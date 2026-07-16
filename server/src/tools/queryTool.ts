import { getConnector } from '../connectors/index.js';
import { FinanceDataset, SourceType } from '../types.js';

export async function queryTool(
  sourceType: SourceType,
  sourceConfig: Record<string, unknown>
): Promise<FinanceDataset> {
  const connector = getConnector(sourceType);
  return connector.fetchData(sourceConfig);
}
