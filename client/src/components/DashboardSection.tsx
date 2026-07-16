import { useEffect, useState } from 'react';
import { DashboardPackage, FilterOptions, fetchDashboard, fetchFilterOptions } from '../api';
import { BarChart, TrendChart } from './charts';

/**
 * Section 1 — configurable CFO dashboard.
 *
 * Data source: internal finance systems / EPM only (the ingested IBM
 * FY2023–FY2025 annual-report dataset served by /api/dashboard). The key
 * elements are configurable: Year, Geography, Country, Business Segment.
 */

function KpiStrip({ kpis }: { kpis: DashboardPackage['kpis'] }) {
  return (
    <div className="kpi-strip">
      {kpis.map((kpi) => (
        <div className="kpi-tile" key={kpi.label}>
          <div className="kpi-tile-label">{kpi.label}</div>
          <div className="kpi-tile-value">{kpi.value}</div>
          <div className={`kpi-tile-delta ${kpi.favourable ? 'good' : 'bad'}`}>
            {kpi.direction === 'up' ? '▲' : kpi.direction === 'down' ? '▼' : '—'} {kpi.deltaLabel}
          </div>
        </div>
      ))}
    </div>
  );
}

function PnlTable({ pnl }: { pnl: DashboardPackage['pnl'] }) {
  return (
    <table className="table pnl-table">
      <thead>
        <tr>
          <th>Line</th>
          <th>FY2023</th>
          <th>FY2024</th>
          <th>FY2025</th>
          <th>YoY (FY25 vs FY24)</th>
        </tr>
      </thead>
      <tbody>
        {pnl.map((row) => (
          <tr key={row.line}>
            <td className="pnl-line">{row.line}</td>
            <td>{row.fy2023}</td>
            <td>{row.fy2024}</td>
            <td className="pnl-latest">{row.fy2025}</td>
            <td className={row.direction === 'up' ? 'delta-good' : row.direction === 'down' ? 'delta-bad' : ''}>{row.yoy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DashboardSection() {
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [year, setYear] = useState<number>(2025);
  const [geo, setGeo] = useState('All');
  const [country, setCountry] = useState('All');
  const [segment, setSegment] = useState('All');
  const [data, setData] = useState<DashboardPackage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchFilterOptions()
      .then((opts) => {
        setOptions(opts);
        setYear(Math.max(...opts.years));
      })
      .catch(() => setError('Could not load filter options — is the server running?'));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchDashboard({ year, geo, country, segment })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Dashboard request failed'))
      .finally(() => setLoading(false));
  }, [year, geo, country, segment]);

  const countryList = options && geo !== 'All' ? options.countries[geo] ?? [] : [];

  return (
    <div className="dashboard-section">
      {/* Configurable filter bar */}
      <div className="card filter-bar">
        <div className="filter-source-badge" title="Section 1 reads only from internal finance systems / EPM (ingested IBM annual reports FY2023–FY2025)">
          ⬢ Internal Finance / EPM · IBM Annual Reports FY2023–2025
        </div>
        <div className="filter-controls">
          <label className="filter-field">
            <span>Fiscal Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {(options?.years ?? [2023, 2024, 2025]).map((y) => <option key={y} value={y}>FY{y}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>Geography</span>
            <select value={geo} onChange={(e) => { setGeo(e.target.value); setCountry('All'); }}>
              <option value="All">All geographies</option>
              {(options?.geographies ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)} disabled={geo === 'All'}>
              <option value="All">All countries</option>
              {countryList.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>Business Segment</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="All">All segments</option>
              {(options?.segments ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error ? <div className="card error-text">{error}</div> : null}
      {loading && !data ? <div className="card muted">Loading dashboard…</div> : null}

      {data && (
        <>
          <div className="muted scope-note">{data.scopeNote}</div>

          {/* Executive summary strip (deck section 1) */}
          <KpiStrip kpis={data.kpis} />

          <div className="card insight-card">
            <h2 className="section-title">Key Insight — FY{data.year}</h2>
            <div>{data.keyInsight}</div>
          </div>

          {/* Revenue performance (deck section 2) */}
          <div className="middle-grid">
            <div className="card">
              <h2 className="section-title">Revenue by Business Segment — FY{data.year}</h2>
              <BarChart data={data.revenueBySegment} />
            </div>
            <div className="card">
              <h2 className="section-title">Revenue by Geography — FY{data.year}</h2>
              <BarChart data={data.revenueByGeo} />
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">
              3-Year Trend — {data.segment === 'All' ? 'Revenue by Segment' : `${data.segment} Revenue by Geography`}
            </h2>
            <TrendChart series={data.trend} years={data.trendYears} />
          </div>

          {/* P&L summary across the three ingested years (deck sections 2–3) */}
          <div className="card">
            <h2 className="section-title">Financial Summary — FY2023 → FY2025</h2>
            <div className="table-scroll">
              <PnlTable pnl={data.pnl} />
            </div>
          </div>

          {/* Cash & liquidity (deck section 4) */}
          <div className="middle-grid">
            <div className="card">
              <h2 className="section-title">Cash & Working Capital — FY{data.year}</h2>
              <div className="stack">
                {data.workingCapital.rows.map((row) => (
                  <div className="wc-row" key={row.metric}>
                    <div>
                      <strong>{row.metric}</strong>
                      <div className="muted">{row.detail}</div>
                    </div>
                    <div className="wc-value">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2 className="section-title">AR by Geography & Inventory Detail</h2>
              <table className="table">
                <thead><tr><th>Geography</th><th>AR</th><th>DSO</th></tr></thead>
                <tbody>
                  {data.workingCapital.arByGeo.map((row) => (
                    <tr key={row.geo}>
                      <td>{row.geo}</td>
                      <td>{row.ar >= 1000 ? `$${(row.ar / 1000).toFixed(1)}B` : `$${row.ar}M`}</td>
                      <td>{row.days} days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.workingCapital.inventoryBuckets.length > 0 && (
                <>
                  <h3 className="subsection-title">Inventory buckets</h3>
                  <table className="table">
                    <tbody>
                      {data.workingCapital.inventoryBuckets.map((bucket) => (
                        <tr key={bucket.bucket}>
                          <td>{bucket.bucket}</td>
                          <td>${bucket.value}M</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>{data.workingCapital.note}</div>
            </div>
          </div>

          {/* Risk & opportunity + recommended actions (deck sections 6–7) */}
          <div className="middle-grid">
            <div className="card">
              <h2 className="section-title">Risk & Opportunity Panel — FY{data.year}</h2>
              <div className="stack">
                {data.risks.map((risk) => (
                  <div className="risk-item" key={risk.driver}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <strong>{risk.driver}</strong>
                      <span className={`badge ${risk.severity}`}>{risk.severity}</span>
                    </div>
                    <div className="muted" style={{ marginTop: 6 }}>{risk.impact}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2 className="section-title">Recommended Actions & Workflow Log</h2>
              <div className="stack">
                {data.actions.map((action) => (
                  <div className="recommendation-item" key={action.action}>
                    <strong>{action.action}</strong>
                    <div className="muted" style={{ marginTop: 6 }}>
                      {action.category} · <span className="action-status">{action.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="muted sources-note">
            Sources: {data.sources.map((s, i) => (
              <span key={s}>
                {i > 0 ? ' · ' : ''}
                <a href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}</a>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
