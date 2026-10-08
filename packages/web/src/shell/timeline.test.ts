import { describe, expect, it } from 'vitest';
import type { FleetEvent } from '@fleet/shared';
import { compareEvents, eventClock, eventDelta, timelineGroups, timelineRows } from './timeline';

const ev = (ts: number, seq: number, taskId?: string, label = `${ts}-${seq}`): FleetEvent => ({
  id: `${ts}-${seq}`,
  ts,
  kind: 'agent.tool',
  projectId: 'p',
  severity: 'info',
  label,
  ...(taskId ? { taskId } : {}),
});

describe('timelineGroups', () => {
  it('groups by task, oldest first, groups ordered by their first event', () => {
    const events = [
      ev(5000, 1, 't04'),
      ev(1000, 1, 't03'),
      ev(3000, 1),
      ev(2000, 1, 't04'),
      ev(4000, 1, 't03'),
    ];
    const groups = timelineGroups(events);
    expect(groups.map((group) => group.task)).toEqual(['t03', 't04', null]);
    expect(groups.map((group) => group.events.map((event) => event.ts))).toEqual([
      [1000, 4000],
      [2000, 5000],
      [3000],
    ]);
  });
  it('breaks same-millisecond ties by sequence number, numerically', () => {
    const events = [ev(1000, 10), ev(1000, 2), ev(1000, 1)];
    expect(timelineGroups(events)[0].events.map((event) => event.id)).toEqual([
      '1000-1',
      '1000-2',
      '1000-10',
    ]);
  });
  it('does not mutate its input', () => {
    const events = [ev(2, 1), ev(1, 1)];
    timelineGroups(events);
    expect(events.map((event) => event.ts)).toEqual([2, 1]);
  });
  it('orders ids of another shape deterministically', () => {
    const a = { ...ev(1, 1), id: 'b' };
    const b = { ...ev(1, 1), id: 'a' };
    expect(compareEvents(a, b)).toBeGreaterThan(0);
    expect(compareEvents(b, a)).toBeLessThan(0);
  });
});

describe('event time formats', () => {
  it('shows seconds so events in one minute stay distinct', () => {
    const at = new Date(2026, 9, 8, 0, 14, 7).getTime();
    expect(eventClock(at)).toBe('00:14:07');
    expect(eventClock(at + 41_000)).toBe('00:14:48');
  });
  it('formats deltas in s, m, h and never negative', () => {
    expect(eventDelta(1000, 1000)).toBe('+0s');
    expect(eventDelta(43_900, 1000)).toBe('+42s');
    expect(eventDelta(1000 + 3 * 60_000 + 5_000, 1000)).toBe('+3m');
    expect(eventDelta(1000 + 2 * 3_600_000, 1000)).toBe('+2h');
    expect(eventDelta(0, 5000)).toBe('+0s');
  });
});

describe('timelineRows', () => {
  const at = new Date(2026, 9, 8, 2, 5, 31).getTime();
  it('shows a same-second run once, on its first row, and gaps from the event before', () => {
    const events = [ev(at, 1), ev(at + 300, 2), ev(at + 2_400, 3), ev(at + 2_450, 4), ev(at + 2_900, 5)];
    events.push(ev(at + 16_000, 6));
    const rows = timelineRows(events);
    expect(rows.map((row) => [row.time, row.run, row.follows])).toEqual([
      ['02:05:31', 2, false],
      ['', 0, true],
      ['+2s', 3, false],
      ['', 0, true],
      ['', 0, true],
      ['+13s', 1, false],
    ]);
    expect(rows.map((row) => row.event.id)).toEqual(events.map((event) => event.id));
  });
  it('keeps every row timed when no two events share a second', () => {
    const rows = timelineRows([ev(at, 1), ev(at + 1_000, 2), ev(at + 65_000, 3)]);
    expect(rows.map((row) => row.time)).toEqual(['02:05:31', '+1s', '+1m']);
    expect(rows.every((row) => row.run === 1 && !row.follows)).toBe(true);
  });
  it('returns no rows for no events', () => {
    expect(timelineRows([])).toEqual([]);
  });
});
