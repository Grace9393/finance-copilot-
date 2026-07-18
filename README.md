# Finance Studio — CFO analytics POC

A React + Express proof of concept for **Finance Studio**, a CFO analytics workspace with two sections:

| Section | What it does | Data sources |
|---|---|---|
| **1 · Dashboard** | Configurable quarter-end style dashboard — Year, Geography, Country and Business Segment are user-selectable. KPI strip, key insight, revenue-by-segment/geo charts, 3-year trend, P&L summary, cash & working capital, risk panel and recommended actions. | **Internal finance systems / EPM only** — the ingested IBM annual-report dataset |
| **2 · Free-Text Enquiry** | Chat-based analysis with an embedded assistant. Root-cause / ranking questions, projections, and cash / AR / inventory status come back as free-text analysis **with tables and confidence levels**. | Internal finance / EPM · ISC-style working-capital detail · **internet** (competitor & market context) · **Context Studio MCP** + skills |

The UI is styled after the *WatsonX Sample Output Dashboard* deck and the ABC CFO Command Center reference.

## Ingested data — last 3 years of IBM annual reports

For the POC, [`server/data/ibm-annual-reports.json`](server/data/ibm-annual-reports.json) contains key financials from IBM's **FY2023, FY2024 and FY2025** annual reports (10-K / Q4 earnings releases): revenue by segment and geography, gross profit & margin, net income, free cash flow, cash & marketable securities, accounts receivable, inventory and total debt.

Every record carries a provenance tag:

- `reported` — figure as published by IBM
- `derived` — computed from reported totals and reported growth rates
- `illustrative` — EPM/ISC-style detail (country splits, AR-by-geo days, inventory buckets) added for POC configurability; public filings do not disclose that granularity

## Prerequisites

- Node.js 18+
- npm

## Install & run

```bash
npm install
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

## Section 1 — configurable dashboard

`GET /api/dashboard?year=2025&geo=EMEA&country=Germany&segment=Software`

`GET /api/dashboard/options` returns the available filter values that drive the controls.

The dashboard reads **only** from the internal EPM dataset — no internet calls. Scoped views (a geography, country or segment) are pro-rata allocations of reported totals; a production build would query the EPM system at native granularity.

## Section 2 — free-text enquiry

`POST /api/chat` routes each message through, in order:

1. **Finance enquiry engine** (`server/src/enquiry.ts`) — answers three archetypes from the ingested dataset:
   - *Root cause / ranking* — "Why did the infrastructure revenue drop by 7%? Rank which markets dropped the most to the least, how are competitors doing?" → analysis + ranked tables; competitor context is pulled live from the internet when asked. If the premise doesn't match the recorded data (e.g. the actual drop was 4.1%), the answer says so and uses the recorded figure.
   - *Projection* — "Based on existing data points, what is the projection on revenue / margin by business, geo?" → FY2026 trend extrapolation tables with a per-row **confidence level** (stability of the 3-year trend).
   - *Liquidity* — "What's the status of cash balances, AR, inventory?" → liquidity table, free cash flow, inventory sold-but-not-delivered / excess buckets, receivables by geography, with confidence notes.
2. **Annual-report fetch** — "IBM 2025 annual report" downloads and reads the document.
3. **Web search** — open questions go to the internet.
4. **Context Studio MCP** — vector / graph / hybrid queries against the knowledge base (prefix a message with `@context` to force this path). The ⚡ Skills drawer lists the installed skills (annual-report analyzer, variance analysis, file-to-PPTX, …).

### Context Studio configuration

Set the MCP endpoint before starting the server (see `server/src/contextStudio.ts` / `server/context-studio.json`). Without it, enquiry, report fetch and web search still work; only the Context Studio modes report offline.

### ICA MCP configuration

The embedded chat can connect to an **IBM Consulting Advantage (ICA) MCP server** running locally. This gives access to ICA assistants, agents, digital workers and raw chat models directly from the Finance Studio chat panel.

#### 1. Start the ICA MCP server

```powershell
cd "H:\My Drive\AA\mcp-ica-2.0-server-main"
# Copy the example env file and add your ICA API key
copy .env.example .env.local
# Edit .env.local — set ICA_API_KEY=sk-...
# Then start the HTTP server (defaults to port 3000)
npm install
npm run build
npm run start:http
```

Verify it is running: `GET http://localhost:3000/health` should return `{"status":"ok"}`.

#### 2. Configure Finance Studio

Add these two lines to the Finance Studio root `.env.local`:

```
ICA_MCP_URL=http://localhost:3000
ICA_API_KEY=sk-your-ica-key-here
```

Then (re)start Finance Studio with `npm run dev`.

#### 3. Use ICA in the chat panel

1. Open the **Section 2 – Enquiry** chat panel.
2. Click the **ICA** button in the chat header — it turns green when the server is reachable.
3. Select the **Namespace** (Assistant / Agent / Digital Worker / Raw Model).
4. Paste the **Model / Assistant / Agent ID** from the ICA UI (_Settings → API Keys → find the ID in the relevant list_).
5. Type your message and press **Send** (or Enter).

Replies appear in the shared message thread, tagged with `ICA · <tool> · <model-id> · <ms>` metadata.

#### API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/chat/ica/status` | GET | Checks whether the ICA MCP server is reachable and returns available tools |
| `POST /api/chat/ica` | POST | `{ message, tool, model, files? }` → `{ reply, tool, model, isError, elapsedMs }` |

The `tool` field is one of: `ica_chat_assistants`, `ica_chat_agents`, `ica_chat_digital_workforce`, `ica_chat_models`.

## Legacy API

`POST /api/analyse` (source-connector pipeline: local file, web URL, Google Sheets, ICA MCP) and `POST /api/upload` are retained from the v1 POC and still work — the chat file-upload zone uses `/api/upload`.

## Build

```bash
npm run build
```

## Deploy

**Vercel** (production): `vercel.json` routes all `/api/*` requests to the serverless wrappers in `api-dist/` (pre-bundled by `scripts/bundle-api.mjs`) and serves the Vite-built SPA from `client/dist/`.

```bash
npm run build   # tsc -b + vite build + esbuild bundle
vercel --prod
```

Live URL: **https://ibm-finance-studio.vercel.app**
