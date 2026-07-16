import { Router } from 'express';
import { analysisTool } from '../tools/analysisTool.js';
import { executionTool, insightTool, recommendationTool } from '../tools/insightTool.js';
import { queryTool } from '../tools/queryTool.js';
import { SourceType } from '../types.js';

const validSourceTypes: SourceType[] = ['localFile', 'webScraper', 'googleSheets', 'icaMcp', 'pdf'];

export const analyseRouter = Router();

analyseRouter.post('/', async (request, response, next) => {
  try {
    const { sourceType, sourceConfig } = request.body as {
      sourceType?: SourceType;
      sourceConfig?: Record<string, unknown>;
    };

    if (!sourceType || !validSourceTypes.includes(sourceType)) {
      response.status(400).json({ error: 'Invalid sourceType' });
      return;
    }

    if (!sourceConfig || typeof sourceConfig !== 'object') {
      response.status(400).json({ error: 'sourceConfig is required' });
      return;
    }

    const dataset = await queryTool(sourceType, sourceConfig);
    const analysis = analysisTool(dataset);
    const narrative = insightTool(analysis);
    const recommendations = recommendationTool(analysis);
    const decisionPackage = executionTool(dataset, analysis, narrative, recommendations);

    response.json(decisionPackage);
  } catch (error) {
    next(error);
  }
});
