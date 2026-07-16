# Finance Co-Pilot

A local React + Express proof of concept that answers:

> What are the biggest risks to margin this quarter, and what actions should we take?

It supports four source types:
- Local file path
- Web URL with HTML table scraping
- Google Sheets published CSV URL
- ICA MCP HTTP endpoint or mock fallback

## Prerequisites

- Node.js 18+
- npm

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

## Build

```bash
npm run build
```

## Data source configuration

### 1. Local file
Use source type `Local File` and enter a path such as:

```text
server/data/sample-finance.csv
```

Supported file formats are auto-detected from extension:
- `.csv`
- `.json`
- `.xlsx`
- `.xls`

### 2. Web URL
Use source type `Web URL` and paste a page URL that contains an HTML table. The first table on the page is parsed.

### 3. Google Sheets
Publish the sheet as CSV and paste the generated published URL into `Google Sheets`.

### 4. ICA MCP
If no endpoint is provided, the app uses built-in mock finance data.

To connect a real endpoint, set an environment variable before starting the server:

```powershell
$env:ICA_MCP_URL="http://localhost:8080/finance"
npm run dev
```

The server sends:

```json
{ "action": "financeSnapshot" }
```

and expects a response compatible with the dataset shape:

```json
{
  "source": "ica",
  "fields": ["Quarter", "ActualRevenue", "ForecastRevenue", "ActualCost", "ForecastCost", "MarginPct"],
  "rows": [
    {
      "Quarter": "Q1",
      "ActualRevenue": 950000,
      "ForecastRevenue": 1000000,
      "ActualCost": 620000,
      "ForecastCost": 580000,
      "MarginPct": 34.7
    }
  ],
  "fetchedAt": "2025-01-01T00:00:00.000Z"
}
```

## Sample data

- [`server/data/sample-finance.csv`](server/data/sample-finance.csv)
- [`server/data/sample-campaigns.json`](server/data/sample-campaigns.json)

## End-to-end flow

1. Open the dashboard
2. Choose a source type
3. Enter the source value
4. Click `Refresh`
5. The client calls `POST /api/analyse`
6. The server runs query, analysis, insight, recommendation, and execution tools
7. The UI renders KPI cards, risk list, recommendations, opportunity table, and campaign highlights
