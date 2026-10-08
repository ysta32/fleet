/**
 * Time helpers shared by the app and the site. User-visible clock times are in the viewer's local
 * time zone; UTC is for tooltips (`title`) and machine-readable attributes only.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** Local midnight at the start of the day containing `at` (epoch ms). */
export function localStartOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export interface LocalTimeOptions {
  /** include seconds ("17:31:08"); default false ("17:31") */
  seconds?: boolean;
  /** IANA zone override (e.g. for static rendering); default the runtime's local zone */
  timeZone?: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** 24h wall-clock time in local time: "17:31" or, with `seconds`, "17:31:08". */
export function formatLocalTime(at: number, opts: LocalTimeOptions = {}): string {
  const key = `${opts.seconds ? 's' : 'm'}|${opts.timeZone ?? ''}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      ...(opts.seconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23',
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    });
    formatters.set(key, format);
  }
  return format.format(at);
}

/** Unambiguous UTC stamp for tooltips: "2026-10-08 14:05:09 UTC". */
export function formatUtcTime(at: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}
