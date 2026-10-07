import type { SpendAlert, SpendBucket, SpendDimension } from '@fleet/shared';
import type {
  AnalyzeOptions,
  PriceTable,
  SpendBrief,
  SpendBudget,
  SpendSummary,
  SpendTokens,
  UsageRecord,
} from '../contracts.js';
import { priceRecord } from '../pricing/engine.js';
import { DAY_MS, HOUR_MS, dedupeRecords, localDayKey, monthPeriod, savingsTips, tok, usd } from './tips.js';

export const NONE_KEY = '(none)';
export const MAX_BUCKETS = 50;
export const DAILY_DAYS = 31;

const DIMENSIONS: SpendDimension[] = ['repo', 'branch', 'session', 'army', 'task', 'day', 'model', 'source'];

interface Priced {
  r: UsageRecord;
  cost: number;
  priced: boolean;
  modelId?: string;
}

function emptyTokens(): SpendTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

function addTo(b: SpendBucket, p: Priced): void {
  const t = p.r.tokens;
  b.costUsd += p.cost;
  b.records += 1;
  b.tokens.input += tok(t?.input);
  b.tokens.output += tok(t?.output);
  b.tokens.cacheRead += tok(t?.cacheRead);
  b.tokens.cacheWrite5m += tok(t?.cacheWrite5m);
  b.tokens.cacheWrite1h += tok(t?.cacheWrite1h);
}

function keyOrNone(v: unknown): string {
  return typeof v === 'string' && v.trim() !== '' ? v : NONE_KEY;
}

function dimensionKey(p: Priced, dim: SpendDimension): string {
  const r = p.r;
  switch (dim) {
    case 'repo':
      return keyOrNone(r.repo);
    case 'branch':
      return keyOrNone(r.branch);
    case 'session':
      return keyOrNone(r.sessionId);
    case 'army':
      return keyOrNone(r.army);
    case 'task':
      return keyOrNone(r.task);
    case 'day':
      return localDayKey(r.ts);
    case 'model':
      // canonical table id when known so dated/aliased raw ids roll up together
      return keyOrNone(p.modelId ?? r.model);
    case 'source':
      return keyOrNone(r.source);
  }
}

function sortBuckets(list: SpendBucket[]): SpendBucket[] {
  return list.sort((a, b) => b.costUsd - a.costUsd || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function priceAll(records: UsageRecord[], table: PriceTable): Priced[] {
  return dedupeRecords(records).map((r) => {
    const pc = priceRecord(r, table);
    return { r, cost: pc.costUsd, priced: pc.priced, ...(pc.modelId ? { modelId: pc.modelId } : {}) };
  });
}

function sumCost(rows: Priced[], from: number, to: number): number {
  let s = 0;
  for (const p of rows) if (p.r.ts >= from && p.r.ts < to) s += p.cost;
  return s;
}

/** Thresholds in (0, 1), deduped, ascending; 1.0 and above are covered by the "over" alert. */
function warnThresholds(budget: SpendBudget): number[] {
  const raw = Array.isArray(budget.warnAt) ? budget.warnAt : [];
  const set = new Set<number>();
  for (const t of raw) if (typeof t === 'number' && Number.isFinite(t) && t > 0 && t < 1) set.add(t);
  return [...set].sort((a, b) => a - b);
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function budgetAlerts(
  monthKey: string,
  mtd: number,
  forecast: number,
  budget: SpendBudget,
  now: number,
): SpendAlert[] {
  const b = budget.monthlyUsd;
  if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) return [];
  const alerts: SpendAlert[] = [];
  const add = (id: string, level: SpendAlert['level'], title: string, body: string): void => {
    alerts.push({ id, level, title: clip(title, 80), body: clip(body, 200), at: now });
  };
  const status = `Month to date ${usd(mtd)}, forecast ${usd(forecast)} for ${monthKey}, budget ${usd(b)}.`;
  const over = mtd >= b;
  if (over) {
    add(
      `budget-${monthKey}-over`,
      'over',
      `Spend over budget: ${usd(mtd)} of ${usd(b)} (${monthKey})`,
      status,
    );
  }
  for (const t of warnThresholds(budget)) {
    const pct = Math.round(t * 100);
    if (mtd >= t * b) {
      add(
        `budget-${monthKey}-mtd-${t}`,
        'warn',
        `Spend reached ${pct}% of ${usd(b)} budget (${monthKey})`,
        status,
      );
    }
  }
  if (!over) {
    for (const t of warnThresholds(budget)) {
      const pct = Math.round(t * 100);
      if (forecast >= t * b) {
        add(
          `budget-${monthKey}-forecast-${t}`,
          'warn',
          `Forecast reaches ${pct}% of ${usd(b)} budget (${monthKey})`,
          status,
        );
      }
    }
    if (forecast >= b) {
      add(
        `budget-${monthKey}-forecast-over`,
        'warn',
        `Forecast ${usd(forecast)} exceeds ${usd(b)} budget (${monthKey})`,
        status,
      );
    }
  }
  return alerts;
}

/**
 * Build the spend summary for the local calendar month containing `opts.now`.
 *
 * Windows (half-open, epoch ms): month = [monthStart, nextMonthStart); today = [local midnight,
 * next local midnight); daily = the 31 local calendar days ending today; burn = [now - 1h, now).
 *
 * Forecast (D-12, nothing rounded):
 *   elapsedDays = max((now - monthStart) / 86400000, 1/24)
 *   dailyRate   = elapsedDays < 3 ? MTD / elapsedDays : cost of records in [now - 7d, now) / 7
 *   forecast    = MTD + dailyRate * max(daysInMonth - elapsedDays, 0)
 * (the clamp only matters for the extra DST hour at the very end of a fall-back month).
 */
export function summarize(records: UsageRecord[], opts: AnalyzeOptions): SpendSummary {
  const { now, table, budget } = opts;
  const period = monthPeriod(now);
  const rows = priceAll(records, table);
  const month = rows.filter((p) => p.r.ts >= period.start && p.r.ts < period.end);

  const mtd = month.reduce((s, p) => s + p.cost, 0);

  const nd = new Date(now);
  const todayStart = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate()).getTime();
  const tomorrowStart = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate() + 1).getTime();
  const todayUsd = sumCost(rows, todayStart, tomorrowStart);
  const burnUsdPerHour = sumCost(rows, now - HOUR_MS, now);

  const dailyRate =
    period.elapsedDays < 3 ? mtd / period.elapsedDays : sumCost(rows, now - 7 * DAY_MS, now) / 7;
  const forecast = mtd + dailyRate * Math.max(period.daysInMonth - period.elapsedDays, 0);

  const breakdown = {} as Record<SpendDimension, SpendBucket[]>;
  for (const dim of DIMENSIONS) {
    const map = new Map<string, SpendBucket>();
    for (const p of month) {
      const key = dimensionKey(p, dim);
      let b = map.get(key);
      if (!b) map.set(key, (b = { key, costUsd: 0, tokens: emptyTokens(), records: 0 }));
      addTo(b, p);
    }
    breakdown[dim] = sortBuckets([...map.values()]).slice(0, MAX_BUCKETS);
  }

  const daily: SpendBucket[] = [];
  const dayIndex = new Map<string, SpendBucket>();
  for (let i = DAILY_DAYS - 1; i >= 0; i--) {
    const key = localDayKey(new Date(nd.getFullYear(), nd.getMonth(), nd.getDate() - i).getTime());
    const b: SpendBucket = { key, costUsd: 0, tokens: emptyTokens(), records: 0 };
    daily.push(b);
    dayIndex.set(key, b);
  }
  const dailyStart = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate() - (DAILY_DAYS - 1)).getTime();
  for (const p of rows) {
    if (p.r.ts < dailyStart || p.r.ts >= tomorrowStart) continue;
    const b = dayIndex.get(localDayKey(p.r.ts));
    if (b) addTo(b, p);
  }

  const unpriced = new Set<string>();
  for (const p of rows) if (!p.priced) unpriced.add(keyOrNone(p.r.model));

  return {
    generatedAt: now,
    priceTableVersion: table.version,
    monthStart: period.start,
    monthToDateUsd: mtd,
    todayUsd,
    forecastMonthEndUsd: forecast,
    burnUsdPerHour,
    budget,
    breakdown,
    daily,
    tips: savingsTips(records, table, now),
    alerts: budgetAlerts(period.key, mtd, forecast, budget, now),
    sources: opts.sources,
    unpricedModels: [...unpriced].sort(),
  };
}

/**
 * Compact brief. sessionBurn / projectBurn are USD over [now - 1h, now) keyed by session id / repo
 * display name (records lacking the key are omitted). Totals and alerts come from `summary`.
 */
export function toBrief(
  records: UsageRecord[],
  summary: SpendSummary,
  opts: { now: number; table: PriceTable },
): SpendBrief {
  // Maps + Object.fromEntries so ids like "__proto__" become plain own keys
  const sessions = new Map<string, number>();
  const projects = new Map<string, number>();
  for (const p of priceAll(records, opts.table)) {
    if (!(p.r.ts >= opts.now - HOUR_MS && p.r.ts < opts.now)) continue;
    const sid = p.r.sessionId;
    if (typeof sid === 'string' && sid !== '') sessions.set(sid, (sessions.get(sid) ?? 0) + p.cost);
    const repo = p.r.repo;
    if (typeof repo === 'string' && repo !== '') projects.set(repo, (projects.get(repo) ?? 0) + p.cost);
  }
  const sessionBurn: Record<string, number> = Object.fromEntries(sessions);
  const projectBurn: Record<string, number> = Object.fromEntries(projects);
  return {
    generatedAt: opts.now,
    monthToDateUsd: summary.monthToDateUsd,
    forecastMonthEndUsd: summary.forecastMonthEndUsd,
    budgetUsd: summary.budget.monthlyUsd,
    burnUsdPerHour: summary.burnUsdPerHour,
    sessionBurn,
    projectBurn,
    alerts: summary.alerts,
  };
}
