import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callTool, extractText, getConfig, listTools } from '../server/src/contextStudio.js';
import { detectReportIntent, searchAnnualReport } from '../server/src/reportSearch.js';
import { webSearch } from '../server/src/webSearch.js';
import type { ChatMode, DataContext } from '../server/src/routes/chat.js';

function buildGroundedMessage(message: string, dataContext?: DataContext): string {
  if (!dataContext || !dataContext.rows?.length) return message;
  const rowSample = dataContext.rows.slice(0, 20);
  return [
    `[DASHBOARD DATA — source: ${dataContext.source}]`,
    `Fields: ${dataContext.fields.join(', ')}`,
    `Rows (first ${rowSample.length} of ${dataContext.rows.length}):`,
    JSON.stringify(rowSample),
    dataContext.kpis ? `KPIs: ${JSON.stringify(dataContext.kpis)}` : '',
    dataContext.narrative ? `Narrative: ${dataContext.narrative}` : '',
    '[END DASHBOARD DATA]',
    '',
    message
  ].filter(Boolean).join('\n');
}

function buildToolCall(mode: ChatMode, message: string) {
  const config = getConfig();
  const base = { context_id: config.contextId, AgentPersona: config.agentPersona };
  switch (mode) {
    case 'vector':  return { tool: 'context-broker-vector-query', args: { ...base, query: message, top_k: 10 } };
    case 'graph':   return { tool: 'context-broker-graph-query',  args: { ...base, query: message, max_depth: 2, limit: 10 } };
    case 'schema':  return { tool: 'context-broker-get-context-schema',   args: { context_id: config.contextId } };
    case 'metadata':return { tool: 'context-broker-get-context-metadata', args: { context_id: config.contextId } };
    case 'contexts':return { tool: 'context-broker-get-contexts', args: {} };
    default:        return { tool: 'context-broker-hybrid-query', args: { ...base, query: message } };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── GET /api/chat/status ──────────────────────────────────────────────────
  // Vercel routes /api/chat and /api/chat/status to this same file via vercel.json
  if (req.method === 'GET') {
    const config = getConfig();
    try {
      const tools = await listTools();
      res.json({ online: true, contextId: config.contextId, agentPersona: config.agentPersona, tools: tools.map(t => t.name) });
    } catch (error) {
      res.json({ online: false, contextId: config.contextId, agentPersona: config.agentPersona, tools: [], error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { message, mode, dataContext } = req.body as { message?: string; mode?: ChatMode; dataContext?: DataContext };
  const chatMode: ChatMode = mode ?? 'hybrid';
  const needsMessage = chatMode === 'hybrid' || chatMode === 'vector' || chatMode === 'graph';

  if (needsMessage && (!message || !message.trim())) {
    res.status(400).json({ error: 'message is required for query modes' });
    return;
  }

  const trimmedMessage = message?.trim() ?? '';
  const startedAt = Date.now();

  // Report intent
  const reportIntent = needsMessage ? detectReportIntent(trimmedMessage) : null;
  if (reportIntent) {
    try {
      const result = await searchAnnualReport(reportIntent.company, reportIntent.year);
      const pageInfo = result.pages > 0 ? ` · ${result.pages} pages` : '';
      const header = result.fetched ? `✅ Read **${result.title}**${pageInfo} — here is the document content:` : `🔍 Searched the web for **${result.title}** — here is what was found:`;
      const cleanExcerpt = result.excerpt.replace(/\f/g, '\n\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n').trim();
      const lines = [`## ${result.title}`, '', header, '', cleanExcerpt || '_(No content could be extracted)_', '', `**Source:** [${result.url}](${result.url})`, '', result.fetched ? `_Ask me to summarize financials, compare with another company, or analyse specific sections._` : `_Try asking again or specify the company's investor relations page URL._`].join('\n');
      res.json({ reply: lines, tool: 'report-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Report search failed', tool: 'report-search', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // Web search fallback
  const hasDataContext = (dataContext?.rows?.length ?? 0) > 0;
  const isExplicitContextMode = chatMode === 'vector' || chatMode === 'graph';
  const isContextPrefix = trimmedMessage.toLowerCase().startsWith('@context');
  if (needsMessage && !hasDataContext && !isExplicitContextMode && !isContextPrefix) {
    try {
      const result = await webSearch(trimmedMessage);
      const snippetLines = result.snippets.length > 0 ? ['**Top results:**', '', ...result.snippets.map((s, i) => `**${i + 1}. [${s.title}](${s.url})**\n${s.snippet}`), ''] : [];
      const topResultHeader = result.snippets.length > 0 && result.url !== `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmedMessage)}` ? `**From top result — [${result.url}](${result.url}):**\n` : '';
      const lines = [`## 🔍 ${result.title}`, '', ...snippetLines, topResultHeader, result.excerpt.slice(0, 3000), '', `**Source:** [${result.url}](${result.url})`, '', `_Ask me follow-up questions or request a comparison with company financials._`].filter(Boolean).join('\n');
      res.json({ reply: lines, tool: 'web-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Web search failed', tool: 'web-search', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // Context Studio path
  const csMessage = isContextPrefix ? trimmedMessage.replace(/^@context\s*/i, '').trim() : trimmedMessage;
  const groundedMessage = buildGroundedMessage(csMessage, dataContext);
  const { tool, args } = buildToolCall(chatMode, groundedMessage);
  try {
    const result = await callTool(tool, args);
    res.json({ reply: extractText(result), tool, mode: chatMode, isError: result.isError ?? false, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Context Studio request failed', tool, mode: chatMode, elapsedMs: Date.now() - startedAt });
  }
}
