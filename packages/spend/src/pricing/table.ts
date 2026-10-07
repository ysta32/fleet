import type { ModelPrice, PriceTable } from '../contracts.js';

/** USD per million tokens. Bump PRICE_TABLE.version on any change. */

type Rates = Pick<ModelPrice, 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h'>;

/** Anthropic multipliers: 5m cache write = 1.25x input, 1h cache write = 2x input. */
function anth(input: number, output: number, cacheRead: number): Rates {
  return { input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 };
}

/** OpenAI / Google: no separate write premium; cache writes bill as ordinary input. */
function flat(input: number, output: number, cacheRead: number): Rates {
  return { input, output, cacheRead, cacheWrite5m: input, cacheWrite1h: input };
}

function m(
  id: string,
  provider: ModelPrice['provider'],
  tier: ModelPrice['tier'],
  match: string[],
  rates: Rates,
  longContext?: ModelPrice['longContext'],
): ModelPrice {
  return { id, provider, tier, match, ...rates, ...(longContext ? { longContext } : {}) };
}

/* -------------------------------------------------------------------------------------------------
 * SOURCE (anthropic): Anthropic pricing as published in the claude-api skill model/caching reference,
 * as of 2026-10-06. Cache read 0.1x input except Fable 5.1 / Mythos 5.1 (0.025x, $0.25) and
 * Opus 5.5 (0.05x, $0.20). Cache write 1.25x (5m) / 2x (1h). Long-context tiers: Haiku 5.5 above
 * 100K prompt tokens ($0.50/$2.50); Sonnet 4.5 / Sonnet 4 above 200K ($6/$22.50). Opus 4.6+ and
 * Sonnet 4.6+ have 1M context at standard pricing. Legacy (Opus 4/4.1, Haiku 3/3.5, 3.x) rates are
 * the last published list prices.
 * ------------------------------------------------------------------------------------------------- */
const ANTHROPIC: ModelPrice[] = [
  m('claude-fable-5-1', 'anthropic', 3, ['claude-fable-5-1'], anth(10, 50, 0.25)),
  m('claude-mythos-5-1', 'anthropic', 3, ['claude-mythos-5-1'], anth(10, 50, 0.25)),
  m('claude-fable-5', 'anthropic', 3, ['claude-fable-5'], anth(10, 50, 1)),
  m('claude-mythos-5', 'anthropic', 3, ['claude-mythos-5', 'claude-mythos-preview'], anth(10, 50, 1)),
  m('claude-opus-5-5', 'anthropic', 3, ['claude-opus-5-5', 'claude-5-5-opus'], anth(4, 20, 0.2)),
  m('claude-opus-5', 'anthropic', 3, ['claude-opus-5', 'claude-5-opus'], anth(5, 25, 0.5)),
  m('claude-opus-4-8', 'anthropic', 3, ['claude-opus-4-8', 'claude-4-8-opus'], anth(5, 25, 0.5)),
  m('claude-opus-4-7', 'anthropic', 3, ['claude-opus-4-7', 'claude-4-7-opus'], anth(5, 25, 0.5)),
  m('claude-opus-4-6', 'anthropic', 3, ['claude-opus-4-6', 'claude-4-6-opus'], anth(5, 25, 0.5)),
  m('claude-opus-4-5', 'anthropic', 3, ['claude-opus-4-5', 'claude-4-5-opus'], anth(5, 25, 0.5)),
  m('claude-opus-4-1', 'anthropic', 3, ['claude-opus-4-1', 'claude-4-1-opus'], anth(15, 75, 1.5)),
  m(
    'claude-opus-4-0',
    'anthropic',
    3,
    ['claude-opus-4', 'claude-opus-4-0', 'claude-4-opus'],
    anth(15, 75, 1.5),
  ),
  m('claude-3-opus', 'anthropic', 3, ['claude-3-opus'], anth(15, 75, 1.5)),
  m('claude-sonnet-5-5', 'anthropic', 2, ['claude-sonnet-5-5', 'claude-5-5-sonnet'], anth(2, 10, 0.2)),
  m('claude-sonnet-5', 'anthropic', 2, ['claude-sonnet-5', 'claude-5-sonnet'], anth(2, 10, 0.2)),
  m('claude-sonnet-4-6', 'anthropic', 2, ['claude-sonnet-4-6', 'claude-4-6-sonnet'], anth(3, 15, 0.3)),
  m('claude-sonnet-4-5', 'anthropic', 2, ['claude-sonnet-4-5', 'claude-4-5-sonnet'], anth(3, 15, 0.3), {
    thresholdTokens: 200_000,
    ...anth(6, 22.5, 0.6),
  }),
  m(
    'claude-sonnet-4-0',
    'anthropic',
    2,
    ['claude-sonnet-4', 'claude-sonnet-4-0', 'claude-4-sonnet'],
    anth(3, 15, 0.3),
    {
      thresholdTokens: 200_000,
      ...anth(6, 22.5, 0.6),
    },
  ),
  m('claude-3-7-sonnet', 'anthropic', 2, ['claude-3-7-sonnet'], anth(3, 15, 0.3)),
  m('claude-3-5-sonnet', 'anthropic', 2, ['claude-3-5-sonnet'], anth(3, 15, 0.3)),
  m('claude-haiku-5-5', 'anthropic', 1, ['claude-haiku-5-5', 'claude-5-5-haiku'], anth(0.1, 0.5, 0.01), {
    thresholdTokens: 100_000,
    ...anth(0.5, 2.5, 0.05),
  }),
  m('claude-haiku-4-5', 'anthropic', 1, ['claude-haiku-4-5', 'claude-4-5-haiku'], anth(1, 5, 0.1)),
  m('claude-3-5-haiku', 'anthropic', 1, ['claude-3-5-haiku'], anth(0.8, 4, 0.08)),
  m('claude-3-haiku', 'anthropic', 1, ['claude-3-haiku'], anth(0.25, 1.25, 0.03)),
];

/* -------------------------------------------------------------------------------------------------
 * SOURCE (openai): OpenAI API pricing page (platform.openai.com/docs/pricing), best known list
 * prices as of 2026-10-01 — UNVERIFIED, from memory; confirm before relying on them. Cached input
 * is the "cached input" column; OpenAI has no cache-write premium (writes bill as input).
 * ------------------------------------------------------------------------------------------------- */
const OPENAI: ModelPrice[] = [
  m('gpt-5-pro', 'openai', 3, ['gpt-5-pro'], flat(15, 120, 15)),
  m('gpt-5-2', 'openai', 2, ['gpt-5-2', 'gpt-5-2-codex'], flat(1.75, 14, 0.175)),
  m('gpt-5-1', 'openai', 2, ['gpt-5-1', 'gpt-5-1-codex', 'gpt-5-1-codex-max'], flat(1.25, 10, 0.125)),
  m('gpt-5-1-codex-mini', 'openai', 1, ['gpt-5-1-codex-mini'], flat(0.25, 2, 0.025)),
  m('gpt-5-codex', 'openai', 2, ['gpt-5-codex'], flat(1.25, 10, 0.125)),
  m('gpt-5', 'openai', 2, ['gpt-5'], flat(1.25, 10, 0.125)),
  m('gpt-5-mini', 'openai', 1, ['gpt-5-mini'], flat(0.25, 2, 0.025)),
  m('gpt-5-codex-mini', 'openai', 1, ['gpt-5-codex-mini'], flat(0.25, 2, 0.025)),
  // codex-mini-latest (o4-mini based Codex CLI model) has its own, higher rates
  m('codex-mini-latest', 'openai', 1, ['codex-mini'], flat(1.5, 6, 0.375)),
  m('gpt-5-nano', 'openai', 1, ['gpt-5-nano'], flat(0.05, 0.4, 0.005)),
  m('o3-pro', 'openai', 3, ['o3-pro'], flat(20, 80, 20)),
  m('o1-pro', 'openai', 3, ['o1-pro'], flat(150, 600, 150)),
  m('o1', 'openai', 3, ['o1'], flat(15, 60, 7.5)),
  m('o3', 'openai', 2, ['o3'], flat(2, 8, 0.5)),
  m('o3-mini', 'openai', 1, ['o3-mini', 'o1-mini'], flat(1.1, 4.4, 0.55)),
  m('o4-mini', 'openai', 1, ['o4-mini'], flat(1.1, 4.4, 0.275)),
  m('gpt-4-1', 'openai', 2, ['gpt-4-1'], flat(2, 8, 0.5)),
  m('gpt-4-1-mini', 'openai', 1, ['gpt-4-1-mini'], flat(0.4, 1.6, 0.1)),
  m('gpt-4-1-nano', 'openai', 1, ['gpt-4-1-nano'], flat(0.1, 0.4, 0.025)),
  m('gpt-4o', 'openai', 2, ['gpt-4o'], flat(2.5, 10, 1.25)),
  m('gpt-4o-mini', 'openai', 1, ['gpt-4o-mini'], flat(0.15, 0.6, 0.075)),
];

/* -------------------------------------------------------------------------------------------------
 * SOURCE (google): Gemini API pricing (ai.google.dev/gemini-api/docs/pricing), best known paid-tier
 * list prices as of 2026-10-01 — UNVERIFIED, from memory. Cache storage fees are not modelled;
 * cache writes bill as input. 2.5 Pro has a >200K prompt tier.
 * ------------------------------------------------------------------------------------------------- */
const GOOGLE: ModelPrice[] = [
  m('gemini-2-5-pro', 'google', 2, ['gemini-2-5-pro'], flat(1.25, 10, 0.125), {
    thresholdTokens: 200_000,
    ...flat(2.5, 15, 0.25),
  }),
  m('gemini-2-5-flash', 'google', 1, ['gemini-2-5-flash'], flat(0.3, 2.5, 0.03)),
  m('gemini-2-5-flash-lite', 'google', 1, ['gemini-2-5-flash-lite'], flat(0.1, 0.4, 0.01)),
];

export const PRICE_TABLE: PriceTable = {
  version: '2026-10-01',
  models: [...ANTHROPIC, ...OPENAI, ...GOOGLE],
};
