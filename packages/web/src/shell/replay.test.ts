import { describe, expect, it } from 'vitest';
import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import { clampPlayhead, eventsCrossed, normalizeHistory, reconstruct } from '../data/replay';

const frame = (generatedAt: number): FleetSnapshot => ({
  version: 1,
  generatedAt,
  projects: [],
  sessions: [],
  agents: [],
  prs: [],
  releases: [],
  deploys: [],
  alerts: [],
});
const event = (ts: number): FleetEvent => ({
  id: `synthetic-${ts}`,
  ts,
  kind: 'agent.tool',
  projectId: 'synthetic',
  severity: 'info',
  label: 'Edit fixture.ts',
});
const history: HistoryResponse = {
  from: 0,
  to: 100,
  frames: [frame(80), frame(20), frame(50)],
  events: [event(80), event(20), event(50)],
};

describe('replay reconstruction', () => {
  it('selects the latest frame at or before the playhead without exposing future events', () => {
    expect(reconstruct(history, 50)).toEqual({ snapshot: frame(50), events: [event(20), event(50)] });
    expect(reconstruct(history, 79).snapshot).toEqual(frame(50));
    expect(reconstruct(history, 100).snapshot).toEqual(frame(80));
  });
  it('does not borrow a future frame before the first snapshot', () => {
    expect(reconstruct(history, 10)).toEqual({ snapshot: null, events: [] });
    expect(reconstruct({ ...history, frames: [], events: [] }, 50)).toEqual({ snapshot: null, events: [] });
  });
  it('retains only the latest 300 eligible events in chronological order', () => {
    const events = Array.from({ length: 500 }, (_, i) => event(i)).reverse();
    const result = reconstruct({ ...history, events }, 399);
    expect(result.events).toHaveLength(300);
    expect(result.events[0].ts).toBe(100);
    expect(result.events.at(-1)?.ts).toBe(399);
  });
  it('emits every crossed event once even when a high-speed tick crosses many events', () => {
    expect(eventsCrossed(history, 20, 80)).toEqual([event(50), event(80)]);
    expect(eventsCrossed(history, 80, 100)).toEqual([]);
    expect(eventsCrossed(history, 80, 20)).toEqual([]);
    expect(eventsCrossed(history, 50, 50)).toEqual([]);
  });
  it('clamps seeking and normalizes without mutating the supplied history', () => {
    expect(clampPlayhead(history, -10)).toBe(0);
    expect(clampPlayhead(history, 120)).toBe(100);
    expect(clampPlayhead(history, 50)).toBe(50);
    expect(normalizeHistory(history).frames.map((snapshot) => snapshot.generatedAt)).toEqual([20, 50, 80]);
    expect(history.frames.map((snapshot) => snapshot.generatedAt)).toEqual([80, 20, 50]);
    expect(normalizeHistory(history).events.map((entry) => entry.ts)).toEqual([20, 50, 80]);
  });
});
