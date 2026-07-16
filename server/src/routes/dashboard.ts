import { Router } from 'express';
import { buildDashboard, getFilterOptions } from '../ibmData.js';

export const dashboardRouter = Router();

/** Filter options that drive the configurable controls (Year, Geo, Country, Segment). */
dashboardRouter.get('/options', (_request, response) => {
  response.json(getFilterOptions());
});

/**
 * GET /api/dashboard?year=2025&geo=EMEA&country=Germany&segment=Software
 *
 * Section 1 of the POC: the dashboard reads ONLY from the internal
 * finance / EPM dataset (the ingested IBM annual reports) — no internet.
 */
dashboardRouter.get('/', (request, response) => {
  try {
    const year = request.query.year ? Number(request.query.year) : undefined;
    const geo = typeof request.query.geo === 'string' ? request.query.geo : undefined;
    const country = typeof request.query.country === 'string' ? request.query.country : undefined;
    const segment = typeof request.query.segment === 'string' ? request.query.segment : undefined;
    response.json(buildDashboard({ year, geo, country, segment }));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Dashboard build failed' });
  }
});
