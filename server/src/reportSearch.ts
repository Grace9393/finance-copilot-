/**
 * reportSearch.ts
 *
 * Detects "annual report" intent from a chat message, finds the PDF URL,
 * and reads the actual document text using pdf-parse (same as PdfConnector).
 *
 * Pattern matched: "<Company> <YYYY> [annual] report / 10-K / results"
 */

import { createRequire } from 'node:module';
import fetch from 'node-fetch';

// pdf-parse is CommonJS-only; load from ESM context
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

export interface ReportSearchResult {
  company: string;
  year: string;
  url: string;
  title: string;
  /** First ~4 000 chars of extracted document text */
  excerpt: string;
  /** Total pages in the PDF */
  pages: number;
  /** Full extracted text (up to 60 000 chars) available for follow-up queries */
  fullText: string;
  fetched: boolean;
}

/** Known direct report URLs for common companies — checked first. */
const KNOWN_REPORT_URLS: Record<string, Record<string, string>> = {
  ibm: {
    '2025': 'https://www.ibm.com/downloads/documents/us-en/15db52348fc203a4',
    '2024': 'https://www.ibm.com/annualreport/assets/downloads/IBM_Annual_Report_2024.pdf',
    '2023': 'https://www.ibm.com/annualreport/assets/downloads/IBM_Annual_Report_2023.pdf',
  },
  apple: {
    '2024': 'https://www.annualreports.com/HostedData/AnnualReports/PDF/NASDAQ_AAPL_2024.pdf',
  },
  microsoft: {
    '2024': 'https://microsoft.gcs-web.com/static-files/annual-reports/2024-annual-report.pdf',
  },
};

/**
 * Detects report-search intent in a message.
 * Returns { company, year } if found, otherwise null.
 * Year defaults to the current year when not specified.
 */
export function detectReportIntent(message: string): { company: string; year: string } | null {
  const currentYear = String(new Date().getFullYear());

  // "<Company> <YYYY> annual report" / "IBM 2025 report" / "Apple FY2024 10-K"
  const withYear =
    /\b([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)\s+(?:FY\s*)?(\d{4})\s+(?:annual\s+)?(?:report|10-K|10K|results|filing|earnings)\b/i;
  // "2025 IBM report" / "2024 annual report for Apple"
  const yearFirst =
    /\b(?:FY\s*)?(\d{4})\s+(?:annual\s+)?(?:report|10-K|results|filing)\s+(?:for\s+)?([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)\b/i;
  // "annual report for IBM" / "summarize annual report for Apple" / "latest annual report IBM"
  const noYear =
    /\b(?:annual\s+report|10-K|latest\s+report)\s+(?:for\s+|of\s+)?([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)(?:\s*$|[.,!?])/i;
  // "IBM annual report" / "Apple latest report" — company first, no year
  const companyFirst =
    /\b([A-Za-z][A-Za-z0-9\s&.,\-]{1,30}?)\s+(?:annual\s+report|latest\s+report|10-K)\b/i;

  let m = message.match(withYear);
  if (m) return { company: m[1].trim(), year: m[2].trim() };

  m = message.match(yearFirst);
  if (m) return { company: m[2].trim(), year: m[1].trim() };

  m = message.match(noYear);
  if (m) return { company: m[1].trim(), year: currentYear };

  m = message.match(companyFirst);
  if (m) return { company: m[1].trim(), year: currentYear };

  return null;
}

/**
 * Fetch a PDF from a URL and extract its text with pdf-parse.
 * Returns null if the URL is not a PDF or extraction fails.
 */
async function fetchAndParsePdf(url: string): Promise<{ text: string; pages: number; finalUrl: string } | null> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FinanceCopilot/1.0)',
      Accept: 'application/pdf,*/*'
    },
    redirect: 'follow',
    // @ts-expect-error node-fetch supports timeout
    timeout: 30000
  });

  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? '';
  const finalUrl = res.url ?? url;

  if (!contentType.includes('pdf') && !finalUrl.toLowerCase().includes('.pdf')) {
    return null;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const parsed = await pdfParse(buffer);
  const text = (parsed.text ?? '').trim();

  if (!text) return null;

  return { text, pages: parsed.numpages, finalUrl };
}

/**
 * Fetch an HTML page and return stripped text — used for search results pages.
 */
async function fetchHtmlText(url: string, maxChars = 20000): Promise<{ text: string; finalUrl: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FinanceCopilot/1.0)',
        Accept: 'text/html,*/*'
      },
      redirect: 'follow',
      // @ts-expect-error node-fetch supports timeout
      timeout: 15000
    });
    const finalUrl = res.url ?? url;
    if (!res.ok) return { text: '', finalUrl };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, maxChars);
    return { text, finalUrl };
  } catch {
    return { text: '', finalUrl: url };
  }
}

/** Extract the first PDF-like URL from raw HTML/text. */
function extractPdfUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+\.pdf(?:[?#][^\s"'<>]*)?/i);
  return match ? match[0] : null;
}

/**
 * Main entry point: find and read the annual report PDF for a company + year.
 */
export async function searchAnnualReport(company: string, year: string): Promise<ReportSearchResult> {
  const companyKey = company.toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Try known direct URL first — parse the actual PDF
  const knownUrl = KNOWN_REPORT_URLS[companyKey]?.[year];
  if (knownUrl) {
    try {
      const parsed = await fetchAndParsePdf(knownUrl);
      if (parsed) {
        return {
          company, year,
          url: parsed.finalUrl,
          title: `${company} ${year} Annual Report`,
          excerpt: parsed.text.slice(0, 4000),
          pages: parsed.pages,
          fullText: parsed.text.slice(0, 60000),
          fetched: true
        };
      }
    } catch { /* fall through to search */ }
  }

  // 2. DuckDuckGo HTML search — find a PDF link then parse it
  const searchQuery = encodeURIComponent(`${company} ${year} annual report filetype:pdf`);
  const searchUrl = `https://duckduckgo.com/html/?q=${searchQuery}`;
  const { text: searchText } = await fetchHtmlText(searchUrl);

  const pdfUrl = extractPdfUrl(searchText);
  if (pdfUrl) {
    try {
      const parsed = await fetchAndParsePdf(pdfUrl);
      if (parsed) {
        return {
          company, year,
          url: parsed.finalUrl,
          title: `${company} ${year} Annual Report`,
          excerpt: parsed.text.slice(0, 4000),
          pages: parsed.pages,
          fullText: parsed.text.slice(0, 60000),
          fetched: true
        };
      }
    } catch { /* fall through */ }
  }

  // 3. Fallback — return search results summary (no PDF found)
  const excerpt = searchText.slice(0, 2000);
  return {
    company, year,
    url: searchUrl,
    title: `Search results: ${company} ${year} annual report`,
    excerpt: excerpt || '_(No results found)_',
    pages: 0,
    fullText: excerpt,
    fetched: excerpt.length > 0
  };
}
