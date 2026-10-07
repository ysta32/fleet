import type { ModelFamily, TokenUsage } from './types.js';

const PRICING: Record<ModelFamily, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
  fable: { input: 15, output: 75 },
  astra: { input: 1.25, output: 10 },
  unknown: { input: 3, output: 15 },
};

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
  const price = PRICING[modelFamily(modelId)];
  return (
    (t.input * price.input +
      t.output * price.output +
      t.cacheRead * price.input * 0.1 +
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
