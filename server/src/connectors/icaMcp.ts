import fetch from 'node-fetch';
import { Connector, FinanceDataset, IcaMcpConfig } from '../types.js';

function getMockDataset(): FinanceDataset {
  return {
    source: 'ica-mcp-mock',
    fields: ['Quarter', 'ActualRevenue', 'ForecastRevenue', 'ActualCost', 'ForecastCost', 'MarginPct'],
    rows: [
      {
        Quarter: 'Q1',
        ActualRevenue: 950000,
        ForecastRevenue: 1000000,
        ActualCost: 620000,
        ForecastCost: 580000,
        MarginPct: 34.7
      },
      {
        Quarter: 'Q2',
        ActualRevenue: 1020000,
        ForecastRevenue: 1100000,
        ActualCost: 690000,
        ForecastCost: 640000,
        MarginPct: 32.4
      }
    ],
    fetchedAt: new Date().toISOString()
  };
}

export class IcaMcpConnector implements Connector {
  async fetchData(config: Record<string, unknown>): Promise<FinanceDataset> {
    const { endpoint } = config as unknown as IcaMcpConfig;
    const url = endpoint || process.env.ICA_MCP_URL;

    if (!url) {
      return getMockDataset();
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'financeSnapshot' })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ICA MCP data: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as FinanceDataset;
  }
}
