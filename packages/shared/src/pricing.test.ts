import { describe, expect, it } from 'vitest';
import { addTokens, estimateCostUsd, modelFamily, ZERO_TOKENS } from './index.js';

describe('modelFamily', () => {
  it.each([
    ['claude-opus-4-1', 'opus'],
    ['claude-sonnet-4-5', 'sonnet'],
    ['claude-haiku-4-5', 'haiku'],
    ['claude-fable-preview', 'fable'],
    ['gpt-6', 'astra'],
    ['codex-mini', 'astra'],
    ['astra', 'astra'],
    ['CLAUDE-OPUS-4', 'opus'],
    ['unrecognized', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ])('classifies %s as %s', (id, family) => {
    expect(modelFamily(id)).toBe(family);
  });
});

describe('estimateCostUsd', () => {
  it.each([
    ['claude-opus-4', 15, 75, 1.5],
    ['claude-opus-4-1-20250805', 15, 75, 1.5],
    ['claude-opus-4-5-20251101', 5, 25, 0.5],
    ['claude-opus-4-7', 5, 25, 0.5],
    ['claude-opus-4-7[1m]', 5, 25, 0.5],
    ['claude-opus-5-5', 4, 20, 0.2],
    ['claude-opus-4-9', 5, 25, 0.5],
    ['claude-opus', 5, 25, 0.5],
    ['claude-sonnet-4', 3, 15, 0.3],
    ['claude-sonnet-5-5', 2, 10, 0.2],
    ['claude-haiku-4', 1, 5, 0.1],
    ['claude-haiku-4-5', 1, 5, 0.1],
    ['claude-fable', 10, 50, 1],
    ['claude-fable-5-1', 10, 50, 0.25],
    ['gpt-6', 1.25, 10, 0.125],
    ['codex-mini', 1.25, 10, 0.125],
    ['astra', 1.25, 10, 0.125],
    ['unrecognized', 3, 15, 0.3],
    [undefined, 3, 15, 0.3],
  ] as const)('prices each token category for %s', (id, input, output, cacheRead) => {
    expect(estimateCostUsd(id, { ...ZERO_TOKENS, input: 1_000_000 })).toBe(input);
    expect(estimateCostUsd(id, { ...ZERO_TOKENS, output: 1_000_000 })).toBe(output);
    expect(estimateCostUsd(id, { ...ZERO_TOKENS, cacheRead: 1_000_000 })).toBeCloseTo(cacheRead);
    expect(estimateCostUsd(id, { ...ZERO_TOKENS, cacheWrite: 1_000_000 })).toBeCloseTo(input * 1.25);
    expect(estimateCostUsd(id, ZERO_TOKENS)).toBe(0);
  });

  it('sums mixed token categories in dollars', () => {
    expect(
      estimateCostUsd('claude-sonnet-4', {
        input: 1000,
        output: 2000,
        cacheRead: 3000,
        cacheWrite: 4000,
      }),
    ).toBeCloseTo(0.0489);
  });
});

describe('addTokens', () => {
  it('adds every category without mutating either operand', () => {
    const a = Object.freeze({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
    const b = Object.freeze({ input: 5, output: 6, cacheRead: 7, cacheWrite: 8 });
    expect(addTokens(a, b)).toEqual({ input: 6, output: 8, cacheRead: 10, cacheWrite: 12 });
    expect(addTokens(a, ZERO_TOKENS)).toEqual(a);
    expect(addTokens(a, ZERO_TOKENS)).not.toBe(a);
    expect(ZERO_TOKENS).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(Object.isFrozen(ZERO_TOKENS)).toBe(true);
  });
});
