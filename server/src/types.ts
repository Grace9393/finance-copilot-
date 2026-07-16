export type FinanceRow = Record<string, string | number>;

export interface FinanceDataset {
  source: string;
  fields: string[];
  rows: FinanceRow[];
  fetchedAt: string;
}

export type SourceType = 'localFile' | 'webScraper' | 'googleSheets' | 'icaMcp' | 'pdf';

export interface Connector {
  fetchData(config: Record<string, unknown>): Promise<FinanceDataset>;
}

export interface LocalFileConfig {
  filePath: string;
}

export interface UrlConfig {
  url: string;
}

export interface IcaMcpConfig {
  endpoint?: string;
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

export interface TrendItem {
  metric: string;
  direction: 'up' | 'down' | 'flat';
  changePercent: number;
}

export interface AnalysisResult {
  kpis: Kpis;
  risks: RiskItem[];
  trends: TrendItem[];
}

export interface RecommendationItem {
  action: string;
  priority: string;
  category: string;
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

export function normaliseValue(value: unknown): string | number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return String(value ?? '');
  }

  const trimmed = value.trim();
  const numeric = Number(trimmed.replace(/,/g, ''));

  return trimmed !== '' && Number.isFinite(numeric) ? numeric : trimmed;
}
