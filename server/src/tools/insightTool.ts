import { AnalysisResult, DecisionPackage, FinanceDataset, RecommendationItem } from '../types.js';

export function insightTool(result: AnalysisResult): string {
  const highestRisk = result.risks[0];
  const lead = highestRisk
    ? `The biggest risk to margin this quarter is ${highestRisk.driver.toLowerCase()}, with ${highestRisk.impact.toLowerCase()}.`
    : 'No major margin risks were detected in the current dataset.';

  const trendSummary = result.trends
    .map((trend) => `${trend.metric} is ${trend.direction} by ${trend.changePercent.toFixed(1)}%`)
    .join('; ');

  return `${lead} Current margin is ${result.kpis.marginPct.toFixed(1)}%. ${trendSummary}.`;
}

export function recommendationTool(result: AnalysisResult): RecommendationItem[] {
  return result.risks.map((risk) => {
    if (risk.driver === 'Costs above forecast') {
      return {
        action: 'Launch a cost containment review on the highest-growth expense lines and pause discretionary spend.',
        priority: 'High',
        category: 'Cost optimisation'
      };
    }

    if (risk.driver === 'Revenue below forecast') {
      return {
        action: 'Accelerate late-stage deals, review pricing leakage, and tighten forecast accountability by region.',
        priority: 'High',
        category: 'Revenue recovery'
      };
    }

    return {
      action: 'Review low-margin products and improve mix, pricing, or service delivery efficiency.',
      priority: 'Medium',
      category: 'Margin improvement'
    };
  });
}

function findField(fields: string[], includes: string[]): string | undefined {
  return fields.find((field) => includes.some((part) => field.toLowerCase().includes(part)));
}

function getNumber(row: Record<string, string | number>, field?: string): number {
  if (!field) {
    return 0;
  }

  const value = row[field];
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

export function executionTool(
  dataset: FinanceDataset,
  analysis: AnalysisResult,
  narrative: string,
  recommendations: RecommendationItem[]
): DecisionPackage {
  const fields = dataset.fields;
  const revenueField = findField(fields, ['actualrevenue', 'revenue']);
  const campaignField = findField(fields, ['campaign', 'theme']);

  const topDeals = [...dataset.rows]
    .sort((left, right) => getNumber(right, revenueField) - getNumber(left, revenueField))
    .slice(0, 5);

  const campaigns = campaignField ? dataset.rows.filter((row) => String(row[campaignField] ?? '').trim() !== '').slice(0, 3) : dataset.rows.slice(0, 3);

  return {
    narrative,
    recommendations,
    kpis: analysis.kpis,
    risks: analysis.risks,
    topDeals,
    campaigns,
    dataset
  };
}
