import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { Connector, FinanceDataset, FinanceRow, UrlConfig, normaliseValue } from '../types.js';

export class WebScraperConnector implements Connector {
  async fetchData(config: Record<string, unknown>): Promise<FinanceDataset> {
    const { url } = config as unknown as UrlConfig;

    if (!url) {
      throw new Error('url is required for webScraper source');
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const table = $('table').first();

    if (table.length === 0) {
      throw new Error('No table found on the provided web page');
    }

    const headers = table
      .find('tr')
      .first()
      .find('th, td')
      .map((_, element) => $(element).text().trim())
      .get();

    const rows: FinanceRow[] = [];

    table
      .find('tr')
      .slice(1)
      .each((_, row) => {
        const cells = $(row)
          .find('td')
          .map((__, cell) => $(cell).text().trim())
          .get();

        if (cells.length === 0) {
          return;
        }

        const entry = Object.fromEntries(
          headers.map((header, index) => [header || `column_${index + 1}`, normaliseValue(cells[index] ?? '')])
        );

        rows.push(entry);
      });

    return {
      source: url,
      fields: headers,
      rows,
      fetchedAt: new Date().toISOString()
    };
  }
}
