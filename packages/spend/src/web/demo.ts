import type { SpendBucket, SpendDimension, SpendSummary, SpendTokens } from '@fleet/shared';

const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);

function tok(costUsd: number): SpendTokens {
  const m = Math.round(costUsd * 40_000);
  return {
    input: Math.round(m * 0.1),
    output: Math.round(m * 0.05),
    cacheRead: Math.round(m * 0.8),
    cacheWrite5m: Math.round(m * 0.05),
    cacheWrite1h: 0,
  };
}

function bucket(key: string, costUsd: number, records: number): SpendBucket {
  return { key, costUsd, tokens: tok(costUsd), records };
}

function buckets(rows: [string, number, number][]): SpendBucket[] {
  return rows.map(([k, c, r]) => bucket(k, c, r)).sort((a, b) => b.costUsd - a.costUsd);
}

const DAILY: SpendBucket[] = Array.from({ length: 31 }, (_, i) => {
  const day = new Date(NOW - (30 - i) * 86_400_000).toISOString().slice(0, 10);
  // deterministic ramp: flat ~$1/day, then agentic usage explodes
  const cost = i < 12 ? 0.9 + (i % 3) * 0.2 : 4 + (i - 12) * 2.4 + (i % 4) * 3;
  return bucket(day, Math.round(cost * 100) / 100, 20 + i * 9);
});

/** Fully synthetic summary: a $29 plan turning into a $750 month. */
export const DEMO_SUMMARY: SpendSummary = {
  generatedAt: NOW,
  priceTableVersion: '2026-10-01',
  monthStart: Date.UTC(2026, 9, 1),
  monthToDateUsd: 412.37,
  todayUsd: 38.2,
  forecastMonthEndUsd: 750.0,
  burnUsdPerHour: 4.6,
  budget: { monthlyUsd: 500, warnAt: [0.5, 0.8] },
  breakdown: {
    repo: buckets([
      ['acme/api', 171.4, 2210],
      ['acme/web', 120.15, 1654],
      ['acme/infra', 64.9, 702],
      ['acme/docs', 55.92, 480],
    ]),
    model: buckets([
      ['claude-opus-4-1', 218.6, 1320],
      ['claude-sonnet-4-5', 126.3, 3010],
      ['gpt-5-codex', 49.2, 940],
      ['copilot', 18.27, 776],
    ]),
    session: buckets([
      ['sess-7f3a', 88.4, 640],
      ['sess-19bc', 61.75, 502],
      ['sess-e402', 47.1, 388],
    ]),
    army: buckets([
      ['refactor-army', 140.2, 1500],
      ['docs-army', 52.8, 610],
    ]),
    task: buckets([
      ['T-migrate-db', 76.3, 420],
      ['T-ui-rewrite', 58.9, 380],
      ['T-write-tests', 31.4, 290],
    ]),
    source: buckets([
      ['claude-code', 344.9, 4330],
      ['codex', 49.2, 940],
      ['copilot', 18.27, 776],
    ]),
    branch: buckets([
      ['main', 150.0, 1900],
      ['feat/billing', 120.4, 1500],
    ]),
    day: DAILY.slice(-14)
      .map((d) => ({ ...d }))
      .sort((a, b) => b.costUsd - a.costUsd),
  } satisfies Record<SpendDimension, SpendBucket[]>,
  daily: DAILY,
  tips: [
    {
      id: 'opus-to-sonnet',
      title: 'Use Sonnet for routine edits',
      detail: '62% of Opus calls were small edits that Sonnet handles equally well.',
      estMonthlySavingsUsd: 140,
    },
    {
      id: 'cache-reuse',
      title: 'Keep sessions warm to reuse cache',
      detail: 'Cache writes are being repeated after idle gaps over 5 minutes.',
      estMonthlySavingsUsd: 42,
    },
  ],
  alerts: [
    {
      id: 'budget-80',
      level: 'warn',
      title: 'Budget 80% used',
      body: 'You have used $412 of your $500 monthly budget.',
      at: NOW - 3_600_000,
    },
  ],
  sources: [
    { source: 'claude-code', records: 4330, status: 'ok' },
    { source: 'codex', records: 940, status: 'ok' },
    { source: 'copilot', records: 776, status: 'ok', note: 'from usage export' },
    { source: 'cursor', records: 0, status: 'missing' },
  ],
  unpricedModels: ['experimental-model-x'],
};
