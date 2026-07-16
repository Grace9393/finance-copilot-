import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';
import { Connector, FinanceDataset, UrlConfig, normaliseValue } from '../types.js';

export class GoogleSheetsConnector implements Connector {
  async fetchData(config: Record<string, unknown>): Promise<FinanceDataset> {
    const { url } = config as unknown as UrlConfig;

    if (!url) {
      throw new Error('url is required for googleSheets source');
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch Google Sheets URL: ${response.status} ${response.statusText}`);
    }

    const csv = await response.text();
    const parsed = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
    const rows = parsed.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normaliseValue(value)]))
    );

    return {
      source: url,
      fields: rows[0] ? Object.keys(rows[0]) : [],
      rows,
      fetchedAt: new Date().toISOString()
    };
  }
}
