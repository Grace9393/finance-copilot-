/**
 * enquiry.ts
 *
 * Free-text enquiry engine for Section 2 of the POC.
 *
 * Answers three archetypes of CFO questions against the ingested IBM
 * annual-report dataset (internal finance / EPM stand-in), optionally
 * augmented with internet search for competitor context:
 *
 *   1. Root cause / ranking — "why did infrastructure revenue drop by 7%?
 *      rank which markets dropped the most, how are competitors doing?"
 *   2. Projection — "what is the projection on revenue / margin by
 *      business, geo?" → table + confidence level
 *   3. Liquidity status — "what's the status of cash balances, AR,
 *      inventory?" → table + free cash flow + inventory buckets + confidence
 *
 * Anything else falls through to the existing chat pipeline
 * (Context Studio MCP / annual-report fetch / web search).
 */

import { fmtMillions, getDataset } from './ibmData.js';
import { webSearch } from './webSearch.js';

export type EnquiryKind = 'rootCause' | 'projection' | 'liquidity';

export interface EnquiryAnswer {
  reply: string;
  tool: string;
  kind: EnquiryKind;
}

// ── Intent detection ──────────────────────────────────────────────────────────

const SEGMENT_ALIASES: Record<string, string> = {
  software: 'Software',
  consulting: 'Consulting',
  infrastructure: 'Infrastructure',
  financing: 'Financing'
};

function mentionedSegment(message: string): string | null {
  const lower = message.toLowerCase();
  for (const [alias, name] of Object.entries(SEGMENT_ALIASES)) {
    if (lower.includes(alias)) return name;
  }
  return null;
}

function mentionedYear(message: string): number | null {
  const match = message.match(/\b(202[0-9])\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return getDataset().fiscalYears.includes(year) ? year : null;
}

export function detectEnquiry(message: string): EnquiryKind | null {
  const m = message.toLowerCase();

  // Liquidity: cash / AR / inventory status
  if (/\b(cash\s+balance|cash\s+position|liquidity|free\s+cash\s+flow|fcf)\b/.test(m) ||
      (/\b(status|position|balance|level)\b/.test(m) && /\b(ar|a\/r|receivable|inventory|cash)\b/.test(m)) ||
      (/\b(receivables?|inventory)\b/.test(m) && /\b(cash|stuck|excess|status)\b/.test(m))) {
    return 'liquidity';
  }

  // Projection: forecast / outlook based on existing data points
  if (/\b(project(ion|ed)?|forecast|outlook|extrapolat|what.{0,20}next\s+year|fy20(2[6-9]))\b/.test(m) &&
      /\b(revenue|margin|growth|income|cash|business|geo|segment)\b/.test(m)) {
    return 'projection';
  }

  // Root cause / ranking: why did X drop / grow, rank markets, competitors
  if ((/\b(why|root\s+cause|key\s+factor|driver|what\s+caused|explain)\b/.test(m) ||
       /\brank\b/.test(m)) &&
      /\b(revenue|margin|growth|drop|decline|decrease|increase|grew|fell|software|consulting|infrastructure|financing|market|geo)\b/.test(m)) {
    return 'rootCause';
  }

  return null;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function tableJson(rows: Record<string, string | number>[]): string {
  return '```json\n' + JSON.stringify(rows, null, 1) + '\n```';
}

function confidenceNote(level: 'High' | 'Medium' | 'Low', reason: string): string {
  return `**Confidence: ${level}** — ${reason}`;
}

const wantsCompetitors = (m: string) => /\b(competitor|peer|rival|versus|vs\.?|dell|hpe|accenture|microsoft|oracle|sap)\b/i.test(m);

// ── 1. Root cause / ranking ───────────────────────────────────────────────────

export async function answerRootCause(message: string): Promise<EnquiryAnswer> {
  const ds = getDataset();
  const latest = Math.max(...ds.fiscalYears);
  const segment = mentionedSegment(message);
  const year = mentionedYear(message) ?? (segment ? findWorstYear(segment) : latest);

  const lines: string[] = [];
  const rows: Record<string, string | number>[] = [];

  if (segment) {
    const rec = ds.segments.find((s) => s.year === year && s.segment === segment);
    const prior = ds.segments.find((s) => s.year === year - 1 && s.segment === segment);
    if (rec) {
      const claimed = message.match(/(\d+(?:\.\d+)?)\s*%/);
      lines.push(`## ${segment} revenue — FY${year} root-cause analysis`);
      lines.push('');
      if (claimed && Math.abs(Number(claimed[1]) - Math.abs(rec.growthPct)) > 1) {
        lines.push(`> Note: the internal data shows ${segment} moved **${rec.growthPct >= 0 ? '+' : ''}${rec.growthPct.toFixed(1)}%** in FY${year} (not ${claimed[1]}%). Analysis below uses the recorded figure.`);
        lines.push('');
      }
      lines.push(`${segment} revenue was **${fmtMillions(rec.revenue)}** in FY${year}` +
        (prior ? ` vs ${fmtMillions(prior.revenue)} in FY${year - 1}` : '') +
        `, a change of **${rec.growthPct >= 0 ? '+' : ''}${rec.growthPct.toFixed(1)}%**.`);
      if (rec.notes) {
        lines.push('');
        lines.push(`**Key factors (from annual-report commentary):** ${rec.notes}`);
      }
    }
  } else {
    lines.push(`## FY${year} revenue root-cause analysis`);
  }

  // Rank markets (geographies) from biggest drop to best growth
  const geos = ds.geographies.filter((g) => g.year === year).sort((a, b) => a.growthPct - b.growthPct);
  lines.push('');
  lines.push(`**Markets ranked — biggest decline first (FY${year}, ${segment ? `${segment} allocated pro-rata` : 'total company'}):**`);
  lines.push('');
  const total = ds.annual.find((a) => a.year === year)?.revenue ?? 1;
  const segRec = segment ? ds.segments.find((s) => s.year === year && s.segment === segment) : null;
  for (const g of geos) {
    const value = segRec ? Math.round(g.revenue * (segRec.revenue / total)) : g.revenue;
    rows.push({
      Market: g.geo,
      [`FY${year} Revenue`]: fmtMillions(value),
      'YoY Growth': `${g.growthPct >= 0 ? '+' : ''}${g.growthPct.toFixed(1)}%`,
      Rank: rows.length + 1
    });
  }
  lines.push(tableJson(rows));

  // Segment ranking too, when no specific segment was asked about
  if (!segment) {
    const segs = ds.segments.filter((s) => s.year === year && s.segment !== 'Other').sort((a, b) => a.growthPct - b.growthPct);
    lines.push('');
    lines.push(`**Business segments ranked — biggest decline first (FY${year}):**`);
    lines.push('');
    lines.push(tableJson(segs.map((s, i) => ({
      Segment: s.segment,
      [`FY${year} Revenue`]: fmtMillions(s.revenue),
      'YoY Growth': `${s.growthPct >= 0 ? '+' : ''}${s.growthPct.toFixed(1)}%`,
      Rank: i + 1
    }))));
  }

  // Competitor context from the internet, when asked
  if (wantsCompetitors(message)) {
    const competitorQuery = segment === 'Infrastructure'
      ? `Dell HPE server infrastructure revenue growth ${year}`
      : segment === 'Consulting'
        ? `Accenture Deloitte consulting revenue growth ${year}`
        : `enterprise software cloud revenue growth Microsoft Oracle SAP ${year}`;
    try {
      const result = await webSearch(competitorQuery);
      lines.push('');
      lines.push('**Competitor context (internet):**');
      lines.push('');
      for (const s of result.snippets.slice(0, 3)) {
        lines.push(`• **[${s.title}](${s.url})** — ${s.snippet}`);
      }
      if (result.snippets.length === 0 && result.excerpt) {
        lines.push(result.excerpt.slice(0, 800));
        lines.push(`Source: ${result.url}`);
      }
    } catch {
      lines.push('');
      lines.push('_Competitor web search was unavailable — internal analysis only._');
    }
  }

  lines.push('');
  lines.push(confidenceNote('High', `internal figures come directly from the ingested FY2023–FY2025 annual reports${wantsCompetitors(message) ? '; competitor context is from live internet search and should be validated' : ''}. Country-level splits are illustrative allocations.`));

  return { reply: lines.join('\n'), tool: 'finance-enquiry', kind: 'rootCause' };
}

function findWorstYear(segment: string): number {
  const ds = getDataset();
  const recs = ds.segments.filter((s) => s.segment === segment);
  const worst = [...recs].sort((a, b) => a.growthPct - b.growthPct)[0];
  return worst?.year ?? Math.max(...ds.fiscalYears);
}

// ── 2. Projection ─────────────────────────────────────────────────────────────

/** Simple 3-point trend extrapolation with a stability-based confidence label. */
function project(points: number[]): { next: number; cagrPct: number; confidence: 'High' | 'Medium' | 'Low' } {
  const [a, b, c] = points;
  const g1 = b / a - 1;
  const g2 = c / b - 1;
  const cagr = Math.sqrt(c / a) - 1;
  const next = c * (1 + cagr);
  const spread = Math.abs(g1 - g2);
  const confidence = spread < 0.03 ? 'High' : spread < 0.08 ? 'Medium' : 'Low';
  return { next, cagrPct: cagr * 100, confidence };
}

export function answerProjection(message: string): EnquiryAnswer {
  const ds = getDataset();
  const years = ds.fiscalYears;
  const nextYear = Math.max(...years) + 1;
  const lines: string[] = [];

  lines.push(`## FY${nextYear} projection — trend extrapolation from FY${years[0]}–FY${years[years.length - 1]} actuals`);
  lines.push('');
  lines.push('_Method: 2-year CAGR applied to the latest actuals. Confidence reflects how stable the growth trend was across the three ingested years (stable → High, volatile → Low)._');
  lines.push('');

  // By business segment
  const segNames = [...new Set(ds.segments.filter((s) => s.segment !== 'Other').map((s) => s.segment))];
  const segRows = segNames.map((name) => {
    const pts = years.map((y) => ds.segments.find((s) => s.year === y && s.segment === name)?.revenue ?? 0);
    const p = project(pts);
    return {
      Business: name,
      [`FY${years[2]} Actual`]: fmtMillions(pts[2]),
      'Trend CAGR': `${p.cagrPct >= 0 ? '+' : ''}${p.cagrPct.toFixed(1)}%`,
      [`FY${nextYear} Projection`]: fmtMillions(p.next),
      Confidence: p.confidence
    };
  });
  lines.push('**Revenue projection by business:**');
  lines.push('');
  lines.push(tableJson(segRows));

  // By geography
  const geoNames = [...new Set(ds.geographies.map((g) => g.geo))];
  const geoRows = geoNames.map((name) => {
    const pts = years.map((y) => ds.geographies.find((g) => g.year === y && g.geo === name)?.revenue ?? 0);
    const p = project(pts);
    return {
      Geography: name,
      [`FY${years[2]} Actual`]: fmtMillions(pts[2]),
      'Trend CAGR': `${p.cagrPct >= 0 ? '+' : ''}${p.cagrPct.toFixed(1)}%`,
      [`FY${nextYear} Projection`]: fmtMillions(p.next),
      Confidence: p.confidence
    };
  });
  lines.push('');
  lines.push('**Revenue projection by geography:**');
  lines.push('');
  lines.push(tableJson(geoRows));

  // Margin projection
  const gm = years.map((y) => ds.annual.find((a) => a.year === y)?.grossMarginPct ?? 0);
  const gmStep = ((gm[2] - gm[0]) / 2);
  const gmNext = gm[2] + gmStep;
  const rev = years.map((y) => ds.annual.find((a) => a.year === y)?.revenue ?? 0);
  const revProj = project(rev);
  lines.push('');
  lines.push('**Margin & total revenue projection:**');
  lines.push('');
  lines.push(tableJson([
    { Metric: 'Total revenue', [`FY${years[2]} Actual`]: fmtMillions(rev[2]), [`FY${nextYear} Projection`]: fmtMillions(revProj.next), Confidence: revProj.confidence },
    { Metric: 'Gross margin %', [`FY${years[2]} Actual`]: `${gm[2].toFixed(1)}%`, [`FY${nextYear} Projection`]: `${gmNext.toFixed(1)}%`, Confidence: gmStep > 0 ? 'Medium' : 'Low' }
  ]));

  lines.push('');
  lines.push(confidenceNote('Medium', `projections are pure trend extrapolations from three annual data points — they do not incorporate pipeline, product-cycle, or macro signals. Treat as a directional baseline; overlay management guidance before use.`));

  return { reply: lines.join('\n'), tool: 'finance-enquiry', kind: 'projection' };
}

// ── 3. Liquidity status ───────────────────────────────────────────────────────

export function answerLiquidity(message: string): EnquiryAnswer {
  const ds = getDataset();
  const year = mentionedYear(message) ?? Math.max(...ds.fiscalYears);
  const a = ds.annual.find((r) => r.year === year)!;
  const prior = ds.annual.find((r) => r.year === year - 1);

  const lines: string[] = [];
  lines.push(`## Cash, receivables & inventory — FY${year} status`);
  lines.push('');
  lines.push('**Liquidity summary:**');
  lines.push('');
  lines.push(tableJson([
    { Metric: 'Cash & equivalents', Value: fmtMillions(a.cashAndEquivalents), 'vs Prior Year': prior ? fmtMillions(a.cashAndEquivalents - prior.cashAndEquivalents) : 'n/a' },
    { Metric: 'Short-term investments', Value: fmtMillions(a.shortTermInvestments), 'vs Prior Year': prior ? fmtMillions(a.shortTermInvestments - prior.shortTermInvestments) : 'n/a' },
    { Metric: 'Cash & marketable securities (total)', Value: fmtMillions(a.cashAndSecurities), 'vs Prior Year': prior ? fmtMillions(a.cashAndSecurities - prior.cashAndSecurities) : 'n/a' },
    { Metric: 'Free cash flow', Value: fmtMillions(a.freeCashFlow), 'vs Prior Year': prior ? fmtMillions(a.freeCashFlow - prior.freeCashFlow) : 'n/a' },
    { Metric: 'Total debt', Value: fmtMillions(a.totalDebt), 'vs Prior Year': prior ? fmtMillions(a.totalDebt - prior.totalDebt) : 'n/a' }
  ]));

  // AR by geography (allocation)
  const dso = (a.accountsReceivable / a.revenue) * 365;
  const arRows = ds.geographies
    .filter((g) => g.year === year)
    .map((g) => ({
      Geography: g.geo,
      'Accounts Receivable': fmtMillions(Math.round(a.accountsReceivable * (g.revenue / a.revenue))),
      'DSO (days)': ds.workingCapitalDetail.arDaysByGeo[g.geo] ?? Math.round(dso)
    }));
  lines.push('');
  lines.push(`**Accounts receivable by geography** (total ${fmtMillions(a.accountsReceivable)}, ≈${dso.toFixed(0)} DSO):`);
  lines.push('');
  lines.push(tableJson(arRows));

  // Inventory buckets
  const buckets = ds.workingCapitalDetail.inventoryBuckets.find((b) => b.year === year);
  if (buckets) {
    lines.push('');
    lines.push(`**Inventory breakdown** (total ${fmtMillions(a.inventory)}):`);
    lines.push('');
    lines.push(tableJson([
      { Bucket: 'Sold, not yet delivered', Value: fmtMillions(buckets.soldNotDelivered), Comment: 'Revenue recognised on delivery — watch logistics lead times' },
      { Bucket: 'Excess & obsolete exposure', Value: fmtMillions(buckets.excessAndObsolete), Comment: 'Candidate for write-down review / demand rebalancing' },
      { Bucket: 'In transit', Value: fmtMillions(buckets.inTransit), Comment: 'Normal pipeline stock' },
      { Bucket: 'Raw material & WIP', Value: fmtMillions(buckets.rawAndWip), Comment: 'Supports current build plan' }
    ]));
  }

  lines.push('');
  const fcfTrend = prior ? (a.freeCashFlow > prior.freeCashFlow ? 'improving' : 'declining') : 'stable';
  lines.push(`**Reading:** free cash flow is ${fcfTrend} (${fmtMillions(a.freeCashFlow)} in FY${year}); ` +
    `${fmtMillions(buckets?.soldNotDelivered ?? 0)} of inventory is sold but not yet delivered and ` +
    `${fmtMillions(buckets?.excessAndObsolete ?? 0)} is flagged as excess — both are working-capital release opportunities.`);
  lines.push('');
  lines.push(confidenceNote('High', 'balance-sheet totals are as reported in the annual reports. AR-by-geography and inventory buckets are illustrative EPM/ISC-style allocations for the POC (public filings do not disclose this granularity).'));

  return { reply: lines.join('\n'), tool: 'finance-enquiry', kind: 'liquidity' };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function answerEnquiry(message: string, kind: EnquiryKind): Promise<EnquiryAnswer> {
  switch (kind) {
    case 'rootCause':
      return answerRootCause(message);
    case 'projection':
      return answerProjection(message);
    case 'liquidity':
      return answerLiquidity(message);
  }
}
