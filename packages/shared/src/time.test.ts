import { describe, expect, it } from 'vitest';
import { sessionSpend } from './spend.js';
import { formatLocalTime, formatUtcTime, localStartOfDay } from './time.js';

describe('time helpers', () => {
  it('formats local 24h clock times and UTC tooltips', () => {
    const at = new Date(2026, 9, 8, 7, 5, 9).getTime();
    expect(formatLocalTime(at)).toBe('07:05');
    expect(formatLocalTime(at, { seconds: true })).toBe('07:05:09');
    const utc = Date.UTC(2026, 9, 8, 23, 4, 5);
    expect(formatLocalTime(utc, { timeZone: 'UTC' })).toBe('23:04');
    expect(formatLocalTime(utc, { timeZone: 'Asia/Tokyo' })).toBe('08:04');
    expect(formatUtcTime(utc)).toBe('2026-10-08 23:04:05 UTC');
    expect(formatUtcTime(NaN)).toBe('');
    expect(localStartOfDay(at)).toBe(new Date(2026, 9, 8).getTime());
  });

  it('splits session spend into today and earlier from one pass', () => {
    const now = new Date(2026, 9, 8, 0, 30).getTime();
    const sessions = [
      { startedAt: new Date(2026, 9, 7, 18).getTime(), costUsd: 30 },
      { startedAt: new Date(2026, 9, 7, 23, 50).getTime(), costUsd: 9.5 },
      { startedAt: new Date(2026, 9, 8, 0, 10).getTime(), costUsd: 0.4 },
      { startedAt: now + 60_000, costUsd: 1 },
    ];
    const spend = sessionSpend(sessions, now);
    expect(spend.todayUsd).toBeCloseTo(0.4);
    expect(spend.totalUsd).toBeCloseTo(40.9);
    expect(spend.earlierUsd).toBeCloseTo(40.5);
    expect(spend.todaySessions).toBe(1);
    expect(spend.sessions).toBe(4);
    expect(sessionSpend([], now)).toEqual({
      todayUsd: 0,
      totalUsd: 0,
      earlierUsd: 0,
      todaySessions: 0,
      sessions: 0,
    });
  });
});
