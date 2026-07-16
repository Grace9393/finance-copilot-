import { useMemo, useState } from 'react';
import './App.css';
import { analyseData, DataContext, DecisionPackage, FinanceRow, SourceType } from './api';
import { ChatPanel } from './components/ChatPanel';
import { KpiCards } from './components/KpiCards';
import { SourcePanel } from './components/SourcePanel';

function NarrativePanel({ narrative }: { narrative: string }) {
  return (
    <div className="card">
      <h2 className="section-title">Executive Narrative</h2>
      <div>{narrative}</div>
    </div>
  );
}

function RiskPanel({ risks }: { risks: DecisionPackage['risks'] }) {
  return (
    <div className="card">
      <h2 className="section-title">Top Margin Risks</h2>
      <div className="stack">
        {risks.map((risk) => (
          <div className="risk-item" key={`${risk.driver}-${risk.impact}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <strong>{risk.driver}</strong>
              <span className={`badge ${risk.severity}`}>{risk.severity}</span>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>{risk.impact}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecommendationPanel({ items }: { items: DecisionPackage['recommendations'] }) {
  return (
    <div className="card">
      <h2 className="section-title">Recommended Actions</h2>
      <div className="stack">
        {items.map((item) => (
          <div className="recommendation-item" key={`${item.action}-${item.category}`}>
            <strong>{item.action}</strong>
            <div className="muted" style={{ marginTop: 8 }}>
              {item.category} · {item.priority}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DealsTable({ rows }: { rows: FinanceRow[] }) {
  const columns = useMemo(() => Object.keys(rows[0] ?? {}).slice(0, 6), [rows]);

  return (
    <div className="card">
      <h2 className="section-title">Opportunity Radar</h2>
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{String(row[column] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignCards({ rows }: { rows: FinanceRow[] }) {
  return (
    <div className="card">
      <h2 className="section-title">Campaign / Driver Highlights</h2>
      <div className="stack">
        {rows.map((row, index) => (
          <div className="campaign-item" key={index}>
            {Object.entries(row)
              .slice(0, 4)
              .map(([key, value]) => (
                <div key={key} style={{ marginBottom: 6 }}>
                  <strong>{key}:</strong> {String(value)}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const emptyData: DecisionPackage = {
  narrative: 'Run the analysis to see margin risks and recommended actions.',
  recommendations: [],
  kpis: { closedWon: 0, openPipeline: 0, toGoRevenue: 0, marginPct: 0 },
  risks: [],
  topDeals: [],
  campaigns: [],
  dataset: { source: '', fields: [], rows: [], fetchedAt: '' }
};

function getSourceConfig(sourceType: SourceType, sourceValue: string): Record<string, unknown> {
  if (sourceType === 'localFile') {
    return { filePath: sourceValue };
  }

  if (sourceType === 'icaMcp') {
    return sourceValue ? { endpoint: sourceValue } : {};
  }

  if (sourceType === 'pdf') {
    // Remote URL if it starts with http, otherwise treat as local file path
    const isRemote = /^https?:\/\//i.test(sourceValue);
    return isRemote ? { url: sourceValue } : { filePath: sourceValue };
  }

  return { url: sourceValue };
}

export default function App() {
  const [sourceType, setSourceType] = useState<SourceType>('icaMcp');
  const [sourceValue, setSourceValue] = useState('');
  const [data, setData] = useState<DecisionPackage>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Build a DataContext from the loaded dataset whenever data changes
  const dataContext: DataContext | undefined = useMemo(() => {
    if (!data.dataset?.rows?.length) return undefined;
    return {
      source: data.dataset.source,
      fields: data.dataset.fields,
      rows: data.dataset.rows,
      kpis: {
        closedWon: data.kpis.closedWon,
        openPipeline: data.kpis.openPipeline,
        toGoRevenue: data.kpis.toGoRevenue,
        marginPct: data.kpis.marginPct
      },
      narrative: data.narrative
    };
  }, [data]);

  async function handleAnalyse() {
    setLoading(true);
    setError('');

    try {
      const result = await analyseData(sourceType, getSourceConfig(sourceType, sourceValue));
      setData(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="workspace">
        {/* Left: main dashboard */}
        <div className="dashboard">
          <SourcePanel
            sourceType={sourceType}
            sourceValue={sourceValue}
            loading={loading}
            onSourceTypeChange={setSourceType}
            onSourceValueChange={setSourceValue}
            onAnalyse={handleAnalyse}
          />
          {error ? <div className="card error-text">{error}</div> : null}
          <KpiCards kpis={data.kpis} />
          <NarrativePanel narrative={data.narrative} />
          <div className="middle-grid">
            <RiskPanel risks={data.risks} />
            <RecommendationPanel items={data.recommendations} />
          </div>
          <div className="lower-grid">
            <DealsTable rows={data.topDeals} />
            <CampaignCards rows={data.campaigns} />
          </div>
        </div>

        {/* Right: Context Studio chat — receives live data context */}
        <ChatPanel dataContext={dataContext} />
      </div>
    </div>
  );
}
