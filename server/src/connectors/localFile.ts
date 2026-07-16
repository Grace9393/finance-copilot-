import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { Connector, FinanceDataset, FinanceRow, LocalFileConfig, normaliseValue } from '../types.js';

function normaliseRows(rows: Record<string, unknown>[]): FinanceRow[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normaliseValue(value)]))
  );
}

export class LocalFileConnector implements Connector {
  async fetchData(config: Record<string, unknown>): Promise<FinanceDataset> {
    const { filePath } = config as unknown as LocalFileConfig;

    if (!filePath) {
      throw new Error('filePath is required for localFile source');
    }

    const extension = path.extname(filePath).toLowerCase();

    if (extension === '.json') {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>[];
      const rows = normaliseRows(parsed);
      return {
        source: filePath,
        fields: rows[0] ? Object.keys(rows[0]) : [],
        rows,
        fetchedAt: new Date().toISOString()
      };
    }

    if (extension === '.csv') {
      const content = await readFile(filePath, 'utf-8');
      const parsed = parse(content, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
      const rows = normaliseRows(parsed);
      return {
        source: filePath,
        fields: rows[0] ? Object.keys(rows[0]) : [],
        rows,
        fetchedAt: new Date().toISOString()
      };
    }

    if (extension === '.xlsx' || extension === '.xls') {
      const workbook = XLSX.readFile(filePath);
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
      const rows = normaliseRows(parsed);
      return {
        source: filePath,
        fields: rows[0] ? Object.keys(rows[0]) : [],
        rows,
        fetchedAt: new Date().toISOString()
      };
    }

    throw new Error(`Unsupported local file extension: ${extension}`);
  }
}
