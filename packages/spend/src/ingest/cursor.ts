import { readFile } from 'node:fs/promises';
import type { Ingester, UsageRecord } from '../contracts.js';
import { csvId, csvNumber, csvRows, isMissingFile } from './csv.js';

const exportNote = 'export usage CSV from cursor.com/dashboard and set paths.cursorExportPath';

export const ingestCursor: Ingester = async (ctx) => {
  const path = ctx.config.paths.cursorExportPath;
  if (!path) return { source: 'cursor', records: [], status: 'missing', note: exportNote };
  try {
    const rows = csvRows(await readFile(path, 'utf8'));
    const records: UsageRecord[] = [];
    const seen = new Map<string, number>();
    for (const row of rows) {
      const ts = Date.parse(row.date ?? '');
      if (!Number.isFinite(ts) || ts < ctx.since) continue;
      const input = Math.max(0, csvNumber(row['input (w/o cache write)']) ?? 0);
      const withCache = csvNumber(row['input (w/ cache write)']);
      const vendorCostUsd = csvNumber(row.cost);
      records.push({
        id: csvId('cursor', row, seen),
        source: 'cursor',
        ts,
        model: row.model || 'unknown',
        tokens: {
          input,
          output: Math.max(0, csvNumber(row['output tokens']) ?? 0),
          cacheRead: Math.max(0, csvNumber(row['cache read']) ?? 0),
          cacheWrite5m: Math.max(0, (withCache ?? input) - input),
          cacheWrite1h: 0,
        },
        ...(vendorCostUsd === undefined ? {} : { vendorCostUsd }),
      });
    }
    return { source: 'cursor', records, status: 'ok' };
  } catch (error) {
    return {
      source: 'cursor',
      records: [],
      status: isMissingFile(error) ? 'missing' : 'error',
      note: isMissingFile(error) ? exportNote : 'Unable to read Cursor usage CSV',
    };
  }
};
