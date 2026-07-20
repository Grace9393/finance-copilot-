import { Router } from 'express';
import { callTool, extractText, getConfig, listTools } from '../contextStudio.js';
import { answerFromDataContext } from '../dataAnswer.js';
import { answerEnquiry, detectEnquiry } from '../enquiry.js';
import { detectDirective } from '../dashboardDirective.js';
import { callIcaTool, extractIcaText, getIcaConfig, listIcaTools } from '../icaMcp.js';
import { detectReportIntent, searchAnnualReport, type ReportAlreadyIngested, type ReportSearchResult } from '../reportSearch.js';
import { runSkill } from '../skillRunner.js';
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

// ── ICA MCP status ────────────────────────────────────────────────────────────
chatRouter.get('/ica/status', async (_request, response) => {
  const config = getIcaConfig();

  if (!config.url) {
    response.json({
      online: false,
      url: '',
      tools: [],
      error: 'ICA_MCP_URL is not configured. Add it to .env.local.'
    });
    return;
  }

  try {
    const tools = await listIcaTools();
    response.json({
      online: true,
      url: config.url,
      tools: tools.map((t) => t.name)
    });
  } catch (error) {
    response.json({
      online: false,
      url: config.url,
      tools: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ── ICA MCP chat ──────────────────────────────────────────────────────────────
// POST /api/chat/ica — send a message to an ICA assistant/agent/model via the
// ICA MCP server. The tool name and model ID are specified in the request body.
chatRouter.post('/ica', async (request, response) => {
  const {
    message,
    tool = 'ica_chat_assistants',
    model,
    files
  } = request.body as {
    message?: string;
    tool?: string;
    model?: string;
    files?: Array<{ type: string; id: string }>;
  };

  if (!message?.trim()) {
    response.status(400).json({ error: 'message is required' });
    return;
  }
  if (!model) {
    response.status(400).json({ error: 'model (assistant/agent/model ID) is required' });
    return;
  }

  const icaConfig = getIcaConfig();
  if (!icaConfig.url) {
    response.status(503).json({
      error: 'ICA MCP is not configured. Set ICA_MCP_URL in .env.local and start the ICA MCP server.'
    });
    return;
  }

  const startedAt = Date.now();
  const args: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: message.trim() }]
  };
  if (files?.length) args.files = files;

  try {
    const result = await callIcaTool(tool, args);
    response.json({
      reply: extractIcaText(result),
      tool,
      model,
      isError: result.isError ?? false,
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'ICA MCP request failed',
      tool,
      model,
      elapsedMs: Date.now() - startedAt
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

  // ── ICA prefix — @ica <message> routes directly to ICA MCP ──────────────────
  // Users prefix with "@ica " to explicitly send the query to ICA via the chat
  // panel without having to use the dedicated ICA section.
  const isIcaPrefixed = trimmedMessage.toLowerCase().startsWith('@ica ');
  if (needsMessage && isIcaPrefixed) {
    const icaConfig = getIcaConfig();

    if (!icaConfig.url) {
      response.status(503).json({
        error: 'ICA MCP is not configured. Set ICA_MCP_URL in .env.local.',
        tool: 'ica-mcp',
        mode: chatMode,
        elapsedMs: Date.now() - startedAt
      });
      return;
    }

    // Default to ica_chat_models; a model is required — without one we instruct
    // the user to use the ICA section which shows available models.
    response.status(400).json({
      error: 'Use the ICA section in the chat panel to select an assistant/agent/model, then send your message, or provide a model ID.',
      tool: 'ica-mcp',
      mode: chatMode,
      elapsedMs: Date.now() - startedAt
    });
    return;
  }

  // ── Routing flags (parity with api/chat.ts skill-aware routing v2) ──────────
  // Skills ("@skill-name …", "Use the X skill …"), the @context prefix, loaded
  // data, and explicit vector/graph modes all force Context Studio MCP.
  const hasDataContext = (dataContext?.rows?.length ?? 0) > 0;
  const isExplicitCSMode = chatMode === 'vector' || chatMode === 'graph';
  const isContextPrefixed = trimmedMessage.toLowerCase().startsWith('@context');
  const skillInvocation = needsMessage ? detectSkillInvocation(trimmedMessage) : null;
  // Only Context-Studio-routed skills force the MCP path — skills with real
  // local implementations (web / report / enquiry / data / pptx) execute below.
  const forceContextStudio = isExplicitCSMode || isContextPrefixed || hasDataContext || skillInvocation?.route === 'context';

  // Dashboard-control directive: chat questions steer the dashboard live
  // (year/geo/country/segment for the EPM view; dimension/measure for the
  // dynamic view built from connected data).
  const dashboardDirective = needsMessage
    ? detectDirective(trimmedMessage, hasDataContext ? dataContext : undefined)
    : undefined;

  // ── Skill execution on real implementations ──────────────────────────────────
  // web-search / report / enquiry / data / pptx skills run on their actual
  // pipelines; runSkill returns null for Context-Studio-routed skills.
  if (skillInvocation && skillInvocation.route !== 'context') {
    try {
      const result = await runSkill(skillInvocation, hasDataContext ? dataContext : undefined);
      if (result) {
        response.json({
          ...result,
          dashboard: dashboardDirective,
          mode: chatMode,
          skill: skillInvocation.skill,
          elapsedMs: Date.now() - startedAt
        });
        return;
      }
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : `Skill ${skillInvocation.skill} failed`,
        tool: skillInvocation.skill,
        mode: chatMode,
        elapsedMs: Date.now() - startedAt
      });
      return;
    }
  }

  // ── Data-grounded answering ──────────────────────────────────────────────────
  // With a data source connected (upload / local path / web URL / Google Sheet /
  // fetched report), plain hybrid questions are answered from the data itself —
  // Context Studio's retrieval tools cannot read ad-hoc uploaded data.
  // @context, vector/graph modes and skill invocations still go to Context Studio.
  if (needsMessage && hasDataContext && chatMode === 'hybrid' && !isContextPrefixed && !skillInvocation) {
    try {
      response.json({
        reply: answerFromDataContext(trimmedMessage, dataContext!),
        dashboard: dashboardDirective,
        tool: 'data-grounded',
        mode: chatMode,
        isError: false,
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Data-grounded answer failed',
        tool: 'data-grounded',
        mode: chatMode,
        elapsedMs: Date.now() - startedAt
      });
    }
    return;
  }

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
        dashboard: dashboardDirective,
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
      const searchOutcome = await searchAnnualReport(reportIntent.company, reportIntent.year);

      // Already ingested in Context Studio — query the knowledge base instead
      // of re-downloading the PDF (parity with the serverless handler).
      if ((searchOutcome as ReportAlreadyIngested).ingested) {
        const ingested = searchOutcome as ReportAlreadyIngested;
        const config = getConfig();
        if (config.url) {
          const csResult = await callTool('context-broker-hybrid-query', {
            context_id: config.contextId,
            AgentPersona: config.agentPersona,
            query: ingested.contextStudioQuery
          });
          response.json({
            reply: extractText(csResult),
            dashboard: dashboardDirective,
            tool: 'context-broker-hybrid-query',
            mode: chatMode,
            isError: csResult.isError ?? false,
            elapsedMs: Date.now() - startedAt
          });
          return;
        }
      }

      const result = searchOutcome as ReportSearchResult;
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
        dashboard: dashboardDirective,
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
        dashboard: dashboardDirective,
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
  const groundedMessage = buildGroundedMessage(csMessage, dataContext, isContextPrefixed);
  // "list documents / what files are in the context" → metadata endpoint;
  // hybrid retrieval searches content and cannot enumerate the library.
  const wantsDocumentList = /\b(list|show|what|which)\b[^.?!]*\b(documents?|files?|sources?)\b|\bdocuments? (list|inventory)\b/i.test(csMessage);
  const { tool, args } = wantsDocumentList
    ? { tool: 'context-broker-get-context-metadata', args: { context_id: getConfig().contextId } as Record<string, unknown> }
    : buildToolCall(chatMode, groundedMessage);

  try {
    const result = await callTool(tool, args);
    response.json({
      reply: extractText(result),
      dashboard: dashboardDirective,
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
