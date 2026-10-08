import { formatLocalTime } from '@fleet/shared';
import type { SpendBucket, SpendSummary } from '@fleet/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "$1,234.56" — always two decimals, thousands separators. */
export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${s}`;
}

/** "$1,235" — whole dollars, for axis ticks and ranges. */
export function moneyWhole(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  return `$${v.toLocaleString('en-US')}`;
}

export function pct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  if (n > 0 && n < 0.01) return '<1%';
  return `${Math.round(n * 100)}%`;
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Parse a YYYY-MM-DD key without touching the local timezone. */
export function parseDay(key: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "Oct 7" for a YYYY-MM-DD key; the key itself otherwise. */
export function dayLabel(key: string): string {
  const p = parseDay(key);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : key;
}

export function monthName(m: number): string {
  return MONTHS_LONG[m - 1] ?? '';
}
export function monthShort(m: number): string {
  return MONTHS[m - 1] ?? '';
}

/**
 * X-axis day ticks for a month chart: 1, 8, 15, 22 and the last day. The 8th and 22nd are `alt` (hidden
 * on narrow charts, where they collide with their neighbours), and a weekly tick closer than 4 days to the
 * month end is dropped so the end label never overlaps it.
 */
export function monthTicks(days: number): { day: number; alt: boolean }[] {
  const n = Math.max(1, Math.floor(days));
  const ticks = [1, 8, 15, 22]
    .filter((day) => day === 1 || n - day >= 4)
    .map((day) => ({ day, alt: day === 8 || day === 22 }));
  if (n > 1) ticks.push({ day: n, alt: false });
  return ticks;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "Oct 8, 17:31" in the viewer's local time zone (the stamp's UTC form goes in a tooltip). */
export function stampLocal(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${monthShort(d.getMonth() + 1)} ${d.getDate()}, ${formatLocalTime(ms)}`;
}

export function totalTokens(b: SpendBucket): number {
  const t = b.tokens;
  return t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
}

/** Round up to a 1/2/2.5/5 x 10^k step so ~4 gridlines fit. */
export function niceTicks(max: number, target = 4): { max: number; ticks: number[]; step: number } {
  const m = max > 0 ? max : 1;
  const raw = m / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag;
  const n = Math.ceil(m / step - 1e-9);
  // integer multiples keep full precision (no cent rounding, so sub-cent steps never collapse)
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { max: ticks[n]!, ticks, step };
}

/** Axis label sized to the step: whole dollars for steps >= $1, otherwise enough decimals to tell ticks apart. */
export function tickLabel(v: number, step: number): string {
  let decimals = 0;
  // up to 20 decimals (Intl's limit): sub-micro-dollar steps still get distinct labels
  for (; decimals < 20; decimals++) {
    const x = step * 10 ** decimals;
    if (Math.round(x) !== 0 && Math.abs(x - Math.round(x)) <= 1e-6 * x) break;
  }
  if (decimals === 0) return moneyWhole(v);
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Largest-remainder rounding: integer percents that sum to exactly 100 (or 0 when the total is 0). */
export function sharePercents(values: number[]): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

export interface MonthModel {
  year: number;
  month: number;
  days: number;
  /** day-of-month of the last day with data (today) */
  today: number;
  /** per-day cost for days 1..today */
  perDay: number[];
  /** cumulative cost for days 1..today */
  cumulative: number[];
  budget: number | null;
  forecast: number;
  lo: number;
  hi: number;
  /** fractional day-of-month where spend crosses budget; null if it does not */
  crossDay: number | null;
  crossIsActual: boolean;
}

/**
 * Derive the current-month series from the 31-day daily list. The month is taken from the newest daily key
 * (falls back to monthStart). Cumulative actuals end at monthToDateUsd: if the daily rows do not add up
 * (e.g. late ingestion), the last point is pinned to the reported total.
 */
export function monthModel(s: SpendSummary): MonthModel {
  const last = s.daily.length ? parseDay(s.daily[s.daily.length - 1]!.key) : null;
  // monthStart is the producer's local midnight on the 1st. Every UTC offset is within -12h..+14h, so
  // monthStart + 1 day read in UTC always lands on the 1st or 2nd of the right month: deterministic on
  // server and client regardless of either one's time zone (no hydration drift).
  const ms = new Date(s.monthStart + 86_400_000);
  const year = last?.y ?? ms.getUTCFullYear();
  const month = last?.m ?? ms.getUTCMonth() + 1;
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const days = daysInMonth(year, month);
  const today = Math.max(1, last && last.y === year && last.m === month ? last.d : 1);
  const perDay = Array.from({ length: today }, () => 0);
  for (const b of s.daily) {
    if (!b.key.startsWith(prefix)) continue;
    const p = parseDay(b.key);
    if (p && p.d >= 1 && p.d <= today) perDay[p.d - 1] = b.costUsd;
  }
  const cumulative: number[] = [];
  let acc = 0;
  for (const v of perDay) cumulative.push((acc += v));
  if (cumulative.length) cumulative[cumulative.length - 1] = s.monthToDateUsd;

  const mtd = s.monthToDateUsd;
  const forecast = Math.max(mtd, s.forecastMonthEndUsd);
  const remaining = days - today;
  // Range: +/- 1.28 sd of the last 7 daily totals, scaled by sqrt(days left). An estimate, labeled as such.
  const recent = s.daily.slice(-7).map((b) => b.costUsd);
  const mean = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
  const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, recent.length));
  const spread = remaining > 0 ? 1.28 * sd * Math.sqrt(remaining) : 0;
  const lo = Math.max(mtd, forecast - spread);
  const hi = forecast + spread;

  const budget = s.budget.monthlyUsd;
  let crossDay: number | null = null;
  let crossIsActual = false;
  if (budget !== null && budget > 0) {
    const i = cumulative.findIndex((v) => v >= budget);
    if (i >= 0) {
      const prev = i > 0 ? cumulative[i - 1]! : 0;
      const cur = cumulative[i]!;
      crossDay = i + (cur > prev ? (budget - prev) / (cur - prev) : 1);
      crossIsActual = true;
    } else if (forecast > budget && remaining > 0) {
      crossDay = today + ((budget - mtd) / (forecast - mtd)) * remaining;
    }
  }
  return { year, month, days, today, perDay, cumulative, budget, forecast, lo, hi, crossDay, crossIsActual };
}
