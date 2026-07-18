declare const __API_URL__: string;
const API_BASE = (typeof __API_URL__ !== 'undefined' && __API_URL__) ? __API_URL__ : '';

export type SourceType = 'localFile' | 'webScraper' | 'googleSheets' | 'icaMcp' | 'pdf';
export type ChatMode = 'hybrid' | 'vector' | 'graph' | 'schema' | 'metadata' | 'contexts';

export interface DataContext {
  source: string;
  fields: string[];
  rows: Record<string, string | number>[];
  kpis?: Record<string, number>;
  narrative?: string;
}

export interface Kpis {
  closedWon: number;
  openPipeline: number;
  toGoRevenue: number;
  marginPct: number;
}

export interface RiskItem {
  driver: string;
  impact: string;
  severity: 'high' | 'medium' | 'low';
}

export interface RecommendationItem {
  action: string;
  priority: string;
  category: string;
}

export interface FinanceRow {
  [key: string]: string | number;
}

export interface FinanceDataset {
  source: string;
  fields: string[];
  rows: FinanceRow[];
  fetchedAt: string;
  /** Present for image uploads — used for preview only */
  imageDataUri?: string;
}

export type ExternalSourceType = 'localPath' | 'webUrl' | 'googleSheet';

/** Connect an external data source (local path / web URL / Google Sheet). */
export async function connectSource(type: ExternalSourceType, value: string): Promise<FinanceDataset> {
  const response = await fetch(`${API_BASE}/api/source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, value })
  });
  if (!response.ok) {
    let msg = `Source connection failed (${response.status})`;
    try { const b = (await response.json()) as { error?: string }; if (b.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await response.json()) as FinanceDataset;
}

export interface DecisionPackage {
  narrative: string;
  recommendations: RecommendationItem[];
  kpis: Kpis;
  risks: RiskItem[];
  topDeals: FinanceRow[];
  campaigns: FinanceRow[];
  dataset: FinanceDataset;
}

export interface ChatStatus {
  online: boolean;
  contextId: string;
  agentPersona: string;
  tools: string[];
  error?: string;
}

/** Status returned by GET /api/chat/ica/status */
export interface IcaChatStatus {
  online: boolean;
  url: string;
  tools: string[];
  error?: string;
}

/** Reply from POST /api/chat/ica */
export interface IcaChatReply {
  reply: string;
  tool: string;
  model: string;
  isError: boolean;
  elapsedMs: number;
}

/** Dashboard-control directive derived from a chat message. */
export interface DashboardDirective {
  year?: number;
  geo?: string;
  country?: string;
  segment?: string;
  dimension?: string;
  measure?: string;
}

export interface ChatReply {
  reply: string;
  tool: string;
  mode: ChatMode;
  isError: boolean;
  elapsedMs: number;
  /** When present, the client applies this to the dashboard view live */
  dashboard?: DashboardDirective;
  reportUrl?: string;
  reportFullText?: string;
  /** Skill name when the reply was produced by a skill invocation via Context Studio */
  skill?: string;
  /** Set when the reply contains a downloadable PPTX */
  pptxDownload?: { filename: string; base64: string; mimeType: string; slideCount: number; warnings: string[] };
}

export interface PptxReply {
  filename: string;
  base64: string;
  mimeType: string;
  slideCount: number;
  warnings: string[];
}

/** POST an image file to /api/pptx and receive the generated PPTX as base64. */
export async function convertToPptx(file: File, title?: string): Promise<PptxReply> {
  assertUploadSize(file);
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);

  const response = await fetch(`${API_BASE}/api/pptx`, { method: 'POST', body: form });

  if (!response.ok) {
    let msg = `PPTX conversion failed (${response.status})`;
    try { const b = await response.json() as { error?: string }; if (b.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }

  return (await response.json()) as PptxReply;
}

export async function getChatStatus(): Promise<ChatStatus> {
  const response = await fetch(`${API_BASE}/api/chat/status`);

  if (!response.ok) {
    throw new Error('Chat status request failed');
  }

  return (await response.json()) as ChatStatus;
}

/** GET /api/chat/ica/status — check whether the ICA MCP server is reachable. */
export async function getIcaChatStatus(): Promise<IcaChatStatus> {
  const response = await fetch(`${API_BASE}/api/chat/ica/status`);
  if (!response.ok) {
    return { online: false, url: '', tools: [], error: 'Status request failed' };
  }
  return (await response.json()) as IcaChatStatus;
}

/**
 * POST /api/chat/ica — send a message to an ICA assistant, agent, or model.
 * @param message   The user's message.
 * @param tool      ICA MCP tool name (default: 'ica_chat_assistants').
 * @param model     The assistant/agent/model ID (required by ICA).
 * @param files     Optional file or collection attachments.
 */
export async function sendIcaMessage(
  message: string,
  tool: string,
  model: string,
  files?: Array<{ type: string; id: string }>
): Promise<IcaChatReply> {
  const response = await fetch(`${API_BASE}/api/chat/ica`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tool, model, files })
  });

  if (!response.ok) {
    let errorMsg = 'ICA chat request failed';
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch { /* ignore */ }
    throw new Error(errorMsg);
  }

  return (await response.json()) as IcaChatReply;
}

export async function sendChatMessage(
  message: string,
  mode: ChatMode,
  dataContext?: DataContext
): Promise<ChatReply> {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, mode, dataContext })
  });

  if (!response.ok) {
    let errorMsg = 'Chat request failed';
    try {
      const body = await response.text();
      if (body) {
        const parsed = JSON.parse(body) as { error?: string };
        errorMsg = parsed.error ?? errorMsg;
      }
    } catch { /* ignore parse errors — use default message */ }
    throw new Error(errorMsg);
  }

  const raw = await response.text();
  if (!raw) throw new Error('Empty response from server');
  return JSON.parse(raw) as ChatReply;
}

/** Hosted deployments (Vercel serverless) reject request bodies over ~4.5 MB. */
export const HOSTED_UPLOAD_LIMIT_BYTES = 4.5 * 1024 * 1024;

/**
 * Max rows sent as chat data context. Large datasets (e.g. 8k-row Excel files)
 * would otherwise exceed the serverless request-body limit on every message —
 * the full dataset still drives the client-side dynamic dashboard; the chat
 * grounds on this sample.
 */
export const MAX_CONTEXT_ROWS = 500;

/** Trim a dataset to a chat-safe data context sample. */
export function toChatContext(dataset: FinanceDataset, narrative?: string): DataContext {
  return {
    source: dataset.source,
    fields: dataset.fields,
    rows: dataset.rows.slice(0, MAX_CONTEXT_ROWS),
    narrative: narrative ?? (dataset.rows.length > MAX_CONTEXT_ROWS
      ? `Sample of first ${MAX_CONTEXT_ROWS} of ${dataset.rows.length} rows from ${dataset.source}`
      : undefined)
  };
}

function isHostedDeployment(): boolean {
  return typeof location !== 'undefined' && !['localhost', '127.0.0.1'].includes(location.hostname);
}

function assertUploadSize(file: File): void {
  if (isHostedDeployment() && file.size > HOSTED_UPLOAD_LIMIT_BYTES) {
    throw new Error(`File too large: "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the hosted deployment accepts up to ~4.5 MB. Split the file, or run the app locally (npm run dev) and use 📁 Local path for big files.`);
  }
}

/** Upload a file to /api/upload and get back a FinanceDataset (used as DataContext in chat). */
export async function uploadFile(file: File): Promise<FinanceDataset> {
  assertUploadSize(file);
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });

  if (!response.ok) {
    // Platform errors (413 etc.) come back as plain text, not JSON
    if (response.status === 413) {
      throw new Error(`File too large: "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the hosted deployment accepts up to ~4.5 MB. Split the file, or run the app locally (npm run dev) and use 📁 Local path for big files.`);
    }
    const text = await response.text().catch(() => '');
    let message = `Upload failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (text) message = `Upload failed (${response.status}): ${text.slice(0, 120)}`;
    }
    throw new Error(message);
  }

  return (await response.json()) as FinanceDataset;
}

// ── Section 1: configurable dashboard (internal finance / EPM only) ──────────

export interface KpiTile {
  label: string;
  value: string;
  deltaLabel: string;
  direction: 'up' | 'down' | 'flat';
  favourable: boolean;
}

export interface SeriesPoint {
  label: string;
  value: number;
  growthPct?: number;
  notes?: string;
}

export interface TrendSeries {
  name: string;
  points: { year: number; value: number }[];
}

export interface PnlRow {
  line: string;
  fy2023: string;
  fy2024: string;
  fy2025: string;
  yoy: string;
  direction: 'up' | 'down' | 'flat';
}

export interface DashboardPackage {
  company: string;
  year: number;
  geo: string;
  country: string;
  segment: string;
  scopeNote: string;
  kpis: KpiTile[];
  keyInsight: string;
  revenueBySegment: SeriesPoint[];
  revenueByGeo: SeriesPoint[];
  trend: TrendSeries[];
  trendYears: number[];
  pnl: PnlRow[];
  workingCapital: {
    rows: { metric: string; value: string; detail: string }[];
    arByGeo: { geo: string; ar: number; days: number }[];
    inventoryBuckets: { bucket: string; value: number }[];
    note: string;
  };
  risks: { driver: string; impact: string; severity: 'high' | 'medium' | 'low' }[];
  actions: { action: string; category: string; status: string }[];
  sources: string[];
}

export interface FilterOptions {
  years: number[];
  geographies: string[];
  countries: Record<string, string[]>;
  segments: string[];
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const response = await fetch(`${API_BASE}/api/dashboard/options`);
  if (!response.ok) throw new Error('Failed to load filter options');
  return (await response.json()) as FilterOptions;
}

export async function fetchDashboard(params: { year?: number; geo?: string; country?: string; segment?: string }): Promise<DashboardPackage> {
  const query = new URLSearchParams();
  if (params.year) query.set('year', String(params.year));
  if (params.geo) query.set('geo', params.geo);
  if (params.country) query.set('country', params.country);
  if (params.segment) query.set('segment', params.segment);

  const response = await fetch(`${API_BASE}/api/dashboard?${query.toString()}`);
  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(error.error ?? 'Dashboard request failed');
  }
  return (await response.json()) as DashboardPackage;
}

export async function analyseData(sourceType: SourceType, sourceConfig: Record<string, unknown>): Promise<DecisionPackage> {
  const response = await fetch(`${API_BASE}/api/analyse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceType, sourceConfig })
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(error.error ?? 'Analysis request failed');
  }

  return (await response.json()) as DecisionPackage;
}
