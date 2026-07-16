import { useState } from 'react';
import './App.css';
import { DashboardSection } from './components/DashboardSection';
import { EnquirySection } from './components/EnquirySection';

type Section = 'dashboard' | 'enquiry';

/**
 * CFO AI Co-Pilot — two-section POC:
 *
 *  Section 1 · Dashboard — configurable (Year / Geography / Country / Segment),
 *              reads ONLY from internal finance systems / EPM (the ingested
 *              IBM annual reports FY2023–FY2025).
 *  Section 2 · Free-Text Enquiry — internal finance + ISC + internet +
 *              Context Studio MCP; root-cause, projection and liquidity
 *              questions answered with tables and confidence levels.
 */
export default function App() {
  const [section, setSection] = useState<Section>('dashboard');

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">CFO AI Co-Pilot</div>
          <div className="app-subtitle muted">Finance Co-Pilot POC · IBM FY2023–FY2025 annual reports · Context Studio MCP</div>
        </div>
        <nav className="section-tabs">
          <button
            className={`section-tab${section === 'dashboard' ? ' active' : ''}`}
            onClick={() => setSection('dashboard')}
            type="button"
          >
            <span className="section-tab-index">1</span> Dashboard
          </button>
          <button
            className={`section-tab${section === 'enquiry' ? ' active' : ''}`}
            onClick={() => setSection('enquiry')}
            type="button"
          >
            <span className="section-tab-index">2</span> Free-Text Enquiry
          </button>
        </nav>
      </header>

      <main className="app-main">
        {section === 'dashboard' ? <DashboardSection /> : <EnquirySection />}
      </main>
    </div>
  );
}
