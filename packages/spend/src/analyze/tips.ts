import type { SavingsTip } from '@fleet/shared';
import type { ModelPrice, PriceTable, SpendTokens, UsageRecord } from '../contracts.js';
import { costForTokens, findModel, priceRecord } from '../pricing/engine.js';

/* ------------------------------------------------------------------------------------------------
 * Shared, pure period helpers (also used by summarize.ts). All calendar math is in LOCAL time and
 * built with the Date(y, m, d) constructor so day/month keys stay correct across DST transitions.
 * ------------------------------------------------------------------------------------------------ */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface MonthPeriod {
  /** local midnight of the 1st of the month containing `now` */
  start: number;
  /** local midnight of the 1st of the following month */
  end: number;
  /** calendar days in the month (28-31) */
  daysInMonth: number;
  /** (now - start) / 86400000, fractional, at least 1/24 */
  elapsedDays: number;
  /** "YYYY-MM" */
  key: string;
}

function pad2(v: number): string {
  return v < 10 ? `0${v}` : String(v);
}

export function monthPeriod(now: number): MonthPeriod {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = new Date(y, m, 1).getTime();
  const end = new Date(y, m + 1, 1).getTime();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const elapsedDays = Math.max((now - start) / DAY_MS, 1 / 24);
  return { start, end, daysInMonth, elapsedDays, key: `${y}-${pad2(m + 1)}` };
}

/** Local calendar day key YYYY-MM-DD. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Drop records without a finite timestamp and duplicate ids (first occurrence wins). */
export function dedupeRecords(records: readonly UsageRecord[]): UsageRecord[] {
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const r of records) {
    if (!r || typeof r.ts !== 'number' || !Number.isFinite(r.ts)) continue;
    if (typeof r.id === 'string' && r.id !== '') {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
    }
    out.push(r);
  }
  return out;
}

/** Non-negative finite token count (mirrors the engine's sanitising). */
export function tok(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Savings tips
 * ------------------------------------------------------------------------------------------------ */

/** Minimum elapsed days used when extrapolating month-to-date savings. */
export const MIN_EXTRAPOLATION_DAYS = 3;
/** Tips below this estimated monthly saving are noise and are dropped. */
export const MIN_TIP_USD = 1;
/** Max tips returned. */
export const MAX_TIPS = 8;
/** (a) a call is "low output" below this median output token count. */
export const LOW_OUTPUT_TOKENS = 1500;
/** (a) minimum calls in a group before its median is trusted. */
export const MIN_CALLS = 3;
/** (b) cache hit ratio below this is "low". */
export const LOW_CACHE_RATIO = 0.5;
/** (b) "big input": prompt tokens (input + cacheRead) month to date. */
export const BIG_INPUT_TOKENS = 1_000_000;
/** (d) a model is "high share" of Copilot spend at or above this fraction. */
export const COPILOT_SHARE = 0.3;
/** (e) a session is flagged above this fraction of month-to-date spend. */
export const SESSION_SHARE = 0.25;

/** Sources whose records are daily aggregates rather than single calls. */
const AGGREGATE_SOURCES = new Set<UsageRecord['source']>(['anthropic-api', 'openai-api']);

interface Row {
  r: UsageRecord;
  cost: number;
  price: ModelPrice | undefined;
  /** true when the cost came from the price table (no vendor cost) */
  tokenPriced: boolean;
}

function tokensOf(r: UsageRecord): SpendTokens {
  const t = r.tokens;
  return {
    input: tok(t?.input),
    output: tok(t?.output),
    cacheRead: tok(t?.cacheRead),
    cacheWrite5m: tok(t?.cacheWrite5m),
    cacheWrite1h: tok(t?.cacheWrite1h),
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The cheaper alternative used for an estimate: among same-provider models of `tier`, the one that
 * would have cost the MOST for exactly these calls (so the saving shown is a floor, not a best case),
 * restricted to candidates that are actually cheaper than the current model. Returns the ratio
 * altApiCost / currentApiCost so it can be applied to vendor-billed costs too.
 */
function cheaperAlternative(
  current: ModelPrice,
  tier: ModelPrice['tier'],
  calls: SpendTokens[],
  allowLongContext: boolean[],
  table: PriceTable,
): { model: ModelPrice; ratio: number } | undefined {
  const priceAll = (p: ModelPrice): number =>
    calls.reduce((sum, t, i) => sum + costForTokens(p, t, allowLongContext[i] ?? true), 0);
  const base = priceAll(current);
  if (!(base > 0)) return undefined;
  let best: { model: ModelPrice; cost: number } | undefined;
  for (const p of table.models) {
    if (p.provider !== current.provider || p.tier !== tier || p.id === current.id) continue;
    const c = priceAll(p);
    if (!(c < base)) continue;
    if (!best || c > best.cost) best = { model: p, cost: c };
  }
  return best ? { model: best.model, ratio: best.cost / base } : undefined;
}

function safeId(s: string): string {
  return s.replace(/[^A-Za-z0-9._:-]+/g, '_').slice(0, 64);
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Savings tips for the current local calendar month up to `now` (other records are ignored,
 * including any dated after `now`). Every estimate is month-to-date saving extrapolated:
 *   estMonthlySavingsUsd = mtdSaving * daysInMonth / max(elapsedDays, 3)
 * (at least three elapsed days, matching the forecast's early-month rule, so the first days of a
 * month cannot inflate an estimate).
 * Tips that cannot be estimated from recorded data carry 0 rather than a guess.
 * Sorted by estimate desc (then id), at most 8.
 */
export function savingsTips(records: UsageRecord[], table: PriceTable, now: number): SavingsTip[] {
  const period = monthPeriod(now);
  const scale = period.daysInMonth / Math.max(period.elapsedDays, MIN_EXTRAPOLATION_DAYS);
  const rows: Row[] = [];
  for (const r of dedupeRecords(records)) {
    if (r.ts < period.start || r.ts >= period.end || r.ts > now) continue;
    const priced = priceRecord(r, table);
    const price = typeof r.model === 'string' ? findModel(r.model, table) : undefined;
    const vendor = typeof r.vendorCostUsd === 'number' && Number.isFinite(r.vendorCostUsd);
    rows.push({ r, cost: priced.costUsd, price, tokenPriced: priced.priced && !vendor });
  }
  const tips: SavingsTip[] = [];
  const push = (id: string, title: string, detail: string, mtdSaving: number): void => {
    const est = mtdSaving * scale;
    if (!(est >= MIN_TIP_USD)) return;
    tips.push({ id, title: clip(title, 80), detail: clip(detail, 200), estMonthlySavingsUsd: est });
  };

  /* (a) top-tier model on a task/session whose calls produce little output */
  {
    const groups = new Map<
      string,
      { dim: 'task' | 'session'; key: string; price: ModelPrice; rows: Row[] }
    >();
    for (const row of rows) {
      const { r, price } = row;
      // copilot is covered by (d); aggregate API rows are not single calls
      if (!row.tokenPriced || !price || price.tier !== 3) continue;
      if (AGGREGATE_SOURCES.has(r.source) || r.source === 'copilot') continue;
      const dim = r.task ? 'task' : r.sessionId ? 'session' : undefined;
      if (!dim) continue;
      const key = (dim === 'task' ? r.task : r.sessionId) as string;
      const gk = `${dim}\u0000${key}\u0000${price.id}`;
      let g = groups.get(gk);
      if (!g) groups.set(gk, (g = { dim, key, price, rows: [] }));
      g.rows.push(row);
    }
    for (const g of groups.values()) {
      if (g.rows.length < MIN_CALLS) continue;
      const calls = g.rows.map((x) => tokensOf(x.r));
      const med = median(calls.map((t) => t.output));
      if (!(med < LOW_OUTPUT_TOKENS)) continue;
      const alt = cheaperAlternative(
        g.price,
        2,
        calls,
        calls.map(() => true),
        table,
      );
      if (!alt) continue;
      const cost = g.rows.reduce((s, x) => s + x.cost, 0);
      const saving = cost * (1 - alt.ratio);
      push(
        `tier-${g.dim}-${safeId(g.key)}-${g.price.id}`,
        `Use ${alt.model.id} instead of ${g.price.id} for ${g.dim} ${g.key}`,
        `${g.dim} ${g.key}: ${g.rows.length} ${g.price.id} calls, median ${Math.round(med)} output tokens, ` +
          `${usd(cost)} this month; same calls at ${alt.model.id} rates cost ${usd(cost * alt.ratio)}.`,
        saving,
      );
    }
  }

  /* per-model token totals for (b) and (c), token-priced rows only */
  const byModel = new Map<string, { price: ModelPrice; t: SpendTokens }>();
  for (const row of rows) {
    if (!row.tokenPriced || !row.price) continue;
    let g = byModel.get(row.price.id);
    if (!g) {
      g = { price: row.price, t: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
      byModel.set(row.price.id, g);
    }
    const t = tokensOf(row.r);
    g.t.input += t.input;
    g.t.output += t.output;
    g.t.cacheRead += t.cacheRead;
    g.t.cacheWrite5m += t.cacheWrite5m;
    g.t.cacheWrite1h += t.cacheWrite1h;
  }

  /* (b) low cache hit ratio with large prompts */
  for (const { price, t } of byModel.values()) {
    const prompt = t.input + t.cacheRead;
    if (prompt < BIG_INPUT_TOKENS) continue;
    const ratio = t.cacheRead / prompt;
    if (!(ratio < LOW_CACHE_RATIO)) continue;
    // Conservative: every token moved from input to cache read is assumed to be written once at the
    // 5m rate (premium cacheWrite5m - input) and read once.
    const perToken = price.input - price.cacheRead - Math.max(price.cacheWrite5m - price.input, 0);
    if (!(perToken > 0)) continue;
    const shifted = LOW_CACHE_RATIO * prompt - t.cacheRead;
    const saving = (shifted * perToken) / 1_000_000;
    push(
      `cache-ratio-${price.id}`,
      `Raise prompt cache hits for model ${price.id}`,
      `model ${price.id}: ${Math.round(ratio * 100)}% of ${Math.round(prompt).toLocaleString('en-US')} prompt tokens ` +
        `were cache reads this month. Use prompt caching or keep sessions longer to reach ${LOW_CACHE_RATIO * 100}%.`,
      saving,
    );
  }

  /* (c) heavy 1h cache writes. The saving is priced per record with priceRecord (so long-context
   * tiers and the aggregate-source rule apply): cost as recorded minus cost with the 1h writes
   * re-billed as 5m writes. */
  const ttlSaving = new Map<string, number>();
  for (const row of rows) {
    if (!row.tokenPriced || !row.price) continue;
    const t = tokensOf(row.r);
    if (!(t.cacheWrite1h > 0)) continue;
    const as5m: UsageRecord = {
      ...row.r,
      tokens: { ...t, cacheWrite5m: t.cacheWrite5m + t.cacheWrite1h, cacheWrite1h: 0 },
    };
    const diff = row.cost - priceRecord(as5m, table).costUsd;
    ttlSaving.set(row.price.id, (ttlSaving.get(row.price.id) ?? 0) + diff);
  }
  for (const { price, t } of byModel.values()) {
    if (!(t.cacheWrite1h > 0) || t.cacheWrite1h <= t.cacheWrite5m) continue;
    const saving = ttlSaving.get(price.id) ?? 0;
    if (!(saving > 0)) continue;
    push(
      `cache-1h-${price.id}`,
      `Use 5-minute cache writes for model ${price.id}`,
      `model ${price.id}: ${Math.round(t.cacheWrite1h).toLocaleString('en-US')} tokens written with 1h TTL this month ` +
        `(${usd(saving)} premium over 5m). 5m TTL is cheaper when calls are frequent; upper bound shown.`,
      saving,
    );
  }

  /* (d) Copilot: model with a high share of Copilot spend -> cheaper model one tier down */
  {
    const copilot = rows.filter((x) => x.r.source === 'copilot');
    const total = copilot.reduce((s, x) => s + x.cost, 0);
    if (total > 0) {
      const groups = new Map<string, { price: ModelPrice; rows: Row[] }>();
      for (const row of copilot) {
        if (!row.price || row.price.tier === 1) continue;
        let g = groups.get(row.price.id);
        if (!g) groups.set(row.price.id, (g = { price: row.price, rows: [] }));
        g.rows.push(row);
      }
      for (const g of groups.values()) {
        const cost = g.rows.reduce((s, x) => s + x.cost, 0);
        const share = cost / total;
        if (!(share >= COPILOT_SHARE)) continue;
        // only rows with token counts can be compared; rows without tokens contribute no saving
        const withTokens = g.rows.filter((x) => {
          const c = tokensOf(x.r);
          return c.input + c.output + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h > 0;
        });
        if (withTokens.length === 0) continue;
        const calls = withTokens.map((x) => tokensOf(x.r));
        const estimable = withTokens.reduce((s, x) => s + x.cost, 0);
        const alt = cheaperAlternative(
          g.price,
          (g.price.tier - 1) as ModelPrice['tier'],
          calls,
          calls.map(() => true),
          table,
        );
        if (!alt) continue;
        push(
          `copilot-model-${g.price.id}`,
          `Pick a cheaper Copilot model than ${g.price.id}`,
          `model ${g.price.id}: ${usd(cost)} (${Math.round(share * 100)}% of Copilot spend) this month. ` +
            `The same tokens at ${alt.model.id} list rates cost ${Math.round(alt.ratio * 100)}% as much.`,
          estimable * (1 - alt.ratio),
        );
      }
    }
  }

  /* (e) one session dominating the month (no saving can be derived: estimate 0) */
  {
    const total = rows.reduce((s, x) => s + x.cost, 0);
    const sessions = new Map<string, number>();
    for (const { r, cost } of rows) {
      if (!r.sessionId) continue;
      sessions.set(r.sessionId, (sessions.get(r.sessionId) ?? 0) + cost);
    }
    if (total > 0) {
      for (const [sid, cost] of sessions) {
        const share = cost / total;
        if (!(share > SESSION_SHARE)) continue;
        tips.push({
          id: `session-share-${safeId(sid)}`,
          title: clip(`Session ${sid} is ${Math.round(share * 100)}% of this month's spend`, 80),
          detail: clip(
            `session ${sid}: ${usd(cost)} of ${usd(total)} month to date. Review its model choice and context size; ` +
              `no saving estimate is possible from usage data alone.`,
            200,
          ),
          estMonthlySavingsUsd: 0,
        });
      }
    }
  }

  tips.sort(
    (a, b) => b.estMonthlySavingsUsd - a.estMonthlySavingsUsd || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return tips.slice(0, MAX_TIPS);
}
