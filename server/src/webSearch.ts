/**
 * webSearch.ts
 *
 * Detects general web-search intent (market data, industry trends, news, etc.)
 * and fetches the top result's page text using DuckDuckGo HTML search +
 * node-fetch for page retrieval.
 */

import fetch from 'node-fetch';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebSearchResult {
  query: string;
  /** Best source URL — either a top result page or the search results page itself */
  url: string;
  title: string;
  /** Cleaned page text, up to ~4 000 chars for display */
  excerpt: string;
  /** Full text up to ~40 000 chars for grounding follow-up queries */
  fullText: string;
  /** All result snippets from the search page (for fallback display) */
  snippets: { title: string; url: string; snippet: string }[];
  fetched: boolean;
}

// ── Intent detection ──────────────────────────────────────────────────────────

/**
 * Keywords and patterns that signal a general web search rather than
 * an annual-report request or a Context Studio data query.
 */
const SEARCH_TRIGGERS = [
  // Direct search verbs
  /\b(search|find|look up|google|look for|fetch|get)\b.{0,60}(market|industry|sector|trend|news|data|info|information|report|outlook|forecast|overview|analysis|growth|size|share)\b/i,
  // Market / industry topic starters
  /\b(overall\s+market|market\s+(size|share|trend|growth|outlook|overview|analysis|data|report|forecast))\b/i,
  /\b(industry\s+(trend|overview|analysis|outlook|data|report|forecast|size|growth))\b/i,
  /\b(sector\s+(performance|trend|overview|analysis|outlook))\b/i,
  // News / current-events patterns
  /\b(latest|recent|current|today'?s?)\s+(news|update|trend|data|market|industry)\b/i,
  // "What is / How does / Tell me about" open questions about external topics
  /^(what\s+is|what\s+are|how\s+does|how\s+do|tell\s+me\s+(about|more)|explain|describe|summarize|overview\s+of)\b.{5,}/i,
  // Explicit search prefix
  /^(search|find|look\s+up|fetch)\b.{3,}/i,
];

export function detectWebSearchIntent(message: string): boolean {
  return SEARCH_TRIGGERS.some((re) => re.test(message));
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities, collapse whitespace. */
function stripHtml(html: string, maxChars = 40000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** Fetch a URL and return stripped text. Returns empty string on error. */
async function fetchPage(url: string, maxChars = 40000): Promise<{ text: string; finalUrl: string }> {
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
    return { text: stripHtml(html, maxChars), finalUrl };
  } catch {
    return { text: '', finalUrl: url };
  }
}

// ── DuckDuckGo search result parser ──────────────────────────────────────────

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse DuckDuckGo HTML search results page and extract title/url/snippet
 * for up to `limit` organic results.
 */
function parseDdgResults(html: string, limit = 5): SearchHit[] {
  const hits: SearchHit[] = [];

  // Each result is wrapped in <div class="result ...">
  const resultBlocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|$)/gi) ?? [];

  for (const block of resultBlocks.slice(0, limit * 2)) {
    // Extract URL from <a class="result__a" href="...">
    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/i)
      ?? block.match(/href="(https?:\/\/[^"]+)"/i);
    // Extract title text
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);

    if (!urlMatch) continue;

    const url = urlMatch[1].startsWith('//') ? `https:${urlMatch[1]}` : urlMatch[1];
    // Skip DuckDuckGo internal redirect URLs; keep real http links only
    if (!url.startsWith('http')) continue;

    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, '').trim()
      : url;
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
      : '';

    hits.push({ title, url, snippet });
    if (hits.length >= limit) break;
  }

  return hits;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Search the web for `query` and return the text of the best result.
 *
 * Strategy:
 * 1. DuckDuckGo HTML search — get top result URLs + snippets
 * 2. Fetch the top result page and extract its text
 * 3. Fallback to search-results snippets if page fetch fails
 */
export async function webSearch(query: string): Promise<WebSearchResult> {
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let searchHtml = '';
  try {
    const fetched = await fetchPage(searchUrl, 80000);
    searchHtml = fetched.text;
  } catch {
    // network error — return a graceful no-results response
    return {
      query,
      url: searchUrl,
      title: `Web search: ${query}`,
      excerpt: `_(Search unavailable — network error)_`,
      fullText: '',
      snippets: [],
      fetched: false
    };
  }

  // Parse structured hits from search results page
  const hits = parseDdgResults(searchHtml);

  // Also extract raw snippet text from the stripped HTML as fallback
  const rawSnippets = searchHtml.slice(0, 6000);

  if (hits.length === 0) {
    return {
      query,
      url: searchUrl,
      title: `Web search: ${query}`,
      excerpt: rawSnippets || '_(No results found)_',
      fullText: rawSnippets,
      snippets: [],
      fetched: rawSnippets.length > 0
    };
  }

  // Fetch the top result page for full content
  const topHit = hits[0];
  const { text: pageText, finalUrl } = await fetchPage(topHit.url);

  const hasPageContent = pageText.length > 200;

  // Build a snippets summary for display (all results)
  const snippetsSummary = hits
    .map((h, i) => `**${i + 1}. ${h.title}**\n${h.snippet}\n${h.url}`)
    .join('\n\n');

  const fullText = hasPageContent
    ? pageText
    : snippetsSummary;

  const excerpt = hasPageContent
    ? pageText.slice(0, 4000)
    : snippetsSummary.slice(0, 4000);

  return {
    query,
    url: hasPageContent ? finalUrl : searchUrl,
    title: hasPageContent ? topHit.title : `Search results: ${query}`,
    excerpt,
    fullText,
    snippets: hits,
    fetched: true
  };
}
