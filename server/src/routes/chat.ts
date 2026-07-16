import { Router } from 'express';
import { callTool, extractText, getConfig, listTools } from '../contextStudio.js';
import { answerEnquiry, detectEnquiry } from '../enquiry.js';
import { detectReportIntent, searchAnnualReport } from '../reportSearch.js';
import { detectSkillInvocation } from '../skills.js';
import { webSearch } from '../webSearch.js';

export const chatRouter = Router();

export type ChatMode = 'hybrid' | 'vector' | 'graph' | 'schema' | 'metadata' | 'contexts';

export interface DataContext {
  source: string;
  fields: string[];
  rows: Record<string, string | number>[];
  kpis?: Record<string, number>;
  narrative?: string;
}

/** Prepend a concise data summary to the user message so the Context Studio
 *  query is grounded with the currently loaded dashboard data. */
function buildGroundedMessage(message: string, dataContext?: DataContext): string {
  if (!dataContext || !dataContext.rows?.length) return message;

  const rowSample = dataContext.rows.slice(0, 20);
  const summary = [
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

  return summary;
}

function buildToolCall(mode: ChatMode, message: string): { tool: string; args: Record<string, unknown> } {
  const config = getConfig();
  const base = { context_id: config.contextId, AgentPersona: config.agentPersona };

  switch (mode) {
    case 'vector':
      return { tool: 'context-broker-vector-query', args: { ...base, query: message, top_k: 10 } };
    case 'graph':
      return { tool: 'context-broker-graph-query', args: { ...base, query: message, max_depth: 2, limit: 10 } };
    case 'schema':
      return { tool: 'context-broker-get-context-schema', args: { context_id: config.contextId } };
    case 'metadata':
      return { tool: 'context-broker-get-context-metadata', args: { context_id: config.contextId } };
    case 'contexts':
      return { tool: 'context-broker-get-contexts', args: {} };
    case 'hybrid':
    default:
      return { tool: 'context-broker-hybrid-query', args: { ...base, query: message } };
  }
}

chatRouter.get('/status', async (_request, response) => {
  const config = getConfig();

  try {
    const tools = await listTools();
    response.json({
      online: true,
      contextId: config.contextId,
      agentPersona: config.agentPersona,
      tools: tools.map((tool) => tool.name)
    });
  } catch (error) {
    response.json({
      online: false,
      contextId: config.contextId,
      agentPersona: config.agentPersona,
      tools: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

chatRouter.post('/', async (request, response) => {
  const { message, mode, dataContext } = request.body as {
    message?: string;
    mode?: ChatMode;
    dataContext?: DataContext;
  };
  const chatMode: ChatMode = mode ?? 'hybrid';
  const needsMessage = chatMode === 'hybrid' || chatMode === 'vector' || chatMode === 'graph';

  if (needsMessage && (!message || !message.trim())) {
    response.status(400).json({ error: 'message is required for query modes' });
    return;
  }

  const trimmedMessage = message?.trim() ?? '';
  const startedAt = Date.now();

  // ── Routing flags (parity with api/chat.ts skill-aware routing v2) ──────────
  // Skills ("@skill-name …", "Use the X skill …"), the @context prefix, loaded
  // data, and explicit vector/graph modes all force Context Studio MCP.
  const hasDataContext = (dataContext?.rows?.length ?? 0) > 0;
  const isExplicitCSMode = chatMode === 'vector' || chatMode === 'graph';
  const isContextPrefixed = trimmedMessage.toLowerCase().startsWith('@context');
  const skillInvocation = needsMessage ? detectSkillInvocation(trimmedMessage) : null;
  const forceContextStudio = isExplicitCSMode || isContextPrefixed || hasDataContext || skillInvocation !== null;

  // ── Finance enquiry engine (Section 2 archetypes) ────────────────────────────
  // Root-cause / ranking, projections with confidence, and cash/AR/inventory
  // status questions are answered from the ingested IBM annual-report dataset
  // (internal finance / EPM stand-in), with internet augmentation for
  // competitor context. Prefix a message with @context to bypass this and go
  // straight to Context Studio.
  const enquiryKind = needsMessage && !forceContextStudio ? detectEnquiry(trimmedMessage) : null;
  if (enquiryKind) {
    try {
      const answer = await answerEnquiry(trimmedMessage, enquiryKind);
      response.json({
        reply: answer.reply,
        tool: answer.tool,
        mode: chatMode,
        isError: false,
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : 'Finance enquiry failed',
        tool: 'finance-enquiry',
        mode: chatMode,
        elapsedMs: Date.now() - startedAt
      });
    }
    return;
  }

  // ── Annual report intent detection ──────────────────────────────────────────
  // If the message looks like "<Company> <Year> report", fetch the document
  // directly instead of querying Context Studio. Guarded so skill prompts that
  // mention a company + year are not hijacked.
  const reportIntent = needsMessage && !forceContextStudio ? detectReportIntent(trimmedMessage) : null;
  if (reportIntent) {
    try {
      const result = await searchAnnualReport(reportIntent.company, reportIntent.year);

      const pageInfo = result.pages > 0 ? ` · ${result.pages} pages` : '';
      const header = result.fetched
        ? `✅ Read **${result.title}**${pageInfo} — here is the document content:`
        : `🔍 Searched the web for **${result.title}** — here is what was found:`;

      // Clean up the raw PDF text slightly for readability
      const cleanExcerpt = result.excerpt
        .replace(/\f/g, '\n\n')           // form-feeds → paragraph breaks
        .replace(/[ \t]{3,}/g, '  ')      // collapse excessive spaces
        .replace(/\n{4,}/g, '\n\n\n')     // collapse excessive blank lines
        .trim();

      const lines = [
        `## ${result.title}`,
        '',
        header,
        '',
        cleanExcerpt || '_(No content could be extracted)_',
        '',
        `**Source:** [${result.url}](${result.url})`,
        '',
        result.fetched
          ? `_Ask me to summarize financials, compare with another company, or analyse specific sections._`
          : `_Try asking again or specify the company's investor relations page URL._`
      ].join('\n');

      response.json({
        reply: lines,
        tool: 'report-search',
        mode: chatMode,
        isError: !result.fetched,
        elapsedMs: Date.now() - startedAt,
        reportUrl: result.url,
        // Pass full text back so follow-up queries can be grounded on it
        reportFullText: result.fullText
      });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : 'Report search failed',
        tool: 'report-search',
        mode: chatMode,
        elapsedMs: Date.now() - startedAt
      });
    }
    return;
  }

  // ── General web search path ──────────────────────────────────────────────────
  // Last-resort fallback: only in hybrid mode with no data context, no skill
  // invocation, and no @context prefix.
  const isWebSearch = needsMessage && !forceContextStudio;
  if (isWebSearch) {
    try {
      const result = await webSearch(trimmedMessage);

      // Format search results: snippets list + top page excerpt
      const snippetLines = result.snippets.length > 0
        ? [
            '**Top results:**',
            '',
            ...result.snippets.map((s, i) =>
              `**${i + 1}. [${s.title}](${s.url})**\n${s.snippet}`
            ),
            ''
          ]
        : [];

      const topResultHeader =
        result.snippets.length > 0 && result.url !== `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmedMessage)}`
          ? `**From top result — [${result.url}](${result.url}):**\n`
          : '';

      const lines = [
        `## 🔍 ${result.title}`,
        '',
        ...snippetLines,
        topResultHeader,
        result.excerpt.slice(0, 3000),
        '',
        `**Source:** [${result.url}](${result.url})`,
        '',
        `_Ask me follow-up questions or request a comparison with company financials._`
      ].filter(Boolean).join('\n');

      response.json({
        reply: lines,
        tool: 'web-search',
        mode: chatMode,
        isError: !result.fetched,
        elapsedMs: Date.now() - startedAt,
        reportUrl: result.url,
        reportFullText: result.fullText
      });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : 'Web search failed',
        tool: 'web-search',
        mode: chatMode,
        elapsedMs: Date.now() - startedAt
      });
    }
    return;
  }

  // ── Context Studio path (skills, @context, data loaded, explicit mode) ───────
  const csConfig = getConfig();
  if (!csConfig.url) {
    response.status(503).json({
      error: 'Context Studio is not configured. Provide server/context-studio.json or set the CONTEXT_STUDIO_URL environment variable.',
      tool: 'context-broker',
      mode: chatMode,
      elapsedMs: Date.now() - startedAt
    });
    return;
  }
  // Strip the @context prefix, or rewrite an "@skill-name …" invocation into
  // its canonical "Use the <skill> skill: …" form before sending.
  const csMessage = isContextPrefixed
    ? trimmedMessage.replace(/^@context\s*/i, '').trim()
    : (skillInvocation?.message ?? trimmedMessage);
  const groundedMessage = buildGroundedMessage(csMessage, dataContext);
  const { tool, args } = buildToolCall(chatMode, groundedMessage);

  try {
    const result = await callTool(tool, args);
    response.json({
      reply: extractText(result),
      tool,
      mode: chatMode,
      isError: result.isError ?? false,
      elapsedMs: Date.now() - startedAt,
      skill: skillInvocation?.skill
    });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Context Studio request failed',
      tool,
      mode: chatMode,
      elapsedMs: Date.now() - startedAt
    });
  }
});
