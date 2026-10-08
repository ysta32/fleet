'use client';
// The site is static and its demo clock is stated in UTC. These render the UTC text at build time (so the
// HTML is correct without script), then switch to the visitor's local time after hydration, keeping the
// UTC reading in the tooltip.
import { useEffect, useRef, useState } from 'react';
import { formatLocalTime, formatUtcTime } from '@fleet/shared';

type Style = 'time' | 'date' | 'day-time';

const OPTS: Record<Exclude<Style, 'time'>, Intl.DateTimeFormatOptions> = {
  date: { weekday: 'long', day: 'numeric', month: 'long' },
  'day-time': { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

export function formatAt(at: number, style: Style, timeZone?: string): string {
  // Clock times are the app's own format (formatLocalTime), so site and app read the same.
  if (style === 'time') return formatLocalTime(at, timeZone ? { timeZone } : {});
  return new Intl.DateTimeFormat('en-GB', { ...OPTS[style], timeZone }).format(at);
}

const utcTitle = formatUtcTime;

/** One timestamp: UTC in the HTML, local after hydration, UTC in the title. */
export function LocalTime({
  at,
  style = 'time',
  className,
}: {
  at: number;
  style?: Style;
  className?: string;
}) {
  const [text, setText] = useState(() => formatAt(at, style, 'UTC'));
  useEffect(() => setText(formatAt(at, style)), [at, style]);
  return (
    <time className={className} dateTime={new Date(at).toISOString()} title={utcTitle(at)}>
      {text}
    </time>
  );
}

/** The visitor's zone label at `at` (not today): an October window reads GMT-4 in New York even in winter. */
const zoneName = (at: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'local';

/**
 * Rewrites the build-time UTC clock times inside `children` (HTML from the digest renderer) to local time:
 * every <time datetime> with a clock reading, and the window line when its bounds are given.
 */
export function LocalizeTimes({
  window: win,
  children,
}: {
  window?: { since: string; until: string };
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLTimeElement>('time[datetime]')) {
      const at = Date.parse(el.dateTime);
      const text = el.textContent ?? '';
      if (!el.dateTime.includes('T') || !Number.isFinite(at) || !/\d{2}:\d{2}$/.test(text)) continue;
      el.title = utcTitle(at);
      el.textContent = /^\d{1,2} \w{3} /.test(text) ? formatAt(at, 'day-time') : formatAt(at, 'time');
    }
    if (win) {
      const since = Date.parse(win.since);
      const until = Date.parse(win.until);
      const line = [...root.querySelectorAll<HTMLElement>('.ovn-dateline-item')].find((el) =>
        /\(UTC\)$/.test(el.textContent ?? ''),
      );
      if (line && Number.isFinite(since) && Number.isFinite(until)) {
        line.title = `${utcTitle(since)} to ${utcTitle(until)}`;
        // A window across a DST change names both offsets.
        const zones = [...new Set([zoneName(since), zoneName(until)])].join(' → ');
        line.textContent = `${formatAt(since, 'day-time')} → ${formatAt(until, 'day-time')} (${zones})`;
      }
    }
  }, [win]);
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
