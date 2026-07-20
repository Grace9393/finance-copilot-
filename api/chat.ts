// v2 — skill-aware routing: skills/@context/data/vector/graph → Context Studio; web-search is last-resort fallback
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callTool, extractText, getConfig, listTools } from '../server/src/contextStudio.js';
import { detectDirective } from '../server/src/dashboardDirective.js';
import { answerFromDataContext } from '../server/src/dataAnswer.js';
import { answerEnquiry, detectEnquiry } from '../server/src/enquiry.js';
import { detectReportIntent, searchAnnualReport, type ReportAlreadyIngested } from '../server/src/reportSearch.js';
import { runSkill } from '../server/src/skillRunner.js';
import { detectSkillInvocation } from '../server/src/skills.js';
import { webSearch } from '../server/src/webSearch.js';
import type { ChatMode, DataContext } from '../server/src/routes/chat.js';

// ── Chat helpers ──────────────────────────────────────────────────────────────

/**
 * Ground a Context Studio query with the loaded data - *lightly*.
 *
 * Context Studio queries are semantic: the message becomes an embedding. Dumping
 * 20 raw rows in made queries take 75-130s (gateway timeouts -> error bubbles)
 * and polluted retrieval with unrelated values. We now send a compact schema
 * summary only, and when the user explicitly typed @context we send the bare
 * question - they asked the knowledge base, not their spreadsheet.
 */
function buildGroundedMessage(message: string, dataContext?: DataContext, explicitContextQuery = false): string {
  if (!dataContext || !dataContext.rows?.length || explicitContextQuery) return message;

  const sample = dataContext.rows[0]
    ? Object.entries(dataContext.rows[0]).slice(0, 6).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(', ')
    : '';
  return [
    `[Loaded data: ${dataContext.source} - ${dataContext.rows.length} rows; fields: ${dataContext.fields.slice(0, 15).join(', ')}]`,
    sample ? `[Example row: ${sample}]` : '',
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
  const skillInvocation    = needsMessage ? detectSkillInvocation(trimmedMessage) : null;
  const detectedSkill      = skillInvocation?.skill ?? null;
  const isSkill            = detectedSkill !== null;
  // Only Context-Studio-routed skills force the MCP path — skills with real
  // local implementations (web / report / enquiry / data / pptx) execute below.
  const forceContextStudio = isExplicitCSMode || isContextPrefix || hasDataContext || skillInvocation?.route === 'context';

  // Dashboard-control directive: chat questions steer the dashboard live.
  const dashboardDirective = needsMessage
    ? detectDirective(trimmedMessage, hasDataContext ? dataContext : undefined)
    : undefined;

  // Skill execution on real implementations (web / report / enquiry / data / pptx)
  if (skillInvocation && skillInvocation.route !== 'context') {
    try {
      const result = await runSkill(skillInvocation, hasDataContext ? dataContext : undefined);
      if (result) {
        res.json({ ...result, dashboard: dashboardDirective, mode: chatMode, skill: skillInvocation.skill, elapsedMs: Date.now() - startedAt });
        return;
      }
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : `Skill ${skillInvocation.skill} failed`, tool: skillInvocation.skill, mode: chatMode, elapsedMs: Date.now() - startedAt });
      return;
    }
  }

  // Data-grounded answering: with a data source connected, plain hybrid
  // questions are answered from the data itself (Context Studio retrieval
  // cannot read ad-hoc uploads). @context / vector / graph / skills still go
  // to Context Studio.
  if (needsMessage && hasDataContext && chatMode === 'hybrid' && !isContextPrefix && !isSkill) {
    try {
      res.json({ reply: answerFromDataContext(trimmedMessage, dataContext!), dashboard: dashboardDirective, tool: 'data-grounded', mode: chatMode, isError: false, elapsedMs: Date.now() - startedAt });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Data-grounded answer failed', tool: 'data-grounded', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Finance enquiry engine (root cause / projection / liquidity) ──────────
  // Only runs in hybrid mode when NOT forcing Context Studio and NOT a skill.
  const enquiryKind = needsMessage && !forceContextStudio ? detectEnquiry(trimmedMessage) : null;
  if (enquiryKind) {
    try {
      const answer = await answerEnquiry(trimmedMessage, enquiryKind);
      res.json({ reply: answer.reply, dashboard: dashboardDirective, tool: answer.tool, mode: chatMode, isError: false, elapsedMs: Date.now() - startedAt });
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

      // Already ingested in Context Studio — re-route to CS hybrid query (fast path).
      if ((result as ReportAlreadyIngested).ingested) {
        const ingested = result as ReportAlreadyIngested;
        const config = getConfig();
        if (config.url) {
          const csResult = await callTool('context-broker-hybrid-query', {
            context_id: config.contextId,
            AgentPersona: config.agentPersona,
            query: ingested.contextStudioQuery
          });
          res.json({ reply: extractText(csResult), dashboard: dashboardDirective, tool: 'context-broker-hybrid-query', mode: chatMode, isError: csResult.isError ?? false, elapsedMs: Date.now() - startedAt });
          return;
        }
      }

      const r = result as import('../server/src/reportSearch.js').ReportSearchResult;
      const pageInfo = r.pages > 0 ? ` · ${r.pages} pages` : '';
      const header = r.fetched
        ? `✅ Read **${r.title}**${pageInfo} — here is the document content:`
        : `🔍 Searched the web for **${r.title}** — here is what was found:`;
      const cleanExcerpt = r.excerpt.replace(/\f/g, '\n\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n').trim();
      const lines = [
        `## ${r.title}`, '',
        header, '',
        cleanExcerpt || '_(No content could be extracted)_', '',
        `**Source:** [${r.url}](${r.url})`, '',
        r.fetched
          ? `_Ask me to summarize financials, compare with another company, or analyse specific sections._`
          : `_Try asking again or specify the company's investor relations page URL._`
      ].join('\n');
      res.json({ reply: lines, dashboard: dashboardDirective, tool: 'report-search', mode: chatMode, isError: !r.fetched, elapsedMs: Date.now() - startedAt, reportUrl: r.url, reportFullText: r.fullText });
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
    const csMessage = isContextPrefix
      ? trimmedMessage.replace(/^@context\s*/i, '').trim()
      : (skillInvocation?.message ?? trimmedMessage);
    const groundedMessage = buildGroundedMessage(csMessage, dataContext, isContextPrefix);
    // "list documents / what files are in the context" → metadata endpoint;
    // hybrid retrieval searches content and cannot enumerate the library.
    const wantsDocumentList = /\b(list|show|what|which)\b[^.?!]*\b(documents?|files?|sources?)\b|\bdocuments? (list|inventory)\b/i.test(csMessage);
    const { tool, args } = wantsDocumentList
      ? { tool: 'context-broker-get-context-metadata', args: { context_id: config.contextId } as Record<string, unknown> }
      : buildToolCall(chatMode, groundedMessage);
    try {
      const result = await callTool(tool, args);
      res.json({ reply: extractText(result), dashboard: dashboardDirective, tool, mode: chatMode, isError: result.isError ?? false, elapsedMs: Date.now() - startedAt, skill: detectedSkill ?? undefined });
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
      res.json({ reply: lines, dashboard: dashboardDirective, tool: 'web-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
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
