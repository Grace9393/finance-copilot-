import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callTool, extractText, getConfig, listTools } from '../server/src/contextStudio.js';
import { answerEnquiry, detectEnquiry } from '../server/src/enquiry.js';
import { detectReportIntent, searchAnnualReport } from '../server/src/reportSearch.js';
import { webSearch } from '../server/src/webSearch.js';
import type { ChatMode, DataContext } from '../server/src/routes/chat.js';

// ── Skill-intent detection ────────────────────────────────────────────────────

/** Named skills surfaced in the client Skills drawer. */
const SKILL_NAMES = [
  'annual-report-analyzer',
  'earnings-peer-comparison',
  'financial-variance-analysis',
  'margin-lever-playbook',
  'file-to-pptx',
  'pdf-file-reader',
  'web-document-search',
  'annual-report-search',
  'web-search',
  'industry-search',
] as const;

/**
 * Returns the matched skill name when the message is a skill invocation,
 * e.g. "Use the financial-variance-analysis skill to …"
 * These must always reach Context Studio rather than the web-search fallback.
 */
function detectSkill(message: string): string | null {
  // "Use the X skill …" — generic pattern
  const genericMatch = message.match(/\buse\s+the\s+([\w-]+)\s+skill\b/i);
  if (genericMatch) return genericMatch[1].toLowerCase();
  // Explicit skill name anywhere in the message
  for (const name of SKILL_NAMES) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(message)) return name;
  }
  return null;
}

// ── Chat helpers ──────────────────────────────────────────────────────────────

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
    case 'vector':   return { tool: 'context-broker-vector-query',         args: { ...base, query: message, top_k: 10 } };
    case 'graph':    return { tool: 'context-broker-graph-query',          args: { ...base, query: message, max_depth: 2, limit: 10 } };
    case 'schema':   return { tool: 'context-broker-get-context-schema',   args: { context_id: config.contextId } };
    case 'metadata': return { tool: 'context-broker-get-context-metadata', args: { context_id: config.contextId } };
    case 'contexts': return { tool: 'context-broker-get-contexts',         args: {} };
    default:         return { tool: 'context-broker-hybrid-query',         args: { ...base, query: message } };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── GET /api/chat/status ──────────────────────────────────────────────────
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

  // Determine routing flags up-front so every branch can inspect them.
  const hasDataContext     = (dataContext?.rows?.length ?? 0) > 0;
  const isExplicitCSMode   = chatMode === 'vector' || chatMode === 'graph';
  const isContextPrefix    = trimmedMessage.toLowerCase().startsWith('@context');
  const detectedSkill      = needsMessage ? detectSkill(trimmedMessage) : null;
  const isSkill            = detectedSkill !== null;
  // Force Context Studio when: explicit mode, @context prefix, data is loaded, or a skill is invoked.
  const forceContextStudio = isExplicitCSMode || isContextPrefix || hasDataContext || isSkill;

  // ── Finance enquiry engine (root cause / projection / liquidity) ──────────
  // Only runs in hybrid mode when NOT forcing Context Studio and NOT a skill.
  const enquiryKind = needsMessage && !forceContextStudio ? detectEnquiry(trimmedMessage) : null;
  if (enquiryKind) {
    try {
      const answer = await answerEnquiry(trimmedMessage, enquiryKind);
      res.json({ reply: answer.reply, tool: answer.tool, mode: chatMode, isError: false, elapsedMs: Date.now() - startedAt });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Finance enquiry failed', tool: 'finance-enquiry', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Annual report intent (only when NOT forcing Context Studio) ───────────
  // Guard prevents hijacking skill prompts that mention a company + year.
  const reportIntent = needsMessage && !forceContextStudio ? detectReportIntent(trimmedMessage) : null;
  if (reportIntent) {
    try {
      const result = await searchAnnualReport(reportIntent.company, reportIntent.year);
      const pageInfo = result.pages > 0 ? ` · ${result.pages} pages` : '';
      const header = result.fetched
        ? `✅ Read **${result.title}**${pageInfo} — here is the document content:`
        : `🔍 Searched the web for **${result.title}** — here is what was found:`;
      const cleanExcerpt = result.excerpt.replace(/\f/g, '\n\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n').trim();
      const lines = [
        `## ${result.title}`, '',
        header, '',
        cleanExcerpt || '_(No content could be extracted)_', '',
        `**Source:** [${result.url}](${result.url})`, '',
        result.fetched
          ? `_Ask me to summarize financials, compare with another company, or analyse specific sections._`
          : `_Try asking again or specify the company's investor relations page URL._`
      ].join('\n');
      res.json({ reply: lines, tool: 'report-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Report search failed', tool: 'report-search', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Context Studio path (skills, @context, data loaded, explicit mode) ────
  if (forceContextStudio) {
    const config = getConfig();
    if (!config.url) {
      res.status(503).json({ error: 'Context Studio is not configured. Set the CONTEXT_STUDIO_URL environment variable.', tool: 'context-broker', mode: chatMode, elapsedMs: Date.now() - startedAt });
      return;
    }
    const csMessage = isContextPrefix ? trimmedMessage.replace(/^@context\s*/i, '').trim() : trimmedMessage;
    const groundedMessage = buildGroundedMessage(csMessage, dataContext);
    const { tool, args } = buildToolCall(chatMode, groundedMessage);
    try {
      const result = await callTool(tool, args);
      res.json({ reply: extractText(result), tool, mode: chatMode, isError: result.isError ?? false, elapsedMs: Date.now() - startedAt, skill: detectedSkill ?? undefined });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Context Studio request failed', tool, mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Web search fallback (hybrid, no data, no skill, no @context) ──────────
  if (needsMessage) {
    try {
      const result = await webSearch(trimmedMessage);
      const snippetLines = result.snippets.length > 0
        ? ['**Top results:**', '', ...result.snippets.map((s, i) => `**${i + 1}. [${s.title}](${s.url})**\n${s.snippet}`), '']
        : [];
      const topResultHeader = result.snippets.length > 0 && result.url !== `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmedMessage)}`
        ? `**From top result — [${result.url}](${result.url}):**\n`
        : '';
      const lines = [
        `## 🔍 ${result.title}`, '',
        ...snippetLines,
        topResultHeader,
        result.excerpt.slice(0, 3000), '',
        `**Source:** [${result.url}](${result.url})`, '',
        `_Ask me follow-up questions or request a comparison with company financials._`
      ].filter(Boolean).join('\n');
      res.json({ reply: lines, tool: 'web-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Web search failed', tool: 'web-search', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Non-query modes (schema / metadata / contexts) ────────────────────────
  const config = getConfig();
  if (!config.url) {
    res.status(503).json({ error: 'Context Studio is not configured. Set the CONTEXT_STUDIO_URL environment variable.', tool: 'context-broker', mode: chatMode, elapsedMs: Date.now() - startedAt });
    return;
  }
  const { tool, args } = buildToolCall(chatMode, trimmedMessage);
  try {
    const result = await callTool(tool, args);
    res.json({ reply: extractText(result), tool, mode: chatMode, isError: result.isError ?? false, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Context Studio request failed', tool, mode: chatMode, elapsedMs: Date.now() - startedAt });
  }
}
