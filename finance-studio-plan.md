# Finance CFO Co-Pilot — Plan

## Top-Level Overview

Build **Finance Studio** (formerly CFO Finance Co-Pilot) — a self-contained web application (React + Node.js/TypeScript) that answers the question:

> *"What are the biggest risks to margin this quarter, and what actions should we take?"*

The system has two layers:
1. **Backend (tool server)** — Five orchestrated tool functions (Query, Analysis, Insight, Recommendation, Execution) that pull live data from pluggable data-source connectors and chain AI-powered logic to produce a decision-ready narrative.
2. **Frontend (dashboard UI)** — A React dashboard styled after the reference image, with a data-source selector panel (Local File, Web URL, Google Sheets, ICA MCP), KPI cards, charts, deal/campaign cards, and an Opportunity Radar table.

**No MCP protocol required.** Tool functions are plain TypeScript modules. Data connectors are swappable adapters.

---

## Architecture Overview

```
[ Dashboard UI (React + Vite) ]
        |
        | HTTP (fetch)
        v
[ Express API Server (Node.js/TypeScript) ]
        |
   ┌────┴────────────────────────────────────┐
   |              Tool Orchestrator           |
   |  1. QueryTool → DataSourceConnector     |
   |  2. AnalysisTool → variance / trends    |
   |  3. InsightTool → narrative (LLM stub)  |
   |  4. RecommendationTool → action items   |
   |  5. ExecutionTool → summary + triggers  |
   └────┬────────────────────────────────────┘
        |
   ┌────┴──────────────────────────┐
   |      Data Source Connectors   |
   |  • LocalFileConnector         |
   |  • WebScraperConnector        |
   |  • GoogleSheetsConnector      |
   |  • IcaMcpConnector (stub)     |
   └───────────────────────────────┘
```

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffold

**Intent**: Create the monorepo folder structure with a Vite React frontend and an Express TypeScript backend, including all package manifests and tsconfig files.

**Expected Outcomes**:
- `package.json` at root with workspaces for `client/` and `server/`
- `server/` has Express + TypeScript wired up and runs on port 3001
- `client/` has Vite + React + TypeScript and proxies `/api` to port 3001
- `npm run dev` starts both in parallel

**Todo List**:
1. Create `package.json` (root, workspaces)
2. Create `server/package.json`, `server/tsconfig.json`, `server/src/index.ts` (Express entry point)
3. Create `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/main.tsx`
4. Create root-level `start` and `dev` scripts using `concurrently`

**Relevant Context**: Clean slate — no existing files. Use `express`, `cors`, `tsx` (for TS dev), `vite`, `react`, `react-dom`.

**Status**: [x] done

---

### Sub-Task 2 — Data Source Connectors

**Intent**: Implement four pluggable data-source adapters that all return a normalised `FinanceDataset` shape, making the tool layer data-source-agnostic.

**Expected Outcomes**:
- `server/src/connectors/localFile.ts` — reads CSV, JSON, XLSX from a filesystem path (auto-detect by extension using `csv-parse`, `xlsx`)
- `server/src/connectors/webScraper.ts` — fetches a URL and extracts the first HTML table using `cheerio`
- `server/src/connectors/googleSheets.ts` — fetches a Google Sheets published-as-CSV URL and parses it
- `server/src/connectors/icaMcp.ts` — stub that calls a configurable HTTP endpoint (ICA MCP server base URL from env var `ICA_MCP_URL`); returns mock data if URL is not set
- `server/src/connectors/index.ts` — exports a `getConnector(type, config)` factory

**Normalised shape**:
```ts
interface FinanceDataset {
  source: string;
  fields: string[];
  rows: Record<string, string | number>[];
  fetchedAt: string;
}
```

**Todo List**:
1. Define `FinanceDataset` type in `server/src/types.ts`
2. Implement `LocalFileConnector` with extension-based parser selection
3. Implement `WebScraperConnector` using `cheerio` + `node-fetch`
4. Implement `GoogleSheetsConnector` using published CSV URL fetch + `csv-parse`
5. Implement `IcaMcpConnector` stub with env-var-based URL + mock fallback
6. Implement connector factory `getConnector()`

**Relevant Context**: Dependencies needed: `csv-parse`, `xlsx`, `cheerio`, `node-fetch`.

**Status**: [x] done

---

### Sub-Task 3 — Finance Tool Functions

**Intent**: Implement the five tool functions that form the orchestration chain. Each tool is a pure TypeScript function that takes typed inputs and returns typed outputs.

**Expected Outcomes**:
- `server/src/tools/queryTool.ts` — calls the connector, returns `FinanceDataset`
- `server/src/tools/analysisTool.ts` — computes KPIs: variance (actual vs forecast), margin %, trend direction, top cost drivers; returns `AnalysisResult`
- `server/src/tools/insightTool.ts` — converts `AnalysisResult` into a plain-English narrative string (rule-based for PoC; LLM-ready interface)
- `server/src/tools/recommendationTool.ts` — maps identified risks to a list of specific action recommendations
- `server/src/tools/executionTool.ts` — bundles narrative + recommendations + KPIs into a `DecisionPackage` ready for the UI and for triggering downstream workflows

**Key types**:
```ts
interface AnalysisResult {
  kpis: { closedWon: number; openPipeline: number; toGoRevenue: number; marginPct: number };
  risks: { driver: string; impact: string; severity: 'high'|'medium'|'low' }[];
  trends: { metric: string; direction: 'up'|'down'|'flat'; changePercent: number }[];
}

interface DecisionPackage {
  narrative: string;
  recommendations: { action: string; priority: string; category: string }[];
  kpis: AnalysisResult['kpis'];
  risks: AnalysisResult['risks'];
  topDeals: Record<string, string | number>[];
  campaigns: Record<string, string | number>[];
  dataset: FinanceDataset;
}
```

**Todo List**:
1. Define all types in `server/src/types.ts`
2. Implement `queryTool`
3. Implement `analysisTool` (variance, margin, trend logic on numeric columns)
4. Implement `insightTool` (rule-based narrative builder)
5. Implement `recommendationTool` (risk-to-action mapping table)
6. Implement `executionTool` (assemble `DecisionPackage`)

**Relevant Context**: Analysis logic must work on any column schema — use heuristics (look for columns containing "revenue", "cost", "forecast", "actual", "margin" case-insensitively).

**Status**: [x] done

---

### Sub-Task 4 — API Routes (Orchestration Endpoint)

**Intent**: Wire the tool chain into Express routes so the frontend can trigger the full analysis with a single POST request and also configure the data source.

**Expected Outcomes**:
- `POST /api/analyse` — accepts `{ sourceType, sourceConfig }`, runs all 5 tools in sequence, returns `DecisionPackage`
- `GET /api/health` — returns `{ status: 'ok' }`
- Error handling middleware returns `{ error: string }` with appropriate HTTP status codes
- CORS enabled for `localhost:5173` (Vite dev server)

**Todo List**:
1. Create `server/src/routes/analyse.ts` with the orchestration chain
2. Register route and middleware in `server/src/index.ts`
3. Add input validation for `sourceType` and `sourceConfig`
4. Add error boundary that catches connector and tool errors

**Relevant Context**: `sourceType` is one of `'localFile' | 'webScraper' | 'googleSheets' | 'icaMcp'`. `sourceConfig` is a free object passed through to the connector (e.g. `{ filePath: '...' }` or `{ url: '...' }`).

**Status**: [x] done

---

### Sub-Task 5 — Dashboard UI

**Intent**: Build the React frontend that mirrors the reference image: a data-source selector panel in the header, KPI cards row, Top Deals section, Marketing Campaigns cards, and an Opportunity Radar table — all populated from the `DecisionPackage` returned by the API.

**Expected Outcomes**:
- `client/src/components/SourcePanel.tsx` — header bar with source type radio/tabs and config inputs (file path, URL, sheet URL) plus a Refresh/Analyse button
- `client/src/components/KpiCards.tsx` — three cards: Closed Won, Open Pipeline, To-Go Revenue with trend indicators
- `client/src/components/RiskPanel.tsx` — list of margin risks from `DecisionPackage.risks` with severity badges
- `client/src/components/RecommendationPanel.tsx` — action items from `DecisionPackage.recommendations`
- `client/src/components/DealsTable.tsx` — table rendering `DecisionPackage.topDeals`
- `client/src/components/CampaignCards.tsx` — campaign cards rendering `DecisionPackage.campaigns`
- `client/src/components/NarrativePanel.tsx` — full-width text panel showing `DecisionPackage.narrative`
- `client/src/App.tsx` — layout stitching all components, handles loading/error states
- `client/src/api.ts` — typed fetch wrapper for `POST /api/analyse`

**Todo List**:
1. Create `client/src/api.ts` with `analyseData(sourceType, sourceConfig)` fetch function
2. Build `SourcePanel` with four source type tabs (Local File, Web URL, Google Sheets, ICA MCP) and dynamic config input
3. Build `KpiCards` consuming `kpis` from `DecisionPackage`
4. Build `RiskPanel` consuming `risks`
5. Build `RecommendationPanel` consuming `recommendations`
6. Build `DealsTable` consuming `topDeals`
7. Build `CampaignCards` consuming `campaigns`
8. Build `NarrativePanel` consuming `narrative`
9. Assemble `App.tsx` with header, grid layout, loading spinner, error toast
10. Add minimal CSS (inline styles or a single `App.css`) matching the light dashboard aesthetic from the reference image

**Relevant Context**: No external UI library required — use plain React + CSS. Match the reference image aesthetic: white cards, teal/green accent colours, clean sans-serif font.

**Status**: [x] done

---

### Sub-Task 6 — Sample Data & End-to-End Smoke Test

**Intent**: Provide sample data files so the dashboard works out-of-the-box without needing a live finance system, and verify the full round-trip works.

**Expected Outcomes**:
- `server/data/sample-finance.csv` — a plausible quarterly finance dataset with columns: Quarter, Product, Region, ActualRevenue, ForecastRevenue, ActualCost, ForecastCost, MarginPct, DealName, Stage, CloseDate
- `server/data/sample-campaigns.json` — campaign records with: CampaignName, Market, Theme, PipelineInfluenced, MarketingSpend, WinInfluenceProbability, AttentionScore
- README.md documenting how to run the project, configure each data source, and set `ICA_MCP_URL`

**Todo List**:
1. Create `server/data/sample-finance.csv` with at least 12 rows (3 months × 4 products)
2. Create `server/data/sample-campaigns.json` with at least 3 campaign objects
3. Write `README.md` covering: prerequisites, `npm install`, `npm run dev`, data source configuration guide for all four sources
4. Manually verify (describe the expected flow): source panel → POST /api/analyse → DecisionPackage → all UI panels populated

**Relevant Context**: Sample data should reflect realistic variance patterns (some actuals below forecast) so the analysis tool produces non-trivial risk output.

**Status**: [x] done

---

## Implementation Order

1. Sub-Task 1 (Scaffold) — must be first; all others depend on it
2. Sub-Task 2 (Connectors) — independent of UI
3. Sub-Task 3 (Tools) — depends on connector types
4. Sub-Task 4 (API Routes) — depends on tools
5. Sub-Task 5 (Dashboard UI) — depends on API contract defined in Sub-Task 4
6. Sub-Task 6 (Sample Data + README) — depends on all of the above

## Phase 2 — Two-Section CFO Co-Pilot (July 2026)

Requirements update: restructure the POC into **two sections**, ingesting the
**last 3 years of IBM annual reports** as the internal finance / EPM data source.
UI reference: the *WatsonX Sample Output Dashboard* deck and
https://abc-cfo-dashboard.azurewebsites.net/.

### Sub-Task 7 — Ingest IBM annual reports (FY2023–FY2025)

- `server/data/ibm-annual-reports.json` — revenue by segment & geography, gross
  profit/margin, net income, FCF, cash & securities, AR, inventory, debt; each
  record tagged `reported` / `derived` / `illustrative`
- `server/src/ibmData.ts` — loader, filter/allocation helpers, dashboard builder

**Status**: [x] done

### Sub-Task 8 — Section 1: configurable dashboard

- `GET /api/dashboard` + `GET /api/dashboard/options`
- Configurable **Year / Geography / Country / Business Segment** filter bar
- KPI strip (Revenue, Gross Profit, GM%, Net Income, FCF, Cash & Securities),
  key insight, revenue-by-segment/geo bar charts, 3-year trend, P&L summary
  table, cash & working capital panel, risk & opportunity panel, recommended
  actions — mirroring the deck's seven dashboard sections
- Input data: **internal finance systems / EPM only** (the ingested dataset)
- Client: `DashboardSection.tsx`, `charts.tsx` (SVG, CVD-validated palette)

**Status**: [x] done

### Sub-Task 9 — Section 2: free-text enquiry

- `server/src/enquiry.ts` — three enquiry archetypes answered from internal
  data with **tables + confidence levels**:
  1. root cause / market ranking (+ internet competitor context on request)
  2. revenue / margin projection by business & geo (trend extrapolation)
  3. cash / AR / inventory status (FCF, sold-not-delivered, excess inventory,
     receivables by geo)
- Wired into `POST /api/chat` ahead of report-fetch / web-search /
  Context Studio MCP routing (`@context` prefix still forces MCP)
- Client: `EnquirySection.tsx` — source-scope pills (Internal EPM · ISC ·
  Internet · Context Studio MCP), suggested-question chips, multi-table
  message rendering

**Status**: [x] done

---

## Key Decisions Captured

| Decision | Choice | Rationale |
|---|---|---|
| Framework | React + Vite + Express (Node TS) | Familiar, zero-config, runs locally |
| No MCP protocol | Plain TS module functions | Simpler PoC; MCP-ready interface shape preserved |
| Google Sheets | Published-to-web CSV URL | No OAuth needed; user controls sharing |
| Web source | HTML table scraping via cheerio | Handles real-world pages |
| ICA MCP | HTTP stub with env-var URL | Plug in real server when ready |
| AI/LLM | Rule-based narrative for PoC | No API key required; LLM interface preserved |
