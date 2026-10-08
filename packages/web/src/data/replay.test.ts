import { describe, expect, it } from 'vitest';
import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import { createDemoFleet } from '@fleet/shared';
import {
  buildTimeline,
  formatClock,
  formatWait,
  nearestNotch,
  needsYouMoments,
  normalizeHistory,
  notchMessage,
  reconstruct,
  stepNotch,
} from './replay';

let seq = 0;
const event = (ts: number, kind: FleetEvent['kind'], over: Partial<FleetEvent> = {}): FleetEvent => ({
  id: `e-${ts}-${seq++}`,
  ts,
  kind,
  projectId: 'p1',
  sessionId: 's1',
  severity: kind === 'session.waiting' || kind === 'blocked' ? 'warn' : 'info',
  label: kind,
  ...over,
});
const frame = (generatedAt: number, alerts: FleetSnapshot['alerts'] = []): FleetSnapshot => ({
  version: 1,
  generatedAt,
  projects: [
    { id: 'p1', name: 'helix-db', path: '/x', lastActivity: 0 },
    { id: 'p2', name: 'orbit-docs', path: '/y', lastActivity: 0 },
  ] as FleetSnapshot['projects'],
  sessions: [],
  agents: [],
  prs: [],
  releases: [],
  deploys: [],
  alerts,
});
/** A frame where each [session, project, since] is a session waiting on the operator. */
const waitingFrame = (generatedAt: number, waits: [string, string, number][]): FleetSnapshot => ({
  ...frame(generatedAt),
  sessions: waits.map(([id, projectId, since]) => ({
    id,
    projectId,
    title: `Session ${id}`,
    model: 'sonnet',
    startedAt: 0,
    lastActivity: since,
    status: 'waiting',
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    toolCalls: 0,
    agentIds: [],
  })),
});
const MIN = 60_000;
const history = (events: FleetEvent[], to = 100 * MIN): HistoryResponse =>
  normalizeHistory({ from: 0, to, frames: [frame(0)], events });

describe('needs-you moments', () => {
  it('opens on waiting, merges repeats, and closes when the same session moves on', () => {
    const moments = needsYouMoments(
      history([
        event(10 * MIN, 'session.waiting'),
        event(10 * MIN, 'blocked'),
        event(20 * MIN, 'agent.tool', { sessionId: 's2' }),
        event(30 * MIN, 'session.waiting'),
        event(50 * MIN, 'agent.status'),
        event(60 * MIN, 'blocked', { projectId: 'p2', sessionId: 's9' }),
      ]),
    );
    expect(moments).toEqual([
      { ts: 10 * MIN, end: 50 * MIN, projectId: 'p1', open: false },
      { ts: 60 * MIN, end: 100 * MIN, projectId: 'p2', open: true },
    ]);
  });
  it('keys collector task blocks by project and task and ends them only when that task unblocks', () => {
    const block = { sessionId: undefined, taskId: 't04' };
    const moments = needsYouMoments(
      history([
        event(10 * MIN, 'blocked', block),
        event(12 * MIN, 'agent.tool', { sessionId: 's1' }),
        event(14 * MIN, 'merge', { sessionId: undefined }),
        event(16 * MIN, 'task.state', { sessionId: undefined, taskId: 't05', data: { state: 'running' } }),
        event(18 * MIN, 'task.state', { sessionId: undefined, taskId: 't04', data: { state: 'blocked' } }),
        event(20 * MIN, 'task.state', {
          projectId: 'p2',
          sessionId: undefined,
          taskId: 't04',
          data: { state: 'running' },
        }),
        event(25 * MIN, 'task.state', { sessionId: undefined, taskId: 't04', data: { state: 'running' } }),
        event(30 * MIN, 'blocked', { ...block, taskId: 't07' }),
      ]),
    );
    expect(moments).toEqual([
      { ts: 10 * MIN, end: 25 * MIN, projectId: 'p1', open: false },
      { ts: 30 * MIN, end: 100 * MIN, projectId: 'p1', open: true },
    ]);
  });
  it('keeps session waits keyed by session while a block raised with them waits for its task', () => {
    const moments = needsYouMoments(
      history([
        event(10 * MIN, 'session.waiting'),
        event(10 * MIN, 'blocked', { taskId: 't02' }),
        event(15 * MIN, 'agent.tool', { projectId: 'p1', sessionId: 's1' }),
        event(40 * MIN, 'task.state', { sessionId: undefined, taskId: 't02', data: { state: 'running' } }),
        event(50 * MIN, 'session.waiting', { sessionId: 's2' }),
        event(55 * MIN, 'agent.tool', { sessionId: 's2' }),
      ]),
    );
    // the wait and the block raised together are one moment that lasts until the later of the two ends
    expect(moments).toEqual([
      { ts: 10 * MIN, end: 40 * MIN, projectId: 'p1', open: false },
      { ts: 50 * MIN, end: 55 * MIN, projectId: 'p1', open: false },
    ]);
  });
  it('falls back to the project when an event has no session or agent', () => {
    const moments = needsYouMoments(
      history([
        event(5 * MIN, 'blocked', { sessionId: undefined }),
        event(9 * MIN, 'merge', { sessionId: undefined }),
      ]),
    );
    expect(moments).toEqual([{ ts: 5 * MIN, end: 9 * MIN, projectId: 'p1', open: false }]);
  });
});

describe('timeline model', () => {
  it('colours each column by its most severe event and skips pure motion', () => {
    const model = buildTimeline(
      history([
        event(1 * MIN, 'agent.tool'),
        event(2 * MIN, 'ci', { severity: 'error' }),
        event(3 * MIN, 'merge', { severity: 'success' }),
        event(55 * MIN, 'agent.move'),
        event(99 * MIN, 'deploy', { severity: 'success' }),
      ]),
      10,
    );
    expect(model.buckets[0]).toEqual({ count: 3, severity: 'error' });
    expect(model.buckets[5]).toEqual({ count: 0, severity: null });
    expect(model.buckets[9]).toEqual({ count: 1, severity: 'success' });
    expect(model.max).toBe(3);
  });
  it('names notches by project, merges neighbours by the longest wait, and steps between them', () => {
    // the notches read incidents() off the frames: s1 waits 10-14, s2 (orbit-docs) 12-52, s3 from 70
    const model = buildTimeline(
      normalizeHistory({
        from: 0,
        to: 100 * MIN,
        frames: [
          frame(0),
          waitingFrame(10 * MIN, [['s1', 'p1', 10 * MIN]]),
          waitingFrame(12 * MIN, [
            ['s1', 'p1', 10 * MIN],
            ['s2', 'p2', 12 * MIN],
          ]),
          waitingFrame(14 * MIN, [['s2', 'p2', 12 * MIN]]),
          frame(52 * MIN),
          waitingFrame(70 * MIN, [['s3', 'p1', 70 * MIN]]),
        ],
        events: [],
      }),
      10,
      10,
    );
    expect(model.notches.map((notch) => [notch.ts, notch.projectName, notch.waitedMs, notch.count])).toEqual([
      [12 * MIN, 'orbit-docs', 40 * MIN, 2],
      [70 * MIN, 'helix-db', 30 * MIN, 1],
    ]);
    expect(notchMessage(model.notches[0]!)).toBe('orbit-docs waited 40m here (+1 more)');
    expect(notchMessage(model.notches[1]!)).toBe('helix-db waited 30m+ here');
    // the merged notch sits where the named (longest) wait began, not at the cluster's first moment
    expect(stepNotch(model.notches, 0, 1)?.ts).toBe(12 * MIN);
    expect(stepNotch(model.notches, 12 * MIN, 1)?.ts).toBe(70 * MIN);
    expect(stepNotch(model.notches, 70 * MIN, 1)).toBeUndefined();
    expect(stepNotch(model.notches, 70 * MIN, -1)?.ts).toBe(12 * MIN);
    expect(stepNotch(model.notches, 12 * MIN, -1)).toBeUndefined();
    expect(nearestNotch(model.notches, 68 * MIN, 3 * MIN)?.ts).toBe(70 * MIN);
    expect(nearestNotch(model.notches, 40 * MIN, 3 * MIN)).toBeUndefined();
  });
  it('drops the notch of an alert the operator dismissed, as the Alerts list does', () => {
    const red: FleetSnapshot['alerts'] = [
      {
        id: 'a1',
        kind: 'ci.failed',
        projectId: 'p1',
        title: 'ci.failed',
        body: 'Checks failed on #4',
        at: 20 * MIN,
      },
    ];
    const tape = normalizeHistory({
      from: 0,
      to: 100 * MIN,
      frames: [frame(0), frame(20 * MIN, red), frame(60 * MIN)],
      events: [],
    });
    expect(buildTimeline(tape, 10, 10).notches.map((notch) => [notch.ts, notch.waitedMs])).toEqual([
      [20 * MIN, 40 * MIN],
    ]);
    expect(buildTimeline(tape, 10, 10, new Set(['a1'])).notches).toEqual([]);
    expect(buildTimeline(tape, 10, 10, new Set(['other'])).notches).toHaveLength(1);
  });

  it('leaves out a closed incident that ended exactly where the window starts', () => {
    const tape = (from: number) =>
      normalizeHistory({
        from,
        to: 100 * MIN,
        frames: [
          waitingFrame(0, [['s1', 'p1', 0]]),
          frame(30 * MIN),
          waitingFrame(70 * MIN, [['s2', 'p2', 70 * MIN]]),
        ],
        events: [],
      });
    // the first wait spans 0-30m: inside a window from 29m, gone from one starting at 30m
    expect(buildTimeline(tape(29 * MIN), 10, 10).notches.map((notch) => notch.projectName)).toEqual([
      'helix-db',
      'orbit-docs',
    ]);
    expect(buildTimeline(tape(30 * MIN), 10, 10).notches.map((notch) => notch.projectName)).toEqual([
      'orbit-docs',
    ]);
  });

  it('is empty and safe for a zero-length window', () => {
    const model = buildTimeline({ from: 5, to: 5, frames: [], events: [event(5, 'blocked')] }, 8);
    expect(model.buckets).toHaveLength(8);
    expect(model.notches).toEqual([]);
    expect(model.max).toBe(1);
  });
  it('is deterministic for the demo fleet history', () => {
    const run = () => {
      const fleet = createDemoFleet({ seed: 3, now: 1_700_000_000_000 });
      return buildTimeline(normalizeHistory(fleet.history(1)));
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.notches.length).toBeGreaterThan(0);
    expect(a.buckets.some((bucket) => bucket.severity !== null)).toBe(true);
  });
});

describe('playhead consistency', () => {
  it('hides alerts raised after the playhead when the earliest frame stands in', () => {
    const late = frame(30 * MIN, [
      { id: 'a1', kind: 'session.waiting', projectId: 'p1', title: 't', body: 'b', at: 25 * MIN },
      { id: 'a2', kind: 'session.waiting', projectId: 'p1', title: 't', body: 'b', at: 5 * MIN },
    ]);
    const h = normalizeHistory({ from: 0, to: 60 * MIN, frames: [late], events: [] });
    expect(reconstruct(h, 10 * MIN).snapshot?.alerts.map((alert) => alert.id)).toEqual(['a2']);
    expect(reconstruct(h, 40 * MIN).snapshot).toBe(late);
  });
});

describe('formatting', () => {
  it('uses a 24h clock', () => {
    expect(formatClock(new Date(2026, 9, 7, 17, 31).getTime())).toMatch(/^17.31$/);
    expect(formatClock(new Date(2026, 9, 7, 0, 5).getTime())).toMatch(/^00.05$/);
  });
  it('formats waits compactly', () => {
    expect(formatWait(42_000)).toBe('42s');
    expect(formatWait(40 * MIN)).toBe('40m');
    expect(formatWait(125 * MIN)).toBe('2h 05m');
  });
});
