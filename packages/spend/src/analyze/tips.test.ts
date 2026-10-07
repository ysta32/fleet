import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../contracts.js';
import { PRICE_TABLE } from '../pricing/table.js';
import { savingsTips } from './tips.js';

// Synthetic records only. July 2026 has no DST transition in common zones, so local-time math is stable.
const at = (d: number, h = 12, min = 0) => new Date(2026, 6, d, h, min).getTime();
// now = Jul 16 12:00 local -> elapsedDays 15.5, extrapolation factor 31 / 15.5 = 2
const NOW = at(16);

let seq = 0;
function rec(p: Partial<UsageRecord> & { model: string; ts: number }): UsageRecord {
  return {
    id: `t:${++seq}`,
    source: 'claude-code',
    ...p,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...p.tokens },
  };
}
const opusCall = (task: string, ts: number, input = 100_000, output = 1000) =>
  rec({ model: 'claude-opus-4-7', ts, task, tokens: { input, output } as UsageRecord['tokens'] });

describe('savingsTips', () => {
  it('returns [] for empty input', () => {
    expect(savingsTips([], PRICE_TABLE, NOW)).toEqual([]);
  });

  it('produces each tip kind with hand-computed estimates, sorted desc', () => {
    const records: UsageRecord[] = [
      // (a) task T1: 3 opus-4-7 calls, 100k in / 1k out => 0.525 each, 1.575 total.
      // Tier-2 floor alternative = sonnet-4-6 (first $3/$15 model): 0.315 each, 0.945 total.
      // MTD saving 0.63 -> monthly 1.26
      opusCall('T1', at(3)),
      opusCall('T1', at(4)),
      opusCall('T1', at(5)),
      // (b) sonnet-4-6 2M input, 0 cache read: shift 1M tokens at (3 - 0.3 - 0.75) = 1.95/M -> 1.95 MTD -> 3.9
      rec({ model: 'claude-sonnet-4-6', ts: at(6), tokens: { input: 2_000_000 } as UsageRecord['tokens'] }),
      // (c) haiku-4-5 1M 1h writes: premium (2 - 1.25) = 0.75 MTD -> 1.5 ; costs $2
      rec({
        model: 'claude-haiku-4-5',
        ts: at(7),
        sessionId: 'S2',
        tokens: { cacheWrite1h: 1_000_000 } as UsageRecord['tokens'],
      }),
      // (d) copilot opus-4-7 $10 vendor cost of $11 copilot total; 1M input: opus $5 vs sonnet-4-6 $3
      // ratio 0.6 -> saving 4 MTD -> 8
      rec({
        model: 'claude-opus-4-7',
        source: 'copilot',
        ts: at(8),
        sessionId: 'S1',
        vendorCostUsd: 10,
        tokens: { input: 1_000_000 } as UsageRecord['tokens'],
      }),
      rec({ model: 'gpt-4o-mini', source: 'copilot', ts: at(8), vendorCostUsd: 1 }),
      // previous month: ignored entirely
      opusCall('OLD', new Date(2026, 5, 30, 12).getTime(), 9_000_000),
      opusCall('OLD', new Date(2026, 5, 30, 13).getTime(), 9_000_000),
      opusCall('OLD', new Date(2026, 5, 30, 14).getTime(), 9_000_000),
    ];
    const tips = savingsTips(records, PRICE_TABLE, NOW);
    expect(tips.map((t) => t.id)).toEqual([
      'copilot-model-claude-opus-4-7',
      'cache-ratio-claude-sonnet-4-6',
      'cache-1h-claude-haiku-4-5',
      'tier-task-T1-claude-opus-4-7',
      // (e) S1 = 10 of 20.575 MTD (48.6%); no saving can be derived -> 0
      'session-share-S1',
    ]);
    const est = tips.map((t) => t.estMonthlySavingsUsd);
    expect(est[0]).toBeCloseTo(8, 9);
    expect(est[1]).toBeCloseTo(3.9, 9);
    expect(est[2]).toBeCloseTo(1.5, 9);
    expect(est[3]).toBeCloseTo(1.26, 9);
    expect(est[4]).toBe(0);
    // each tip names its dimension key
    expect(tips[0]!.detail).toContain('model claude-opus-4-7');
    expect(tips[3]!.title).toContain('task T1');
    expect(tips[3]!.title).toContain('claude-sonnet-4-6');
    expect(tips[4]!.title).toContain('S1');
    expect(tips[4]!.title).toContain('49%');
    for (const t of tips) {
      expect(t.title.length).toBeLessThanOrEqual(80);
      expect(t.detail.length).toBeLessThanOrEqual(200);
      expect(t.detail.toLowerCase()).not.toContain('multiplier');
    }
  });

  it('skips tier tips for high-output or too-few-call groups and for sessions with one session only', () => {
    const records = [
      // median output 2000 >= 1500
      // (total prompt 800k stays under the 1M cache-ratio floor)
      opusCall('BIG', at(3), 200_000, 2000),
      opusCall('BIG', at(4), 200_000, 2000),
      opusCall('BIG', at(5), 200_000, 1000),
      // only two calls
      opusCall('FEW', at(3), 100_000),
      opusCall('FEW', at(4), 100_000),
    ];
    expect(savingsTips(records, PRICE_TABLE, NOW)).toEqual([]);
  });

  it('caps at 8 tips', () => {
    const records: UsageRecord[] = [];
    // task Tk: 3 calls of k*100k input + k*100k cache read (ratio 0.5, so no cache tip), 0 output:
    // opus 0.5k + 0.05k = 0.55k vs sonnet-4-6 0.3k + 0.03k = 0.33k per call (sonnet-4-5's >200K tier
    // makes it dearer than opus, so it is not a candidate) -> saving 0.66k MTD -> 1.32k monthly
    for (let k = 1; k <= 10; k++)
      for (let c = 0; c < 3; c++)
        records.push(
          rec({
            model: 'claude-opus-4-7',
            ts: at(2 + c),
            task: `T${k}`,
            tokens: { input: k * 100_000, cacheRead: k * 100_000 } as UsageRecord['tokens'],
          }),
        );
    const tips = savingsTips(records, PRICE_TABLE, NOW);
    expect(tips).toHaveLength(8);
    expect(tips[0]!.id).toBe('tier-task-T10-claude-opus-4-7');
    expect(tips[0]!.estMonthlySavingsUsd).toBeCloseTo(13.2, 9);
    expect(tips[7]!.id).toBe('tier-task-T3-claude-opus-4-7');
    expect(tips[7]!.estMonthlySavingsUsd).toBeCloseTo(3.96, 9);
  });

  it('extrapolates with at least one elapsed day', () => {
    // now = Jul 1 06:00 -> elapsed 0.25 day, clamped to 1 -> factor 31
    const now = new Date(2026, 6, 1, 6).getTime();
    const ts = new Date(2026, 6, 1, 1).getTime();
    const tips = savingsTips(
      [rec({ model: 'claude-haiku-4-5', ts, tokens: { cacheWrite1h: 1_000_000 } as UsageRecord['tokens'] })],
      PRICE_TABLE,
      now,
    );
    expect(tips).toHaveLength(1);
    expect(tips[0]!.estMonthlySavingsUsd).toBeCloseTo(0.75 * 31, 9);
  });
});
