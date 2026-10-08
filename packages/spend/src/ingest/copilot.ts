import { readFile } from 'node:fs/promises';
import type { Ingester, UsageRecord } from '../contracts.js';
import { csvId, csvNumber, csvRows, isMissingFile } from './csv.js';

const exportNote = 'export premium request usage CSV from GitHub and set paths.copilotExportPath';

function repoDisplay(repository: string | undefined): string | undefined {
  if (!repository) return undefined;
  const normalized = repository.replaceAll('\\', '/').replace(/\/+$/, '');
  if (/^[^/:.][^/:]*\/[^/:]+$/.test(normalized)) return normalized;
  return normalized.split('/').filter(Boolean).at(-1) || undefined;
}

export const ingestCopilot: Ingester = async (ctx) => {
  const path = ctx.config.paths.copilotExportPath;
  if (!path) return { source: 'copilot', records: [], status: 'missing', note: exportNote };
  try {
    const rows = csvRows(await readFile(path, 'utf8'));
    const records: UsageRecord[] = [];
    const seen = new Map<string, number>();
    for (const row of rows) {
      const ts = Date.parse(row.date ?? '');
      if (!Number.isFinite(ts) || ts < ctx.since) continue;
      const requests = csvNumber(row.quantity);
      const price = csvNumber(row.price_per_unit) ?? csvNumber(row.applied_cost_per_quantity);
      const computed = requests !== undefined && price !== undefined ? requests * price : undefined;
      const vendorCostUsd =
        csvNumber(row.net_amount) ??
        csvNumber(row.gross_amount) ??
        (computed !== undefined && Number.isFinite(computed) ? computed : undefined);
      const repo = repoDisplay(row.repository);
      records.push({
        id: csvId('copilot', row, seen),
        source: 'copilot',
        ts,
        model: row.model || 'unknown',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
        ...(requests === undefined ? {} : { requests }),
        ...(vendorCostUsd === undefined ? {} : { vendorCostUsd }),
        ...(repo === undefined ? {} : { repo }),
      });
    }
    return { source: 'copilot', records, status: 'ok' };
  } catch (error) {
    return {
      source: 'copilot',
      records: [],
      status: isMissingFile(error) ? 'missing' : 'error',
      note: isMissingFile(error) ? exportNote : 'Unable to read Copilot usage CSV',
    };
  }
};
