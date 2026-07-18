/**
 * dashboardDirective.ts — derive dashboard-control directives from chat input.
 *
 * Every chat question is scanned for dashboard-relevant intent and the reply
 * carries an optional `dashboard` directive the client applies live:
 *   - EPM scope: year / geography / country / segment mentions steer the
 *     Section-1 dashboard filters ("show 2024 EMEA software performance").
 *   - Connected-data scope: "revenue by region" style phrasing picks the
 *     dimension and measure of the dynamic dashboard built from the user's
 *     own file / URL / sheet.
 */

import { DataContextShape } from './dataAnswer.js';
import { getDataset } from './ibmData.js';

export interface DashboardDirective {
  year?: number;
  geo?: string;
  country?: string;
  segment?: string;
  /** External-data dynamic dashboard: categorical field to group by */
  dimension?: string;
  /** External-data dynamic dashboard: numeric field to aggregate */
  measure?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Detect EPM dashboard scope (year / geo / country / segment) in a message. */
export function detectEpmDirective(message: string): DashboardDirective | null {
  const ds = getDataset();
  const m = message.toLowerCase();
  const out: DashboardDirective = {};

  const yearMatch = message.match(/\b(20\d{2})\b/);
  if (yearMatch && ds.fiscalYears.includes(Number(yearMatch[1]))) out.year = Number(yearMatch[1]);

  for (const geo of [...new Set(ds.geographies.map((g) => g.geo))]) {
    if (m.includes(geo.toLowerCase()) || (geo === 'Asia Pacific' && /\bapac\b/.test(m))) {
      out.geo = geo;
      break;
    }
  }

  for (const [geoName, shares] of Object.entries(ds.countryShares)) {
    if (!shares || typeof shares === 'string') continue;
    for (const country of Object.keys(shares)) {
      if (country.startsWith('Other')) continue;
      if (m.includes(country.toLowerCase())) {
        out.country = country;
        out.geo = geoName;
        break;
      }
    }
    if (out.country) break;
  }

  for (const seg of [...new Set(ds.segments.map((s) => s.segment))]) {
    if (seg !== 'Other' && m.includes(seg.toLowerCase())) {
      out.segment = seg;
      break;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Detect dynamic-dashboard intent against a connected dataset: a mentioned
 * numeric field becomes the measure, a mentioned categorical field (or the
 * "by <field>" phrase) becomes the dimension.
 */
export function detectDataDirective(message: string, ctx: DataContextShape): DashboardDirective | null {
  if (!ctx.rows?.length || ctx.fields.includes('text')) return null;
  const m = norm(message);
  const out: DashboardDirective = {};

  const numeric = ctx.fields.filter((f) =>
    ctx.rows.every((row) => row[f] === '' || typeof row[f] === 'number'));
  const categorical = ctx.fields.filter((f) => !numeric.includes(f));

  const byMatch = message.toLowerCase().match(/\bby\s+([\w /-]{2,30})/);
  const byTerm = byMatch ? norm(byMatch[1]) : '';

  // A field "matches" loosely: full normalized name, or a meaningful prefix
  // (handles suffixes like _USD and partial mentions like "pipeline influenced").
  const fieldMentioned = (field: string): boolean => {
    const nf = norm(field);
    if (nf.length < 3) return false;
    if (m.includes(nf)) return true;
    const prefix = nf.slice(0, Math.max(8, Math.ceil(nf.length * 0.6)));
    return nf.length >= 8 && m.includes(prefix);
  };

  // Dimension: the explicit "by <field>" phrase wins outright; only fall back
  // to a general mention scan when no "by" phrase resolves (prevents e.g.
  // "Marketing_Spend" accidentally matching a "Market" field).
  if (byTerm) {
    for (const f of categorical) {
      const nf = norm(f);
      if (nf.length >= 3 && (byTerm === nf || byTerm.startsWith(nf) || nf.startsWith(byTerm))) {
        out.dimension = f;
        break;
      }
    }
  }
  if (!out.dimension && !byTerm) {
    for (const f of categorical) {
      if (fieldMentioned(f)) { out.dimension = f; break; }
    }
  }

  for (const f of numeric) {
    if (fieldMentioned(f)) { out.measure = f; break; }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Combined detection: connected-data directive first, EPM scope as fallback/addition. */
export function detectDirective(message: string, ctx?: DataContextShape): DashboardDirective | undefined {
  const dataDirective = ctx ? detectDataDirective(message, ctx) : null;
  const epmDirective = detectEpmDirective(message);
  if (!dataDirective && !epmDirective) return undefined;
  return { ...(epmDirective ?? {}), ...(dataDirective ?? {}) };
}
