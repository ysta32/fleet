import { describe, expect, it } from 'vitest';
import type { PriceTable, UsageRecord, SpendTokens } from '../contracts.js';
import { findModel, priceRecord, normalizeModelId } from './engine.js';
import { PRICE_TABLE } from './table.js';

const ZERO: SpendTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

function rec(model: string, tokens: Partial<SpendTokens>, extra: Partial<UsageRecord> = {}): UsageRecord {
  return { id: 'x', source: 'claude-code', ts: 0, model, tokens: { ...ZERO, ...tokens }, ...extra };
}

describe('PRICE_TABLE', () => {
  it('has the expected version and unique ids', () => {
    expect(PRICE_TABLE.version).toBe('2026-10-01');
    const ids = PRICE_TABLE.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses Anthropic cache-write multipliers 1.25x (5m) and 2x (1h)', () => {
    for (const m of PRICE_TABLE.models.filter((x) => x.provider === 'anthropic')) {
      expect(m.cacheWrite5m).toBeCloseTo(m.input * 1.25, 10);
      expect(m.cacheWrite1h).toBeCloseTo(m.input * 2, 10);
    }
  });

  it('has current Anthropic headline rates', () => {
    const p = (id: string) => findModel(id)!;
    expect([p('claude-opus-5-5').input, p('claude-opus-5-5').output, p('claude-opus-5-5').cacheRead]).toEqual(
      [4, 20, 0.2],
    );
    expect([
      p('claude-sonnet-5-5').input,
      p('claude-sonnet-5-5').output,
      p('claude-sonnet-5-5').cacheRead,
    ]).toEqual([2, 10, 0.2]);
    expect([p('claude-haiku-5-5').input, p('claude-haiku-5-5').output]).toEqual([0.1, 0.5]);
    expect([
      p('claude-fable-5-1').input,
      p('claude-fable-5-1').output,
      p('claude-fable-5-1').cacheRead,
    ]).toEqual([10, 50, 0.25]);
  });
});

describe('priceRecord', () => {
  it('computes exact cost for a sonnet call with all five token kinds', () => {
    // claude-sonnet-4-6: in 3, out 15, read 0.3, w5m 3.75, w1h 6 ($/MTok)
    const r = rec('claude-sonnet-4-6', {
      input: 1_000_000,
      output: 100_000,
      cacheRead: 2_000_000,
      cacheWrite5m: 400_000,
      cacheWrite1h: 50_000,
    });
    // 3 + 1.5 + 0.6 + 1.5 + 0.3 = 6.9 (sonnet-4-6 has no long-context tier)
    const c = priceRecord(r);
    expect(c.priced).toBe(true);
    expect(c.modelId).toBe('claude-sonnet-4-6');
    expect(c.costUsd).toBeCloseTo(6.9, 10);
  });

  it('prices 1h cache writes at 2x input vs 5m at 1.25x', () => {
    const w5 = priceRecord(rec('claude-sonnet-5-5', { cacheWrite5m: 1_000_000 })).costUsd;
    const w1 = priceRecord(rec('claude-sonnet-5-5', { cacheWrite1h: 1_000_000 })).costUsd;
    expect(w5).toBeCloseTo(2.5, 10);
    expect(w1).toBeCloseTo(4, 10);
  });

  it('applies the long-context tier only above the threshold (input + cache tokens)', () => {
    // sonnet-4-5: base 3/15/0.3; >200K: 6/22.5/0.6/7.5/12
    const at = priceRecord(rec('claude-sonnet-4-5-20250929', { input: 200_000, output: 1_000 })).costUsd;
    expect(at).toBeCloseTo(0.6 + 0.015, 10);
    const over = priceRecord(
      rec('claude-sonnet-4-5-20250929', {
        input: 100_000,
        cacheRead: 100_000,
        cacheWrite1h: 1,
        output: 1_000,
      }),
    ).costUsd;
    expect(over).toBeCloseTo((100_000 * 6 + 100_000 * 0.6 + 1 * 12 + 1_000 * 22.5) / 1e6, 10);
    // haiku-5-5 tier at 100K
    const h = priceRecord(rec('claude-haiku-5-5', { input: 150_000, output: 10_000 })).costUsd;
    expect(h).toBeCloseTo((150_000 * 0.5 + 10_000 * 2.5) / 1e6, 10);
  });

  it('never applies the long-context tier to daily-aggregate API sources', () => {
    const tokens = { input: 5_000_000, output: 100_000 };
    for (const source of ['anthropic-api', 'openai-api'] as const) {
      const c = priceRecord(rec('claude-sonnet-4-5', tokens, { source }));
      expect(c.costUsd).toBeCloseTo(5 * 3 + 0.1 * 15, 10);
    }
    const g = priceRecord(rec('gemini-2.5-pro', { input: 1_000_000 }, { source: 'openai-api' }));
    expect(g.costUsd).toBeCloseTo(1.25, 10);
    // same tokens from a per-call source do get the tier
    expect(priceRecord(rec('claude-sonnet-4-5', tokens)).costUsd).toBeCloseTo(5 * 6 + 0.1 * 22.5, 10);
  });

  it('returns priced:false for unknown models', () => {
    expect(priceRecord(rec('llama-3-70b', { input: 1_000_000 }))).toEqual({ costUsd: 0, priced: false });
    expect(priceRecord(rec('', { input: 1 })).priced).toBe(false);
    // unknown future version of a known family is not silently priced as an older one
    expect(priceRecord(rec('claude-opus-4-9', { input: 1 })).priced).toBe(false);
    expect(priceRecord(rec('gpt-5.9', { input: 1 })).priced).toBe(false);
  });

  it('uses vendorCostUsd over engine pricing, even for unknown models', () => {
    const known = priceRecord(rec('claude-opus-5-5', { input: 1_000_000 }, { vendorCostUsd: 0.42 }));
    expect(known).toEqual({ costUsd: 0.42, priced: true, modelId: 'claude-opus-5-5' });
    const unknown = priceRecord(rec('mystery-model', {}, { vendorCostUsd: 1.5 }));
    expect(unknown).toEqual({ costUsd: 1.5, priced: true });
    expect(priceRecord(rec('mystery-model', {}, { vendorCostUsd: 0 }))).toEqual({ costUsd: 0, priced: true });
  });

  it('treats negative / non-finite token counts as zero', () => {
    const c = priceRecord(rec('claude-opus-5-5', { input: -5, output: Number.NaN, cacheRead: 1_000_000 }));
    expect(c.costUsd).toBeCloseTo(0.2, 10);
  });

  it('accepts a custom table', () => {
    const t: PriceTable = {
      version: 't',
      models: [
        {
          id: 'foo',
          provider: 'other',
          match: ['foo'],
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          tier: 1,
        },
      ],
    };
    expect(priceRecord(rec('foo-20260101', { input: 1_000_000, output: 1_000_000 }), t).costUsd).toBeCloseTo(
      3,
      10,
    );
    expect(priceRecord(rec('claude-opus-5-5', { input: 1 }), t).priced).toBe(false);
  });
});

describe('findModel', () => {
  const cases: [string, string][] = [
    ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['claude-opus-4-1-20250805', 'claude-opus-4-1'],
    ['claude-opus-4-20250514', 'claude-opus-4-0'],
    ['claude-sonnet-4-20250514', 'claude-sonnet-4-0'],
    ['claude-opus-4-5@20251101', 'claude-opus-4-5'],
    ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'claude-3-5-sonnet'],
    ['us.anthropic.claude-opus-4-6-v1', 'claude-opus-4-6'],
    ['claude-3-5-haiku-20241022', 'claude-3-5-haiku'],
    ['claude-3-haiku-20240307', 'claude-3-haiku'],
    ['Claude-Opus-5-5[1m]', 'claude-opus-5-5'],
    ['claude-sonnet-4-6[1M]', 'claude-sonnet-4-6'],
    ['claude-opus-5', 'claude-opus-5'],
    ['claude-fable-5', 'claude-fable-5'],
    ['claude-fable-5-1', 'claude-fable-5-1'],
    ['claude-4.5-sonnet-thinking', 'claude-sonnet-4-5'],
    ['claude-4.1-opus', 'claude-opus-4-1'],
    ['gpt-5', 'gpt-5'],
    ['gpt-5-2025-08-07', 'gpt-5'],
    ['gpt-5-codex', 'gpt-5-codex'],
    ['gpt-5.1-codex-mini', 'gpt-5-1-codex-mini'],
    ['gpt-5.1-codex', 'gpt-5-1'],
    ['gpt-5-mini', 'gpt-5-mini'],
    ['gpt-5-pro', 'gpt-5-pro'],
    ['openai/gpt-4.1-mini', 'gpt-4-1-mini'],
    ['gpt-4o-2024-08-06', 'gpt-4o'],
    ['gpt-4o-mini', 'gpt-4o-mini'],
    ['o3', 'o3'],
    ['o3-mini', 'o3-mini'],
    ['o4-mini-2025-04-16', 'o4-mini'],
    // OpenAI substring-collision regressions
    ['codex-mini-latest', 'codex-mini-latest'],
    ['codex-mini', 'codex-mini-latest'],
    ['gpt-5-codex-mini', 'gpt-5-codex-mini'],
    ['gpt-5.1-codex-max', 'gpt-5-1'],
    ['gpt-5.2-codex', 'gpt-5-2'],
    ['gpt-5-nano-2025-08-07', 'gpt-5-nano'],
    ['gpt-5-pro-2025-10-06', 'gpt-5-pro'],
    ['gpt-5-chat-latest', 'gpt-5'],
    ['o4-mini', 'o4-mini'],
    ['gpt-4o-mini-2024-07-18', 'gpt-4o-mini'],
    ['gpt-4o', 'gpt-4o'],
    ['gpt-4.1', 'gpt-4-1'],
    ['gpt-4.1-2025-04-14', 'gpt-4-1'],
    ['gpt-4.1-mini-2025-04-14', 'gpt-4-1-mini'],
    ['gpt-4.1-nano', 'gpt-4-1-nano'],
    ['o1', 'o1'],
    ['o1-mini', 'o3-mini'],
    ['o1-pro', 'o1-pro'],
    ['o3-pro-2025-06-10', 'o3-pro'],
    ['o3-mini-high', 'o3-mini'],
    ['o3-2025-04-16', 'o3'],
    ['claude-opus-4-0', 'claude-opus-4-0'],
    ['claude-sonnet-4-0', 'claude-sonnet-4-0'],
    ['gpt-5-codex-mini-2025-11-07', 'gpt-5-codex-mini'],
    ['gemini-2.5-pro', 'gemini-2-5-pro'],
    ['gemini-2.5-flash-lite', 'gemini-2-5-flash-lite'],
    ['models/gemini-2.5-flash', 'gemini-2-5-flash'],
  ];
  it.each(cases)('%s -> %s', (raw, id) => {
    expect(findModel(raw)?.id).toBe(id);
  });

  it('every match string resolves to its own entry (no substring collisions)', () => {
    for (const m of PRICE_TABLE.models) {
      for (const s of m.match) expect([s, findModel(s)?.id]).toEqual([s, m.id]);
    }
  });

  it('prices codex-mini-latest at its own rates, not GPT-5 Mini', () => {
    const c = priceRecord(
      rec('codex-mini-latest', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000 }),
    );
    expect(c.modelId).toBe('codex-mini-latest');
    expect(c.costUsd).toBeCloseTo(1.5 + 6 + 0.375, 10);
  });

  it('never resolves a -pro id to a non-pro entry', () => {
    for (const raw of ['gpt-5.2-pro', 'gpt-5-1-pro', 'gpt-4o-pro', 'o4-mini-pro', 'claude-sonnet-4-5-pro']) {
      expect(findModel(raw)).toBeUndefined();
      expect(priceRecord(rec(raw, { input: 1 })).priced).toBe(false);
    }
    expect(findModel('gpt-5-pro')?.id).toBe('gpt-5-pro');
    expect(findModel('o3-pro')?.id).toBe('o3-pro');
    expect(findModel('gemini-2.5-pro-preview-06-05')?.id).toBe('gemini-2-5-pro');
  });

  it('does not match inside other words', () => {
    expect(findModel('foo1')).toBeUndefined();
    expect(findModel('pro3')).toBeUndefined();
    expect(findModel('gpt-5o')).toBeUndefined();
  });

  it('assigns tiers', () => {
    expect(findModel('claude-opus-5-5')?.tier).toBe(3);
    expect(findModel('claude-sonnet-5-5')?.tier).toBe(2);
    expect(findModel('claude-haiku-5-5')?.tier).toBe(1);
    expect(findModel('gpt-5-pro')?.tier).toBe(3);
    expect(findModel('gpt-5')?.tier).toBe(2);
    expect(findModel('gpt-5-mini')?.tier).toBe(1);
  });

  it('normalizes ids', () => {
    expect(normalizeModelId(' Claude-4.5-Sonnet[1m] ')).toBe('claude-4-5-sonnet');
  });
});
