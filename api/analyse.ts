import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';

// ── Shared types ──────────────────────────────────────────────────────────────

type FinanceRow = Record<string, string | number>;

interface FinanceDataset {
  source: string;
  fields: string[];
  rows: FinanceRow[];
  fetchedAt: string;
}

type SourceType = 'localFile' | 'webScraper' | 'googleSheets' | 'icaMcp' | 'pdf';

interface RiskItem {
  driver: string;
  impact: string;
  severity: 'high' | 'medium' | 'low';
}

interface TrendItem {
  metric: string;
  direction: 'up' | 'down' | 'flat';
  changePercent: number;
}

interface AnalysisResult {
  kpis: { closedWon: number; openPipeline: number; toGoRevenue: number; marginPct: number };
  risks: RiskItem[];
  trends: TrendItem[];
}

interface RecommendationItem { action: string; priority: string; category: string; }

interface DecisionPackage {
  narrative: string;
  recommendations: RecommendationItem[];
  kpis: AnalysisResult['kpis'];
  risks: RiskItem[];
  topDeals: FinanceRow[];
  campaigns: FinanceRow[];
  dataset: FinanceDataset;
}

// ── Value normalisation ───────────────────────────────────────────────────────

function normaliseValue(value: unknown): string | number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return String(value ?? '');
  const trimmed = value.trim();
  const numeric = Number(trimmed.replace(/,/g, ''));
  return trimmed !== '' && Number.isFinite(numeric) ? numeric : trimmed;
}

function normaliseRows(rows: Record<string, unknown>[]): FinanceRow[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normaliseValue(v)])));
}

// ── Connectors ────────────────────────────────────────────────────────────────

// PDF text helpers
function parseTextTable(text: string): FinanceRow[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.includes('|') && l.split('|').length >= 3);
  if (tableLines.length < 2) return null;
  const dataLines = tableLines.filter((l) => !/^[\s|:-]+$/.test(l));
  if (dataLines.length < 2) return null;
  const parseCells = (line: string) =>
    line.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));
  const headers = parseCells(dataLines[0]);
  if (headers.length < 2) return null;
  const rows: FinanceRow[] = [];
  for (const line of dataLines.slice(1)) {
    const cells = parseCells(line);
    if (!cells.length) continue;
    const entry: FinanceRow = {};
    headers.forEach((h, i) => { entry[h || `col_${i + 1}`] = normaliseValue(cells[i] ?? ''); });
    rows.push(entry);
  }
  return rows.length > 0 ? rows : null;
}

function chunkTextToRows(text: string): FinanceRow[] {
  let chunks = text.split(/\n{2,}/).map((c) => c.replace(/\n/g, ' ').trim()).filter((c) => c.length > 20);
  if (chunks.length < 3) chunks = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter((s) => s.length > 20) ?? [text.trim()];
  return chunks.slice(0, 300).map((chunk, i) => ({ index: i + 1, text: chunk }));
}

async function getPdfParse(): Promise<(buf: Buffer) => Promise<{ text: string; numpages: number }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('pdf-parse') as any;
  return (mod.default ?? mod) as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
}

async function fetchLocalFile(filePath: string): Promise<FinanceDataset> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);
  if (ext === '.json') {
    const rows = normaliseRows(JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>[]);
    return { source: filePath, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
  }
  if (ext === '.csv') {
    const rows = normaliseRows(parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]);
    return { source: filePath, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
  }
  if (['.xlsx', '.xls'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = normaliseRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }));
    return { source: filePath, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
  }
  throw new Error(`Unsupported local file extension: ${ext}`);
}

async function fetchGoogleSheets(url: string): Promise<FinanceDataset> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Failed to fetch Google Sheets: ${response.status}`);
  const csv = await response.text();
  const rows = normaliseRows(parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]);
  return { source: url, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
}

async function fetchWebScraper(url: string): Promise<FinanceDataset> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const table = $('table').first();
  if (table.length === 0) throw new Error('No table found on the provided web page');
  const headers = table.find('tr').first().find('th, td').map((_, el) => $(el).text().trim()).get();
  const rows: FinanceRow[] = [];
  table.find('tr').slice(1).each((_, row) => {
    const cells = $(row).find('td').map((_, cell) => $(cell).text().trim()).get();
    if (!cells.length) return;
    rows.push(Object.fromEntries(headers.map((h, i) => [h || `col_${i + 1}`, normaliseValue(cells[i] ?? '')])));
  });
  return { source: url, fields: headers, rows, fetchedAt: new Date().toISOString() };
}

function getMockDataset(): FinanceDataset {
  return {
    source: 'ica-mcp-mock',
    fields: ['Quarter', 'ActualRevenue', 'ForecastRevenue', 'ActualCost', 'ForecastCost', 'MarginPct'],
    rows: [
      { Quarter: 'Q1', ActualRevenue: 950000, ForecastRevenue: 1000000, ActualCost: 620000, ForecastCost: 580000, MarginPct: 34.7 },
      { Quarter: 'Q2', ActualRevenue: 1020000, ForecastRevenue: 1100000, ActualCost: 690000, ForecastCost: 640000, MarginPct: 32.4 },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchIcaMcp(config: Record<string, unknown>): Promise<FinanceDataset> {
  const url = (config.endpoint as string | undefined) ?? process.env.ICA_MCP_URL;
  if (!url) return getMockDataset();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'financeSnapshot' }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ICA MCP fetch failed: ${response.status}`);
  return (await response.json()) as FinanceDataset;
}

async function fetchPdf(config: Record<string, unknown>): Promise<FinanceDataset> {
  const { filePath, url } = config as { filePath?: string; url?: string };
  let buffer: Buffer;
  let source: string;
  if (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
    source = url;
  } else if (filePath) {
    const resolved = path.resolve(filePath);
    if (!existsSync(resolved)) throw new Error(`PDF file not found: ${resolved}`);
    buffer = await readFile(resolved);
    source = filePath;
  } else {
    throw new Error('filePath or url is required for pdf source');
  }
  const pdfParse = await getPdfParse();
  const parsed = await pdfParse(buffer);
  const text = parsed.text ?? '';
  if (!text.trim()) throw new Error('PDF appears to be image-only (no extractable text).');
  const rows = parseTextTable(text) ?? chunkTextToRows(text);
  return { source, fields: rows[0] ? Object.keys(rows[0]) : ['text'], rows, fetchedAt: new Date().toISOString() };
}

async function fetchData(sourceType: SourceType, config: Record<string, unknown>): Promise<FinanceDataset> {
  switch (sourceType) {
    case 'localFile':    return fetchLocalFile(config.filePath as string);
    case 'webScraper':  return fetchWebScraper(config.url as string);
    case 'googleSheets':return fetchGoogleSheets(config.url as string);
    case 'icaMcp':      return fetchIcaMcp(config);
    case 'pdf':         return fetchPdf(config);
    default: throw new Error(`Unsupported source type: ${sourceType}`);
  }
}

// ── Analysis tool ─────────────────────────────────────────────────────────────

function findField(fields: string[], includes: string[]): string | undefined {
  return fields.find((f) => includes.some((p) => f.toLowerCase().includes(p)));
}

function getNumber(row: FinanceRow, field?: string): number {
  if (!field) return 0;
  const v = row[field];
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

function getSeverity(delta: number): 'high' | 'medium' | 'low' {
  return delta > 0.1 ? 'high' : delta > 0.05 ? 'medium' : 'low';
}

function analysisTool(dataset: FinanceDataset): AnalysisResult {
  const { fields, rows } = dataset;
  const actualRevenueField   = findField(fields, ['actualrevenue', 'actual revenue', 'revenue']);
  const forecastRevenueField = findField(fields, ['forecastrevenue', 'forecast revenue', 'planrevenue', 'forecast']);
  const actualCostField      = findField(fields, ['actualcost', 'actual cost', 'cost']);
  const forecastCostField    = findField(fields, ['forecastcost', 'forecast cost', 'plancost']);
  const marginField          = findField(fields, ['marginpct', 'margin %', 'margin']);
  const stageField           = findField(fields, ['stage', 'status']);

  const totals = rows.reduce((acc, row) => {
    acc.actualRevenue   += getNumber(row, actualRevenueField);
    acc.forecastRevenue += getNumber(row, forecastRevenueField);
    acc.actualCost      += getNumber(row, actualCostField);
    acc.forecastCost    += getNumber(row, forecastCostField);
    acc.margin          += getNumber(row, marginField);
    return acc;
  }, { actualRevenue: 0, forecastRevenue: 0, actualCost: 0, forecastCost: 0, margin: 0 });

  const averageMargin  = rows.length === 0 ? 0 : totals.margin / rows.length;
  const closedWon      = rows.filter((r) => String(r[stageField ?? ''] ?? '').toLowerCase().includes('won')).reduce((s, r) => s + getNumber(r, actualRevenueField), 0);
  const openPipeline   = rows.filter((r) => !String(r[stageField ?? ''] ?? '').toLowerCase().includes('won')).reduce((s, r) => s + getNumber(r, forecastRevenueField), 0);
  const toGoRevenue    = Math.max(totals.forecastRevenue - totals.actualRevenue, 0);
  const revenueVariance = totals.forecastRevenue === 0 ? 0 : (totals.forecastRevenue - totals.actualRevenue) / totals.forecastRevenue;
  const costVariance    = totals.forecastCost    === 0 ? 0 : (totals.actualCost - totals.forecastCost) / totals.forecastCost;
  const marginTrend     = totals.forecastRevenue === 0 ? 0 : ((totals.actualRevenue - totals.actualCost) - (totals.forecastRevenue - totals.forecastCost)) / totals.forecastRevenue;

  const risks: RiskItem[] = [];
  if (revenueVariance > 0) risks.push({ driver: 'Revenue below forecast', impact: `${(revenueVariance * 100).toFixed(1)}% below plan`, severity: getSeverity(revenueVariance) });
  if (costVariance > 0)    risks.push({ driver: 'Costs above forecast',   impact: `${(costVariance * 100).toFixed(1)}% above plan`,  severity: getSeverity(costVariance) });
  if (averageMargin < 35)  risks.push({ driver: 'Margin compression',     impact: `Average margin at ${averageMargin.toFixed(1)}%`,  severity: averageMargin < 25 ? 'high' : 'medium' });

  const trends: TrendItem[] = [
    { metric: 'Revenue variance', direction: revenueVariance > 0 ? 'down' : revenueVariance < 0 ? 'up' : 'flat', changePercent: Number((Math.abs(revenueVariance) * 100).toFixed(1)) },
    { metric: 'Cost variance',    direction: costVariance    > 0 ? 'up'   : costVariance    < 0 ? 'down' : 'flat', changePercent: Number((Math.abs(costVariance) * 100).toFixed(1)) },
    { metric: 'Margin trend',     direction: marginTrend     > 0 ? 'up'   : marginTrend     < 0 ? 'down' : 'flat', changePercent: Number((Math.abs(marginTrend) * 100).toFixed(1)) },
  ];

  return { kpis: { closedWon, openPipeline, toGoRevenue, marginPct: Number(averageMargin.toFixed(1)) }, risks, trends };
}

// ── Insight + recommendation tools ───────────────────────────────────────────

function insightTool(result: AnalysisResult): string {
  const top = result.risks[0];
  const lead = top ? `The biggest risk to margin this quarter is ${top.driver.toLowerCase()}, with ${top.impact.toLowerCase()}.` : 'No major margin risks were detected.';
  const trendSummary = result.trends.map((t) => `${t.metric} is ${t.direction} by ${t.changePercent.toFixed(1)}%`).join('; ');
  return `${lead} Current margin is ${result.kpis.marginPct.toFixed(1)}%. ${trendSummary}.`;
}

function recommendationTool(result: AnalysisResult): RecommendationItem[] {
  return result.risks.map((risk) => {
    if (risk.driver === 'Costs above forecast') return { action: 'Launch a cost containment review on the highest-growth expense lines and pause discretionary spend.', priority: 'High', category: 'Cost optimisation' };
    if (risk.driver === 'Revenue below forecast') return { action: 'Accelerate late-stage deals, review pricing leakage, and tighten forecast accountability by region.', priority: 'High', category: 'Revenue recovery' };
    return { action: 'Review low-margin products and improve mix, pricing, or service delivery efficiency.', priority: 'Medium', category: 'Margin improvement' };
  });
}

function executionTool(dataset: FinanceDataset, analysis: AnalysisResult, narrative: string, recommendations: RecommendationItem[]): DecisionPackage {
  const revenueField  = findField(dataset.fields, ['actualrevenue', 'revenue']);
  const campaignField = findField(dataset.fields, ['campaign', 'theme']);
  const topDeals = [...dataset.rows].sort((a, b) => getNumber(b, revenueField) - getNumber(a, revenueField)).slice(0, 5);
  const campaigns = campaignField ? dataset.rows.filter((r) => String(r[campaignField] ?? '').trim() !== '').slice(0, 3) : dataset.rows.slice(0, 3);
  return { narrative, recommendations, kpis: analysis.kpis, risks: analysis.risks, topDeals, campaigns, dataset };
}

// ── Handler ───────────────────────────────────────────────────────────────────

const VALID_SOURCE_TYPES: SourceType[] = ['localFile', 'webScraper', 'googleSheets', 'icaMcp', 'pdf'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { sourceType, sourceConfig } = req.body as { sourceType?: SourceType; sourceConfig?: Record<string, unknown> };

  if (!sourceType || !VALID_SOURCE_TYPES.includes(sourceType)) {
    res.status(400).json({ error: 'Invalid sourceType' });
    return;
  }
  if (!sourceConfig || typeof sourceConfig !== 'object') {
    res.status(400).json({ error: 'sourceConfig is required' });
    return;
  }

  try {
    const dataset         = await fetchData(sourceType, sourceConfig);
    const analysis        = analysisTool(dataset);
    const narrative       = insightTool(analysis);
    const recommendations = recommendationTool(analysis);
    const decisionPackage = executionTool(dataset, analysis, narrative, recommendations);
    res.json(decisionPackage);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Analysis failed' });
  }
}
