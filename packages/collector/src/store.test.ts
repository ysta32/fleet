import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, FleetEvent, Project, Session } from '@fleet/shared';
import { FleetStore, HISTORY_FILE } from './store.js';

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function project(id: string, lastActivity: number): Project {
  return { id, name: id, path: `/synthetic/${id}`, lastActivity };
}
function session(
  id: string,
  projectId: string,
  lastActivity: number,
  status: Session['status'] = 'active',
): Session {
  return {
    id,
    projectId,
    model: 'opus',
    startedAt: lastActivity - 1000,
    lastActivity,
    status,
    tokens: ZERO,
    costUsd: 0,
    toolCalls: 0,
    agentIds: [id],
  };
}
function agent(id: string, sessionId: string, projectId: string, lastActivity: number): Agent {
  return {
    id,
    sessionId,
    projectId,
    role: 'lead',
    model: 'opus',
    label: 'lead',
    status: 'working',
    location: { kind: 'project', projectId },
    tokens: ZERO,
    startedAt: lastActivity,
    lastActivity,
  };
}
function event(ts: number, seq = 0): FleetEvent {
  return {
    id: `${ts}-${seq}`,
    ts,
    kind: 'agent.tool',
    projectId: 'p1',
    severity: 'info',
    label: 'Edit a.ts',
  };
}

describe('FleetStore', () => {
  let clock = T0;
  const now = () => clock;
  let dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'fleet-store-'));
    dirs.push(d);
    return d;
  };

  beforeEach(() => {
    clock = T0;
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it('snapshot sorts projects by lastActivity desc and merges orch/github/alerts', () => {
    const s = new FleetStore({ now });
    s.upsertProject(project('old', T0 - 5000));
    s.upsertProject(project('new', T0));
    s.upsertProject(project('mid', T0 - 100));
    s.setOrch('mid', {
      projectId: 'mid',
      phase: 'running',
      statusText: '',
      handoffText: '',
      tasks: [],
      inflight: [],
      worktrees: [],
      blocked: [],
      updatedAt: T0,
    });
    s.setGithub('new', {
      prs: [
        {
          projectId: 'new',
          number: 1,
          title: 'x',
          state: 'open',
          ci: 'pending',
          url: 'https://example.invalid/1',
          headRef: 'b',
          updatedAt: T0,
        },
      ],
      releases: [],
      deploys: [],
    });
    s.addAlert({ id: 'a1', kind: 'ci.failed', projectId: 'new', title: 't', body: 'b', at: T0 });
    const snap = s.snapshot();
    expect(snap.version).toBe(1);
    expect(snap.projects.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
    expect(snap.projects[1].orch?.phase).toBe('running');
    expect(snap.prs).toHaveLength(1);
    expect(s.clearAlert('a1')).toBe(true);
    expect(s.clearAlert('nope')).toBe(false);
    expect(s.snapshot().alerts[0].cleared).toBe(true);
    // setGithub replaces the project's prior state
    s.setGithub('new', { prs: [], releases: [], deploys: [] });
    expect(s.snapshot().prs).toHaveLength(0);
  });

  it('emits event synchronously and debounces change to one emit per 250ms window', () => {
    vi.useFakeTimers();
    const s = new FleetStore({ now });
    const events: FleetEvent[] = [];
    let changes = 0;
    s.on('event', (e: FleetEvent) => events.push(e));
    s.on('change', () => changes++);
    s.emitEvent(event(T0));
    expect(events).toHaveLength(1);
    for (let i = 0; i < 10; i++) s.upsertProject(project(`p${i}`, T0 + i));
    expect(changes).toBe(0);
    vi.advanceTimersByTime(249);
    expect(changes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(changes).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(changes).toBe(1);
    s.upsertSession(session('s1', 'p1', T0));
    vi.advanceTimersByTime(250);
    expect(changes).toBe(2);
  });

  it('caps the event ring at maxEvents and prunes events older than 24h', () => {
    const s = new FleetStore({ now, maxEvents: 5 });
    for (let i = 0; i < 8; i++) s.emitEvent(event(T0 + i, i));
    const all = s.history(0, Infinity).events;
    expect(all.map((e) => e.ts)).toEqual([T0 + 3, T0 + 4, T0 + 5, T0 + 6, T0 + 7]);

    const s2 = new FleetStore({ now });
    s2.emitEvent(event(T0 - 25 * HOUR));
    s2.emitEvent(event(T0 - 23 * HOUR));
    s2.prune();
    expect(s2.history(0, Infinity).events.map((e) => e.ts)).toEqual([T0 - 23 * HOUR]);
  });

  it('default ring holds at most 20k events', () => {
    const s = new FleetStore({ now });
    for (let i = 0; i < 20_010; i++) s.emitEvent(event(T0 + i, i));
    const ev = s.history(0, Infinity).events;
    expect(ev).toHaveLength(20_000);
    expect(ev[0].ts).toBe(T0 + 10);
  });

  it('prunes sessions (and their agents) ended more than 24h ago', () => {
    const s = new FleetStore({ now });
    s.upsertSession(session('gone', 'p1', T0 - 25 * HOUR, 'ended'));
    s.upsertAgent(agent('gone', 'gone', 'p1', T0 - 25 * HOUR));
    s.upsertSession(session('recentEnd', 'p1', T0 - 1 * HOUR, 'ended'));
    s.upsertSession(session('oldActive', 'p1', T0 - 30 * HOUR, 'idle'));
    s.prune();
    const snap = s.snapshot();
    expect(snap.sessions.map((x) => x.id).sort()).toEqual(['oldActive', 'recentEnd']);
    expect(snap.agents).toHaveLength(0);
  });

  it('keyframes only when changed; history returns frames in range plus the last before from', () => {
    const s = new FleetStore({ now });
    expect(s.keyframe()).toBe(false); // empty store, nothing to capture
    s.upsertProject(project('p1', T0));
    expect(s.keyframe(T0)).toBe(true);
    expect(s.keyframe(T0 + 30_000)).toBe(false); // unchanged
    s.upsertProject(project('p1', T0 + 60_000));
    expect(s.keyframe(T0 + 60_000)).toBe(true);
    s.upsertProject(project('p1', T0 + 90_000));
    expect(s.keyframe(T0 + 90_000)).toBe(true);
    s.emitEvent(event(T0 + 10_000, 1));
    s.emitEvent(event(T0 + 70_000, 2));
    s.emitEvent(event(T0 + 95_000, 3));

    const h = s.history(T0 + 50_000, T0 + 80_000);
    expect(h.from).toBe(T0 + 50_000);
    expect(h.to).toBe(T0 + 80_000);
    expect(h.frames.map((f) => f.generatedAt)).toEqual([T0, T0 + 60_000]);
    expect(h.events.map((e) => e.ts)).toEqual([T0 + 70_000]);
    // frames are copies, independent of later mutation
    expect(h.frames[0].projects[0].lastActivity).toBe(T0);

    expect(s.history(T0 + 200_000, T0 + 300_000).frames.map((f) => f.generatedAt)).toEqual([T0 + 90_000]);
    expect(s.history(T0 - 10, T0 - 5).frames).toEqual([]);
    expect(s.history(T0 + 10, T0).frames).toEqual([]);
  });

  it('drops keyframes older than 24h but keeps the immediate predecessor of the cutoff', () => {
    const s = new FleetStore({ now });
    s.upsertProject(project('p1', T0));
    s.keyframe(T0 - 27 * HOUR);
    s.upsertProject(project('p2', T0));
    s.keyframe(T0 - 26 * HOUR);
    s.upsertProject(project('p3', T0));
    s.keyframe(T0 - 25 * HOUR);
    s.prune();
    expect(s.history(0, Infinity).frames.map((f) => f.generatedAt)).toEqual([T0 - 25 * HOUR]);
    s.upsertProject(project('p4', T0));
    s.keyframe(T0 - 23 * HOUR);
    s.upsertProject(project('p5', T0));
    s.keyframe(T0);
    s.prune();
    // predecessor (-25h) kept as initial state for a replay starting at the cutoff
    expect(s.history(0, Infinity).frames.map((f) => f.generatedAt)).toEqual([
      T0 - 25 * HOUR,
      T0 - 23 * HOUR,
      T0,
    ]);
    const h = s.history(T0 - 24 * HOUR, T0);
    expect(h.frames[0].generatedAt).toBe(T0 - 25 * HOUR);
  });

  it('load keeps the frame immediately before the retention cutoff', () => {
    const dir = tmp();
    const s = new FleetStore({ now, persistFrameMs: 1 });
    for (const h of [30, 26, 20, 1]) {
      s.upsertProject(project(`p${h}`, T0));
      s.keyframe(T0 - h * HOUR);
    }
    s.saveSync(dir);
    const r = new FleetStore({ now });
    r.load(dir);
    expect(r.history(0, Infinity).frames.map((f) => f.generatedAt)).toEqual([
      T0 - 26 * HOUR,
      T0 - 20 * HOUR,
      T0 - 1 * HOUR,
    ]);
  });

  it('setOrch(undefined) removes orch embedded via upsertProject or load', () => {
    const orch = {
      projectId: 'p1',
      phase: 'running' as const,
      statusText: '',
      handoffText: '',
      tasks: [],
      inflight: [],
      worktrees: [],
      blocked: [],
      updatedAt: T0,
    };
    const s = new FleetStore({ now });
    s.upsertProject({ ...project('p1', T0), orch });
    expect(s.snapshot().projects[0].orch?.phase).toBe('running');
    s.setOrch('p1', undefined);
    expect(s.snapshot().projects[0].orch).toBeUndefined();
    // a later upsert without orch does not drop a separately set orch
    s.setOrch('p1', orch);
    s.upsertProject(project('p1', T0 + 1));
    expect(s.snapshot().projects[0].orch?.phase).toBe('running');

    const dir = tmp();
    s.saveSync(dir);
    const r = new FleetStore({ now });
    r.load(dir);
    expect(r.snapshot().projects[0].orch?.phase).toBe('running');
    r.setOrch('p1', undefined);
    expect(r.snapshot().projects[0].orch).toBeUndefined();
  });

  it('a failed save keeps the store dirty and the next save succeeds', async () => {
    const base = tmp();
    const blocker = join(base, 'file');
    writeFileSync(blocker, 'x');
    const badDir = join(blocker, 'sub'); // mkdir fails: parent is a regular file
    const s = new FleetStore({ now });
    s.upsertProject(project('p1', T0));
    await expect(s.save(badDir)).rejects.toThrow();
    expect((s as unknown as { dirtySinceSave: boolean }).dirtySinceSave).toBe(true);
    expect(() => s.saveSync(badDir)).toThrow();
    expect((s as unknown as { dirtySinceSave: boolean }).dirtySinceSave).toBe(true);
    const good = join(base, 'ok');
    await s.save(good);
    expect(readdirSync(good)).toEqual([HISTORY_FILE]);
    expect((s as unknown as { dirtySinceSave: boolean }).dirtySinceSave).toBe(false);
  });

  it('save/load keeps the cutoff predecessor even when a newer frame shares its 5min bucket', () => {
    const dir = tmp();
    const bucket = 300_000;
    // cutoff falls mid-bucket: predecessor 1min before cutoff, next frame 1min after, same bucket
    const cutoff = Math.floor((T0 - 24 * HOUR) / bucket) * bucket + 2 * 60_000;
    clock = cutoff + 24 * HOUR;
    const s = new FleetStore({ now });
    s.upsertProject(project('p1', T0));
    s.keyframe(cutoff - 60_000);
    s.upsertProject(project('p2', T0));
    s.keyframe(cutoff + 60_000);
    s.saveSync(dir);
    const r = new FleetStore({ now });
    r.load(dir);
    const h = r.history(cutoff, clock);
    expect(h.frames.map((f) => f.generatedAt)).toEqual([cutoff - 60_000, cutoff + 60_000]);
  });

  it('persists at most one frame per 5 minutes and at most 20k events', () => {
    const dir = tmp();
    const s = new FleetStore({ now, maxEvents: 25_000 });
    // 24h of 30s keyframes
    const start = T0 - 24 * HOUR + 1;
    for (let t = start; t <= T0; t += 30_000) {
      s.upsertProject(project('p1', t));
      s.keyframe(t);
    }
    for (let i = 0; i < 25_000; i++) s.emitEvent(event(T0 - 25_000 + i, i));
    expect(s.history(0, Infinity).frames.length).toBe(2880);
    s.saveSync(dir);
    const file = JSON.parse(readFileSync(join(dir, HISTORY_FILE), 'utf8')) as {
      frames: { generatedAt: number }[];
      events: { ts: number }[];
    };
    expect(file.frames.length).toBeLessThanOrEqual(289);
    expect(file.frames.length).toBeGreaterThanOrEqual(287);
    const buckets = file.frames.map((f) => Math.floor(f.generatedAt / 300_000));
    expect(new Set(buckets).size).toBe(buckets.length);
    expect(file.frames[file.frames.length - 1].generatedAt).toBe(
      s.history(0, Infinity).frames.at(-1)!.generatedAt,
    );
    expect(file.events.length).toBe(20_000);
    expect(file.events[file.events.length - 1].ts).toBe(T0 - 1);
  });

  it('start() captures keyframes every 30s when changed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const s = new FleetStore();
    s.upsertProject(project('p1', T0));
    s.start();
    expect(s.history(0, Infinity).frames).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(s.history(0, Infinity).frames).toHaveLength(1);
    s.upsertProject(project('p1', T0 + 31_000));
    vi.advanceTimersByTime(30_000);
    expect(s.history(0, Infinity).frames).toHaveLength(2);
    return s.close();
  });

  it('save/load roundtrip via atomic write in a temp dir', async () => {
    const dir = tmp();
    const s = new FleetStore({ now });
    s.upsertProject(project('p1', T0));
    s.upsertSession(session('s1', 'p1', T0));
    s.upsertAgent(agent('s1', 's1', 'p1', T0));
    s.addAlert({ id: 'a1', kind: 'army.done', projectId: 'p1', title: 't', body: 'b', at: T0 });
    s.keyframe(T0);
    s.emitEvent(event(T0, 1));
    s.emitEvent(event(T0 + 1, 2));
    await s.save(dir);
    expect(readdirSync(dir)).toEqual([HISTORY_FILE]); // no tmp leftovers

    clock = T0 + 1000;
    const r = new FleetStore({ now });
    expect(r.load(dir)).toBe(true);
    const h = r.history(0, Infinity);
    expect(h.events.map((e) => e.id)).toEqual([`${T0}-1`, `${T0 + 1}-2`]);
    expect(h.frames).toHaveLength(1);
    const snap = r.snapshot();
    expect(snap.projects.map((p) => p.id)).toEqual(['p1']);
    expect(snap.sessions.map((x) => x.id)).toEqual(['s1']);
    expect(snap.agents.map((x) => x.id)).toEqual(['s1']);
    expect(snap.alerts.map((x) => x.id)).toEqual(['a1']);
  });

  it('load prunes data older than 24h and handles missing/malformed files', () => {
    const dir = tmp();
    const s = new FleetStore({ now });
    s.upsertProject(project('p1', T0));
    s.keyframe(T0);
    s.emitEvent(event(T0, 1));
    s.saveSync(dir);

    clock = T0 + 25 * HOUR;
    const r = new FleetStore({ now });
    r.load(dir);
    expect(r.history(0, Infinity).events).toEqual([]);
    // the only frame precedes the cutoff, so it is kept as replay baseline
    expect(r.history(0, Infinity).frames.map((f) => f.generatedAt)).toEqual([T0]);

    expect(new FleetStore({ now }).load(tmp())).toBe(false);
    const bad = tmp();
    writeFileSync(join(bad, HISTORY_FILE), '{not json');
    expect(() => new FleetStore({ now }).load(bad)).toThrow(/malformed/);
    writeFileSync(join(bad, HISTORY_FILE), JSON.stringify({ version: 99, frames: [], events: [] }));
    expect(() => new FleetStore({ now }).load(bad)).toThrow(/unsupported/);
  });

  it('close() writes history when dataDir is set', async () => {
    const dir = tmp();
    const s = new FleetStore({ now, dataDir: dir });
    s.start();
    s.upsertProject(project('p1', T0));
    s.emitEvent(event(T0, 1));
    await s.close();
    const r = new FleetStore({ now });
    expect(r.load(dir)).toBe(true);
    expect(r.history(0, Infinity).events).toHaveLength(1);
    expect(r.snapshot().projects).toHaveLength(1);
  });
});
