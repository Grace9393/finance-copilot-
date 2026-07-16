import { SourceType } from '../api';

interface SourcePanelProps {
  sourceType: SourceType;
  sourceValue: string;
  loading: boolean;
  onSourceTypeChange: (sourceType: SourceType) => void;
  onSourceValueChange: (value: string) => void;
  onAnalyse: () => void;
}

const labels: Record<SourceType, string> = {
  localFile: 'Local File',
  webScraper: 'Web URL',
  googleSheets: 'Google Sheets',
  icaMcp: 'ICA MCP',
  pdf: 'PDF'
};

const placeholders: Record<SourceType, string> = {
  localFile: 'Enter local file path (.json, .csv, .xlsx)',
  webScraper: 'Enter web page URL',
  googleSheets: 'Paste published Google Sheets CSV URL',
  icaMcp: 'Enter ICA MCP endpoint URL (optional)',
  pdf: 'Enter local PDF path or remote PDF URL'
};

export function SourcePanel(props: SourcePanelProps) {
  const { sourceType, sourceValue, loading, onSourceTypeChange, onSourceValueChange, onAnalyse } = props;

  return (
    <div className="card header-card">
      <div>
        <h1 style={{ margin: '0 0 6px' }}>Finance Co-Pilot</h1>
        <div className="muted">Real-time margin risk insight and recommended CFO actions</div>
      </div>
      <div className="header-actions">
        <div className="tab-group">
          {Object.entries(labels).map(([value, label]) => (
            <button
              key={value}
              className={`tab-button ${sourceType === value ? 'active' : ''}`}
              onClick={() => onSourceTypeChange(value as SourceType)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="input"
          value={sourceValue}
          onChange={(event) => onSourceValueChange(event.target.value)}
          placeholder={placeholders[sourceType]}
        />
        <button className="primary-button" disabled={loading} onClick={onAnalyse} type="button">
          {loading ? 'Analysing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
