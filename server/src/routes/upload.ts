import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { normaliseValue, FinanceDataset, FinanceRow } from '../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export const uploadRouter = Router();

// Store files in memory (max 20 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function normaliseRows(rows: Record<string, unknown>[]): FinanceRow[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normaliseValue(v)]))
  );
}

// ── PDF text helpers (same as PdfConnector) ───────────────────────────────────

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

function textToDataset(text: string, source: string): FinanceDataset {
  const rows = parseTextTable(text) ?? chunkTextToRows(text);
  return { source, fields: rows[0] ? Object.keys(rows[0]) : ['text'], rows, fetchedAt: new Date().toISOString() };
}

// ── Route ─────────────────────────────────────────────────────────────────────

uploadRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { buffer, originalname, mimetype } = req.file;
    const ext = path.extname(originalname).toLowerCase();
    const source = originalname;

    let dataset: FinanceDataset;

    // ── JSON ──────────────────────────────────────────────────────────────
    if (ext === '.json') {
      const parsed = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>[];
      const rows = normaliseRows(Array.isArray(parsed) ? parsed : [parsed]);
      dataset = { source, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
    }

    // ── CSV ───────────────────────────────────────────────────────────────
    else if (ext === '.csv') {
      const parsed = parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
      const rows = normaliseRows(parsed);
      dataset = { source, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
    }

    // ── XLSX / XLS / XLSM (macro) ─────────────────────────────────────────
    else if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.SheetNames[0];
      const ws = workbook.Sheets[firstSheet];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const rows = normaliseRows(parsed);
      dataset = { source, fields: rows[0] ? Object.keys(rows[0]) : [], rows, fetchedAt: new Date().toISOString() };
    }

    // ── PDF ───────────────────────────────────────────────────────────────
    else if (ext === '.pdf' || mimetype === 'application/pdf') {
      const parsed = await pdfParse(buffer);
      if (!parsed.text?.trim()) throw new Error('PDF appears to be image-only (no extractable text).');
      dataset = textToDataset(parsed.text, source);
    }

    // ── Plain text / Markdown ─────────────────────────────────────────────
    else if (['.txt', '.md'].includes(ext) || mimetype.startsWith('text/')) {
      const text = buffer.toString('utf-8');
      dataset = textToDataset(text, source);
    }

    // ── Images (PNG, JPG, GIF, WebP) — metadata in rows, blob only at top level ────
    else if (mimetype.startsWith('image/')) {
      const b64 = buffer.toString('base64');
      const dataUri = `data:${mimetype};base64,${b64}`;
      dataset = {
        source,
        fields: ['filename', 'mimeType', 'sizeBytes'],
        rows: [{ filename: originalname, mimeType: mimetype, sizeBytes: buffer.length }],
        fetchedAt: new Date().toISOString(),
        // consumed by the preview panel only — not included in normalised rows
        imageDataUri: dataUri
      } as unknown as FinanceDataset & { imageDataUri: string };
    }

    else {
      res.status(415).json({ error: `Unsupported file type: ${ext || mimetype}` });
      return;
    }

    res.json(dataset);
  } catch (err) {
    next(err);
  }
});
