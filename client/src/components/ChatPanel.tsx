import React, { useEffect, useRef, useState } from 'react';
import { ChatMode, ChatReply, DataContext, FinanceDataset, PptxReply, convertToPptx, getChatStatus, sendChatMessage, uploadFile } from '../api';

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  meta?: string;
  attachmentName?: string;
  pptx?: PptxReply;
}

interface Skill {
  name: string;
  label: string;
  description: string;
  prompt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = '.pdf,.xlsx,.xls,.xlsm,.csv,.json,.txt,.md,.png,.jpg,.jpeg,.gif,.webp';

const MODE_LABELS: Record<ChatMode, string> = {
  hybrid: 'Hybrid',
  vector: 'Vector',
  graph: 'Graph',
  schema: 'Schema',
  metadata: 'Metadata',
  contexts: 'Contexts'
};

const MODE_TIPS: Record<ChatMode, string> = {
  hybrid: 'Context Studio when data is loaded, a skill is invoked, or @context prefix is used. Falls back to web search otherwise.',
  vector: 'Semantic similarity search — always queries Context Studio knowledge base',
  graph: 'Knowledge graph traversal — always queries Context Studio knowledge base',
  schema: 'Fetch Context Studio schema',
  metadata: 'Fetch Context Studio metadata',
  contexts: 'List all team contexts'
};

const QUERY_MODES: ChatMode[] = ['hybrid', 'vector', 'graph'];

const SKILLS: Skill[] = [
  {
    name: 'annual-report-search',
    label: '📄 Annual Report',
    description: 'Type a company name + year (e.g. "IBM 2025 report") to auto-find and fetch the annual report PDF.',
    prompt: 'IBM 2025 annual report'
  },
  {
    name: 'web-search',
    label: '🔍 Web Search',
    description: 'Search the web for market overviews, industry trends, news, or any open topic.',
    prompt: 'search for overall market trend in AI industry 2025'
  },
  {
    name: 'industry-search',
    label: '📊 Industry Trend',
    description: 'Get market size, growth outlook, and competitive landscape for a specific industry.',
    prompt: 'industry overview and market outlook for '
  },
  {
    name: 'file-to-pptx',
    label: 'File to PowerPoint',
    description: 'Convert uploaded files (PDF, Excel, CSV, MD, images…) into an editable, IBM Carbon-branded PowerPoint deck.',
    prompt: 'Use the file-to-pptx skill to convert the uploaded file into a PowerPoint presentation: '
  },
  {
    name: 'pdf-file-reader',
    label: 'PDF File Reader',
    description: 'Read, extract text, tables and form fields from local or uploaded PDFs (incl. scanned / OCR).',
    prompt: 'Use the pdf-file-reader skill to extract and summarize the content of the uploaded PDF: '
  },
  {
    name: 'web-document-search',
    label: 'Web Document Search',
    description: 'Search the public web for documents and pages, then open and read them with attribution.',
    prompt: 'Use the web-document-search skill to find and read: '
  },
  {
    name: 'annual-report-analyzer',
    label: 'Annual Report Analyzer',
    description: 'Locate & summarize a company\'s annual report / 10-K into a cited financial digest.',
    prompt: 'Use the annual-report-analyzer skill to summarize the latest annual report for '
  },
  {
    name: 'earnings-peer-comparison',
    label: 'Earnings Peer Comparison',
    description: 'Side-by-side comparison of two or more companies\' reported financial results.',
    prompt: 'Use the earnings-peer-comparison skill to compare '
  },
  {
    name: 'financial-variance-analysis',
    label: 'Financial Variance Analysis',
    description: 'Decompose financial variances into waterfall bridges with leadership-ready narratives.',
    prompt: 'Use the financial-variance-analysis skill to analyze the variance between '
  },
  {
    name: 'margin-lever-playbook',
    label: 'Margin Lever Playbook',
    description: 'Map quantified margin/cost risks to prioritized corrective actions with expected-impact ranges.',
    prompt: 'Use the margin-lever-playbook skill to recommend actions for the following risk: '
  }
];

let idCounter = 0;
function nextId() { return ++idCounter; }

// ── JSON detection & rendering ───────────────────────────────────────────────

function extractJson(text: string): { pre: string; data: unknown; post: string } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      const data = JSON.parse(fenced[1].trim());
      const idx = text.indexOf(fenced[0]);
      return { pre: text.slice(0, idx).trim(), data, post: text.slice(idx + fenced[0].length).trim() };
    } catch { /* fall through */ }
  }
  for (const startChar of ['{', '[']) {
    const start = text.indexOf(startChar);
    if (start === -1) continue;
    for (let end = text.length; end > start; end--) {
      try {
        const data = JSON.parse(text.slice(start, end));
        if (typeof data === 'object' && data !== null) {
          return { pre: text.slice(0, start).trim(), data, post: text.slice(end).trim() };
        }
      } catch { /* keep shrinking */ }
    }
  }
  return null;
}

function flattenRow(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out[`${k}.${k2}`] = String(v2 ?? '');
      }
    } else { out[k] = String(v ?? ''); }
  }
  return out;
}

function JsonTable({ data }: { data: unknown }) {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const rows = (data as Record<string, unknown>[]).map(flattenRow);
    const cols = Array.from(new Set(rows.flatMap(Object.keys)));
    return (
      <div className="json-table-wrap">
        <table className="json-table">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i}>{cols.map((c) => <td key={c}>{row[c] ?? ''}</td>)}</tr>)}</tbody>
        </table>
        <div className="json-table-count muted">{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
      </div>
    );
  }
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const flat = flattenRow(data as Record<string, unknown>);
    return (
      <div className="json-table-wrap">
        <table className="json-table kv-table">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>{Object.entries(flat).map(([k, v]) => <tr key={k}><td className="kv-key">{k}</td><td>{v}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(data)) {
    return (
      <div className="json-table-wrap">
        <table className="json-table">
          <thead><tr><th>#</th><th>Value</th></tr></thead>
          <tbody>{(data as unknown[]).map((v, i) => <tr key={i}><td className="kv-key">{i + 1}</td><td>{String(v)}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  return null;
}

/** Convert a limited subset of markdown to HTML-safe JSX spans. */
function renderMarkdownLine(line: string, key: number): React.ReactNode {
  // Replace **bold**, [text](url), bare https:// links
  const parts: React.ReactNode[] = [];
  let rest = line;
  let i = 0;

  const push = (chunk: string) => {
    if (chunk) parts.push(<span key={`t${i++}`}>{chunk}</span>);
  };

  while (rest.length > 0) {
    // Bold: **text**
    const bold = rest.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (bold) { push(bold[1]); parts.push(<strong key={`b${i++}`}>{bold[2]}</strong>); rest = bold[3]; continue; }

    // Markdown link: [label](url)
    const mdLink = rest.match(/^(.*?)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(.*)/s);
    if (mdLink) { push(mdLink[1]); parts.push(<a key={`a${i++}`} href={mdLink[3]} target="_blank" rel="noreferrer">{mdLink[2]}</a>); rest = mdLink[4]; continue; }

    // Bare URL
    const bare = rest.match(/^(.*?)(https?:\/\/\S+)(.*)/s);
    if (bare) { push(bare[1]); parts.push(<a key={`u${i++}`} href={bare[2]} target="_blank" rel="noreferrer">{bare[2]}</a>); rest = bare[3]; continue; }

    push(rest);
    break;
  }

  // Heading line
  if (line.startsWith('## ')) return <h3 key={key} style={{ margin: '6px 0 2px', fontSize: 13, fontWeight: 600 }}>{parts.length ? parts : line.slice(3)}</h3>;
  if (line.startsWith('# ')) return <h2 key={key} style={{ margin: '6px 0 2px', fontSize: 14, fontWeight: 700 }}>{parts.length ? parts : line.slice(2)}</h2>;
  // Blockquote
  if (line.startsWith('> ')) return <blockquote key={key} style={{ margin: '2px 0', paddingLeft: 10, borderLeft: '3px solid #cbd5e1', color: '#475569' }}>{parts}</blockquote>;
  // Bullet
  if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ')) return <div key={key} style={{ paddingLeft: 12 }}>• {parts}</div>;

  return <div key={key}>{parts}</div>;
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="chat-bubble-text" style={{ lineHeight: 1.6 }}>
      {lines.map((line, i) => {
        if (line.trim() === '') return <div key={i} style={{ height: 6 }} />;
        return renderMarkdownLine(line, i);
      })}
    </div>
  );
}

function PptxDownloadButton({ pptx }: { pptx: PptxReply }) {
  function download() {
    const bytes = Uint8Array.from(atob(pptx.base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: pptx.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pptx.filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="pptx-download-block">
      <div className="pptx-download-info">
        <span>📊 <strong>{pptx.filename}</strong></span>
        <span className="muted" style={{ marginLeft: 8 }}>{pptx.slideCount} slide{pptx.slideCount !== 1 ? 's' : ''}</span>
      </div>
      {pptx.warnings.length > 0 && (
        <div className="pptx-warnings muted" style={{ fontSize: 11, marginTop: 4 }}>
          {pptx.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      <button className="primary-button" style={{ marginTop: 8 }} onClick={download} type="button">
        ⬇ Download PPTX
      </button>
    </div>
  );
}

function MessageContent({ text, attachmentName, pptx }: { text: string; attachmentName?: string; pptx?: PptxReply }) {
  const extracted = extractJson(text);
  // Use markdown renderer when the text contains markdown markers
  const hasMarkdown = /\*\*|^#{1,3} |^\> |\[.+\]\(https?:/m.test(text);
  return (
    <>
      {attachmentName && <div className="chat-attachment-tag">📎 {attachmentName}</div>}
      {extracted ? (
        <>
          {extracted.pre && <MarkdownText text={extracted.pre} />}
          <JsonTable data={extracted.data} />
          {extracted.post && <div className="chat-bubble-text" style={{ marginTop: 6 }}>{extracted.post}</div>}
        </>
      ) : hasMarkdown ? (
        <MarkdownText text={text} />
      ) : (
        <div className="chat-bubble-text">{text}</div>
      )}
      {pptx && <PptxDownloadButton pptx={pptx} />}
    </>
  );
}

// ── SkillsDrawer ──────────────────────────────────────────────────────────────

function SkillsDrawer({ open, onUse }: { open: boolean; onUse: (prompt: string) => void }) {
  if (!open) return null;
  return (
    <div className="skills-drawer">
      <div className="skills-drawer-title">Available Skills ({SKILLS.length})</div>
      {SKILLS.map((skill) => (
        <div key={skill.name} className="skill-card">
          <div className="skill-card-top">
            <code className="skill-name">{skill.name}</code>
            <button className="skill-use-btn" type="button" onClick={() => onUse(skill.prompt)}>Use ↗</button>
          </div>
          <div className="skill-desc muted">{skill.description}</div>
        </div>
      ))}
    </div>
  );
}

// ── FileZone ──────────────────────────────────────────────────────────────────

interface FileZoneProps {
  pendingFile: File | null;
  uploading: boolean;
  uploadedName: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
}

function FileZone({ pendingFile, uploading, uploadedName, onFile, onClear }: FileZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  const label = uploading
    ? 'Uploading…'
    : pendingFile
      ? `📎 ${pendingFile.name}`
      : uploadedName
        ? `✅ ${uploadedName} — loaded into chat`
        : 'Drop a file here or click to browse';

  const hasFile = !!pendingFile || !!uploadedName;

  return (
    <div
      className={`chat-file-zone${dragOver ? ' drag-over' : ''}${hasFile ? ' has-file' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !hasFile && fileRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      <span className="file-zone-label">{label}</span>
      {hasFile && !uploading && (
        <button
          className="file-zone-clear"
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          title="Remove file"
        >×</button>
      )}
    </div>
  );
}

// ── ChatPanel (main) ──────────────────────────────────────────────────────────

interface ChatPanelProps {
  dataContext?: DataContext;
  onDataContextChange?: (ctx: DataContext) => void;
}

export function ChatPanel({ dataContext, onDataContextChange }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      role: 'assistant',
      text: 'Hello! I\'m connected to your GraceTest Context Studio context.\n\n**Skills & Context Studio (always available):**\n• Click **⚡ Skills** to pick a skill — e.g. "Use the financial-variance-analysis skill to…"\n• Use **Vector** or **Graph** mode to search the knowledge base directly\n• Prefix any message with **@context** — e.g. "@context summarize IBM financials"\n• Drop a file (PDF, Excel, CSV…) — all follow-up questions are grounded on it\n\n**Web search (hybrid mode, no data loaded):**\n• Type naturally — "AI industry trends 2025"\n• "IBM 2025 annual report" — auto-fetches the PDF'
    }
  ]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>('hybrid');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Upload state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedDataset, setUploadedDataset] = useState<FinanceDataset | null>(null);
  // Full text from a fetched annual report — used to ground follow-up queries
  const [reportContext, setReportContext] = useState<{ title: string; text: string; url: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getChatStatus().then((s) => setOnline(s.online)).catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // When a file is selected, immediately upload it
  async function handleFile(file: File) {
    setPendingFile(file);
    setUploading(true);
    try {
      const dataset = await uploadFile(file);
      setUploadedDataset(dataset);
      setUploading(false);
      // Propagate up so the dashboard can also use this data context
      if (onDataContextChange) {
        onDataContextChange({
          source: dataset.source,
          fields: dataset.fields,
          rows: dataset.rows,
          narrative: `Uploaded file: ${file.name}`
        });
      }
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: `File loaded: **${file.name}** — ${dataset.rows.length} rows, ${dataset.fields.length} fields (${dataset.fields.slice(0, 6).join(', ')}${dataset.fields.length > 6 ? '…' : ''}).\n\nYou can now ask questions about this data. All queries will be grounded with the file content.`,
        }
      ]);
    } catch (err) {
      setUploading(false);
      setPendingFile(null);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'error', text: `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
      ]);
    }
  }

  function handleClearFile() {
    setPendingFile(null);
    setUploadedDataset(null);
    if (onDataContextChange) onDataContextChange(undefined as unknown as DataContext);
  }

  // Build the effective data context: uploaded file > report full text > left panel
  const effectiveContext: DataContext | undefined = uploadedDataset
    ? { source: uploadedDataset.source, fields: uploadedDataset.fields, rows: uploadedDataset.rows }
    : reportContext
      ? {
          source: reportContext.title,
          fields: ['text'],
          rows: reportContext.text.match(/[^\n]{1,300}/g)?.map((chunk, i) => ({ index: i + 1, text: chunk })) ?? [],
          narrative: `Annual report document: ${reportContext.url}`
        }
      : dataContext;

  /** Returns true when the message looks like a PPTX conversion request */
  function isPptxIntent(text: string): boolean {
    return /\b(pptx?|powerpoint|presentation|slides?)\b/i.test(text) &&
      /\b(convert|creat|generat|make|build|export|turn.+into)\b/i.test(text);
  }

  async function handleSend() {
    const text = input.trim();
    const needsMessage = QUERY_MODES.includes(mode);
    if (needsMessage && !text) return;
    if (loading) return;

    const displayText = text || `[${MODE_LABELS[mode]}]`;
    const attachmentName = pendingFile?.name;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: displayText, attachmentName }]);
    setInput('');
    setLoading(true);

    // ── PPTX conversion intent: file is an image and message asks for PPTX ──
    if (pendingFile && pendingFile.type.startsWith('image/') && isPptxIntent(text)) {
      try {
        const titleMatch = text.match(/title[:\s]+["']?([^"'\n]+)/i);
        const pptx = await convertToPptx(pendingFile, titleMatch ? titleMatch[1].trim() : undefined);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            text: `✅ Created **${pptx.filename}** — ${pptx.slideCount} slide, IBM Carbon branded. The image fills the left panel; the right panel has editable annotation placeholders. Click below to download.`,
            pptx
          }
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'error', text: `PPTX generation failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        ]);
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      return;
    }

    try {
      const res: ChatReply = await sendChatMessage(text, mode, effectiveContext);
      const toolLabel =
        res.tool === 'report-search' ? '📄 report'
        : res.tool === 'web-search'  ? '🔍 web search'
        : res.skill                  ? `⚡ ${res.skill}`
        : res.mode;
      const metaParts = [toolLabel, `${res.elapsedMs}ms`];

      // Store report full text so follow-up questions are grounded on it
      if (res.reportFullText && res.reportUrl) {
        const titleMatch = res.reply.match(/^## (.+)/m);
        setReportContext({
          title: titleMatch ? titleMatch[1] : `Report · ${res.reportUrl}`,
          text: res.reportFullText,
          url: res.reportUrl
        });
      }

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: res.isError ? 'error' : 'assistant', text: res.reply, meta: metaParts.join(' · ') }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'error', text: err instanceof Error ? err.message : 'Request failed' }
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }

  function handleSkillUse(prompt: string) {
    setInput(prompt);
    setSkillsOpen(false);
    setMode('hybrid');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const needsMessage = QUERY_MODES.includes(mode);
  const canSend = !loading && !uploading && (!needsMessage || input.trim().length > 0);
  const dotColor = online === null ? '#94a3b8' : online ? '#22c55e' : '#ef4444';

  const activeBadge = uploadedDataset
    ? `📎 ${uploadedDataset.source} · ${uploadedDataset.rows.length} rows`
    : reportContext
      ? `📄 ${reportContext.title}`
      : effectiveContext
        ? `⬡ ${effectiveContext.source} · ${effectiveContext.rows.length} rows · ${effectiveContext.fields.length} fields`
        : null;

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div>
          <div className="chat-title">Context Studio Chat</div>
          <div className="chat-subtitle muted">GraceTest · ctx_09f7830c068c</div>
          {activeBadge ? (
            <div className="chat-datasource-badge">{activeBadge}</div>
          ) : (
            <div className="chat-datasource-badge idle">No data loaded</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={`skills-toggle-btn${skillsOpen ? ' active' : ''}`}
            onClick={() => setSkillsOpen((o) => !o)}
            type="button"
            title="Show installed skills"
          >
            ⚡ Skills
          </button>
          <span className="chat-online-dot" style={{ background: dotColor }}
            title={online === null ? 'Checking…' : online ? 'Connected' : 'Offline'} />
        </div>
      </div>

      {/* Skills drawer */}
      <SkillsDrawer open={skillsOpen} onUse={handleSkillUse} />

      {/* Mode selector */}
      <div className="chat-modes">
        {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
          <button key={m} className={`chat-mode-btn${mode === m ? ' active' : ''}`}
            onClick={() => setMode(m)} title={MODE_TIPS[m]} type="button">
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.role}`}>
            <MessageContent text={msg.text} attachmentName={msg.attachmentName} pptx={msg.pptx} />
            {msg.meta && <div className="chat-meta muted">{msg.meta}</div>}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant">
            <div className="chat-typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* File upload zone */}
      <div className="chat-upload-area">
        <FileZone
          pendingFile={pendingFile}
          uploading={uploading}
          uploadedName={uploadedDataset ? uploadedDataset.source : null}
          onFile={handleFile}
          onClear={handleClearFile}
        />
      </div>

      {/* Input row */}
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-textarea"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={needsMessage ? 'Ask about data, or try "IBM 2025 report"… (Enter to send)' : 'Press Send to fetch context info'}
          disabled={loading || uploading}
        />
        <button className="primary-button chat-send-btn" onClick={() => void handleSend()} disabled={!canSend} type="button">
          {loading ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
