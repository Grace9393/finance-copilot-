import { useRef, useState } from 'react';
import { ExternalSourceType, FinanceDataset, connectSource, uploadFile } from '../api';

/**
 * DataSourceBar — connect buttons for external data sources, used by both the
 * dashboard and the chat panel:
 *
 *   📤 Upload file  — xlsx / xls / csv / json / pdf / doc(x) / pptx / txt / md / html / images
 *   📁 Local path   — e.g. C:\Users\me\Downloads\report.pptx (local dev only)
 *   🌐 Web URL      — page with a table, a PDF, CSV, or an article
 *   📊 Google Sheet — share link or published-CSV link
 */

export const UPLOAD_ACCEPT = '.xlsx,.xls,.xlsm,.csv,.json,.pdf,.doc,.docx,.pptx,.txt,.md,.html,.htm,.png,.jpg,.jpeg,.gif,.webp';

type PickerKind = ExternalSourceType | null;

const PICKER_CONFIG: Record<Exclude<PickerKind, null>, { placeholder: string; button: string }> = {
  localPath: { placeholder: 'C:\\Users\\GRACEPAN\\Downloads\\Nestlé AR Proposal v3.pptx', button: 'Load file' },
  webUrl: { placeholder: 'https://… (page with a table, a PDF, CSV, or an article)', button: 'Fetch URL' },
  googleSheet: { placeholder: 'https://docs.google.com/spreadsheets/d/… (share or published-CSV link)', button: 'Load sheet' }
};

interface DataSourceBarProps {
  compact?: boolean;
  connectedSource?: string | null;
  onConnect: (dataset: FinanceDataset) => void;
  onClear?: () => void;
  /** Reports the raw File on uploads (null for path/URL/sheet connects) — lets the chat keep it for @file-to-pptx */
  onFileSelected?: (file: File | null) => void;
}

export function DataSourceBar({ compact, connectedSource, onConnect, onClear, onFileSelected }: DataSourceBarProps) {
  const [picker, setPicker] = useState<PickerKind>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleConnect() {
    if (!picker || !value.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataset = await connectSource(picker, value.trim());
      onFileSelected?.(null);
      onConnect(dataset);
      setPicker(null);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    setBusy(true);
    setError('');
    try {
      const dataset = await uploadFile(file);
      onFileSelected?.(file);
      onConnect(dataset);
      setPicker(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  function togglePicker(kind: Exclude<PickerKind, null>) {
    setError('');
    setValue('');
    setPicker((current) => (current === kind ? null : kind));
  }

  return (
    <div className={`source-bar${compact ? ' compact' : ''}`}>
      <div className="source-bar-buttons">
        <input
          ref={fileRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }}
        />
        <button className="source-btn" type="button" disabled={busy} onClick={() => fileRef.current?.click()} title="Upload xlsx, csv, pdf, doc(x), pptx, txt, md, html or image">
          📤 Upload file
        </button>
        <button className={`source-btn${picker === 'localPath' ? ' active' : ''}`} type="button" disabled={busy} onClick={() => togglePicker('localPath')} title="Read a file from a local path (works when the server runs on your machine)">
          📁 Local path
        </button>
        <button className={`source-btn${picker === 'webUrl' ? ' active' : ''}`} type="button" disabled={busy} onClick={() => togglePicker('webUrl')} title="Fetch a web page (table or article), PDF or CSV by URL — pages readable in your browser/Chrome extension work here too">
          🌐 Web URL
        </button>
        <button className={`source-btn${picker === 'googleSheet' ? ' active' : ''}`} type="button" disabled={busy} onClick={() => togglePicker('googleSheet')} title="Load a Google Sheet by share link or published-CSV link">
          📊 Google Sheet
        </button>
        {connectedSource && onClear && (
          <button className="source-btn clear" type="button" onClick={onClear} title="Disconnect the external source">
            ✕ {connectedSource.length > 28 ? `${connectedSource.slice(0, 28)}…` : connectedSource}
          </button>
        )}
      </div>

      {picker && (
        <div className="source-picker-row">
          <input
            className="source-picker-input"
            value={value}
            placeholder={PICKER_CONFIG[picker].placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleConnect(); }}
            disabled={busy}
            autoFocus
          />
          <button className="primary-button" type="button" disabled={busy || !value.trim()} onClick={() => void handleConnect()}>
            {busy ? '…' : PICKER_CONFIG[picker].button}
          </button>
        </div>
      )}

      {busy && !picker && <div className="muted source-bar-status">Parsing file…</div>}
      {error && <div className="error-text source-bar-status">{error}</div>}
    </div>
  );
}

/** Small preview of a connected dataset (used by the dashboard). */
export function DatasetPreview({ dataset, onClear }: { dataset: FinanceDataset; onClear: () => void }) {
  const cols = dataset.fields.slice(0, 6);
  const rows = dataset.rows.slice(0, 8);
  return (
    <div className="card source-preview">
      <div className="source-preview-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          Connected source: <span className="source-preview-name">{dataset.source}</span>
        </h2>
        <button className="source-btn clear" type="button" onClick={onClear}>✕ Disconnect</button>
      </div>
      <div className="muted" style={{ margin: '6px 0 10px' }}>
        {dataset.rows.length} rows · {dataset.fields.length} fields — this data now grounds the chat; ask questions about it in Free-Text Enquiry.
      </div>
      {dataset.imageDataUri ? (
        <img src={dataset.imageDataUri} alt={dataset.source} style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8 }} />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => <td key={c}>{String(row[c] ?? '').slice(0, 120)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
