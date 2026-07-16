/**
 * charts.tsx — lightweight SVG charts for the dashboard section.
 *
 * Categorical palette (validated for lightness band, chroma, CVD separation
 * and contrast on a white surface): blue, green, amber, violet — assigned in
 * fixed order per entity, never cycled.
 */

export const SERIES_COLORS: Record<string, string> = {
  Software: '#2563eb',
  Consulting: '#059669',
  Infrastructure: '#d97706',
  Financing: '#7c3aed',
  Americas: '#2563eb',
  EMEA: '#059669',
  'Asia Pacific': '#d97706'
};

const FALLBACK_ORDER = ['#2563eb', '#059669', '#d97706', '#7c3aed'];

export function seriesColor(name: string, index: number): string {
  return SERIES_COLORS[name] ?? FALLBACK_ORDER[index % FALLBACK_ORDER.length];
}

function fmtM(value: number): string {
  return value >= 1000 ? `$${(value / 1000).toFixed(1)}B` : `$${value.toFixed(0)}M`;
}

// ── Horizontal bar chart (magnitude by category) ──────────────────────────────

export interface BarDatum {
  label: string;
  value: number;
  growthPct?: number;
  notes?: string;
}

export function BarChart({ data, height = 34 }: { data: BarDatum[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const chartWidth = 560;
  const labelWidth = 110;
  const valueWidth = 120;
  const barMax = chartWidth - labelWidth - valueWidth;
  const totalHeight = data.length * height;

  return (
    <svg viewBox={`0 0 ${chartWidth} ${totalHeight}`} width="100%" role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const w = Math.max((d.value / max) * barMax, 2);
        const y = i * height;
        const color = seriesColor(d.label, i);
        const growth = d.growthPct !== undefined ? ` (${d.growthPct >= 0 ? '+' : ''}${d.growthPct.toFixed(1)}% YoY)` : '';
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${fmtM(d.value)}${growth}${d.notes ? ` — ${d.notes}` : ''}`}</title>
            <text x={labelWidth - 8} y={y + height / 2 + 4} textAnchor="end" fontSize="12" fill="#475569">{d.label}</text>
            <rect x={labelWidth} y={y + 7} width={w} height={height - 14} rx="4" fill={color} />
            <text x={labelWidth + w + 8} y={y + height / 2 + 4} fontSize="12" fontWeight="600" fill="#1e293b">
              {fmtM(d.value)}
              {d.growthPct !== undefined && (
                <tspan fill={d.growthPct >= 0 ? '#15803d' : '#b91c1c'} fontWeight="500">
                  {`  ${d.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(d.growthPct).toFixed(1)}%`}
                </tspan>
              )}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Grouped bar trend (change over 3 fiscal years, by series) ────────────────

export interface TrendSeriesData {
  name: string;
  points: { year: number; value: number }[];
}

export function TrendChart({ series, years }: { series: TrendSeriesData[]; years: number[] }) {
  const chartWidth = 560;
  const chartHeight = 190;
  const padLeft = 8;
  const padBottom = 24;
  const padTop = 8;
  const plotHeight = chartHeight - padBottom - padTop;
  const max = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 1);

  const groupWidth = (chartWidth - padLeft * 2) / years.length;
  const barGap = 2;
  const barWidth = Math.min(34, (groupWidth - 40) / Math.max(series.length, 1) - barGap);

  return (
    <div>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%" role="img" aria-label="Trend by fiscal year">
        {/* baseline */}
        <line x1={padLeft} y1={chartHeight - padBottom} x2={chartWidth - padLeft} y2={chartHeight - padBottom} stroke="#e2e8f0" strokeWidth="1" />
        {years.map((year, yi) => {
          const groupX = padLeft + yi * groupWidth + (groupWidth - series.length * (barWidth + barGap)) / 2;
          return (
            <g key={year}>
              {series.map((s, si) => {
                const point = s.points.find((p) => p.year === year);
                const value = point?.value ?? 0;
                const h = Math.max((value / max) * plotHeight, 2);
                const x = groupX + si * (barWidth + barGap);
                const y = chartHeight - padBottom - h;
                return (
                  <g key={s.name}>
                    <title>{`${s.name} · FY${year}: ${fmtM(value)}`}</title>
                    <rect x={x} y={y} width={barWidth} height={h} rx="4" fill={seriesColor(s.name, si)} />
                  </g>
                );
              })}
              <text x={padLeft + yi * groupWidth + groupWidth / 2} y={chartHeight - 8} textAnchor="middle" fontSize="12" fill="#64748b">
                FY{year}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((s, i) => (
          <span key={s.name} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: seriesColor(s.name, i) }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
