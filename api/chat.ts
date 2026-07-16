import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatMode = 'hybrid' | 'vector' | 'graph' | 'schema' | 'metadata' | 'contexts';

interface DataContext {
  source: string;
  fields: string[];
  rows: Record<string, string | number>[];
  kpis?: Record<string, number>;
  narrative?: string;
}

interface ContextStudioConfig {
  url: string;
  bearerToken: string;
  apiKey: string;
  contextId: string;
  agentPersona: string;
}

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ContextPassage {
  text?: string;
  content?: string;
  title?: string;
  source?: string;
  score?: number;
  summary?: string;
  label?: string;
  name?: string;
  [key: string]: unknown;
}

// ── Context Studio config ─────────────────────────────────────────────────────

function getConfig(): ContextStudioConfig {
  let fileConfig: Partial<ContextStudioConfig> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fileConfig = require('../server/context-studio.json') as ContextStudioConfig;
  } catch { /* no local config file — use env vars */ }

  return {
    url:          process.env.CONTEXT_STUDIO_URL          ?? fileConfig.url          ?? '',
    bearerToken:  process.env.CONTEXT_STUDIO_BEARER       ?? fileConfig.bearerToken  ?? '',
    apiKey:       process.env.CONTEXT_STUDIO_API_KEY      ?? fileConfig.apiKey       ?? '',
    contextId:    process.env.CONTEXT_STUDIO_CONTEXT_ID   ?? fileConfig.contextId    ?? '',
    agentPersona: process.env.CONTEXT_STUDIO_PERSONA      ?? fileConfig.agentPersona ?? 'FinanceCoPilot',
  };
}

// ── MCP JSON-RPC session (per-invocation — serverless has no persistent module state) ─────

let sessionId: string | null = null;
let initialized = false;
let rpcId = 0;

function parseSseBody(body: string): JsonRpcResponse | null {
  let last: JsonRpcResponse | null = null;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed.result !== undefined || parsed.error !== undefined) last = parsed;
    } catch { /* ignore non-JSON SSE heartbeats */ }
  }
  return last;
}

async function rpc(method: string, params: Record<string, unknown>, isNotification = false): Promise<JsonRpcResponse | null> {
  const config = getConfig();
  if (!config.url) throw new Error('Context Studio URL is not configured (set CONTEXT_STUDIO_URL)');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (config.bearerToken) headers['Authorization'] = `Bearer ${config.bearerToken}`;
  if (config.apiKey) headers['x-api-key'] = config.apiKey;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const body: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (!isNotification) body.id = ++rpcId;

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const newSession = response.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Context Studio HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (isNotification) return null;

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  const parsed = contentType.includes('text/event-stream') ? parseSseBody(raw) : (JSON.parse(raw) as JsonRpcResponse);

  if (!parsed) throw new Error('Context Studio returned an empty response');
  if (parsed.error) throw new Error(`Context Studio error ${parsed.error.code}: ${parsed.error.message}`);

  return parsed;
}

async function ensureSession(): Promise<void> {
  if (initialized) return;
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'finance-copilot', version: '1.0.0' } });
  await rpc('notifications/initialized', {}, true);
  initialized = true;
}

function resetSession() { sessionId = null; initialized = false; }

async function withSessionRetry<T>(fn: () => Promise<T>): Promise<T> {
  await ensureSession();
  try { return await fn(); } catch {
    resetSession();
    await ensureSession();
    return fn();
  }
}

async function listTools(): Promise<{ name: string }[]> {
  const res = await withSessionRetry(() => rpc('tools/list', {}));
  return ((res?.result as { tools?: { name: string }[] })?.tools) ?? [];
}

async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const res = await withSessionRetry(() => rpc('tools/call', { name, arguments: args }));
  return (res?.result ?? {}) as McpToolResult;
}

// ── Context Studio result text extraction ─────────────────────────────────────

function extractPassages(items: unknown[]): { text: string; label: string }[] {
  const seen = new Set<string>();
  const out: { text: string; label: string }[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const p = item as ContextPassage;
    const text = (p.text ?? p.content ?? p.summary ?? '').toString().trim();
    if (!text || text.length < 10) continue;
    const key = text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = (p.title ?? p.name ?? p.label ?? '').toString().trim();
    const source = (p.source ?? '').toString().trim();
    const score = typeof p.score === 'number' ? ` (score: ${p.score.toFixed(3)})` : '';
    const label = [title, source].filter(Boolean).join(' — ') + score;
    out.push({ text, label: label || 'Context passage' });
  }
  return out;
}

function formatPassages(passages: { text: string; label: string }[]): string {
  if (passages.length === 0) return '_(No matching content found in the context)_';
  return passages.map((p, i) => {
    const header = p.label !== 'Context passage' ? `**${i + 1}. ${p.label}**` : `**${i + 1}.**`;
    return `${header}\n${p.text}`;
  }).join('\n\n---\n\n');
}

function tryParseContextResult(raw: string): string | null {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const data = obj as Record<string, unknown>;

  if (typeof data.answer === 'string' && data.answer.trim()) {
    const resultItems = Array.isArray(data.results) ? data.results as unknown[] : [];
    const passages = extractPassages(resultItems);
    const sourceBlock = passages.length > 0
      ? '\n\n**Sources retrieved:**\n' + passages.map((p, i) => `${i + 1}. ${p.label}`).join('\n')
      : '';
    return data.answer.trim() + sourceBlock;
  }
  if (Array.isArray(data.results) && data.results.length > 0) return formatPassages(extractPassages(data.results as unknown[]));
  if (Array.isArray(data.nodes)) return formatPassages(extractPassages(data.nodes as unknown[]));
  if (Array.isArray(obj) && obj.length > 0) return formatPassages(extractPassages(obj as unknown[]));
  return null;
}

function extractText(result: McpToolResult): string {
  const rawBlocks: string[] = [];
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) rawBlocks.push(item.text.trim());
    }
  }
  for (const block of rawBlocks) {
    const parsed = tryParseContextResult(block);
    if (parsed) return parsed;
  }
  const joined = rawBlocks.join('\n\n');
  if (joined) return joined;
  if (result.structuredContent !== undefined) {
    const parsed = tryParseContextResult(JSON.stringify(result.structuredContent));
    if (parsed) return parsed;
    return JSON.stringify(result.structuredContent, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

// ── Web search ────────────────────────────────────────────────────────────────

function stripHtml(html: string, maxChars = 40000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
}

async function fetchPage(url: string, maxChars = 40000): Promise<{ text: string; finalUrl: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinanceCopilot/1.0)', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(15000),
    });
    const finalUrl = res.url ?? url;
    if (!res.ok) return { text: '', finalUrl };
    return { text: stripHtml(await res.text(), maxChars), finalUrl };
  } catch {
    return { text: '', finalUrl: url };
  }
}

interface SearchHit { title: string; url: string; snippet: string; }

function parseDdgResults(html: string, limit = 5): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|$)/gi) ?? [];
  for (const block of blocks.slice(0, limit * 2)) {
    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/i) ?? block.match(/href="(https?:\/\/[^"]+)"/i);
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    if (!urlMatch) continue;
    const url = urlMatch[1].startsWith('//') ? `https:${urlMatch[1]}` : urlMatch[1];
    if (!url.startsWith('http')) continue;
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : url;
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    hits.push({ title, url, snippet });
    if (hits.length >= limit) break;
  }
  return hits;
}

async function webSearch(query: string) {
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let searchHtml = '';
  try { searchHtml = (await fetchPage(searchUrl, 80000)).text; } catch { /* ignore */ }
  const hits = parseDdgResults(searchHtml);
  const rawSnippets = searchHtml.slice(0, 6000);
  if (hits.length === 0) {
    return { query, url: searchUrl, title: `Web search: ${query}`, excerpt: rawSnippets || '_(No results found)_', fullText: rawSnippets, snippets: [], fetched: rawSnippets.length > 0 };
  }
  const topHit = hits[0];
  const { text: pageText, finalUrl } = await fetchPage(topHit.url);
  const hasPage = pageText.length > 200;
  const snippetsSummary = hits.map((h, i) => `**${i + 1}. ${h.title}**\n${h.snippet}\n${h.url}`).join('\n\n');
  return {
    query, url: hasPage ? finalUrl : searchUrl, title: hasPage ? topHit.title : `Search results: ${query}`,
    excerpt: hasPage ? pageText.slice(0, 4000) : snippetsSummary.slice(0, 4000),
    fullText: hasPage ? pageText : snippetsSummary,
    snippets: hits, fetched: true,
  };
}

// ── Annual report detection ───────────────────────────────────────────────────

const KNOWN_REPORT_URLS: Record<string, Record<string, string>> = {
  ibm: {
    '2025': 'https://www.ibm.com/downloads/documents/us-en/15db52348fc203a4',
    '2024': 'https://www.ibm.com/annualreport/assets/downloads/IBM_Annual_Report_2024.pdf',
    '2023': 'https://www.ibm.com/annualreport/assets/downloads/IBM_Annual_Report_2023.pdf',
  },
  apple: { '2024': 'https://www.annualreports.com/HostedData/AnnualReports/PDF/NASDAQ_AAPL_2024.pdf' },
  microsoft: { '2024': 'https://microsoft.gcs-web.com/static-files/annual-reports/2024-annual-report.pdf' },
};

function detectReportIntent(message: string): { company: string; year: string } | null {
  const currentYear = String(new Date().getFullYear());
  const withYear    = /\b([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)\s+(?:FY\s*)?(\d{4})\s+(?:annual\s+)?(?:report|10-K|10K|results|filing|earnings)\b/i;
  const yearFirst   = /\b(?:FY\s*)?(\d{4})\s+(?:annual\s+)?(?:report|10-K|results|filing)\s+(?:for\s+)?([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)\b/i;
  const noYear      = /\b(?:annual\s+report|10-K|latest\s+report)\s+(?:for\s+|of\s+)?([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)(?:\s*$|[.,!?])/i;
  const companyFirst= /\b([A-Za-z][A-Za-z0-9\s&.,\-]{1,30}?)\s+(?:annual\s+report|latest\s+report|10-K)\b/i;
  let m = message.match(withYear);    if (m) return { company: m[1].trim(), year: m[2].trim() };
  m = message.match(yearFirst);       if (m) return { company: m[2].trim(), year: m[1].trim() };
  m = message.match(noYear);          if (m) return { company: m[1].trim(), year: currentYear };
  m = message.match(companyFirst);    if (m) return { company: m[1].trim(), year: currentYear };
  return null;
}

async function fetchAndParsePdf(url: string): Promise<{ text: string; pages: number; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinanceCopilot/1.0)', Accept: 'application/pdf,*/*' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const finalUrl = res.url ?? url;
    if (!contentType.includes('pdf') && !finalUrl.toLowerCase().includes('.pdf')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfModule = await import('pdf-parse') as any;
    const pdfParse = (pdfModule.default ?? pdfModule) as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? '').trim();
    if (!text) return null;
    return { text, pages: parsed.numpages, finalUrl };
  } catch { return null; }
}

async function searchAnnualReport(company: string, year: string) {
  const key = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const knownUrl = KNOWN_REPORT_URLS[key]?.[year];
  if (knownUrl) {
    const parsed = await fetchAndParsePdf(knownUrl);
    if (parsed) return { company, year, url: parsed.finalUrl, title: `${company} ${year} Annual Report`, excerpt: parsed.text.slice(0, 4000), pages: parsed.pages, fullText: parsed.text.slice(0, 60000), fetched: true };
  }
  const searchQuery = encodeURIComponent(`${company} ${year} annual report filetype:pdf`);
  const searchUrl = `https://duckduckgo.com/html/?q=${searchQuery}`;
  const { text: searchText } = await fetchPage(searchUrl, 20000);
  const pdfUrlMatch = searchText.match(/https?:\/\/[^\s"'<>]+\.pdf(?:[?#][^\s"'<>]*)?/i);
  if (pdfUrlMatch) {
    const parsed = await fetchAndParsePdf(pdfUrlMatch[0]);
    if (parsed) return { company, year, url: parsed.finalUrl, title: `${company} ${year} Annual Report`, excerpt: parsed.text.slice(0, 4000), pages: parsed.pages, fullText: parsed.text.slice(0, 60000), fetched: true };
  }
  const excerpt = searchText.slice(0, 2000);
  return { company, year, url: searchUrl, title: `Search results: ${company} ${year} annual report`, excerpt: excerpt || '_(No results found)_', pages: 0, fullText: excerpt, fetched: excerpt.length > 0 };
}

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

function isSkillInvocation(message: string): boolean {
  return detectSkill(message) !== null;
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
    '[END DASHBOARD DATA]', '', message,
  ].filter(Boolean).join('\n');
}

function buildToolCall(mode: ChatMode, message: string, config: ContextStudioConfig) {
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
  // Reset per-invocation MCP session state (serverless: no shared module state between requests)
  sessionId = null;
  initialized = false;
  rpcId = 0;

  // ── GET /api/chat/status ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const config = getConfig();
    if (!config.url) {
      res.json({ online: false, contextId: config.contextId, agentPersona: config.agentPersona, tools: [], error: 'CONTEXT_STUDIO_URL not configured' });
      return;
    }
    try {
      const tools = await listTools();
      res.json({ online: true, contextId: config.contextId, agentPersona: config.agentPersona, tools: tools.map((t) => t.name) });
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

  // ── Annual report intent (only when NOT forcing Context Studio) ───────────
  // This avoids hijacking skill prompts that mention a company + year.
  const reportIntent = needsMessage && !forceContextStudio ? detectReportIntent(trimmedMessage) : null;
  if (reportIntent) {
    try {
      const result = await searchAnnualReport(reportIntent.company, reportIntent.year);
      const pageInfo = result.pages > 0 ? ` · ${result.pages} pages` : '';
      const header = result.fetched
        ? `✅ Read **${result.title}**${pageInfo} — here is the document content:`
        : `🔍 Searched the web for **${result.title}** — here is what was found:`;
      const cleanExcerpt = result.excerpt.replace(/\f/g, '\n\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n').trim();
      const lines = [`## ${result.title}`, '', header, '', cleanExcerpt || '_(No content could be extracted)_', '', `**Source:** [${result.url}](${result.url})`, '', result.fetched ? `_Ask me to summarize financials, compare with another company, or analyse specific sections._` : `_Try asking again or specify the company's investor relations page URL._`].join('\n');
      res.json({ reply: lines, tool: 'report-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Report search failed', tool: 'report-search', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Context Studio path (skills, @context, data loaded, explicit mode) ────
  const config = getConfig();
  if (forceContextStudio) {
    if (!config.url) {
      res.status(503).json({ error: 'Context Studio is not configured. Set the CONTEXT_STUDIO_URL environment variable.', tool: 'context-broker', mode: chatMode, elapsedMs: Date.now() - startedAt });
      return;
    }
    const csMessage = isContextPrefix ? trimmedMessage.replace(/^@context\s*/i, '').trim() : trimmedMessage;
    const groundedMessage = buildGroundedMessage(csMessage, dataContext);
    const { tool, args } = buildToolCall(chatMode, groundedMessage, config);
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
        ? ['**Top results:**', '', ...result.snippets.map((s: SearchHit, i: number) => `**${i + 1}. [${s.title}](${s.url})**\n${s.snippet}`), '']
        : [];
      const lines = [`## 🔍 ${result.title}`, '', ...snippetLines, result.excerpt.slice(0, 3000), '', `**Source:** [${result.url}](${result.url})`].filter(Boolean).join('\n');
      res.json({ reply: lines, tool: 'web-search', mode: chatMode, isError: !result.fetched, elapsedMs: Date.now() - startedAt, reportUrl: result.url, reportFullText: result.fullText });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Web search failed', tool: 'web-search', mode: chatMode, elapsedMs: Date.now() - startedAt });
    }
    return;
  }

  // ── Non-query modes (schema / metadata / contexts) without Context Studio ──
  if (!config.url) {
    res.status(503).json({ error: 'Context Studio is not configured. Set the CONTEXT_STUDIO_URL environment variable.', tool: 'context-broker', mode: chatMode, elapsedMs: Date.now() - startedAt });
    return;
  }
  const { tool, args } = buildToolCall(chatMode, trimmedMessage, config);
  try {
    const result = await callTool(tool, args);
    res.json({ reply: extractText(result), tool, mode: chatMode, isError: result.isError ?? false, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Context Studio request failed', tool, mode: chatMode, elapsedMs: Date.now() - startedAt });
  }
}
