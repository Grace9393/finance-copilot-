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

export interface ChatReply {
  reply: string;
  tool: string;
  mode: ChatMode;
  isError: boolean;
  elapsedMs: number;
  reportUrl?: string;
  reportFullText?: string;
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

/** Upload a file to /api/upload and get back a FinanceDataset (used as DataContext in chat). */
export async function uploadFile(file: File): Promise<FinanceDataset> {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });

  if (!response.ok) {
    const err = (await response.json()) as { error?: string };
    throw new Error(err.error ?? `Upload failed (${response.status})`);
  }

  return (await response.json()) as FinanceDataset;
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
