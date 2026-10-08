import type { Ingester, SpendConfig, SpendSource, SpendSummary, UsageRecord } from './contracts.js';
import { ingestAnthropicApi, ingestOpenAiApi } from './ingest/api.js';
import { ingestClaudeCode } from './ingest/claude.js';
import { ingestCodex } from './ingest/codex.js';
import { ingestCopilot } from './ingest/copilot.js';
import { ingestCursor } from './ingest/cursor.js';
import { DAY_MS, dedupeRecords, monthPeriod } from './analyze/tips.js';
import { summarize } from './analyze/summarize.js';
import { PRICE_TABLE } from './pricing/table.js';

export interface CollectOptions {
  now: number;
  config: SpendConfig;
  home: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  /** default: start of the current month minus 31 days */
  since?: number;
}

export interface CollectResult {
  records: UsageRecord[];
  sources: SpendSummary['sources'];
}

export const INGESTERS: readonly [SpendSource, Ingester][] = [
  ['claude-code', ingestClaudeCode],
  ['codex', ingestCodex],
  ['cursor', ingestCursor],
  ['copilot', ingestCopilot],
  ['anthropic-api', ingestAnthropicApi],
  ['openai-api', ingestOpenAiApi],
];

/** Path-free note for an ingester that threw: only an errno-style code, never the message. */
function rejectionNote(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)
    ? `ingest failed (${code})`
    : 'ingest failed';
}

export async function collect(opts: CollectOptions, ingesters = INGESTERS): Promise<CollectResult> {
  const since = opts.since ?? monthPeriod(opts.now).start - 31 * DAY_MS;
  const ctx = {
    config: opts.config,
    home: opts.home,
    now: opts.now,
    since,
    fetch: opts.fetch ?? globalThis.fetch,
    env: opts.env ?? process.env,
  };
  const settled = await Promise.allSettled(ingesters.map(([, ingest]) => ingest(ctx)));
  const records: UsageRecord[] = [];
  const sources: SpendSummary['sources'] = settled.map((result, i) => {
    const source = ingesters[i]![0];
    if (result.status === 'rejected') {
      return { source, records: 0, status: 'error', note: rejectionNote(result.reason) };
    }
    const value = result.value;
    const list = Array.isArray(value.records) ? value.records : [];
    records.push(...list);
    return {
      source,
      records: list.length,
      status: value.status,
      ...(value.note ? { note: value.note } : {}),
    };
  });
  return { records: dedupeRecords(records), sources };
}

/** Summarize collected records against the config budget and the bundled price table. */
export function analyze(collected: CollectResult, config: SpendConfig, now: number): SpendSummary {
  return summarize(collected.records, {
    now,
    budget: config.budget,
    table: PRICE_TABLE,
    sources: collected.sources,
  });
}
