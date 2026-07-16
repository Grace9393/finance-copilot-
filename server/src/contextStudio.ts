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
  // Try to load from file (local dev only) — silently skip if missing
  try {
    // Dynamic require to avoid import.meta issues in commonjs/serverless environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data = require('../context-studio.json') as ContextStudioConfig;
    return data;
  } catch {
    return {};
  }
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

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
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
    clientInfo: { name: 'finance-copilot', version: '1.0.0' }
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

export async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const response = await withSessionRetry(() => rpc('tools/call', { name, arguments: args }));
  return (response?.result ?? {}) as McpToolResult;
}

/**
 * Parse a Context Studio result into a readable synthesised answer.
 *
 * Context Studio tools return one of:
 *   A) content[].text — a JSON string containing { results: [...], answer?: string }
 *   B) content[].text — plain prose (already formatted)
 *   C) structuredContent — raw JSON object
 *
 * We extract all text passages from the results array, deduplicate, and format
 * them as a coherent summarised answer rather than a raw JSON dump.
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
  const seen = new Set<string>();
  const out: { text: string; label: string }[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const p = item as ContextPassage;

    const text = (p.text ?? p.content ?? p.summary ?? '').toString().trim();
    if (!text || text.length < 10) continue;

    // Deduplicate by first 120 chars
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
