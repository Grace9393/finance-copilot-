import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normaliseValue } from '../server/src/types.js';
import type { FinanceDataset, FinanceRow } from '../server/src/types.js';

export const config = { api: { bodyParser: false } };

const require = createRequire(import.meta.url);

function normaliseRows(rows: Record<string, unknown>[]): FinanceRow[] {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normaliseValue(v)])));
}

function parseTextTable(text: string): FinanceRow[] | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const tableLines = lines.filter(l => l.includes('|') && l.split('|').length >= 3);
  if (tableLines.length < 2) return null;
  const dataLines = tableLines.filter(l => !/^[\s|:-]+$/.test(l));
  if (dataLines.length < 2) return null;
  const parseCells = (line: string) => line.split('|').map(c => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));
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
  let chunks = text.split(/\n{2,}/).map(c => c.replace(/\n/g, ' ').trim()).filter(c => c.length > 20);
  if (chunks.length < 3) chunks = text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()).filter(s => s.length > 20) ?? [text.trim()];
  return chunks.slice(0, 300).map((chunk, i) => ({ index: i + 1, text: chunk }));
}

function textToDataset(text: string, source: string): FinanceDataset {
  const rows = parseTextTable(text) ?? chunkTextToRows(text);
  return { source, fields: rows[0] ? Object.keys(rows[0]) : ['text'], rows, fetchedAt: new Date().toISOString() };
}

async function readBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer: Buffer, boundary: string): { fieldname: string; filename: string; mimetype: string; data: Buffer } | null {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    const partStart = idx + boundaryBuf.length + 2; // skip \r\n
    const nextIdx = buffer.indexOf(boundaryBuf, partStart);
    if (nextIdx === -1) break;
    const partEnd = nextIdx - 2; // trim \r\n before next boundary
    parts.push(buffer.slice(partStart, partEnd));
    start = nextIdx;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    const data = part.slice(headerEnd + 4);
    const cdMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]*)"(?:[^\r\n]*filename="([^"]*)")?/i);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    if (cdMatch?.[1] === 'file') {
      return { fieldname: cdMatch[1], filename: cdMatch[2] ?? 'upload', mimetype: ctMatch?.[1]?.trim() ?? 'application/octet-stream', data };
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const contentType = req.headers['content-type'] ?? '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) { res.status(400).json({ error: 'Expected multipart/form-data' }); return; }

    const rawBody = await readBody(req);
    const file = parseMultipart(rawBody, boundaryMatch[1]);
    if (!file) { res.status(400).json({ error: 'No file found in upload' }); return; }

    const { filename: originalname, mimetype, data: buffer } = file;
    const ext = path.extname(originalname).toLowerCase();
    let dataset: FinanceDataset;

    if (ext === '.json') {
      const parsed = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>[];
      const rows = normaliseRows(Array.isArray(parsed) ? parsed : [parsed]);
      dataset = { source: originalname, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
    } else if (ext === '.csv') {
      const rows = normaliseRows(parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]);
      dataset = { source: originalname, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
    } else if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = normaliseRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }));
      dataset = { source: originalname, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
    } else if (ext === '.pdf' || mimetype === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
      const parsed = await pdfParse(buffer);
      if (!parsed.text?.trim()) throw new Error('PDF appears to be image-only (no extractable text).');
      dataset = textToDataset(parsed.text, originalname);
    } else if (['.txt', '.md'].includes(ext) || mimetype.startsWith('text/')) {
      dataset = textToDataset(buffer.toString('utf-8'), originalname);
    } else if (mimetype.startsWith('image/')) {
      const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
      dataset = { source: originalname, fields: ['filename', 'mimeType', 'sizeBytes'], rows: [{ filename: originalname, mimeType: mimetype, sizeBytes: buffer.length }], fetchedAt: new Date().toISOString(), imageDataUri: dataUri } as unknown as FinanceDataset;
    } else {
      res.status(415).json({ error: `Unsupported file type: ${ext || mimetype}` }); return;
    }

    res.json(dataset);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
}
