/**
 * ibmData.ts
 *
 * Loads the ingested IBM annual-report dataset (FY2023–FY2025) and exposes
 * filter/computation helpers. This module is the POC stand-in for the
 * "internal finance systems / EPM" data source: the dashboard section reads
 * ONLY from here, never from the internet.
 */

import { readFileSync } from 'fs';

// ── Raw dataset types (mirror ibm-annual-reports.json) ───────────────────────

export interface AnnualRecord {
  year: number;
  revenue: number;
  revenueGrowthPct: number;
  grossProfit: number;
  grossMarginPct: number;
  netIncome: number;
  netMarginPct: number;
  freeCashFlow: number;
  operatingCashFlow: number;
  cashAndEquivalents: number;
  shortTermInvestments: number;
  cashAndSecurities: number;
  accountsReceivable: number;
  inventory: number;
  totalDebt: number;
  totalAssets: number;
  provenance: string;
  notes?: string;
}

export interface SegmentRecord {
  year: number;
  segment: string;
  revenue: number;
  growthPct: number;
  provenance: string;
  notes?: string;
}

export interface GeoRecord {
  year: number;
  geo: string;
  revenue: number;
  growthPct: number;
  provenance: string;
}

export interface InventoryBucketRecord {
  year: number;
  soldNotDelivered: number;
  excessAndObsolete: number;
  inTransit: number;
  rawAndWip: number;
}

export interface IbmDataset {
  company: string;
  currency: string;
  fiscalYears: number[];
  description: string;
  sources: string[];
  annual: AnnualRecord[];
  segments: SegmentRecord[];
  geographies: GeoRecord[];
  countryShares: Record<string, Record<string, number> | string> & {
    provenance: string;
    note: string;
  };
  workingCapitalDetail: {
    provenance: string;
    note: string;
    arDaysByGeo: Record<string, number>;
    inventoryBuckets: InventoryBucketRecord[];
  };
  keyInsights: { year: number; insight: string }[];
}

// ── Dashboard package types (returned to the client) ─────────────────────────

export interface KpiTile {
  label: string;
  value: string;
  deltaLabel: string;
  direction: 'up' | 'down' | 'flat';
  /** whether the direction is favourable for this metric */
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

// ── Load dataset once at startup ──────────────────────────────────────────────

const datasetUrl = new URL('../data/ibm-annual-reports.json', import.meta.url);
const dataset: IbmDataset = JSON.parse(readFileSync(datasetUrl, 'utf-8')) as IbmDataset;

export function getDataset(): IbmDataset {
  return dataset;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function fmtMillions(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return `$${(value / 1000).toFixed(1)}B`;
  return `$${value.toFixed(0)}M`;
}

function fmtDelta(current: number, prior: number | undefined, unit: 'money' | 'pct' | 'pt'): { deltaLabel: string; direction: 'up' | 'down' | 'flat' } {
  if (prior === undefined || prior === 0) return { deltaLabel: 'no prior year', direction: 'flat' };
  const diff = current - prior;
  const direction: 'up' | 'down' | 'flat' = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  if (unit === 'pt') {
    return { deltaLabel: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt vs FY${prior !== undefined ? '' : ''}prior`, direction };
  }
  const pct = (diff / Math.abs(prior)) * 100;
  return { deltaLabel: `${diff >= 0 ? '+' : ''}${fmtMillions(diff).replace('$', '$')} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`, direction };
}

// ── Filtering helpers ─────────────────────────────────────────────────────────

function geoShare(year: number, geo: string): number {
  if (geo === 'All') return 1;
  const total = dataset.annual.find((a) => a.year === year)?.revenue ?? 0;
  const g = dataset.geographies.find((r) => r.year === year && r.geo === geo);
  return total > 0 && g ? g.revenue / total : 1;
}

function countryShare(geo: string, country: string): number {
  if (country === 'All' || geo === 'All') return 1;
  const shares = dataset.countryShares[geo];
  if (!shares || typeof shares === 'string') return 1;
  return shares[country] ?? 1;
}

function segmentShare(year: number, segment: string): number {
  if (segment === 'All') return 1;
  const total = dataset.annual.find((a) => a.year === year)?.revenue ?? 0;
  const s = dataset.segments.find((r) => r.year === year && r.segment === segment);
  return total > 0 && s ? s.revenue / total : 1;
}

/** Combined scaling factor for the selected scope (POC allocation approach). */
function scopeFactor(year: number, geo: string, country: string, segment: string): number {
  return geoShare(year, geo) * countryShare(geo, country) * segmentShare(year, segment);
}

function scopeNoteFor(geo: string, country: string, segment: string): string {
  const parts: string[] = [];
  if (segment !== 'All') parts.push(`segment "${segment}"`);
  if (geo !== 'All') parts.push(`geography "${geo}"`);
  if (country !== 'All') parts.push(`country "${country}" (illustrative allocation)`);
  if (parts.length === 0) {
    return 'Scope: IBM consolidated, as reported in the FY2023–FY2025 annual reports.';
  }
  return `Scope: ${parts.join(' · ')} — scoped figures are pro-rata allocations of reported totals (POC approach; a production build would query EPM at native granularity).`;
}

// ── Risk & action synthesis (deck sections 6–7) ───────────────────────────────

function buildRisks(year: number): DashboardPackage['risks'] {
  const risks: DashboardPackage['risks'] = [];
  const segs = dataset.segments.filter((s) => s.year === year && s.segment !== 'Other');
  for (const s of segs.filter((x) => x.growthPct < 0).sort((a, b) => a.growthPct - b.growthPct)) {
    risks.push({
      driver: `${s.segment} revenue decline (${s.growthPct.toFixed(1)}%)`,
      impact: s.notes ?? `${s.segment} contracted ${Math.abs(s.growthPct).toFixed(1)}% year over year.`,
      severity: s.growthPct < -5 ? 'high' : 'medium'
    });
  }
  const geos = dataset.geographies.filter((g) => g.year === year && g.growthPct < 0);
  for (const g of geos) {
    risks.push({
      driver: `${g.geo} revenue decline (${g.growthPct.toFixed(1)}%)`,
      impact: `${g.geo} contracted ${Math.abs(g.growthPct).toFixed(1)}% — monitor pipeline coverage and FX exposure.`,
      severity: g.growthPct < -2 ? 'medium' : 'low'
    });
  }
  const a = dataset.annual.find((r) => r.year === year);
  const prior = dataset.annual.find((r) => r.year === year - 1);
  if (a && prior && a.accountsReceivable > prior.accountsReceivable * 1.1) {
    risks.push({
      driver: 'Accounts receivable build-up',
      impact: `AR grew ${(((a.accountsReceivable - prior.accountsReceivable) / prior.accountsReceivable) * 100).toFixed(0)}% year over year (${fmtMillions(prior.accountsReceivable)} → ${fmtMillions(a.accountsReceivable)}) — watch DSO and collections.`,
      severity: 'medium'
    });
  }
  if (a && prior && a.totalDebt > prior.totalDebt * 1.05) {
    risks.push({
      driver: 'Debt increase',
      impact: `Total debt rose from ${fmtMillions(prior.totalDebt)} to ${fmtMillions(a.totalDebt)} — financing costs sensitive to rates.`,
      severity: 'low'
    });
  }
  if (risks.length === 0) {
    risks.push({ driver: 'No material declines in scope', impact: 'All segments and geographies grew in the selected year.', severity: 'low' });
  }
  return risks.slice(0, 5);
}

function buildActions(year: number): DashboardPackage['actions'] {
  const actions: DashboardPackage['actions'] = [];
  const segs = dataset.segments.filter((s) => s.year === year && s.segment !== 'Other');
  const worst = [...segs].sort((a, b) => a.growthPct - b.growthPct)[0];
  const best = [...segs].sort((a, b) => b.growthPct - a.growthPct)[0];
  if (worst && worst.growthPct < 0) {
    actions.push({ action: `Deep-dive ${worst.segment} decline with segment leadership; rebase FY${year + 1} plan`, category: 'Revenue', status: 'Pending approval' });
  }
  if (best) {
    actions.push({ action: `Re-allocate go-to-market investment toward ${best.segment} (+${best.growthPct.toFixed(1)}%)`, category: 'Growth', status: 'Approved' });
  }
  const geos = dataset.geographies.filter((g) => g.year === year);
  const worstGeo = [...geos].sort((a, b) => a.growthPct - b.growthPct)[0];
  if (worstGeo && worstGeo.growthPct < 1) {
    actions.push({ action: `Review ${worstGeo.geo} pipeline coverage and pricing with regional CFO`, category: 'Revenue', status: 'Triggered' });
  }
  actions.push({ action: 'Push updated cash-flow forecast to Treasury', category: 'Liquidity', status: 'Completed' });
  return actions;
}

// ── Main dashboard builder ────────────────────────────────────────────────────

export interface DashboardQuery {
  year?: number;
  geo?: string;
  country?: string;
  segment?: string;
}

export function buildDashboard(query: DashboardQuery): DashboardPackage {
  const year = query.year && dataset.fiscalYears.includes(query.year) ? query.year : Math.max(...dataset.fiscalYears);
  const geo = query.geo ?? 'All';
  const country = query.country ?? 'All';
  const segment = query.segment ?? 'All';

  const a = dataset.annual.find((r) => r.year === year);
  if (!a) throw new Error(`No annual record for ${year}`);
  const prior = dataset.annual.find((r) => r.year === year - 1);

  const factor = scopeFactor(year, geo, country, segment);
  const priorFactor = prior ? scopeFactor(prior.year, geo, country, segment) : factor;

  const scale = (v: number) => v * factor;
  const scalePrior = (v: number) => v * priorFactor;

  // KPI tiles — mirrors the deck's executive-summary strip
  const revenueDelta = fmtDelta(scale(a.revenue), prior ? scalePrior(prior.revenue) : undefined, 'money');
  const gpDelta = fmtDelta(scale(a.grossProfit), prior ? scalePrior(prior.grossProfit) : undefined, 'money');
  const gmDelta = prior
    ? { deltaLabel: `${a.grossMarginPct - prior.grossMarginPct >= 0 ? '+' : ''}${(a.grossMarginPct - prior.grossMarginPct).toFixed(1)}pt vs FY${prior.year}`, direction: (a.grossMarginPct >= prior.grossMarginPct ? 'up' : 'down') as 'up' | 'down' }
    : { deltaLabel: 'no prior year', direction: 'flat' as const };
  const niDelta = fmtDelta(scale(a.netIncome), prior ? scalePrior(prior.netIncome) : undefined, 'money');
  const fcfDelta = fmtDelta(scale(a.freeCashFlow), prior ? scalePrior(prior.freeCashFlow) : undefined, 'money');
  const cashDelta = fmtDelta(scale(a.cashAndSecurities), prior ? scalePrior(prior.cashAndSecurities) : undefined, 'money');

  const kpis: KpiTile[] = [
    { label: 'Revenue', value: fmtMillions(scale(a.revenue)), deltaLabel: revenueDelta.deltaLabel, direction: revenueDelta.direction, favourable: revenueDelta.direction !== 'down' },
    { label: 'Gross Profit', value: fmtMillions(scale(a.grossProfit)), deltaLabel: gpDelta.deltaLabel, direction: gpDelta.direction, favourable: gpDelta.direction !== 'down' },
    { label: 'Gross Margin %', value: `${a.grossMarginPct.toFixed(1)}%`, deltaLabel: gmDelta.deltaLabel, direction: gmDelta.direction, favourable: gmDelta.direction !== 'down' },
    { label: 'Net Income', value: fmtMillions(scale(a.netIncome)), deltaLabel: niDelta.deltaLabel, direction: niDelta.direction, favourable: niDelta.direction !== 'down' },
    { label: 'Free Cash Flow', value: fmtMillions(scale(a.freeCashFlow)), deltaLabel: fcfDelta.deltaLabel, direction: fcfDelta.direction, favourable: fcfDelta.direction !== 'down' },
    { label: 'Cash & Securities', value: fmtMillions(scale(a.cashAndSecurities)), deltaLabel: cashDelta.deltaLabel, direction: cashDelta.direction, favourable: cashDelta.direction !== 'down' }
  ];

  // Revenue by segment / geo for the selected year (scaled by geo/country only
  // for segments, by segment only for geos, so each chart stays meaningful)
  const geoCountryFactor = geoShare(year, geo) * countryShare(geo, country);
  const revenueBySegment: SeriesPoint[] = dataset.segments
    .filter((s) => s.year === year && s.segment !== 'Other' && (segment === 'All' || s.segment === segment))
    .map((s) => ({ label: s.segment, value: Math.round(s.revenue * geoCountryFactor), growthPct: s.growthPct, notes: s.notes }));

  const segFactor = segmentShare(year, segment);
  const revenueByGeo: SeriesPoint[] = dataset.geographies
    .filter((g) => g.year === year && (geo === 'All' || g.geo === geo))
    .map((g) => ({ label: g.geo, value: Math.round(g.revenue * segFactor * countryShare(g.geo, country)), growthPct: g.growthPct }));

  // 3-year trend by segment (or geographies when a single segment is selected)
  const trendYears = dataset.fiscalYears;
  const segNames = ['Software', 'Consulting', 'Infrastructure', 'Financing'];
  const trend: TrendSeries[] =
    segment === 'All'
      ? segNames.map((name) => ({
          name,
          points: trendYears.map((y) => ({
            year: y,
            value: Math.round((dataset.segments.find((s) => s.year === y && s.segment === name)?.revenue ?? 0) * geoShare(y, geo) * countryShare(geo, country))
          }))
        }))
      : dataset.geographies
          .filter((g) => g.year === year)
          .map((g) => g.geo)
          .map((name) => ({
            name,
            points: trendYears.map((y) => ({
              year: y,
              value: Math.round((dataset.geographies.find((r) => r.year === y && r.geo === name)?.revenue ?? 0) * segmentShare(y, segment))
            }))
          }));

  // P&L-style summary table across the three ingested years
  const rowsSpec: { line: string; get: (r: AnnualRecord) => number; isPct?: boolean }[] = [
    { line: 'Revenue', get: (r) => r.revenue },
    { line: 'Gross Profit', get: (r) => r.grossProfit },
    { line: 'Gross Margin %', get: (r) => r.grossMarginPct, isPct: true },
    { line: 'Net Income', get: (r) => r.netIncome },
    { line: 'Operating Cash Flow', get: (r) => r.operatingCashFlow },
    { line: 'Free Cash Flow', get: (r) => r.freeCashFlow },
    { line: 'Cash & Marketable Securities', get: (r) => r.cashAndSecurities },
    { line: 'Accounts Receivable', get: (r) => r.accountsReceivable },
    { line: 'Inventory', get: (r) => r.inventory },
    { line: 'Total Debt', get: (r) => r.totalDebt }
  ];

  const byYear = (y: number) => dataset.annual.find((r) => r.year === y)!;
  const pnl: PnlRow[] = rowsSpec.map(({ line, get, isPct }) => {
    const v23 = get(byYear(2023));
    const v24 = get(byYear(2024));
    const v25 = get(byYear(2025));
    const fm = (v: number, y: number) => (isPct ? `${v.toFixed(1)}%` : fmtMillions(v * scopeFactor(y, geo, country, segment)));
    const yoyDiff = isPct ? v25 - v24 : ((v25 - v24) / Math.abs(v24)) * 100;
    return {
      line,
      fy2023: fm(v23, 2023),
      fy2024: fm(v24, 2024),
      fy2025: fm(v25, 2025),
      yoy: isPct ? `${yoyDiff >= 0 ? '+' : ''}${yoyDiff.toFixed(1)}pt` : `${yoyDiff >= 0 ? '+' : ''}${yoyDiff.toFixed(1)}%`,
      direction: yoyDiff > 0 ? 'up' : yoyDiff < 0 ? 'down' : 'flat'
    };
  });

  // Working capital & liquidity panel (deck section 4)
  const revenueYear = scale(a.revenue);
  const dso = (a.accountsReceivable / a.revenue) * 365;
  const arByGeo = dataset.geographies
    .filter((g) => g.year === year)
    .map((g) => ({
      geo: g.geo,
      ar: Math.round(a.accountsReceivable * (g.revenue / a.revenue)),
      days: dataset.workingCapitalDetail.arDaysByGeo[g.geo] ?? Math.round(dso)
    }));
  const buckets = dataset.workingCapitalDetail.inventoryBuckets.find((b) => b.year === year);
  const inventoryBuckets = buckets
    ? [
        { bucket: 'Sold, not yet delivered', value: buckets.soldNotDelivered },
        { bucket: 'Excess & obsolete exposure', value: buckets.excessAndObsolete },
        { bucket: 'In transit', value: buckets.inTransit },
        { bucket: 'Raw material & WIP', value: buckets.rawAndWip }
      ]
    : [];

  const workingCapital = {
    rows: [
      { metric: 'Cash & marketable securities', value: fmtMillions(scale(a.cashAndSecurities)), detail: `Cash ${fmtMillions(scale(a.cashAndEquivalents))} + short-term investments ${fmtMillions(scale(a.shortTermInvestments))}` },
      { metric: 'Free cash flow', value: fmtMillions(scale(a.freeCashFlow)), detail: `Operating cash flow ${fmtMillions(scale(a.operatingCashFlow))}` },
      { metric: 'Accounts receivable', value: fmtMillions(scale(a.accountsReceivable)), detail: `≈ ${dso.toFixed(0)} days sales outstanding` },
      { metric: 'Inventory', value: fmtMillions(scale(a.inventory)), detail: `${((a.inventory / a.revenue) * 365).toFixed(0)} days of revenue` }
    ],
    arByGeo,
    inventoryBuckets,
    note: dataset.workingCapitalDetail.note
  };

  const keyInsight = dataset.keyInsights.find((k) => k.year === year)?.insight ?? '';

  return {
    company: dataset.company,
    year,
    geo,
    country,
    segment,
    scopeNote: scopeNoteFor(geo, country, segment),
    kpis,
    keyInsight,
    revenueBySegment,
    revenueByGeo,
    trend,
    trendYears,
    pnl,
    workingCapital,
    risks: buildRisks(year),
    actions: buildActions(year),
    sources: dataset.sources
  };
}

/** Filter options for the client (drives the configurable controls). */
export function getFilterOptions() {
  const geoNames = [...new Set(dataset.geographies.map((g) => g.geo))];
  const countries: Record<string, string[]> = {};
  for (const geoName of geoNames) {
    const shares = dataset.countryShares[geoName];
    countries[geoName] = shares && typeof shares !== 'string' ? Object.keys(shares) : [];
  }
  return {
    years: dataset.fiscalYears,
    geographies: geoNames,
    countries,
    segments: [...new Set(dataset.segments.filter((s) => s.segment !== 'Other').map((s) => s.segment))]
  };
}
