import { Router } from 'express';
import { ingestSource, SourceType } from '../ingest.js';

export const sourceRouter = Router();

/**
 * POST /api/source  { type: 'localPath' | 'webUrl' | 'googleSheet', value: string }
 *
 * Connects an external data source and returns the parsed dataset:
 *  - localPath   — absolute path on the server machine (local dev), any supported file type
 *  - webUrl      — page with a table, a PDF, CSV, JSON, or an article (text-chunked)
 *  - googleSheet — share link or published-CSV link
 */
sourceRouter.post('/', async (request, response) => {
  const { type, value } = request.body as { type?: SourceType; value?: string };
  if (!type || !value) {
    response.status(400).json({ error: 'type and value are required' });
    return;
  }
  try {
    response.json(await ingestSource(type, value));
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : 'Source ingestion failed' });
  }
});
