/**
 * ICA MCP client — connects the finance-studio chat route to the
 * mcp-ica-2.0-server (HTTP/SSE transport).
 *
 * The ICA MCP server must be running separately:
 *   cd "H:\My Drive\AA\mcp-ica-2.0-server-main"
 *   npm run start:http          # default port 3000
 *
 * Environment variables (set in .env.local or process env):
 *   ICA_MCP_URL       Base URL of the ICA MCP HTTP server, e.g. http://localhost:3000
 *   ICA_API_KEY       Your ICA developer API key (sk-…), forwarded as Bearer token
 */

export interface IcaMcpConfig {
  url: string;      // e.g. http://localhost:3000
  apiKey: string;   // sk-… — forwarded to ICA MCP in Authorization header
}

export interface IcaToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface IcaToolResult {
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

// ── Singleton session state ───────────────────────────────────────────────────

let cachedConfig: IcaMcpConfig | null = null;
let sessionId: string | null = null;
let initialized = false;
let rpcId = 0;

export function getIcaConfig(): IcaMcpConfig {
  if (!cachedConfig) {
    cachedConfig = {
      url:    (process.env.ICA_MCP_URL ?? '').replace(/\/+$/, ''),
      apiKey: process.env.ICA_API_KEY ?? ''
    };
  }
  return cachedConfig;
}

/** Call after changing env vars in tests or hot-reloads. */
export function resetIcaSession(): void {
  cachedConfig = null;
  sessionId = null;
  initialized = false;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

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
    } catch { /* ignore non-JSON heartbeats */ }
  }
  return last;
}

// ── JSON-RPC over HTTP/SSE ────────────────────────────────────────────────────

async function rpc(
  method: string,
  params: Record<string, unknown>,
  isNotification = false
): Promise<JsonRpcResponse | null> {
  const config = getIcaConfig();
  if (!config.url) throw new Error('ICA_MCP_URL is not set');

  // Use session endpoint when we have one, otherwise the base SSE init goes via
  // the /message route that the SSE transport opens after GET /sse.
  // For simplicity we use the streamable-HTTP style: POST directly to the server
  // root which the ICA MCP HTTP server accepts for JSON-RPC when using streamable
  // transport, OR we fall back to the SSE session pattern.
  //
  // The ICA MCP server (mcp-ica-2.0-server) uses SSE transport from the MCP SDK.
  // The SSE transport workflow is:
  //   1. GET /sse   → opens SSE stream, server sends sessionId in first event
  //   2. POST /message?sessionId=<id>  → send JSON-RPC messages
  //   3. Responses arrive via the SSE stream
  //
  // For a server-side client this bidirectional SSE approach is complex. Instead
  // we use the Streamable HTTP transport supported by @modelcontextprotocol/sdk
  // which accepts a single POST to a single endpoint.  The ICA MCP HTTP server
  // ALSO supports this via its /message handler when a session is active.
  //
  // Practical approach: POST each JSON-RPC message to /message?sessionId=<id>
  // once a session has been established, or re-establish via /sse first.

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const body: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (!isNotification) body.id = ++rpcId;

  // Use /message?sessionId= endpoint when we have an active session
  const endpoint = sessionId
    ? `${config.url}/message?sessionId=${encodeURIComponent(sessionId)}`
    : `${config.url}/message`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId) sessionId = newSessionId;

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ICA MCP HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (isNotification) return null;

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();

  if (!raw.trim()) return null;

  const parsed = contentType.includes('text/event-stream')
    ? parseSseBody(raw)
    : (JSON.parse(raw) as JsonRpcResponse);

  if (!parsed) throw new Error('ICA MCP returned an empty response');
  if (parsed.error) throw new Error(`ICA MCP error ${parsed.error.code}: ${parsed.error.message}`);

  return parsed;
}

// ── Session init via /sse GET ─────────────────────────────────────────────────

/**
 * Establish an SSE session by connecting to GET /sse.
 * The ICA MCP server sends the sessionId in the first SSE event.
 */
async function openSseSession(): Promise<void> {
  const config = getIcaConfig();
  if (!config.url) throw new Error('ICA_MCP_URL is not set');

  const headers: Record<string, string> = {
    'Accept': 'text/event-stream'
  };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  // We only need the first event to capture the sessionId endpoint, then we
  // can POST JSON-RPC messages. Use a small timeout to avoid hanging.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${config.url}/sse`, {
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ICA MCP SSE connect HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    // Capture mcp-session-id from response headers (set before body streams)
    const sid = response.headers.get('mcp-session-id');
    if (sid) {
      sessionId = sid;
    } else {
      // Read a few SSE lines to find the endpoint event
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let accumulated = '';
        let found = false;

        while (!found) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          // Look for endpoint event which contains the sessionId
          const endpointMatch = /data:\s*(http[^\n]+)/m.exec(accumulated);
          if (endpointMatch) {
            const url = new URL(endpointMatch[1].trim());
            sessionId = url.searchParams.get('sessionId');
            found = true;
          }
          // Also look for mcp-session-id in SSE data
          const sidMatch = /mcp-session-id['":\s]+([a-zA-Z0-9_-]+)/i.exec(accumulated);
          if (sidMatch) {
            sessionId = sidMatch[1];
            found = true;
          }
        }

        reader.cancel().catch(() => {/* ignore */});
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSession(): Promise<void> {
  if (initialized) return;
  await openSseSession();
  initialized = true;
}

async function withSessionRetry<T>(operation: () => Promise<T>): Promise<T> {
  await ensureSession();
  try {
    return await operation();
  } catch {
    sessionId = null;
    initialized = false;
    await ensureSession();
    return operation();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listIcaTools(): Promise<IcaToolInfo[]> {
  const response = await withSessionRetry(() => rpc('tools/list', {}));
  const result = response?.result as { tools?: IcaToolInfo[] } | undefined;
  return result?.tools ?? [];
}

export async function callIcaTool(
  name: string,
  args: Record<string, unknown>
): Promise<IcaToolResult> {
  const response = await withSessionRetry(() => rpc('tools/call', { name, arguments: args }));
  return (response?.result ?? {}) as IcaToolResult;
}

/**
 * Extract the assistant's reply text from an ICA tool result.
 * ICA chat tools return structured content with a markdown-formatted
 * "## Response\n\n<text>" block plus optional Sources and Generated Files.
 */
export function extractIcaText(result: IcaToolResult): string {
  const blocks: string[] = [];

  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
        blocks.push(item.text.trim());
      }
    }
  }

  const joined = blocks.join('\n\n');
  if (joined) return joined;

  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent, null, 2);
  }

  return JSON.stringify(result, null, 2);
}
