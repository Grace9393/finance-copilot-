import { useMemo, useState } from 'react';
import './App.css';
import { DataContext, FinanceDataset } from './api';
import { ChatPanel, ChatSuggestion } from './components/ChatPanel';
import { DashboardSection } from './components/DashboardSection';
import { DataSourceBar, DatasetPreview } from './components/DataSourceBar';

/**
 * CFO AI Co-Pilot — single-page POC:
 *
 *  Left  · Dashboard — configurable (Year / Geography / Country / Segment),
 *          reads ONLY from internal finance systems / EPM (the ingested
 *          IBM annual reports FY2023–FY2025).
 *  Right · Free-Text Enquiry chat — internal finance + ISC + internet +
 *          Context Studio MCP; root-cause, projection and liquidity
 *          questions answered with tables and confidence levels.
 */

const WELCOME = [
  'Welcome to **Free-Text Enquiry**. I answer from the ingested IBM annual reports (FY2023–FY2025), ISC-style working-capital detail, the internet, and your Context Studio knowledge base.',
  '',
  '**Typical questions:**',
  '• **Root cause** — "Why did infrastructure revenue drop? Rank which markets dropped the most, how are competitors doing?"',
  '• **Projection** — "Based on existing data points, what is the projection on revenue and margin by business and geo?"',
  '• **Liquidity** — "What\'s the status of cash balances, AR and inventory?"',
  '',
  'Answers include tables and a **confidence level**.',
  '',
  '**Skills:** open ⚡ Skills and click one, or type **@skill-name** — e.g. "@financial-variance-analysis IBM FY2025 vs FY2024". Prefix with **@context** to query the Context Studio knowledge base directly.'
].join('\n');

const SUGGESTIONS: ChatSuggestion[] = [
  {
    label: '🔎 Why did infrastructure revenue drop?',
    prompt: 'Why did the infrastructure revenue drop? Rank which markets dropped the most to the least, and how are competitors doing?'
  },
  {
    label: '📈 Revenue / margin projection',
    prompt: 'Based on existing data points, what is the projection on revenue and margin by business and geo?'
  },
  {
    label: '💰 Cash, AR & inventory status',
    prompt: "What's the status of cash balances, AR and inventory? How much is free cash flow, how much is stuck with inventory sold but not delivered, how much with excess inventory, and receivables by geo?"
  }
];

export default function App() {
  // External data source (upload / local path / web URL / Google Sheet) —
  // shared by the dashboard (preview) and the chat (grounding context).
  const [externalData, setExternalData] = useState<FinanceDataset | null>(null);

  const externalContext: DataContext | undefined = useMemo(() => {
    if (!externalData?.rows?.length) return undefined;
    return {
      source: externalData.source,
      fields: externalData.fields,
      rows: externalData.rows,
      narrative: `External data source connected: ${externalData.source}`
    };
  }, [externalData]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">CFO AI Co-Pilot</div>
          <div className="app-subtitle muted">Finance Co-Pilot POC · IBM FY2023–FY2025 annual reports · Context Studio MCP</div>
        </div>
        <div className="header-source-pills">
          <span className="source-pill internal">⬢ Internal Finance / EPM</span>
          <span className="source-pill isc">🏭 ISC</span>
          <span className="source-pill internet">🌐 Internet</span>
          <span className="source-pill mcp">⚡ Context Studio MCP</span>
        </div>
      </header>

      <div className="workspace">
        {/* Left: Section 1 — configurable dashboard (internal EPM by default;
            external sources can be connected and previewed) */}
        <div className="dashboard">
          <div className="card">
            <h2 className="section-title">Data sources</h2>
            <DataSourceBar
              connectedSource={externalData?.source ?? null}
              onConnect={setExternalData}
              onClear={() => setExternalData(null)}
            />
          </div>
          {externalData && <DatasetPreview dataset={externalData} onClear={() => setExternalData(null)} />}
          <DashboardSection />
        </div>

        {/* Right: Section 2 — free-text enquiry chat (grounded on any
            connected external source) */}
        <ChatPanel welcomeText={WELCOME} suggestions={SUGGESTIONS} dataContext={externalContext} showSourceBar />
      </div>
    </div>
  );
}
