import { Connector, SourceType } from '../types.js';
import { GoogleSheetsConnector } from './googleSheets.js';
import { IcaMcpConnector } from './icaMcp.js';
import { LocalFileConnector } from './localFile.js';
import { PdfConnector } from './pdf.js';
import { WebScraperConnector } from './webScraper.js';

export function getConnector(sourceType: SourceType): Connector {
  if (sourceType === 'localFile') {
    return new LocalFileConnector();
  }

  if (sourceType === 'webScraper') {
    return new WebScraperConnector();
  }

  if (sourceType === 'googleSheets') {
    return new GoogleSheetsConnector();
  }

  if (sourceType === 'icaMcp') {
    return new IcaMcpConnector();
  }

  if (sourceType === 'pdf') {
    return new PdfConnector();
  }

  throw new Error(`Unsupported source type: ${sourceType}`);
}
