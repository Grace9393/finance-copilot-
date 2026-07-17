/**
 * ingest.ts — unified data-source ingestion.
 *
 * One parser for every supported input, used by the upload route, the
 * /api/source route (local path / web URL / Google Sheet) and their Vercel
 * wrappers, so all entry points accept the same formats:
 *
 *   Tabular:  .xlsx .xls .xlsm .csv .json  (+ HTML pages with a <table>)
 *   Document: .pdf .docx .pptx .txt .md .html  → text chunks for grounding
 *   Image:    .png .jpg .jpeg .gif .webp      → metadata + data URI preview
 *   .doc (legacy Word binary) is rejected with a clear message.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import * as XLSX from 'xlsx';
import { FinanceDataset, FinanceRow, normaliseValue } from './types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export type IngestedDataset = FinanceDataset & { imageDataUri?: string };

// ── Shared helpers ────────────────────────────────────────────────────────────

function normaliseRows(rows: Record<string, unknown>[]): FinanceRow[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normaliseValue(v)]))
  );
}

function tabularDataset(rows: FinanceRow[], source: string): FinanceDataset {
  return { source, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
}

/** Detect a markdown/ASCII pipe table inside plain text. */
function parseTextTable(text: string): FinanceRow[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.includes('|') && l.split('|').length >= 3);
  if (tableLines.length < 2) return null;
  const dataLines = tableLines.filter((l) => !/^[\s|:-]+$/.test(l));
  if (dataLines.length < 2) return null;
  const parseCells = (line: string) =>
    line.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));
  const headers = parseCells(dataLines[0]);
  if (headers.length < 2) return null;
  const rows: FinanceRow[] = [];
  for (const line of dataLines.slice(1)) {
    const cells = parseCells(line);
    if (!cells.length) continue;
    const entry: FinanceRow = {};
    headers.forEach((h, i) => { entry[h || `col_${i + 1}`] = normaliseValue(cells[i] ?? ''); });
    rows.push(entry);
  }
  return rows.length > 0 ? rows : null;
}

function chunkTextToRows(text: string): FinanceRow[] {
  let chunks = text.split(/\n{2,}/).map((c) => c.replace(/\n/g, ' ').trim()).filter((c) => c.length > 20);
  if (chunks.length < 3) {
    chunks = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter((s) => s.length > 20) ?? [text.trim()];
  }
  return chunks.slice(0, 300).map((chunk, i) => ({ index: i + 1, text: chunk }));
}

export function textToDataset(text: string, source: string): FinanceDataset {
  const rows = parseTextTable(text) ?? chunkTextToRows(text);
  return tabularDataset(rows, source);
}

// ── Office formats (docx / pptx are OPC zip packages) ─────────────────────────
// Zip entries are read with a small built-in reader (central directory +
// node:zlib inflate) — deliberately no zip dependency, so the Vercel function
// bundle needs nothing beyond long-traced packages.

interface ZipEntry { name: string; data: Buffer }

function readZipEntries(buffer: Buffer, wanted: (name: string) => boolean): ZipEntry[] {
  // Locate the end-of-central-directory record (scan back past any comment)
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a valid Office file (zip directory missing)');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && offset + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compMethod = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLen).toString('utf-8');
    if (wanted(name)) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buffer.slice(dataStart, dataStart + compSize);
      entries.push({ name, data: compMethod === 0 ? raw : inflateRawSync(raw) });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function extractDocxText(buffer: Buffer): string {
  const [doc] = readZipEntries(buffer, (n) => n === 'word/document.xml');
  if (!doc) throw new Error('Not a valid .docx file (word/document.xml missing)');
  const xml = doc.data.toString('utf-8');
  // Paragraph ends become newlines; then strip all remaining tags
  const text = xml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => p.replace(/<[^>]+>/g, '') + '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text);
}

function extractPptxText(buffer: Buffer): string {
  const slides = readZipEntries(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.name.match(/(\d+)/)?.[1] ?? 0) - Number(b.name.match(/(\d+)/)?.[1] ?? 0));
  if (slides.length === 0) throw new Error('Not a valid .pptx file (no slides found)');
  const parts: string[] = [];
  for (const slide of slides) {
    const xml = slide.data.toString('utf-8');
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const slideNo = slide.name.match(/(\d+)/)?.[1];
    if (runs.length) parts.push(`[Slide ${slideNo}] ${runs.join(' · ')}`);
  }
  return parts.join('\n\n');
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function htmlToDataset(html: string, source: string): FinanceDataset {
  const $ = cheerio.load(html);
  const table = $('table').first();
  if (table.length > 0) {
    const headers = table.find('tr').first().find('th, td').map((_, el) => $(el).text().trim()).get();
    const rows: FinanceRow[] = [];
    table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td').map((__, cell) => $(cell).text().trim()).get();
      if (cells.length === 0) return;
      rows.push(Object.fromEntries(headers.map((h, i) => [h || `column_${i + 1}`, normaliseValue(cells[i] ?? '')])));
    });
    if (rows.length > 0) return tabularDataset(rows, source);
  }
  $('script, style, nav, header, footer').remove();
  const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
  if (!text) throw new Error('No table or readable text found in the HTML page');
  return textToDataset(text, source);
}

// ── Buffer parser (uploads + local paths) ─────────────────────────────────────

export async function parseFileBuffer(buffer: Buffer, filename: string, mimetype = ''): Promise<IngestedDataset> {
  const ext = path.extname(filename).toLowerCase();
  const source = filename;

  if (ext === '.json') {
    const parsed = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>[] | Record<string, unknown>;
    return tabularDataset(normaliseRows(Array.isArray(parsed) ? parsed : [parsed]), source);
  }

  if (ext === '.csv') {
    const parsed = parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
    return tabularDataset(normaliseRows(parsed), source);
  }

  if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    return tabularDataset(normaliseRows(parsed), source);
  }

  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const parsed = await pdfParse(buffer);
    if (!parsed.text?.trim()) throw new Error('PDF appears to be image-only (no extractable text).');
    return textToDataset(parsed.text, source);
  }

  if (ext === '.docx') {
    const text = extractDocxText(buffer);
    if (!text.trim()) throw new Error('No text could be extracted from the .docx file');
    return textToDataset(text, source);
  }

  if (ext === '.doc') {
    throw new Error('Legacy .doc (Word 97-2003) is not supported — please save the file as .docx and retry.');
  }

  if (ext === '.pptx') {
    const text = extractPptxText(buffer);
    if (!text.trim()) throw new Error('No text could be extracted from the .pptx file');
    return textToDataset(text, source);
  }

  if (['.html', '.htm'].includes(ext) || mimetype.includes('text/html')) {
    return htmlToDataset(buffer.toString('utf-8'), source);
  }

  if (['.txt', '.md'].includes(ext) || mimetype.startsWith('text/')) {
    return textToDataset(buffer.toString('utf-8'), source);
  }

  if (mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    const imageMime = mimetype || `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`;
    return {
      source,
      fields: ['filename', 'mimeType', 'sizeBytes'],
      rows: [{ filename, mimeType: imageMime, sizeBytes: buffer.length }],
      fetchedAt: new Date().toISOString(),
      imageDataUri: `data:${imageMime};base64,${buffer.toString('base64')}`
    };
  }

  throw new Error(`Unsupported file type: ${ext || mimetype || 'unknown'}`);
}

// ── Source connectors (local path / web URL / Google Sheet) ───────────────────

export async function ingestLocalPath(filePath: string): Promise<IngestedDataset> {
  // Absolute paths are used as-is; relative paths are tried against the
  // working directory (server/) and the repo root.
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : [path.resolve(process.cwd(), filePath), path.resolve(process.cwd(), '..', filePath)];

  let buffer: Buffer | null = null;
  for (const candidate of candidates) {
    try {
      buffer = await readFile(candidate);
      break;
    } catch { /* try next candidate */ }
  }
  if (!buffer) {
    throw new Error(`Cannot read local path "${filePath}" (file not found). Local paths only work when the server runs on the same machine as the file — start the app locally with "npm run dev".`);
  }
  return parseFileBuffer(buffer, path.basename(filePath));
}

export async function ingestWebUrl(url: string): Promise<IngestedDataset> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Web URL must start with http:// or https://');
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (finance-copilot POC)' } });
  if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await response.arrayBuffer());

  if (contentType.includes('pdf') || /\.pdf(\?|$)/i.test(url)) {
    const parsed = await pdfParse(buffer);
    return textToDataset(parsed.text, url);
  }
  if (contentType.includes('csv') || /\.csv(\?|$)/i.test(url)) {
    const parsed = parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
    return tabularDataset(normaliseRows(parsed), url);
  }
  if (contentType.includes('html') || contentType === '') {
    return htmlToDataset(buffer.toString('utf-8'), url);
  }
  if (contentType.includes('json')) {
    const parsed = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>[] | Record<string, unknown>;
    return tabularDataset(normaliseRows(Array.isArray(parsed) ? parsed : [parsed]), url);
  }
  // Fall back to plain text
  return textToDataset(buffer.toString('utf-8'), url);
}

/**
 * Accepts either a "published to web" CSV link or a normal Google Sheets share
 * URL (https://docs.google.com/spreadsheets/d/<id>/edit…) — share URLs are
 * rewritten to the CSV export endpoint (the sheet must be link-visible).
 */
export async function ingestGoogleSheet(url: string): Promise<IngestedDataset> {
  let csvUrl = url;
  const shareMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/i);
  if (shareMatch && !/output=csv|format=csv/i.test(url)) {
    const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? '0';
    csvUrl = `https://docs.google.com/spreadsheets/d/${shareMatch[1]}/export?format=csv&gid=${gid}`;
  }
  const response = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (finance-copilot POC)' } });
  if (!response.ok) {
    throw new Error(`Failed to fetch Google Sheet (${response.status}). Make sure the sheet is shared as "Anyone with the link" or published to the web as CSV.`);
  }
  const csv = await response.text();
  if (csv.trimStart().startsWith('<')) {
    throw new Error('Google returned a sign-in page — share the sheet as "Anyone with the link" or publish it to the web as CSV.');
  }
  const parsed = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
  return tabularDataset(normaliseRows(parsed), url);
}

export type SourceType = 'localPath' | 'webUrl' | 'googleSheet';

export async function ingestSource(type: SourceType, value: string): Promise<IngestedDataset> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('A path or URL is required');
  switch (type) {
    case 'localPath': return ingestLocalPath(trimmed);
    case 'webUrl': return ingestWebUrl(trimmed);
    case 'googleSheet': return ingestGoogleSheet(trimmed);
    default: throw new Error(`Unknown source type: ${type as string}`);
  }
}
