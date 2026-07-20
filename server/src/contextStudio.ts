import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface ContextStudioConfig {
  url: string;
  bearerToken: string;
  apiKey: string;
  contextId: string;
  agentPersona: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface McpToolResult {
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

// Reset per-invocation in serverless — no module-level state persists between cold starts
let cachedConfig: ContextStudioConfig | null = null;
// Also reset session state so each serverless invocation gets a fresh MCP session

function loadFileConfig(): Partial<ContextStudioConfig> {
  // Try to load from file (local dev) — silently skip if missing.
  // fs + cwd-relative paths work in both ESM (tsx / node dist) and serverless
  // CJS bundles; on Vercel the file is absent and env vars are used instead.
  const candidates = [
    resolve(process.cwd(), 'context-studio.json'),          // cwd = server/
    resolve(process.cwd(), 'server', 'context-studio.json') // cwd = repo root
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf-8')) as ContextStudioConfig;
    } catch { /* try next candidate */ }
  }
  return {};
}

export function getConfig(): ContextStudioConfig {
  if (!cachedConfig) {
    const file = loadFileConfig();
    cachedConfig = {
      url:          process.env.CONTEXT_STUDIO_URL     ?? file.url          ?? '',
      bearerToken:  process.env.CONTEXT_STUDIO_BEARER  ?? file.bearerToken  ?? '',
      apiKey:       process.env.CONTEXT_STUDIO_API_KEY ?? file.apiKey       ?? '',
      contextId:    process.env.CONTEXT_STUDIO_CONTEXT_ID ?? file.contextId ?? '',
      agentPersona: process.env.CONTEXT_STUDIO_PERSONA ?? file.agentPersona ?? 'FinanceCoPilot'
    };
  }

  return cachedConfig;
}

let sessionId: string | null = null;
let initialized = false;
let rpcId = 0;

function parseSseBody(body: string): JsonRpcResponse | null {
  let last: JsonRpcResponse | null = null;

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed.result !== undefined || parsed.error !== undefined) {
        last = parsed;
      }
    } catch {
      // ignore non-JSON SSE lines (heartbeats etc.)
    }
  }

  return last;
}

async function rpc(method: string, params: Record<string, unknown>, isNotification = false): Promise<JsonRpcResponse | null> {
  const config = getConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${config.bearerToken}`,
    'x-api-key': config.apiKey
  };

  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const body: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (!isNotification) {
    body.id = ++rpcId;
  }

  // Fail fast instead of hanging: some broker calls (notably graph traversal on
  // large contexts) run for 3+ minutes and then error anyway. A bounded wait
  // lets the caller return a useful message while the user is still watching.
  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.CONTEXT_STUDIO_TIMEOUT_MS ?? 55000))
  });

  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId) {
    sessionId = newSessionId;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Context Studio gateway HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (isNotification) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  const parsed = contentType.includes('text/event-stream')
    ? parseSseBody(raw)
    : (JSON.parse(raw) as JsonRpcResponse);

  if (!parsed) {
    throw new Error('Context Studio gateway returned an empty response');
  }

  if (parsed.error) {
    throw new Error(`Context Studio error ${parsed.error.code}: ${parsed.error.message}`);
  }

  return parsed;
}

async function ensureSession(): Promise<void> {
  if (initialized) {
    return;
  }

  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'finance-studio', version: '1.0.0' }
  });
  await rpc('notifications/initialized', {}, true);
  initialized = true;
}

function resetSession(): void {
  sessionId = null;
  initialized = false;
}

async function withSessionRetry<T>(operation: () => Promise<T>): Promise<T> {
  await ensureSession();

  try {
    return await operation();
  } catch (error) {
    // Session may have expired on the gateway side — start over once.
    resetSession();
    await ensureSession();
    return operation();
  }
}

export async function listTools(): Promise<McpToolInfo[]> {
  const response = await withSessionRetry(() => rpc('tools/list', {}));
  const result = response?.result as { tools?: McpToolInfo[] } | undefined;
  return result?.tools ?? [];
}

/** True when the failure was our bounded-wait timeout rather than a broker error. */
export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const message = error instanceof Error ? error.message : String(error);
  return name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|aborted/i.test(message);
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const response = await withSessionRetry(() => rpc('tools/call', { name, arguments: args }));
  return (response?.result ?? {}) as McpToolResult;
}

/**
 * Parse a Context Studio result into a readable synthesised answer.
 *
 * Observed response shapes (context-broker tools):
 *   A) { answer: string, results: [...] }
 *   B) { results: [...] } or top-level array of passages
 *   C) { nodes: [...] } — graph result
 *   D) { items: [ { content, metadata:{title, score, source_file,…} } ] } — vector query
 *   E) { items: { vector: [...], graph: [ { graph_data:{nodes:[…]} } ], … } } — hybrid query
 *      Graph node data lives in node.properties.properties as a stringified dict.
 *
 * We extract document content and graph entity data, deduplicate, and format
 * them as a readable answer with source attribution rather than a JSON dump.
 */
export function extractText(result: McpToolResult): string {
  // Collect all raw text blocks from content[]
  const rawBlocks: string[] = [];
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
        rawBlocks.push(item.text.trim());
      }
    }
  }

  // Try to parse each block as JSON — Context Studio often wraps results in JSON
  for (const block of rawBlocks) {
    const parsed = tryParseContextResult(block);
    if (parsed) return parsed;
  }

  // Plain text — return as-is if it's already readable
  const joined = rawBlocks.join('\n\n');
  if (joined) return joined;

  // structuredContent fallback — parse it too
  if (result.structuredContent !== undefined) {
    const parsed = tryParseContextResult(JSON.stringify(result.structuredContent));
    if (parsed) return parsed;
    return JSON.stringify(result.structuredContent, null, 2);
  }

  return JSON.stringify(result, null, 2);
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

/**
 * Attempt to parse a raw JSON string from Context Studio and format it
 * as a readable answer. Returns null if the string is not parseable JSON
 * or does not match the expected shape.
 */
function tryParseContextResult(raw: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null; // not JSON — caller handles plain text
  }

  if (!obj || typeof obj !== 'object') return null;

  const data = obj as Record<string, unknown>;

  // Shape F: { context_metadata: { manually_ingested_documents: [...] } }
  if (data.context_metadata && typeof data.context_metadata === 'object') {
    const meta = data.context_metadata as Record<string, unknown>;
    const docs = Array.isArray(meta.manually_ingested_documents) ? meta.manually_ingested_documents as Record<string, unknown>[] : [];
    if (docs.length > 0) {
      const rows = docs.map((d) => ({
        File: String(d.file_name ?? ''),
        Type: String(d.file_type ?? ''),
        Status: String(d.ingestion_status ?? ''),
        'Graph nodes': Number(d.nodes_extracted ?? 0),
        Ingested: String(d.ingested_at ?? '').slice(0, 10)
      }));
      const ready = rows.filter((r) => r.Status.toLowerCase() === 'ready').length;
      const pending = rows.length - ready;
      return [
        `## Documents in context ${String(meta.name ?? meta.context_id ?? '')}`,
        '',
        '```json',
        JSON.stringify(rows, null, 1),
        '```',
        '',
        `**${rows.length} documents** — ${ready} ready, ${pending} pending.` +
        (pending > 0 ? ' ⚠️ Pending documents are not yet queryable (no chunks/embeddings) — re-trigger their ingestion in Context Studio.' : '')
      ].join('\n');
    }
  }

  // Shape D: { items: [...] } — vector query result
  if (Array.isArray(data.items)) {
    return formatPassages(extractPassages(data.items as unknown[]));
  }

  // Shape E: { items: { vector: [...], graph: [...], scratchpad: [...] } } — hybrid query
  if (data.items && typeof data.items === 'object') {
    const groups = data.items as Record<string, unknown>;
    // Document passages first, knowledge-graph entities after
    const order = Object.keys(groups).sort((a, b) => (a === 'graph' ? 1 : 0) - (b === 'graph' ? 1 : 0));
    const passages: { text: string; label: string }[] = [];
    for (const sourceName of order) {
      const group = groups[sourceName];
      if (!Array.isArray(group)) continue;
      if (sourceName === 'graph') {
        passages.push(...extractGraphPassages(group as unknown[]));
      } else {
        passages.push(...extractPassages(group as unknown[]));
      }
    }
    return formatPassages(dedupePassages(passages));
  }

  // Shape A: { answer: string, results: [...] }
  if (typeof data.answer === 'string' && data.answer.trim()) {
    const resultItems = Array.isArray(data.results) ? (data.results as unknown[]) : [];
    const passages = extractPassages(resultItems);
    const sourceBlock = passages.length > 0
      ? '\n\n**Sources retrieved:**\n' + passages.map((p, i) => `${i + 1}. ${p.label}`).join('\n')
      : '';
    return data.answer.trim() + sourceBlock;
  }

  // Shape B: { results: [...] } — synthesise from passages
  if (Array.isArray(data.results) && data.results.length > 0) {
    return formatPassages(extractPassages(data.results as unknown[]));
  }

  // Shape C: { nodes: [...], edges: [...] } — graph result
  if (Array.isArray(data.nodes)) {
    return formatPassages(extractPassages(data.nodes as unknown[]));
  }

  // Shape D: top-level array of passage objects
  if (Array.isArray(obj) && obj.length > 0) {
    return formatPassages(extractPassages(obj as unknown[]));
  }

  return null;
}

/** Pull text + metadata out of a heterogeneous passage/node array. */
function extractPassages(items: unknown[]): { text: string; label: string }[] {
  const out: { text: string; label: string }[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const p = item as ContextPassage;
    const meta = (p.metadata && typeof p.metadata === 'object' ? p.metadata : {}) as Record<string, unknown>;

    const text = (p.text ?? p.content ?? p.summary ?? '').toString().trim();
    if (!text || text.length < 10) continue;
    // Skip graph placeholder summaries ("Graph traversal with N nodes")
    if (/^Graph traversal with \d+ nodes?$/i.test(text)) continue;

    const title = (p.title ?? meta.title ?? p.name ?? p.label ?? meta.section_title ?? '').toString().trim();
    const source = (meta.source_file ?? p.source ?? '').toString().trim();
    const scoreVal = typeof p.score === 'number' ? p.score : typeof meta.score === 'number' ? meta.score : undefined;
    const score = typeof scoreVal === 'number' ? ` (score: ${scoreVal.toFixed(3)})` : '';
    const label = [title, source].filter(Boolean).join(' — ') + score;

    out.push({ text, label: label || 'Context passage' });
  }

  return dedupePassages(out);
}

/** Deduplicate passages by leading text. */
function dedupePassages(passages: { text: string; label: string }[]): { text: string; label: string }[] {
  const seen = new Set<string>();
  return passages.filter((p) => {
    const key = p.text.slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse a stringified python-style dict ("{'k': 'v', …}") into key/value pairs.
 * Graph node payloads store their entity data this way.
 */
function parsePropsString(raw: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const re = /'([^']+)':\s*'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match[2].trim()) out[match[1]] = match[2];
  }
  return Object.keys(out).length > 0 ? out : null;
}

interface GraphNode {
  name?: string;
  type?: string;
  properties?: Record<string, unknown>;
}

/**
 * Extract readable entity data from hybrid-query graph items — the substance
 * lives in graph_data.nodes[].properties.properties (a stringified dict).
 * Schema/scaffolding nodes are skipped.
 */
function extractGraphPassages(items: unknown[]): { text: string; label: string }[] {
  const out: { text: string; label: string }[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const graphData = (item as Record<string, unknown>).graph_data as { nodes?: unknown[] } | undefined;
    if (!Array.isArray(graphData?.nodes)) continue;

    for (const rawNode of graphData.nodes) {
      if (!rawNode || typeof rawNode !== 'object') continue;
      const node = rawNode as GraphNode;
      const props = node.properties ?? {};
      if (props.is_schema_node === true || String(node.type ?? '').startsWith('SchemaNode')) continue;

      const propsString = typeof props.properties === 'string' ? props.properties : '';
      const parsed = propsString ? parsePropsString(propsString) : null;
      if (!parsed) continue;

      const entityName = (parsed.name ?? node.name ?? 'Entity').toString();
      const sourceFile = (props.source_file ?? '').toString();
      const detailLines = Object.entries(parsed)
        .filter(([key]) => key !== 'name')
        .map(([key, value]) => `• ${key.replace(/_/g, ' ')}: ${value}`);
      if (detailLines.length === 0) continue;

      out.push({
        text: detailLines.join('\n'),
        label: [`⬡ ${entityName}`, node.type?.replace(/_/g, ' '), sourceFile].filter(Boolean).join(' — ')
      });
    }
  }

  return dedupePassages(out);
}

/** Format a list of passages into a readable markdown answer. */
function formatPassages(passages: { text: string; label: string }[]): string {
  if (passages.length === 0) {
    return '_(No matching content found in the context)_';
  }

  const sections = passages.map((p, i) => {
    const header = p.label && p.label !== 'Context passage' ? `**${i + 1}. ${p.label}**` : `**${i + 1}.**`;
    return `${header}\n${p.text}`;
  });

  return sections.join('\n\n---\n\n');
}
