import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildDashboard, getFilterOptions } from '../server/src/ibmData.js';

/**
 * Serverless wrapper for Section 1 (configurable dashboard).
 * /api/dashboard          → dashboard package for the selected scope
 * /api/dashboard/options  → filter options (routed here via vercel.json)
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const isOptions = (req.url ?? '').includes('/options');
  if (isOptions) {
    res.json(getFilterOptions());
    return;
  }

  try {
    const q = req.query;
    res.json(buildDashboard({
      year: typeof q.year === 'string' ? Number(q.year) : undefined,
      geo: typeof q.geo === 'string' ? q.geo : undefined,
      country: typeof q.country === 'string' ? q.country : undefined,
      segment: typeof q.segment === 'string' ? q.segment : undefined
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Dashboard build failed' });
  }
}
