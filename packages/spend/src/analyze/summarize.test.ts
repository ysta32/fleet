import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalyzeOptions, SpendBudget, UsageRecord } from '../contracts.js';
import { PRICE_TABLE } from '../pricing/table.js';
import { summarize, toBrief } from './summarize.js';

// Synthetic records only. All instants are built with the local Date constructor so expectations hold
// in any TZ; forecast cases use July (no DST transition in common zones).
const local = (mo: number, d: number, h = 0, min = 0) => new Date(2026, mo, d, h, min).getTime();
const jul = (d: number, h = 0, min = 0) => local(6, d, h, min);

let seq = 0;
type Tok = Partial<UsageRecord['tokens']>;
function rec(p: Omit<Partial<UsageRecord>, 'tokens'> & { ts: number; tokens?: Tok }): UsageRecord {
  return {
    id: `s:${++seq}`,
    source: 'claude-code',
    model: 'claude-sonnet-4-6', // $3 in / $15 out per M
    ...p,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...p.tokens },
  };
}
const NO_BUDGET: SpendBudget = { monthlyUsd: null, warnAt: [0.5, 0.8] };
const opts = (now: number, budget: SpendBudget = NO_BUDGET): AnalyzeOptions => ({
  now,
  budget,
  table: PRICE_TABLE,
  sources: [{ source: 'claude-code', records: 0, status: 'ok' }],
});

describe('summarize', () => {
  it('handles empty input with no budget', () => {
    const now = jul(15, 12);
    const s = summarize([], opts(now));
    expect(s.generatedAt).toBe(now);
    expect(s.priceTableVersion).toBe(PRICE_TABLE.version);
    expect(s.monthStart).toBe(jul(1));
    expect(s.monthToDateUsd).toBe(0);
    expect(s.todayUsd).toBe(0);
    expect(s.forecastMonthEndUsd).toBe(0);
    expect(s.burnUsdPerHour).toBe(0);
    expect(s.alerts).toEqual([]);
    expect(s.tips).toEqual([]);
    expect(s.unpricedModels).toEqual([]);
    expect(s.budget).toEqual(NO_BUDGET);
    for (const list of Object.values(s.breakdown)) expect(list).toEqual([]);
    expect(Object.keys(s.breakdown).sort()).toEqual(
      ['army', 'branch', 'day', 'model', 'repo', 'session', 'source', 'task'].sort(),
    );
    expect(s.daily).toHaveLength(31);
    expect(s.daily[0]!.key).toBe('2026-06-15');
    expect(s.daily[30]!.key).toBe('2026-07-15');
    expect(s.daily.every((b) => b.costUsd === 0 && b.records === 0)).toBe(true);
  });

  const NOW = jul(15, 12); // elapsedDays = 14.5, daysInMonth = 31
  const records = (): UsageRecord[] => [
    // $3: 1M input
    rec({ id: 'r1', ts: jul(2, 10), repo: 'a', sessionId: 's1', task: 't1', tokens: { input: 1_000_000 } }),
    rec({ id: 'r1', ts: jul(2, 10), repo: 'a', sessionId: 's1', task: 't1', tokens: { input: 1_000_000 } }), // dup
    // $7 vendor cost
    rec({ id: 'r2', ts: jul(10, 10), source: 'copilot', model: 'gpt-4o', vendorCostUsd: 7, repo: 'b' }),
    // $3: 200k output, inside the last hour and today
    rec({ id: 'r3', ts: jul(15, 11, 30), repo: 'a', sessionId: 's2', tokens: { output: 200_000 } }),
    // previous month, $3
    rec({ id: 'r4', ts: local(5, 30, 23), repo: 'a', tokens: { input: 1_000_000 } }),
    // unpriced
    rec({ id: 'r5', ts: jul(14, 9), model: 'mystery-1', tokens: { input: 5 } }),
  ];

  it('computes totals, breakdowns, daily and the 7-day forecast', () => {
    const s = summarize(records(), opts(NOW));
    expect(s.monthToDateUsd).toBeCloseTo(13, 12);
    expect(s.todayUsd).toBeCloseTo(3, 12);
    expect(s.burnUsdPerHour).toBeCloseTo(3, 12);
    // last 7 days [Jul 8 12:00, Jul 15 12:00) = 7 + 3 + 0 = 10 ; forecast = 13 + 10/7 * (31 - 14.5) = 256/7
    expect(s.forecastMonthEndUsd).toBeCloseTo(256 / 7, 10);
    expect(s.unpricedModels).toEqual(['mystery-1']);

    const pick = (dim: keyof typeof s.breakdown) =>
      s.breakdown[dim].map((b) => [b.key, b.costUsd, b.records]);
    expect(pick('repo')).toEqual([
      ['b', 7, 1],
      ['a', 6, 2],
      ['(none)', 0, 1],
    ]);
    expect(pick('session')).toEqual([
      ['(none)', 7, 2],
      ['s1', 3, 1],
      ['s2', 3, 1],
    ]);
    expect(pick('model')).toEqual([
      ['gpt-4o', 7, 1],
      ['claude-sonnet-4-6', 6, 2],
      ['mystery-1', 0, 1],
    ]);
    expect(pick('day')).toEqual([
      ['2026-07-10', 7, 1],
      ['2026-07-02', 3, 1],
      ['2026-07-15', 3, 1],
      ['2026-07-14', 0, 1],
    ]);
    expect(pick('source')).toEqual(
      [
        ['claude-code', 6, 3],
        ['copilot', 7, 1],
      ].sort((x, y) => (y[1] as number) - (x[1] as number)),
    );
    expect(s.breakdown.branch).toEqual([
      {
        key: '(none)',
        costUsd: 13,
        records: 4,
        tokens: { input: 1_000_005, output: 200_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      },
    ]);

    expect(s.daily).toHaveLength(31);
    expect(s.daily[0]!.key).toBe('2026-06-15');
    const day = (k: string) => s.daily.find((b) => b.key === k)!;
    expect(day('2026-06-30').costUsd).toBe(3);
    expect(day('2026-07-02').records).toBe(1);
    expect(day('2026-07-15').costUsd).toBe(3);
    expect(s.daily.reduce((a, b) => a + b.costUsd, 0)).toBeCloseTo(16, 12);
  });

  it('caps breakdown buckets at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      rec({ ts: jul(3), repo: `r${i}`, tokens: { input: (i + 1) * 1000 } }),
    );
    const s = summarize(many, opts(NOW));
    expect(s.breakdown.repo).toHaveLength(50);
    expect(s.breakdown.repo[0]!.key).toBe('r59');
    expect(s.breakdown.repo[49]!.key).toBe('r10');
  });

  it('emits mtd / over alerts with distinct ids', () => {
    const s = summarize(records(), opts(NOW, { monthlyUsd: 12, warnAt: [0.8, 0.5, 1] }));
    expect(s.alerts.map((a) => [a.id, a.level])).toEqual([
      ['budget-2026-07-over', 'over'],
      ['budget-2026-07-mtd-0.5', 'warn'],
      ['budget-2026-07-mtd-0.8', 'warn'],
    ]);
    for (const a of s.alerts) {
      expect(a.at).toBe(NOW);
      expect(a.title.length).toBeLessThanOrEqual(80);
      expect(a.body.length).toBeLessThanOrEqual(200);
    }
  });

  it('emits forecast alerts only while under budget', () => {
    // mtd 13, forecast 36.571...
    const s40 = summarize(records(), opts(NOW, { monthlyUsd: 40, warnAt: [0.5, 0.8] }));
    expect(s40.alerts.map((a) => a.id)).toEqual([
      'budget-2026-07-forecast-0.5',
      'budget-2026-07-forecast-0.8',
    ]);
    const s30 = summarize(records(), opts(NOW, { monthlyUsd: 30, warnAt: [0.5, 0.8] }));
    expect(s30.alerts.map((a) => [a.id, a.level])).toEqual([
      ['budget-2026-07-forecast-0.5', 'warn'],
      ['budget-2026-07-forecast-0.8', 'warn'],
      ['budget-2026-07-forecast-over', 'warn'],
    ]);
    const s20 = summarize(records(), opts(NOW, { monthlyUsd: 20, warnAt: [0.5, 0.8] }));
    expect(s20.alerts.map((a) => a.id)).toEqual([
      'budget-2026-07-mtd-0.5',
      'budget-2026-07-forecast-0.5',
      'budget-2026-07-forecast-0.8',
      'budget-2026-07-forecast-over',
    ]);
    expect(summarize(records(), opts(NOW, { monthlyUsd: 1000, warnAt: [0.5] })).alerts).toEqual([]);
  });

  it('uses MTD / elapsed for the first 3 days', () => {
    const r = [
      rec({ ts: jul(1, 6), tokens: { input: 1_000_000 } }),
      rec({ ts: local(5, 30, 6), tokens: { input: 1_000_000 } }),
    ];
    // elapsed 1.5 days: rate 3 / 1.5 = 2 ; forecast 3 + 2 * 29.5 = 62
    expect(summarize(r, opts(jul(2, 12))).forecastMonthEndUsd).toBeCloseTo(62, 10);
    // elapsed 0.5h clamps to 1/24 day: rate 72 ; forecast 3 + 72 * (31 - 1/24) = 2232
    const r2 = [rec({ ts: jul(1, 0, 10), tokens: { input: 1_000_000 } })];
    expect(summarize(r2, opts(jul(1, 0, 30))).forecastMonthEndUsd).toBeCloseTo(2232, 9);
  });

  it('respects the month boundary', () => {
    const now = local(7, 1, 0, 30); // Aug 1 00:30
    const r = [
      rec({ ts: jul(31, 23, 50), tokens: { input: 1_000_000 } }), // $3, previous month
      rec({ ts: local(7, 1), tokens: { output: 100_000 } }), // $1.5 exactly at month start
    ];
    const s = summarize(r, opts(now, { monthlyUsd: 10, warnAt: [0.5] }));
    expect(s.monthStart).toBe(local(7, 1));
    expect(s.monthToDateUsd).toBeCloseTo(1.5, 12);
    expect(s.todayUsd).toBeCloseTo(1.5, 12);
    expect(s.burnUsdPerHour).toBeCloseTo(4.5, 12);
    expect(s.breakdown.day.map((b) => b.key)).toEqual(['2026-08-01']);
    expect(s.daily.slice(-2).map((b) => [b.key, b.costUsd])).toEqual([
      ['2026-07-31', 3],
      ['2026-08-01', 1.5],
    ]);
    // elapsed clamps to 1/24: forecast 1.5 + 36 * (31 - 1/24) = 1116 -> over-forecast ids use 2026-08
    expect(s.forecastMonthEndUsd).toBeCloseTo(1116, 9);
    expect(s.alerts.map((a) => a.id)).toEqual([
      'budget-2026-08-forecast-0.5',
      'budget-2026-08-forecast-over',
    ]);
  });

  it('keys local days correctly across DST transitions', () => {
    // window Oct 6 .. Nov 5 2026 spans the EU (Oct 25) and US (Nov 1) fall-back transitions
    const now = local(10, 5, 12);
    const r = [
      rec({ ts: local(9, 25, 1, 30), tokens: { output: 100_000 } }),
      rec({ ts: local(9, 25, 23, 30), tokens: { output: 100_000 } }),
      rec({ ts: local(10, 1, 0, 30), tokens: { output: 100_000 } }),
      rec({ ts: local(10, 1, 23, 30), tokens: { output: 100_000 } }),
      rec({ ts: local(9, 31, 23, 59), tokens: { output: 100_000 } }),
    ];
    const s = summarize(r, opts(now));
    expect(s.daily.map((b) => b.key)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
    const day = (k: string) => s.daily.find((b) => b.key === k)!;
    expect(day('2026-10-25').records).toBe(2);
    expect(day('2026-10-31').records).toBe(1);
    expect(day('2026-11-01').records).toBe(2);
    expect(day('2026-11-01').costUsd).toBeCloseTo(3, 12);
    expect(s.breakdown.day).toEqual([
      {
        key: '2026-11-01',
        costUsd: 3,
        records: 2,
        tokens: { input: 0, output: 200_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      },
    ]);
  });
});

describe('toBrief', () => {
  it('derives last-hour session and project burn', () => {
    const now = jul(15, 12);
    const r = [
      rec({ ts: jul(15, 11, 10), sessionId: 'A', repo: 'p1', tokens: { output: 100_000 } }), // 1.5
      rec({ ts: jul(15, 11, 50), sessionId: 'A', repo: 'p2', tokens: { input: 1_000_000 } }), // 3
      rec({ ts: jul(15, 11, 0), sessionId: '__proto__', repo: 'p1', tokens: { input: 500_000 } }), // 1.5
      rec({ ts: jul(15, 10, 59), sessionId: 'old', repo: 'p1', tokens: { input: 1_000_000 } }), // outside
      rec({ ts: jul(15, 11, 30), tokens: { input: 1_000_000 } }), // no keys, 3
    ];
    const budget = { monthlyUsd: 5, warnAt: [0.5] };
    const s = summarize(r, opts(now, budget));
    const b = toBrief(r, s, { now, table: PRICE_TABLE });
    expect(b.generatedAt).toBe(now);
    expect(b.monthToDateUsd).toBe(s.monthToDateUsd);
    expect(b.forecastMonthEndUsd).toBe(s.forecastMonthEndUsd);
    expect(b.budgetUsd).toBe(5);
    expect(b.burnUsdPerHour).toBeCloseTo(9, 12);
    expect(b.alerts).toBe(s.alerts);
    expect(Object.keys(b.sessionBurn).sort()).toEqual(['A', '__proto__']);
    expect(b.sessionBurn['A']).toBeCloseTo(4.5, 12);
    expect(Object.getOwnPropertyDescriptor(b.sessionBurn, '__proto__')!.value).toBeCloseTo(1.5, 12);
    expect(b.projectBurn).toEqual({ p1: 3, p2: 3 });
    expect(JSON.parse(JSON.stringify(b.sessionBurn))).toEqual(JSON.parse('{"A":4.5,"__proto__":1.5}'));
  });

  it('handles empty input and null budget', () => {
    const now = jul(15, 12);
    const b = toBrief([], summarize([], opts(now)), { now, table: PRICE_TABLE });
    expect(b).toEqual({
      generatedAt: now,
      monthToDateUsd: 0,
      forecastMonthEndUsd: 0,
      budgetUsd: null,
      burnUsdPerHour: 0,
      sessionBurn: {},
      projectBurn: {},
      alerts: [],
    });
  });
});

describe('review regressions', () => {
  it('excludes records dated after now from every figure', () => {
    const now = jul(15, 12);
    const base = [
      rec({ id: 'p1', ts: jul(15, 11, 30), repo: 'a', tokens: { output: 200_000 } }), // $3
      rec({ id: 'p2', ts: jul(10, 10), sessionId: 's', tokens: { output: 200_000 } }), // $3
    ];
    const future = [
      rec({ id: 'f1', ts: jul(15, 13), repo: 'z', sessionId: 's', tokens: { input: 100_000_000 } }), // $300 today
      rec({ id: 'f2', ts: jul(20), model: 'future-x', tokens: { input: 5 } }),
    ];
    const budget = { monthlyUsd: 10, warnAt: [0.5] };
    const s = summarize([...base, ...future], opts(now, budget));
    expect(s.monthToDateUsd).toBeCloseTo(6, 12);
    expect(s.todayUsd).toBeCloseTo(3, 12);
    expect(s.daily.reduce((a, b) => a + b.costUsd, 0)).toBeCloseTo(6, 12);
    expect(s.breakdown.repo.map((b) => b.key)).toEqual(['(none)', 'a']);
    expect(s.unpricedModels).toEqual([]);
    // mtd 6 >= 5 ; 7-day rate 6/7 -> forecast 6 + 6/7 * 16.5 = 141/7 = 20.14 >= 5 and >= 10
    expect(s.forecastMonthEndUsd).toBeCloseTo(141 / 7, 10);
    expect(s.alerts.map((a) => a.id)).toEqual([
      'budget-2026-07-mtd-0.5',
      'budget-2026-07-forecast-0.5',
      'budget-2026-07-forecast-over',
    ]);
    // session s = $3 of $6 (50%); the $300 future record is not counted
    expect(s.tips.map((t) => [t.id, t.title.includes('50%')])).toEqual([['session-share-s', true]]);
  });

  it('lists unpriced models only from current-month records without a vendor cost', () => {
    const now = jul(15, 12);
    const s = summarize(
      [
        rec({ ts: jul(3), model: 'mystery-now', tokens: { input: 10 } }),
        rec({ ts: local(5, 20), model: 'mystery-old', tokens: { input: 10 } }),
        rec({ ts: jul(4), model: 'vendor-billed-x', vendorCostUsd: 0 }),
      ],
      opts(now),
    );
    expect(s.unpricedModels).toEqual(['mystery-now']);
  });

  it('sessionBurn keeps only claude-code sessions; projectBurn keeps every source', () => {
    const now = jul(15, 12);
    const r = [
      rec({ ts: jul(15, 11, 30), sessionId: 'cc', repo: 'p1', tokens: { output: 100_000 } }), // 1.5
      rec({
        ts: jul(15, 11, 40),
        source: 'codex',
        model: 'gpt-5',
        sessionId: 'cx',
        repo: 'p2',
        tokens: { output: 100_000 },
      }), // 1.0
    ];
    const b = toBrief(r, summarize(r, opts(now)), { now, table: PRICE_TABLE });
    expect(b.sessionBurn).toEqual({ cc: 1.5 });
    expect(b.projectBurn).toEqual({ p1: 1.5, p2: 1 });
  });

  // November-end regression in America/New_York. Node only honours a runtime process.env.TZ change on
  // the main thread; vitest runs this file in a worker thread, where the assignment is a no-op. So:
  // set TZ, check it took effect via getTimezoneOffset, and if it did not, run this one test in a child
  // vitest process started with TZ=America/New_York (where it takes the direct path). Either way it runs.
  const NOV_END_TEST = 'uses the exact D-12 formula in the extra fall-back hour at November end';
  const tzActive = () =>
    new Date(2026, 10, 1, 0, 30).getTimezoneOffset() === 240 && // Nov 1 00:30 EDT
    new Date(2026, 10, 30, 23, 30).getTimezoneOffset() === 300; // Nov 30 23:30 EST
  let savedTz: string | undefined;
  beforeAll(() => {
    savedTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });
  it(
    NOV_END_TEST,
    () => {
      if (tzActive()) {
        // Nov 1 2026 00:00 EDT -> Nov 30 23:30 EST is 30 days + 30 min: elapsedDays = 30 + 1/48 > daysInMonth 30
        const now = local(10, 30, 23, 30);
        const r = [rec({ ts: local(10, 28, 12), source: 'copilot', model: 'gpt-4o', vendorCostUsd: 7 })];
        const s = summarize(r, opts(now));
        expect(s.monthToDateUsd).toBe(7);
        // dailyRate = 7 / 7 = 1 ; forecast = 7 + 1 * (30 - (30 + 1/48)) = 335/48
        expect(s.forecastMonthEndUsd).toBeCloseTo(335 / 48, 12);
        expect(s.forecastMonthEndUsd).toBeLessThan(7);
        return;
      }
      const require = createRequire(import.meta.url);
      const vitestBin = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
      const thisFile = fileURLToPath(import.meta.url);
      const root = join(dirname(thisFile), '..', '..', '..', '..');
      const res = spawnSync(
        process.execPath,
        [vitestBin, 'run', relative(root, thisFile), '-t', NOV_END_TEST, '--reporter', 'verbose'],
        { cwd: root, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8', timeout: 60_000 },
      );
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
      expect(res.status, out).toBe(0);
      // must have actually executed (not skipped / filtered out)
      expect(out).toMatch(/Tests\s+1 passed/);
    },
    90_000,
  );
});
