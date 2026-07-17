import type { VercelRequest, VercelResponse } from '@vercel/node';
// Force-include the runtime packages used by server/src/ingest.js — Vercel's
// file tracer only bundles node_modules packages imported from api entry
// files, not from the includeFiles-shipped server/src modules.
import 'csv-parse/sync';
import 'cheerio';
import 'node-fetch';
import 'xlsx';
import 'pdf-parse';
import { ingestSource, SourceType } from '../server/src/ingest.js';

/**
 * Serverless wrapper for POST /api/source — connect an external data source
 * (localPath / webUrl / googleSheet). Note: localPath only works when the
 * server runs on the user's machine; on Vercel it returns a clear error.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { type, value } = req.body as { type?: SourceType; value?: string };
  if (!type || !value) { res.status(400).json({ error: 'type and value are required' }); return; }
  try {
    res.json(await ingestSource(type, value));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Source ingestion failed' });
  }
}
