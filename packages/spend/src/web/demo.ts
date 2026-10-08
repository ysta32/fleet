import type { SpendBucket, SpendDimension, SpendSummary, SpendTokens } from '@fleet/shared';

/**
 * Example data for previews and the marketing section. Fully synthetic and deterministic; every figure is
 * derived from the daily series below so the totals agree with each other. Always labeled "Example data".
 */
const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);
const DAY = 86_400_000;

/** tokens for a cost at a given $/M blended rate (lower rate = more tokens per dollar) */
function tok(costUsd: number, usdPerM = 2.5): SpendTokens {
  const m = Math.round((costUsd / usdPerM) * 1_000_000);
  return {
    input: Math.round(m * 0.08),
    output: Math.round(m * 0.04),
    cacheRead: Math.round(m * 0.82),
    cacheWrite5m: Math.round(m * 0.06),
    cacheWrite1h: 0,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Weekday rhythm with a ramp mid-month as agent usage grows. 31 days ending today (Oct 18).
const DAILY: SpendBucket[] = Array.from({ length: 31 }, (_, i) => {
  const ts = NOW - (30 - i) * DAY;
  const key = new Date(ts).toISOString().slice(0, 10);
  const dow = new Date(ts).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const base = i < 13 ? 9 + (i % 4) * 1.6 : 14 + (i - 13) * 1.15 + ((i * 7) % 5) * 1.4;
  const cost = r2(weekend ? base * 0.35 : base);
  return { key, costUsd: cost, tokens: tok(cost), records: Math.round(cost * 11) };
});

const MONTH_DAYS = DAILY.filter((d) => d.key.startsWith('2026-10-'));
const MTD = r2(MONTH_DAYS.reduce((a, b) => a + b.costUsd, 0));
const TODAY = DAILY[DAILY.length - 1]!.costUsd;
const LAST7 = DAILY.slice(-7).reduce((a, b) => a + b.costUsd, 0) / 7;
const FORECAST = r2(MTD + LAST7 * (31 - 18));

/** Split MTD by shares (they need not sum to 1 for partial dimensions like task). */
function split(rows: [string, number, number?][]): SpendBucket[] {
  return rows
    .map(([key, share, rate]) => {
      const costUsd = r2(MTD * share);
      return { key, costUsd, tokens: tok(costUsd, rate), records: Math.round(costUsd * 11) };
    })
    .sort((a, b) => b.costUsd - a.costUsd);
}

export const DEMO_SUMMARY: SpendSummary = {
  generatedAt: NOW,
  priceTableVersion: '2026-10-01',
  monthStart: Date.UTC(2026, 9, 1),
  monthToDateUsd: MTD,
  todayUsd: TODAY,
  forecastMonthEndUsd: FORECAST,
  burnUsdPerHour: 3.4,
  budget: { monthlyUsd: 400, warnAt: [0.5, 0.8] },
  breakdown: {
    source: split([
      ['claude-code', 0.73],
      ['codex', 0.18],
      ['copilot', 0.09],
    ]),
    model: split([
      ['claude-opus-4-1', 0.58, 9],
      ['claude-sonnet-4-5', 0.19, 1.8],
      ['gpt-5-codex', 0.15, 1.2],
      ['claude-haiku-4-5', 0.05, 0.6],
      ['copilot-credits', 0.03, 1.5],
    ]),
    repo: split([
      ['acme/api', 0.38],
      ['acme/web', 0.27],
      ['acme/infra', 0.14],
      ['acme/docs', 0.09],
      ['acme/mobile', 0.06],
      ['acme/billing', 0.03],
      ['acme/scripts', 0.015],
      ['acme/design', 0.01],
      ['acme/sandbox', 0.005],
      ['acme/legacy', 0.004],
    ]),
    branch: split([
      ['main', 0.34],
      ['feat/billing-v2', 0.22],
      ['fix/flaky-tests', 0.12],
      ['chore/deps', 0.07],
    ]),
    task: split([
      ['Migrate db to Postgres 17', 0.21],
      ['Rewrite settings UI', 0.16],
      ['Add contract tests', 0.09],
    ]),
    session: split([
      ['sess-7f3a', 0.09],
      ['sess-19bc', 0.07],
      ['sess-e402', 0.05],
    ]),
    army: split([
      ['refactor-army', 0.3],
      ['docs-army', 0.11],
    ]),
    day: MONTH_DAYS.map((d) => ({ ...d })).sort((a, b) => b.costUsd - a.costUsd),
  } satisfies Record<SpendDimension, SpendBucket[]>,
  daily: DAILY,
  tips: [
    {
      id: 'opus-to-sonnet',
      title: 'Use Sonnet for short edits',
      detail:
        '31 Opus sessions this month were edits under 2k output tokens. Assumes the same tokens at Sonnet rates.',
      estMonthlySavingsUsd: 38.2,
    },
    {
      id: 'cache-reuse',
      title: 'Keep sessions warm to reuse cache',
      detail: 'Cache writes repeat after idle gaps over 5 minutes in acme/api.',
      estMonthlySavingsUsd: 17,
    },
    {
      id: 'copilot-credits',
      title: 'Copilot credits unused',
      detail: '$6.10 of included credits remain until Oct 31. Route small completions there first.',
      estMonthlySavingsUsd: 6.1,
    },
  ],
  alerts: [
    {
      id: 'forecast-over',
      level: 'warn',
      title: 'Forecast is over budget',
      body: `On pace for $${Math.round(FORECAST)} against a $400 budget.`,
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
