import { AnalysisResult, FinanceDataset, FinanceRow, RiskItem, TrendItem } from '../types.js';

function findField(fields: string[], includes: string[]): string | undefined {
  return fields.find((field) => includes.some((part) => field.toLowerCase().includes(part)));
}

function getNumber(row: FinanceRow, field?: string): number {
  if (!field) {
    return 0;
  }

  const value = row[field];
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function getSeverity(delta: number): 'high' | 'medium' | 'low' {
  if (delta > 0.1) {
    return 'high';
  }

  if (delta > 0.05) {
    return 'medium';
  }

  return 'low';
}

export function analysisTool(dataset: FinanceDataset): AnalysisResult {
  const { fields, rows } = dataset;
  const actualRevenueField = findField(fields, ['actualrevenue', 'actual revenue', 'revenue']);
  const forecastRevenueField = findField(fields, ['forecastrevenue', 'forecast revenue', 'planrevenue', 'forecast']);
  const actualCostField = findField(fields, ['actualcost', 'actual cost', 'cost']);
  const forecastCostField = findField(fields, ['forecastcost', 'forecast cost', 'plancost']);
  const marginField = findField(fields, ['marginpct', 'margin %', 'margin']);
  const stageField = findField(fields, ['stage', 'status']);

  const totals = rows.reduce<{
    actualRevenue: number;
    forecastRevenue: number;
    actualCost: number;
    forecastCost: number;
    margin: number;
  }>(
    (accumulator, row) => {
      accumulator.actualRevenue += getNumber(row, actualRevenueField);
      accumulator.forecastRevenue += getNumber(row, forecastRevenueField);
      accumulator.actualCost += getNumber(row, actualCostField);
      accumulator.forecastCost += getNumber(row, forecastCostField);
      accumulator.margin += getNumber(row, marginField);
      return accumulator;
    },
    { actualRevenue: 0, forecastRevenue: 0, actualCost: 0, forecastCost: 0, margin: 0 }
  );

  const averageMargin = rows.length === 0 ? 0 : totals.margin / rows.length;
  const closedWon = rows
    .filter((row) => String(row[stageField ?? ''] ?? '').toLowerCase().includes('won'))
    .reduce((sum, row) => sum + getNumber(row, actualRevenueField), 0);
  const openPipeline = rows
    .filter((row) => !String(row[stageField ?? ''] ?? '').toLowerCase().includes('won'))
    .reduce((sum, row) => sum + getNumber(row, forecastRevenueField), 0);
  const toGoRevenue = Math.max(totals.forecastRevenue - totals.actualRevenue, 0);

  const revenueVariance = totals.forecastRevenue === 0 ? 0 : (totals.forecastRevenue - totals.actualRevenue) / totals.forecastRevenue;
  const costVariance = totals.forecastCost === 0 ? 0 : (totals.actualCost - totals.forecastCost) / totals.forecastCost;
  const marginTrend = totals.forecastRevenue === 0 ? 0 : ((totals.actualRevenue - totals.actualCost) - (totals.forecastRevenue - totals.forecastCost)) / totals.forecastRevenue;

  const risks: RiskItem[] = [];

  if (revenueVariance > 0) {
    risks.push({
      driver: 'Revenue below forecast',
      impact: `${(revenueVariance * 100).toFixed(1)}% below plan`,
      severity: getSeverity(revenueVariance)
    });
  }

  if (costVariance > 0) {
    risks.push({
      driver: 'Costs above forecast',
      impact: `${(costVariance * 100).toFixed(1)}% above plan`,
      severity: getSeverity(costVariance)
    });
  }

  if (averageMargin < 35) {
    risks.push({
      driver: 'Margin compression',
      impact: `Average margin at ${averageMargin.toFixed(1)}%`,
      severity: averageMargin < 25 ? 'high' : 'medium'
    });
  }

  const trends: TrendItem[] = [
    {
      metric: 'Revenue variance',
      direction: revenueVariance > 0 ? 'down' : revenueVariance < 0 ? 'up' : 'flat',
      changePercent: Number((Math.abs(revenueVariance) * 100).toFixed(1))
    },
    {
      metric: 'Cost variance',
      direction: costVariance > 0 ? 'up' : costVariance < 0 ? 'down' : 'flat',
      changePercent: Number((Math.abs(costVariance) * 100).toFixed(1))
    },
    {
      metric: 'Margin trend',
      direction: marginTrend > 0 ? 'up' : marginTrend < 0 ? 'down' : 'flat',
      changePercent: Number((Math.abs(marginTrend) * 100).toFixed(1))
    }
  ];

  return {
    kpis: {
      closedWon,
      openPipeline,
      toGoRevenue,
      marginPct: Number(averageMargin.toFixed(1))
    },
    risks,
    trends
  };
}
