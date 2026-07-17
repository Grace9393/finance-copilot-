import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';
import { Connector, FinanceDataset, FinanceRow, normaliseValue } from '../types.js';

import { pdfToText } from '../pdfText.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Try to parse a Markdown-style or ASCII table from extracted PDF text.
 * Returns rows if at least one pipe-delimited line with 2+ cells is found.
 */
function parseTextTable(text: string): FinanceRow[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.includes('|') && l.split('|').length >= 3);
  if (tableLines.length < 2) return null;

  // Strip separator lines (---|--- style)
  const dataLines = tableLines.filter((l) => !/^[\s|:-]+$/.test(l));
  if (dataLines.length < 2) return null;

  const parseCells = (line: string) =>
    line.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));

  const headers = parseCells(dataLines[0]);
  if (headers.length < 2) return null;

  const rows: FinanceRow[] = [];
  for (const line of dataLines.slice(1)) {
    const cells = parseCells(line);
    if (cells.length === 0) continue;
    const entry: FinanceRow = {};
    headers.forEach((header, i) => {
      entry[header || `col_${i + 1}`] = normaliseValue(cells[i] ?? '');
    });
    rows.push(entry);
  }
  return rows.length > 0 ? rows : null;
}

/**
 * Try to parse whitespace-aligned columns (fixed-width tables common in PDFs).
 * Works when at least 3 consecutive lines share ≥2 multi-space-separated tokens
 * at roughly the same positions.
 */
function parseAlignedColumns(text: string): FinanceRow[] | null {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());

  // Find a block of ≥3 lines where every line has ≥3 whitespace-separated tokens
  let headerIdx = -1;
  for (let i = 0; i < lines.length - 3; i++) {
    const block = lines.slice(i, i + 4);
    if (block.every((l) => l.trim().split(/\s{2,}/).length >= 3)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const headers = lines[headerIdx].trim().split(/\s{2,}/);
  const rows: FinanceRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = line.trim().split(/\s{2,}/);
    if (cells.length < 2) break; // likely end of table block
    const entry: FinanceRow = {};
    headers.forEach((h, i) => {
      entry[h || `col_${i + 1}`] = normaliseValue(cells[i] ?? '');
    });
    rows.push(entry);
    if (rows.length >= 200) break;
  }
  return rows.length > 1 ? rows : null;
}

/**
 * Fallback: split the full PDF text into sentence/paragraph chunks and return
 * them as a single-column dataset so the chat can reason over the full content.
 */
function chunkTextToRows(text: string): FinanceRow[] {
  // Split on double-newline paragraphs first, then sentences if too few chunks
  let chunks = text.split(/\n{2,}/).map((c) => c.replace(/\n/g, ' ').trim()).filter((c) => c.length > 20);
  if (chunks.length < 3) {
    chunks = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter((s) => s.length > 20) ?? [text.trim()];
  }
  return chunks.slice(0, 300).map((chunk, i) => ({ index: i + 1, text: chunk }));
}

// ── Connector ─────────────────────────────────────────────────────────────────

export class PdfConnector implements Connector {
  async fetchData(config: Record<string, unknown>): Promise<FinanceDataset> {
    const { filePath, url } = config as { filePath?: string; url?: string };

    let buffer: Buffer;
    let source: string;

    if (url) {
      // Remote PDF via URL
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status} ${resp.statusText}`);
      buffer = Buffer.from(await resp.arrayBuffer());
      source = url;
    } else if (filePath) {
      // Local file path — also accept .pdf extension coming from localFile route
      const resolved = path.resolve(filePath);
      if (!existsSync(resolved)) throw new Error(`PDF file not found: ${resolved}`);
      buffer = await readFile(resolved);
      source = filePath;
    } else {
      throw new Error('filePath or url is required for pdf source');
    }

    const parsed = await pdfToText(buffer);
    const text = parsed.text ?? '';

    if (!text.trim()) {
      throw new Error('PDF appears to be image-only (no extractable text). Try an OCR-enabled PDF.');
    }

    // 1. Try pipe-delimited / markdown table
    let rows = parseTextTable(text);

    // 2. Try aligned-column table (fixed-width)
    if (!rows) rows = parseAlignedColumns(text);

    // 3. Fallback: sentence/paragraph chunks
    if (!rows) rows = chunkTextToRows(text);

    const fields = rows[0] ? Object.keys(rows[0]) : ['text'];

    return {
      source,
      fields,
      rows,
      fetchedAt: new Date().toISOString()
    };
  }
}
