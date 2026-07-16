import { ChatPanel, ChatSuggestion } from './ChatPanel';

/**
 * Section 2 — free-text enquiry.
 *
 * Data sources: internal finance systems / EPM (ingested IBM annual reports),
 * ISC-style working-capital detail, the internet (competitor / market
 * context), and the Context Studio MCP knowledge base. Typical questions are
 * root-cause analysis, projections, and cash / AR / inventory status —
 * answers come back as free-text analysis with tables and confidence levels.
 */

const WELCOME = [
  'Welcome to **Free-Text Enquiry**. I answer from the ingested IBM annual reports (FY2023–FY2025), ISC-style working-capital detail, the internet, and your Context Studio knowledge base.',
  '',
  '**Typical questions:**',
  '• **Root cause** — "Why did infrastructure revenue drop? Rank which markets dropped the most, how are competitors doing?"',
  '• **Projection** — "Based on existing data points, what is the projection on revenue and margin by business and geo?"',
  '• **Liquidity** — "What\'s the status of cash balances, AR and inventory?"',
  '',
  'Answers include tables and a **confidence level**. Prefix with **@context** to query Context Studio directly, or type "IBM 2025 annual report" to fetch the source document.'
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

export function EnquirySection() {
  return (
    <div className="enquiry-section">
      <div className="card enquiry-sources">
        <h2 className="section-title">Data sources in scope</h2>
        <div className="enquiry-source-badges">
          <span className="source-pill internal">⬢ Internal Finance / EPM — IBM annual reports FY2023–2025</span>
          <span className="source-pill isc">🏭 ISC — inventory & working-capital detail</span>
          <span className="source-pill internet">🌐 Internet — competitor & market context</span>
          <span className="source-pill mcp">⚡ Context Studio MCP + skills</span>
        </div>
      </div>
      <div className="enquiry-chat">
        <ChatPanel welcomeText={WELCOME} suggestions={SUGGESTIONS} />
      </div>
    </div>
  );
}
