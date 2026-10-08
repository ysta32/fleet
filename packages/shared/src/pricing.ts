import type { ModelFamily, TokenUsage } from './types.js';

/** USD per million tokens. Cache writes bill at 1.25x input (5m TTL). */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
}

/** Fallback when a model id has no versioned entry below: the current generation of each family. */
const FAMILY_PRICING: Record<ModelFamily, Rates> = {
  opus: { input: 5, output: 25, cacheRead: 0.5 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheRead: 0.1 },
  fable: { input: 10, output: 50, cacheRead: 1 },
  astra: { input: 1.25, output: 10, cacheRead: 0.125 },
  unknown: { input: 3, output: 15, cacheRead: 0.3 },
};

/**
 * Per-version Anthropic list prices, kept in step with fleet-spend's PRICE_TABLE (a test there
 * checks it). Rates changed across versions (Opus 4.5 cut Opus from $15/$75 to $5/$25), so the
 * family alone is not enough.
 */
const VERSIONED: [prefix: string, rates: Rates][] = (
  [
    ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
    ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
    ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
    ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
    ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
    ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
    ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
    ['claude-opus-4-5', { input: 5, output: 25, cacheRead: 0.5 }],
    ['claude-opus-4-1', { input: 15, output: 75, cacheRead: 1.5 }],
    ['claude-opus-4', { input: 15, output: 75, cacheRead: 1.5 }],
    ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
    ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
    ['claude-sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3 }],
    ['claude-sonnet-4-5', { input: 3, output: 15, cacheRead: 0.3 }],
    ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.3 }],
    ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
    ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
  ] as [string, Rates][]
).sort((a, b) => b[0].length - a[0].length);

/** a short numeric segment after a prefix means a different, unlisted version ("-4-9" after "claude-opus-4") */
const VERSION_TAIL = /^-\d{1,2}(?!\d)/;

function ratesFor(modelId: string | undefined): Rates {
  const id = (modelId ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\./g, '-')
    .trim();
  for (const [prefix, rates] of VERSIONED) {
    if (!id.startsWith(prefix)) continue;
    const tail = id.slice(prefix.length);
    if (/^[a-z0-9]/.test(tail) || VERSION_TAIL.test(tail)) continue;
    return rates;
  }
  return FAMILY_PRICING[modelFamily(id)];
}

export const ZERO_TOKENS: TokenUsage = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export function modelFamily(modelId?: string): ModelFamily {
  const id = modelId?.toLowerCase() ?? '';
  for (const family of ['opus', 'sonnet', 'haiku', 'fable'] as const) {
    if (id.startsWith(`claude-${family}`)) return family;
  }
  if (/^(gpt|codex|astra)/.test(id)) return 'astra';
  return 'unknown';
}

export function estimateCostUsd(modelId: string | undefined, t: TokenUsage): number {
  const price = ratesFor(modelId);
  return (
    (t.input * price.input +
      t.output * price.output +
      t.cacheRead * price.cacheRead +
      t.cacheWrite * price.input * 1.25) /
    1_000_000
  );
}

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}
