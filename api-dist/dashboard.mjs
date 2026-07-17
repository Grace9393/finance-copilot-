import { createRequire as __cr } from 'node:module';
import { fileURLToPath as __f2p } from 'node:url';
import __path from 'node:path';
const require = __cr(import.meta.url);
const __filename = __f2p(import.meta.url);
const __dirname = __path.dirname(__filename);
globalThis.DOMMatrix ??= class DOMMatrix {
  constructor(init) {
    if (Array.isArray(init) && init.length === 6) { [this.a, this.b, this.c, this.d, this.e, this.f] = init; }
    else { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  }
  static fromMatrix(m) { return new DOMMatrix([m?.a ?? 1, m?.b ?? 0, m?.c ?? 0, m?.d ?? 1, m?.e ?? 0, m?.f ?? 0]); }
  scale() { return this; } translate() { return this; } multiply() { return this; } invertSelf() { return this; }
};
globalThis.ImageData ??= class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(0); } };
globalThis.Path2D ??= class Path2D { addPath() {} moveTo() {} lineTo() {} closePath() {} };

// server/src/data/ibmAnnualReports.ts
var ibmAnnualReports = {
  "company": "IBM",
  "currency": "USD millions",
  "fiscalYears": [
    2023,
    2024,
    2025
  ],
  "description": "Key financials ingested from IBM's last three annual reports (FY2023, FY2024, FY2025 10-K / Q4 press releases). Acts as the internal finance / EPM data source for the POC.",
  "sources": [
    "https://newsroom.ibm.com/2026-01-28-IBM-RELEASES-FOURTH-QUARTER-RESULTS",
    "https://www.sec.gov/Archives/edgar/data/51143/000005114326000010/ibm-20251231.htm",
    "https://www.sec.gov/Archives/edgar/data/51143/000005114326000027/ibmars2025.pdf",
    "https://www.sec.gov/Archives/edgar/data/51143/000005114325000015/Financial_Report.xlsx"
  ],
  "provenance": {
    "reported": "Figure as reported in IBM annual report / 10-K / Q4 earnings release",
    "derived": "Figure derived from reported totals and reported growth rates",
    "illustrative": "Illustrative EPM-style detail added for POC configurability; not disclosed at this granularity in public filings"
  },
  "annual": [
    {
      "year": 2023,
      "revenue": 61860,
      "revenueGrowthPct": 2.2,
      "grossProfit": 34300,
      "grossMarginPct": 55.4,
      "netIncome": 7502,
      "netMarginPct": 12.1,
      "freeCashFlow": 11236,
      "operatingCashFlow": 13931,
      "cashAndEquivalents": 13068,
      "shortTermInvestments": 373,
      "cashAndSecurities": 13441,
      "accountsReceivable": 7214,
      "inventory": 1161,
      "totalDebt": 56540,
      "totalAssets": 135241,
      "provenance": "reported"
    },
    {
      "year": 2024,
      "revenue": 62753,
      "revenueGrowthPct": 1.4,
      "grossProfit": 35551,
      "grossMarginPct": 56.7,
      "netIncome": 6023,
      "netMarginPct": 9.6,
      "freeCashFlow": 12749,
      "operatingCashFlow": 13445,
      "cashAndEquivalents": 13947,
      "shortTermInvestments": 644,
      "cashAndSecurities": 14591,
      "accountsReceivable": 6804,
      "inventory": 959,
      "totalDebt": 54973,
      "totalAssets": 137175,
      "provenance": "reported",
      "notes": "Net income includes a one-time non-cash pension settlement charge; underlying profitability improved year over year."
    },
    {
      "year": 2025,
      "revenue": 67472,
      "revenueGrowthPct": 7.5,
      "grossProfit": 39297,
      "grossMarginPct": 58.2,
      "netIncome": 10593,
      "netMarginPct": 15.7,
      "freeCashFlow": 14734,
      "operatingCashFlow": 13193,
      "cashAndEquivalents": 13587,
      "shortTermInvestments": 830,
      "cashAndSecurities": 14417,
      "accountsReceivable": 8112,
      "inventory": 1084,
      "totalDebt": 61260,
      "totalAssets": 151880,
      "provenance": "reported",
      "notes": "Free cash flow uses IBM's definition (excludes financing receivables). Gross margin expanded 150 bps on software mix."
    }
  ],
  "segments": [
    {
      "year": 2023,
      "segment": "Software",
      "revenue": 26330,
      "growthPct": 5.1,
      "provenance": "reported"
    },
    {
      "year": 2023,
      "segment": "Consulting",
      "revenue": 19985,
      "growthPct": 4.6,
      "provenance": "reported"
    },
    {
      "year": 2023,
      "segment": "Infrastructure",
      "revenue": 14625,
      "growthPct": -4.3,
      "provenance": "reported",
      "notes": "z16 mainframe cycle wind-down; distributed infrastructure demand normalised post-pandemic."
    },
    {
      "year": 2023,
      "segment": "Financing",
      "revenue": 741,
      "growthPct": 15.9,
      "provenance": "reported"
    },
    {
      "year": 2023,
      "segment": "Other",
      "revenue": 179,
      "growthPct": 0,
      "provenance": "derived"
    },
    {
      "year": 2024,
      "segment": "Software",
      "revenue": 27085,
      "growthPct": 2.9,
      "provenance": "reported",
      "notes": "Hybrid Platform & Solutions and Red Hat growth, partly offset by transaction processing timing."
    },
    {
      "year": 2024,
      "segment": "Consulting",
      "revenue": 20692,
      "growthPct": 3.5,
      "provenance": "reported",
      "notes": "Clients reprioritised discretionary spend toward AI programmes; backlog remained healthy."
    },
    {
      "year": 2024,
      "segment": "Infrastructure",
      "revenue": 14020,
      "growthPct": -4.1,
      "provenance": "reported",
      "notes": "Declining z16 product cycle ahead of the z17 launch; Power and storage demand soft."
    },
    {
      "year": 2024,
      "segment": "Financing",
      "revenue": 713,
      "growthPct": -3.8,
      "provenance": "reported"
    },
    {
      "year": 2024,
      "segment": "Other",
      "revenue": 243,
      "growthPct": 35.8,
      "provenance": "derived"
    },
    {
      "year": 2025,
      "segment": "Software",
      "revenue": 29962,
      "growthPct": 10.6,
      "provenance": "reported",
      "notes": "Generative AI book of business exceeded $12.5B inception-to-date; automation and data platforms accelerated."
    },
    {
      "year": 2025,
      "segment": "Consulting",
      "revenue": 21055,
      "growthPct": 1.8,
      "provenance": "reported",
      "notes": "AI-led signings grew while conventional application work stayed muted."
    },
    {
      "year": 2025,
      "segment": "Infrastructure",
      "revenue": 15718,
      "growthPct": 12.1,
      "provenance": "reported",
      "notes": "z17 mainframe cycle launch drove double-digit growth."
    },
    {
      "year": 2025,
      "segment": "Financing",
      "revenue": 737,
      "growthPct": 3.4,
      "provenance": "reported"
    }
  ],
  "geographies": [
    {
      "year": 2023,
      "geo": "Americas",
      "revenue": 31700,
      "growthPct": 3.4,
      "provenance": "derived"
    },
    {
      "year": 2023,
      "geo": "EMEA",
      "revenue": 18473,
      "growthPct": 4,
      "provenance": "derived"
    },
    {
      "year": 2023,
      "geo": "Asia Pacific",
      "revenue": 11687,
      "growthPct": -3,
      "provenance": "derived"
    },
    {
      "year": 2024,
      "geo": "Americas",
      "revenue": 31300,
      "growthPct": -1.3,
      "provenance": "reported"
    },
    {
      "year": 2024,
      "geo": "EMEA",
      "revenue": 19415,
      "growthPct": 5.1,
      "provenance": "reported"
    },
    {
      "year": 2024,
      "geo": "Asia Pacific",
      "revenue": 12038,
      "growthPct": 3,
      "provenance": "reported"
    },
    {
      "year": 2025,
      "geo": "Americas",
      "revenue": 33318,
      "growthPct": 6.6,
      "provenance": "reported"
    },
    {
      "year": 2025,
      "geo": "EMEA",
      "revenue": 22166,
      "growthPct": 14.2,
      "provenance": "reported"
    },
    {
      "year": 2025,
      "geo": "Asia Pacific",
      "revenue": 11988,
      "growthPct": -0.4,
      "provenance": "reported"
    }
  ],
  "countryShares": {
    "provenance": "illustrative",
    "note": "Country-level split inside each geography is an illustrative allocation for POC configurability. Geography totals are as reported/derived above.",
    "Americas": {
      "United States": 0.78,
      "Canada": 0.08,
      "Brazil": 0.07,
      "Mexico": 0.04,
      "Other Americas": 0.03
    },
    "EMEA": {
      "United Kingdom": 0.22,
      "Germany": 0.2,
      "France": 0.14,
      "Middle East & Africa": 0.16,
      "Italy": 0.08,
      "Spain": 0.06,
      "Other Europe": 0.14
    },
    "Asia Pacific": {
      "Japan": 0.45,
      "India": 0.18,
      "Australia": 0.12,
      "China": 0.1,
      "Other APAC": 0.15
    }
  },
  "workingCapitalDetail": {
    "provenance": "illustrative",
    "note": "AR-by-geo allocation and inventory buckets are illustrative EPM/ISC-style detail; totals per year match reported balance-sheet figures.",
    "arDaysByGeo": {
      "Americas": 36,
      "EMEA": 46,
      "Asia Pacific": 42
    },
    "inventoryBuckets": [
      {
        "year": 2023,
        "soldNotDelivered": 209,
        "excessAndObsolete": 128,
        "inTransit": 139,
        "rawAndWip": 685
      },
      {
        "year": 2024,
        "soldNotDelivered": 173,
        "excessAndObsolete": 96,
        "inTransit": 115,
        "rawAndWip": 575
      },
      {
        "year": 2025,
        "soldNotDelivered": 195,
        "excessAndObsolete": 87,
        "inTransit": 130,
        "rawAndWip": 672
      }
    ]
  },
  "keyInsights": [
    {
      "year": 2023,
      "insight": "Revenue grew 2.2% to $61.9B. Software (+5.1%) and Consulting (+4.6%) offset the Infrastructure decline (-4.3%) as the z16 cycle wound down. Gross margin reached 55.4% and free cash flow $11.2B."
    },
    {
      "year": 2024,
      "insight": "Revenue grew 1.4% to $62.8B. Software (+2.9%) and Consulting (+3.5%) grew while Infrastructure fell 4.1% ahead of the z17 launch. Gross margin expanded 130 bps to 56.7%; free cash flow rose to $12.7B. Net income was depressed by a one-time pension settlement charge."
    },
    {
      "year": 2025,
      "insight": "Revenue grew 7.5% to $67.5B \u2014 the strongest year of the three. Software (+10.6%) passed a $12.5B generative-AI book of business, Infrastructure (+12.1%) rode the z17 cycle, and EMEA (+14.2%) led all geographies. Gross margin hit 58.2% and free cash flow a record $14.7B."
    }
  ]
};

// server/src/ibmData.ts
var dataset = ibmAnnualReports;
function fmtMillions(value) {
  const abs = Math.abs(value);
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}B`;
  return `$${value.toFixed(0)}M`;
}
function fmtDelta(current, prior, unit) {
  if (prior === void 0 || prior === 0) return { deltaLabel: "no prior year", direction: "flat" };
  const diff = current - prior;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  if (unit === "pt") {
    return { deltaLabel: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pt vs FY${prior !== void 0 ? "" : ""}prior`, direction };
  }
  const pct = diff / Math.abs(prior) * 100;
  return { deltaLabel: `${diff >= 0 ? "+" : ""}${fmtMillions(diff).replace("$", "$")} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`, direction };
}
function geoShare(year, geo) {
  if (geo === "All") return 1;
  const total = dataset.annual.find((a) => a.year === year)?.revenue ?? 0;
  const g = dataset.geographies.find((r) => r.year === year && r.geo === geo);
  return total > 0 && g ? g.revenue / total : 1;
}
function countryShare(geo, country) {
  if (country === "All" || geo === "All") return 1;
  const shares = dataset.countryShares[geo];
  if (!shares || typeof shares === "string") return 1;
  return shares[country] ?? 1;
}
function segmentShare(year, segment) {
  if (segment === "All") return 1;
  const total = dataset.annual.find((a) => a.year === year)?.revenue ?? 0;
  const s = dataset.segments.find((r) => r.year === year && r.segment === segment);
  return total > 0 && s ? s.revenue / total : 1;
}
function scopeFactor(year, geo, country, segment) {
  return geoShare(year, geo) * countryShare(geo, country) * segmentShare(year, segment);
}
function scopeNoteFor(geo, country, segment) {
  const parts = [];
  if (segment !== "All") parts.push(`segment "${segment}"`);
  if (geo !== "All") parts.push(`geography "${geo}"`);
  if (country !== "All") parts.push(`country "${country}" (illustrative allocation)`);
  if (parts.length === 0) {
    return "Scope: IBM consolidated, as reported in the FY2023\u2013FY2025 annual reports.";
  }
  return `Scope: ${parts.join(" \xB7 ")} \u2014 scoped figures are pro-rata allocations of reported totals (POC approach; a production build would query EPM at native granularity).`;
}
function buildRisks(year) {
  const risks = [];
  const segs = dataset.segments.filter((s) => s.year === year && s.segment !== "Other");
  for (const s of segs.filter((x) => x.growthPct < 0).sort((a2, b) => a2.growthPct - b.growthPct)) {
    risks.push({
      driver: `${s.segment} revenue decline (${s.growthPct.toFixed(1)}%)`,
      impact: s.notes ?? `${s.segment} contracted ${Math.abs(s.growthPct).toFixed(1)}% year over year.`,
      severity: s.growthPct < -5 ? "high" : "medium"
    });
  }
  const geos = dataset.geographies.filter((g) => g.year === year && g.growthPct < 0);
  for (const g of geos) {
    risks.push({
      driver: `${g.geo} revenue decline (${g.growthPct.toFixed(1)}%)`,
      impact: `${g.geo} contracted ${Math.abs(g.growthPct).toFixed(1)}% \u2014 monitor pipeline coverage and FX exposure.`,
      severity: g.growthPct < -2 ? "medium" : "low"
    });
  }
  const a = dataset.annual.find((r) => r.year === year);
  const prior = dataset.annual.find((r) => r.year === year - 1);
  if (a && prior && a.accountsReceivable > prior.accountsReceivable * 1.1) {
    risks.push({
      driver: "Accounts receivable build-up",
      impact: `AR grew ${((a.accountsReceivable - prior.accountsReceivable) / prior.accountsReceivable * 100).toFixed(0)}% year over year (${fmtMillions(prior.accountsReceivable)} \u2192 ${fmtMillions(a.accountsReceivable)}) \u2014 watch DSO and collections.`,
      severity: "medium"
    });
  }
  if (a && prior && a.totalDebt > prior.totalDebt * 1.05) {
    risks.push({
      driver: "Debt increase",
      impact: `Total debt rose from ${fmtMillions(prior.totalDebt)} to ${fmtMillions(a.totalDebt)} \u2014 financing costs sensitive to rates.`,
      severity: "low"
    });
  }
  if (risks.length === 0) {
    risks.push({ driver: "No material declines in scope", impact: "All segments and geographies grew in the selected year.", severity: "low" });
  }
  return risks.slice(0, 5);
}
function buildActions(year) {
  const actions = [];
  const segs = dataset.segments.filter((s) => s.year === year && s.segment !== "Other");
  const worst = [...segs].sort((a, b) => a.growthPct - b.growthPct)[0];
  const best = [...segs].sort((a, b) => b.growthPct - a.growthPct)[0];
  if (worst && worst.growthPct < 0) {
    actions.push({ action: `Deep-dive ${worst.segment} decline with segment leadership; rebase FY${year + 1} plan`, category: "Revenue", status: "Pending approval" });
  }
  if (best) {
    actions.push({ action: `Re-allocate go-to-market investment toward ${best.segment} (+${best.growthPct.toFixed(1)}%)`, category: "Growth", status: "Approved" });
  }
  const geos = dataset.geographies.filter((g) => g.year === year);
  const worstGeo = [...geos].sort((a, b) => a.growthPct - b.growthPct)[0];
  if (worstGeo && worstGeo.growthPct < 1) {
    actions.push({ action: `Review ${worstGeo.geo} pipeline coverage and pricing with regional CFO`, category: "Revenue", status: "Triggered" });
  }
  actions.push({ action: "Push updated cash-flow forecast to Treasury", category: "Liquidity", status: "Completed" });
  return actions;
}
function buildDashboard(query) {
  const year = query.year && dataset.fiscalYears.includes(query.year) ? query.year : Math.max(...dataset.fiscalYears);
  const geo = query.geo ?? "All";
  const country = query.country ?? "All";
  const segment = query.segment ?? "All";
  const a = dataset.annual.find((r) => r.year === year);
  if (!a) throw new Error(`No annual record for ${year}`);
  const prior = dataset.annual.find((r) => r.year === year - 1);
  const factor = scopeFactor(year, geo, country, segment);
  const priorFactor = prior ? scopeFactor(prior.year, geo, country, segment) : factor;
  const scale = (v) => v * factor;
  const scalePrior = (v) => v * priorFactor;
  const revenueDelta = fmtDelta(scale(a.revenue), prior ? scalePrior(prior.revenue) : void 0, "money");
  const gpDelta = fmtDelta(scale(a.grossProfit), prior ? scalePrior(prior.grossProfit) : void 0, "money");
  const gmDelta = prior ? { deltaLabel: `${a.grossMarginPct - prior.grossMarginPct >= 0 ? "+" : ""}${(a.grossMarginPct - prior.grossMarginPct).toFixed(1)}pt vs FY${prior.year}`, direction: a.grossMarginPct >= prior.grossMarginPct ? "up" : "down" } : { deltaLabel: "no prior year", direction: "flat" };
  const niDelta = fmtDelta(scale(a.netIncome), prior ? scalePrior(prior.netIncome) : void 0, "money");
  const fcfDelta = fmtDelta(scale(a.freeCashFlow), prior ? scalePrior(prior.freeCashFlow) : void 0, "money");
  const cashDelta = fmtDelta(scale(a.cashAndSecurities), prior ? scalePrior(prior.cashAndSecurities) : void 0, "money");
  const kpis = [
    { label: "Revenue", value: fmtMillions(scale(a.revenue)), deltaLabel: revenueDelta.deltaLabel, direction: revenueDelta.direction, favourable: revenueDelta.direction !== "down" },
    { label: "Gross Profit", value: fmtMillions(scale(a.grossProfit)), deltaLabel: gpDelta.deltaLabel, direction: gpDelta.direction, favourable: gpDelta.direction !== "down" },
    { label: "Gross Margin %", value: `${a.grossMarginPct.toFixed(1)}%`, deltaLabel: gmDelta.deltaLabel, direction: gmDelta.direction, favourable: gmDelta.direction !== "down" },
    { label: "Net Income", value: fmtMillions(scale(a.netIncome)), deltaLabel: niDelta.deltaLabel, direction: niDelta.direction, favourable: niDelta.direction !== "down" },
    { label: "Free Cash Flow", value: fmtMillions(scale(a.freeCashFlow)), deltaLabel: fcfDelta.deltaLabel, direction: fcfDelta.direction, favourable: fcfDelta.direction !== "down" },
    { label: "Cash & Securities", value: fmtMillions(scale(a.cashAndSecurities)), deltaLabel: cashDelta.deltaLabel, direction: cashDelta.direction, favourable: cashDelta.direction !== "down" }
  ];
  const geoCountryFactor = geoShare(year, geo) * countryShare(geo, country);
  const revenueBySegment = dataset.segments.filter((s) => s.year === year && s.segment !== "Other" && (segment === "All" || s.segment === segment)).map((s) => ({ label: s.segment, value: Math.round(s.revenue * geoCountryFactor), growthPct: s.growthPct, notes: s.notes }));
  const segFactor = segmentShare(year, segment);
  const revenueByGeo = dataset.geographies.filter((g) => g.year === year && (geo === "All" || g.geo === geo)).map((g) => ({ label: g.geo, value: Math.round(g.revenue * segFactor * countryShare(g.geo, country)), growthPct: g.growthPct }));
  const trendYears = dataset.fiscalYears;
  const segNames = ["Software", "Consulting", "Infrastructure", "Financing"];
  const trend = segment === "All" ? segNames.map((name) => ({
    name,
    points: trendYears.map((y) => ({
      year: y,
      value: Math.round((dataset.segments.find((s) => s.year === y && s.segment === name)?.revenue ?? 0) * geoShare(y, geo) * countryShare(geo, country))
    }))
  })) : dataset.geographies.filter((g) => g.year === year).map((g) => g.geo).map((name) => ({
    name,
    points: trendYears.map((y) => ({
      year: y,
      value: Math.round((dataset.geographies.find((r) => r.year === y && r.geo === name)?.revenue ?? 0) * segmentShare(y, segment))
    }))
  }));
  const rowsSpec = [
    { line: "Revenue", get: (r) => r.revenue },
    { line: "Gross Profit", get: (r) => r.grossProfit },
    { line: "Gross Margin %", get: (r) => r.grossMarginPct, isPct: true },
    { line: "Net Income", get: (r) => r.netIncome },
    { line: "Operating Cash Flow", get: (r) => r.operatingCashFlow },
    { line: "Free Cash Flow", get: (r) => r.freeCashFlow },
    { line: "Cash & Marketable Securities", get: (r) => r.cashAndSecurities },
    { line: "Accounts Receivable", get: (r) => r.accountsReceivable },
    { line: "Inventory", get: (r) => r.inventory },
    { line: "Total Debt", get: (r) => r.totalDebt }
  ];
  const byYear = (y) => dataset.annual.find((r) => r.year === y);
  const pnl = rowsSpec.map(({ line, get, isPct }) => {
    const v23 = get(byYear(2023));
    const v24 = get(byYear(2024));
    const v25 = get(byYear(2025));
    const fm = (v, y) => isPct ? `${v.toFixed(1)}%` : fmtMillions(v * scopeFactor(y, geo, country, segment));
    const yoyDiff = isPct ? v25 - v24 : (v25 - v24) / Math.abs(v24) * 100;
    return {
      line,
      fy2023: fm(v23, 2023),
      fy2024: fm(v24, 2024),
      fy2025: fm(v25, 2025),
      yoy: isPct ? `${yoyDiff >= 0 ? "+" : ""}${yoyDiff.toFixed(1)}pt` : `${yoyDiff >= 0 ? "+" : ""}${yoyDiff.toFixed(1)}%`,
      direction: yoyDiff > 0 ? "up" : yoyDiff < 0 ? "down" : "flat"
    };
  });
  const revenueYear = scale(a.revenue);
  const dso = a.accountsReceivable / a.revenue * 365;
  const arByGeo = dataset.geographies.filter((g) => g.year === year).map((g) => ({
    geo: g.geo,
    ar: Math.round(a.accountsReceivable * (g.revenue / a.revenue)),
    days: dataset.workingCapitalDetail.arDaysByGeo[g.geo] ?? Math.round(dso)
  }));
  const buckets = dataset.workingCapitalDetail.inventoryBuckets.find((b) => b.year === year);
  const inventoryBuckets = buckets ? [
    { bucket: "Sold, not yet delivered", value: buckets.soldNotDelivered },
    { bucket: "Excess & obsolete exposure", value: buckets.excessAndObsolete },
    { bucket: "In transit", value: buckets.inTransit },
    { bucket: "Raw material & WIP", value: buckets.rawAndWip }
  ] : [];
  const workingCapital = {
    rows: [
      { metric: "Cash & marketable securities", value: fmtMillions(scale(a.cashAndSecurities)), detail: `Cash ${fmtMillions(scale(a.cashAndEquivalents))} + short-term investments ${fmtMillions(scale(a.shortTermInvestments))}` },
      { metric: "Free cash flow", value: fmtMillions(scale(a.freeCashFlow)), detail: `Operating cash flow ${fmtMillions(scale(a.operatingCashFlow))}` },
      { metric: "Accounts receivable", value: fmtMillions(scale(a.accountsReceivable)), detail: `\u2248 ${dso.toFixed(0)} days sales outstanding` },
      { metric: "Inventory", value: fmtMillions(scale(a.inventory)), detail: `${(a.inventory / a.revenue * 365).toFixed(0)} days of revenue` }
    ],
    arByGeo,
    inventoryBuckets,
    note: dataset.workingCapitalDetail.note
  };
  const keyInsight = dataset.keyInsights.find((k) => k.year === year)?.insight ?? "";
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
function getFilterOptions() {
  const geoNames = [...new Set(dataset.geographies.map((g) => g.geo))];
  const countries = {};
  for (const geoName of geoNames) {
    const shares = dataset.countryShares[geoName];
    countries[geoName] = shares && typeof shares !== "string" ? Object.keys(shares) : [];
  }
  return {
    years: dataset.fiscalYears,
    geographies: geoNames,
    countries,
    segments: [...new Set(dataset.segments.filter((s) => s.segment !== "Other").map((s) => s.segment))]
  };
}

// api/dashboard.ts
function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const isOptions = (req.url ?? "").includes("/options");
  if (isOptions) {
    res.json(getFilterOptions());
    return;
  }
  try {
    const q = req.query;
    res.json(buildDashboard({
      year: typeof q.year === "string" ? Number(q.year) : void 0,
      geo: typeof q.geo === "string" ? q.geo : void 0,
      country: typeof q.country === "string" ? q.country : void 0,
      segment: typeof q.segment === "string" ? q.segment : void 0
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Dashboard build failed" });
  }
}
export {
  handler as default
};
