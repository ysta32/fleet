import type { ModelPrice, PriceTable, PricedCost, SpendTokens, UsageRecord } from '../contracts.js';
import { PRICE_TABLE } from './table.js';

/**
 * Normalize a raw model id for matching: lowercase, drop bracketed suffixes such as "[1m]",
 * and treat "." as "-" so "claude-4.5-sonnet" / "gpt-4.1" / "gemini-2.5-pro" line up with table ids.
 */
export function normalizeModelId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\./g, '-')
    .trim();
}

interface Matcher {
  needle: string;
  model: ModelPrice;
}

const compiled = new WeakMap<PriceTable, Matcher[]>();

function matchersFor(table: PriceTable): Matcher[] {
  let list = compiled.get(table);
  if (!list) {
    list = [];
    for (const model of table.models) {
      for (const s of model.match) {
        const needle = normalizeModelId(s);
        if (needle) list.push({ needle, model });
      }
    }
    // longest needle first; first hit wins
    list.sort((a, b) => b.needle.length - a.needle.length);
    compiled.set(table, list);
  }
  return list;
}

/** needles must sit on token boundaries (no alphanumeric char immediately before or after) */
const ALNUM = /[a-z0-9]/;
/** a short numeric version segment right after the needle means a different (unknown) model version */
const VERSION_TAIL = /^-\d{1,2}(?!\d)/;

function hitAt(id: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = id.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : id[i - 1]!;
    const tail = id.slice(i + needle.length);
    const after = tail.charAt(0);
    if (!ALNUM.test(before) && !ALNUM.test(after) && !VERSION_TAIL.test(tail)) return true;
    from = i + 1;
  }
}

/** Longest-substring match of a raw model id against the table. */
export function findModel(model: string, table: PriceTable = PRICE_TABLE): ModelPrice | undefined {
  if (typeof model !== 'string') return undefined;
  const id = normalizeModelId(model);
  if (!id) return undefined;
  for (const { needle, model: price } of matchersFor(table)) {
    if (hitAt(id, needle)) return price;
  }
  return undefined;
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Sources whose records are daily aggregates: per-call long-context tiers never apply (D-05). */
const AGGREGATE_SOURCES = new Set<UsageRecord['source']>(['anthropic-api', 'openai-api']);

export function costForTokens(price: ModelPrice, tokens: SpendTokens, allowLongContext = true): number {
  const input = n(tokens.input);
  const output = n(tokens.output);
  const cacheRead = n(tokens.cacheRead);
  const w5 = n(tokens.cacheWrite5m);
  const w1 = n(tokens.cacheWrite1h);
  const lc = price.longContext;
  const rates = allowLongContext && lc && input + cacheRead + w5 + w1 > lc.thresholdTokens ? lc : price;
  return (
    (input * rates.input +
      output * rates.output +
      cacheRead * rates.cacheRead +
      w5 * rates.cacheWrite5m +
      w1 * rates.cacheWrite1h) /
    1_000_000
  );
}

export function priceRecord(r: UsageRecord, table: PriceTable = PRICE_TABLE): PricedCost {
  const price = findModel(r.model, table);
  const modelId = price?.id;
  if (typeof r.vendorCostUsd === 'number' && Number.isFinite(r.vendorCostUsd)) {
    return { costUsd: r.vendorCostUsd, priced: true, ...(modelId ? { modelId } : {}) };
  }
  if (!price) return { costUsd: 0, priced: false };
  const tokens = r.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  return {
    costUsd: costForTokens(price, tokens, !AGGREGATE_SOURCES.has(r.source)),
    priced: true,
    modelId,
  };
}
