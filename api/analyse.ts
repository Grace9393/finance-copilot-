import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getConnector } from '../server/src/connectors/index.js';
import { analysisTool } from '../server/src/tools/analysisTool.js';
import { executionTool, insightTool, recommendationTool } from '../server/src/tools/insightTool.js';
import type { SourceType } from '../server/src/types.js';

const validSourceTypes: SourceType[] = ['localFile', 'webScraper', 'googleSheets', 'icaMcp', 'pdf'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { sourceType, sourceConfig } = req.body as {
    sourceType?: SourceType;
    sourceConfig?: Record<string, unknown>;
  };

  if (!sourceType || !validSourceTypes.includes(sourceType)) {
    res.status(400).json({ error: 'Invalid sourceType' });
    return;
  }

  if (!sourceConfig || typeof sourceConfig !== 'object') {
    res.status(400).json({ error: 'sourceConfig is required' });
    return;
  }

  try {
    const connector = getConnector(sourceType);
    const dataset = await connector.fetchData(sourceConfig);
    const analysis = analysisTool(dataset);
    const narrative = insightTool(analysis);
    const recommendations = recommendationTool(analysis);
    const decisionPackage = executionTool(dataset, analysis, narrative, recommendations);
    res.json(decisionPackage);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Analysis failed' });
  }
}
