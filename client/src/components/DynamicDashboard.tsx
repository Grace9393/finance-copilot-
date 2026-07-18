import { useMemo, useState } from 'react';
import { DashboardDirective, FinanceDataset } from '../api';
import { BarChart } from './charts';

/**
 * DynamicDashboard — a dashboard auto-built from whatever data source the user
 * connected (upload / local path / web URL / Google Sheet).
 *
 * Numeric fields become KPI tiles and measures; low-cardinality categorical
 * fields become filters and chart dimensions. Chat directives ("revenue by
 * region") steer the selected dimension/measure live.
 */

interface DynamicDashboardProps {
  dataset: FinanceDataset;
  directive?: DashboardDirective;
  onClear: () => void;
}

const fmtNum = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return Math.round(v * 100) / 100 + '';
};

export function DynamicDashboard({ dataset, directive, onClear }: DynamicDashboardProps) {
  const { numericFields, categoricalFields, filterableFields } = useMemo(() => {
    const isDateOrId = (f: string) => /date|_id$|^id$|number$/i.test(f);
    const numeric = dataset.fields.filter((f) =>
      !isDateOrId(f) && dataset.rows.length > 0 && dataset.rows.every((r) => r[f] === '' || typeof r[f] === 'number'));
    const categorical = dataset.fields.filter((f) => !numeric.includes(f));
    const filterable = categorical.filter((f) => {
      const cardinality = new Set(dataset.rows.map((r) => String(r[f]))).size;
      return cardinality >= 2 && cardinality <= 12;
    });
    return { numericFields: numeric, categoricalFields: categorical, filterableFields: filterable.slice(0, 3) };
  }, [dataset]);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [localDim, setLocalDim] = useState<string | null>(null);
  const [localMeasure, setLocalMeasure] = useState<string | null>(null);

  // Chat directive wins over local UI choice; local choice wins over default
  const dimension =
    (directive?.dimension && categoricalFields.includes(directive.dimension) ? directive.dimension : null) ??
    localDim ?? filterableFields[0] ?? categoricalFields[0] ?? null;
  const measure =
    (directive?.measure && numericFields.includes(directive.measure) ? directive.measure : null) ??
    localMeasure ?? numericFields[0] ?? null;

  const filteredRows = useMemo(
    () => dataset.rows.filter((r) => Object.entries(filters).every(([f, v]) => v === 'All' || String(r[f]) === v)),
    [dataset, filters]
  );

  const kpis = useMemo(() => numericFields.slice(0, 4).map((f) => {
    const values = filteredRows.map((r) => Number(r[f])).filter(Number.isFinite);
    const total = values.reduce((a, b) => a + b, 0);
    return { field: f, total, avg: values.length ? total / values.length : 0 };
  }), [numericFields, filteredRows]);

  const chartData = useMemo(() => {
    if (!dimension || !measure) return [];
    const sums = new Map<string, number>();
    for (const row of filteredRows) {
      const key = String(row[dimension] ?? '—');
      sums.set(key, (sums.get(key) ?? 0) + (Number(row[measure]) || 0));
    }
    return [...sums.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));
  }, [filteredRows, dimension, measure]);

  const isTextDoc = dataset.fields.includes('text') && dataset.fields.length <= 3;

  if (isTextDoc) {
    return (
      <div className="card source-preview">
        <div className="source-preview-head">
          <h2 className="section-title" style={{ margin: 0 }}>
            Connected document: <span className="source-preview-name">{dataset.source}</span>
          </h2>
          <button className="source-btn clear" type="button" onClick={onClear}>✕ Disconnect</button>
        </div>
        <div className="muted" style={{ margin: '6px 0 8px' }}>
          {dataset.rows.length} passages loaded — ask about it in the chat; answers quote the matching passages.
        </div>
        <div className="table-scroll">
          <table className="table">
            <tbody>
              {dataset.rows.slice(0, 4).map((row, i) => (
                <tr key={i}><td>{String(row.text ?? '').slice(0, 160)}…</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="card source-preview">
      <div className="source-preview-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          Dynamic dashboard: <span className="source-preview-name">{dataset.source}</span>
        </h2>
        <button className="source-btn clear" type="button" onClick={onClear}>✕ Disconnect</button>
      </div>
      <div className="muted" style={{ margin: '4px 0 10px' }}>
        {filteredRows.length} of {dataset.rows.length} rows · built automatically from the connected data — steer it from the chat, e.g. “{measure ?? 'value'} by {dimension ?? 'category'}”.
      </div>

      {/* Filters + dimension/measure pickers */}
      <div className="filter-controls" style={{ marginBottom: 12 }}>
        {filterableFields.map((f) => (
          <label className="filter-field" key={f}>
            <span>{f}</span>
            <select value={filters[f] ?? 'All'} onChange={(e) => setFilters((prev) => ({ ...prev, [f]: e.target.value }))}>
              <option value="All">All</option>
              {[...new Set(dataset.rows.map((r) => String(r[f])))].sort().map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        ))}
        {categoricalFields.length > 1 && (
          <label className="filter-field">
            <span>Group by</span>
            <select value={dimension ?? ''} onChange={(e) => setLocalDim(e.target.value)}>
              {categoricalFields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        )}
        {numericFields.length > 1 && (
          <label className="filter-field">
            <span>Measure</span>
            <select value={measure ?? ''} onChange={(e) => setLocalMeasure(e.target.value)}>
              {numericFields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* KPI tiles */}
      {kpis.length > 0 && (
        <div className="kpi-strip" style={{ gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, minmax(0, 1fr))`, marginBottom: 12 }}>
          {kpis.map((kpi) => (
            <div className="kpi-tile" key={kpi.field}>
              <div className="kpi-tile-label">{kpi.field}</div>
              <div className="kpi-tile-value">{fmtNum(kpi.total)}</div>
              <div className="muted" style={{ fontSize: 12 }}>avg {fmtNum(kpi.avg)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && dimension && measure && (
        <>
          <h3 className="subsection-title" style={{ marginTop: 4 }}>{measure} by {dimension}</h3>
          <BarChart data={chartData} format={fmtNum} />
        </>
      )}
    </div>
  );
}
