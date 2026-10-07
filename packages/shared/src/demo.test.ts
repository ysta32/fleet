import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createDemoFleet } from './demo.js';
import type { FleetSnapshot } from './types.js';

const NOW = Date.UTC(2026, 0, 1);

function checkReferences(snapshot: FleetSnapshot): void {
  for (const session of snapshot.sessions) {
    expect(snapshot.projects.some((project) => project.id === session.projectId)).toBe(true);
    expect(session.agentIds.sort()).toEqual(
      snapshot.agents
        .filter((agent) => agent.sessionId === session.id)
        .map((agent) => agent.id)
        .sort(),
    );
    const agents = snapshot.agents.filter((agent) => agent.sessionId === session.id);
    expect(session.tokens.input).toBe(agents.reduce((sum, agent) => sum + agent.tokens.input, 0));
  }
  for (const agent of snapshot.agents) {
    const project = snapshot.projects.find((entry) => entry.id === agent.projectId);
    expect(project).toBeDefined();
    expect(snapshot.sessions.some((session) => session.id === agent.sessionId)).toBe(true);
    expect(agent.location.projectId).toBe(project!.id);
    const { kind, ref } = agent.location;
    if (agent.currentTask)
      expect(project!.orch!.tasks.some((task) => task.id === agent.currentTask)).toBe(true);
    if (kind === 'task' || kind === 'review')
      expect(project!.orch!.tasks.some((task) => task.id === ref)).toBe(true);
    if (kind === 'worktree') expect(project!.orch!.worktrees).toContain(ref);
    if (kind === 'ci')
      expect(snapshot.prs.some((pr) => pr.projectId === project!.id && String(pr.number) === ref)).toBe(true);
    if (kind === 'deploy')
      expect(snapshot.deploys.some((deploy) => deploy.projectId === project!.id && deploy.id === ref)).toBe(
        true,
      );
    if (kind === 'project') expect(ref).toBeUndefined();
  }
  for (const project of snapshot.projects) {
    for (const task of project.orch?.tasks ?? []) {
      if (['running', 'review', 'landed'].includes(task.state)) {
        for (const dependency of task.depends) {
          expect(project.orch!.tasks.find((entry) => entry.id === dependency)?.state).toBe('landed');
        }
      }
    }
  }
}

describe('createDemoFleet', () => {
  it('starts six invented projects and three armies with valid DAGs and all roles', () => {
    const snapshot = createDemoFleet({ now: NOW }).snapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.projects.map((project) => project.name)).toEqual([
      'aurora-api',
      'nebula-ui',
      'quasar-cli',
      'helix-db',
      'orbit-docs',
      'pulsar-ml',
    ]);
    const runs = snapshot.projects.flatMap((project) => (project.orch ? [project.orch] : []));
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.tasks.length).toBeGreaterThanOrEqual(8);
      expect(run.tasks.length).toBeLessThanOrEqual(14);
      run.tasks.forEach((task, index) => {
        for (const dependency of task.depends)
          expect(run.tasks.slice(0, index).map((entry) => entry.id)).toContain(dependency);
      });
    }
    expect(new Set(snapshot.agents.map((agent) => agent.role))).toEqual(
      new Set(['lead', 'coder', 'critic', 'scout', 'tester']),
    );
    checkReferences(snapshot);
  });

  it('is deterministic by seed and independent of tick chunking', () => {
    const a = createDemoFleet({ seed: 71, now: NOW });
    const b = createDemoFleet({ seed: 71, now: NOW });
    const aEvents = a.tick(600_000);
    const bEvents = Array.from({ length: 1200 }, () => b.tick(500)).flat();
    expect(aEvents).toEqual(bEvents);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(createDemoFleet({ seed: 72, now: NOW }).tick(600_000)).not.toEqual(aEvents);
    expect(new Set(aEvents.map((event) => event.id)).size).toBe(aEvents.length);
    expect(aEvents.map((event) => event.ts)).toEqual(aEvents.map((event) => event.ts).sort((x, y) => x - y));
    expect(aEvents.every((event) => event.ts > NOW && event.ts <= NOW + 600_000)).toBe(true);
  });

  it('runs the complete lifecycle with realistic overall event cadence and costs', () => {
    const fleet = createDemoFleet({ seed: 42, now: NOW });
    const events = fleet.tick(600_000);
    const kinds = new Set(events.map((event) => event.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    for (const kind of [
      'session.start',
      'agent.spawn',
      'agent.move',
      'agent.tool',
      'task.state',
      'test.run',
      'review',
      'merge',
      'ci',
      'deploy',
      'release',
      'army.done',
      'session.end',
      'session.waiting',
      'blocked',
    ]) {
      expect(kinds.has(kind as (typeof events)[number]['kind'])).toBe(true);
    }
    expect(events.length / 600).toBeGreaterThanOrEqual(1);
    expect(events.length / 600).toBeLessThanOrEqual(4);
    expect(
      events.filter((event) => event.kind === 'agent.move').every((event) => event.to !== undefined),
    ).toBe(true);
    expect(
      new Set(events.filter((event) => event.kind === 'agent.tool').map((event) => event.data?.name)),
    ).toEqual(new Set(['Read', 'Edit', 'Bash']));
    const failure = events.findIndex((event) => event.kind === 'ci' && event.severity === 'error');
    expect(failure).toBeGreaterThanOrEqual(0);
    expect(
      events
        .slice(failure + 1)
        .some(
          (event) =>
            event.projectId === events[failure]!.projectId &&
            event.kind === 'ci' &&
            event.label === 'CI repaired',
        ),
    ).toBe(true);
    const done = events.findIndex((event) => event.kind === 'army.done');
    expect(events.slice(done + 1).some((event) => event.kind === 'session.start')).toBe(true);
    expect(fleet.snapshot().sessions.reduce((sum, session) => sum + session.costUsd, 0)).toBeGreaterThan(0);
    expect(events.every((event) => event.label.length <= 80)).toBe(true);
  });

  it('keeps references and dependency states valid through multiple army restarts', () => {
    const fleet = createDemoFleet({ now: NOW });
    for (let step = 0; step < 1800; step++) {
      fleet.tick(800);
      checkReferences(fleet.snapshot());
    }
    const snapshot = fleet.snapshot();
    expect(snapshot.sessions.length).toBeLessThanOrEqual(6);
    expect(snapshot.agents.length).toBeLessThanOrEqual(36);
  });

  it('isolates snapshots, events and historical frames from caller mutation', () => {
    const fleet = createDemoFleet({ now: NOW });
    const event = fleet.tick(800).find((entry) => entry.to)!;
    event.to!.projectId = 'mutated';
    const before = fleet.snapshot();
    const detached = fleet.snapshot();
    detached.projects[0]!.orch!.tasks[0]!.depends.push('missing');
    detached.agents[0]!.tokens.input = -1;
    detached.agents[0]!.location.projectId = 'missing';
    detached.sessions[0]!.agentIds.length = 0;
    expect(fleet.snapshot()).toEqual(before);
    const history = fleet.history(0.1);
    const first = JSON.stringify(history.frames[0]);
    history.frames[1]!.projects[0]!.orch!.tasks[0]!.depends.push('missing');
    expect(JSON.stringify(history.frames[0])).toBe(first);
    expect(fleet.snapshot()).toEqual(before);
  });

  it('generates six hours of history in under 500ms, with exact replay every 30 seconds', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 17 });
    const start = performance.now();
    const history = fleet.history(6);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
    expect(history.from).toBe(NOW - 6 * 3_600_000);
    expect(history.to).toBe(NOW);
    expect(history.frames).toHaveLength(721);
    expect(history.frames.every((frame, index) => frame.generatedAt === history.from + index * 30_000)).toBe(
      true,
    );
    const replay = createDemoFleet({ seed: 17, now: history.from });
    expect(history.frames[0]).toEqual(replay.snapshot());
    expect(history.events).toEqual(replay.tick(6 * 3_600_000));
    expect(history.frames.at(-1)).toEqual(replay.snapshot());
    expect(fleet.snapshot().generatedAt).toBe(NOW);
  });

  it('uses the current clock for history and caps its duration to 24 hours', () => {
    const fleet = createDemoFleet({ now: NOW, projects: 1 });
    fleet.tick(1000);
    expect(fleet.history(0)).toEqual({
      from: NOW + 1000,
      to: NOW + 1000,
      frames: [createDemoFleet({ now: NOW + 1000, projects: 1 }).snapshot()],
      events: [],
    });
    const history = fleet.history(25);
    expect(history.to - history.from).toBe(24 * 3_600_000);
  });

  it('supports smaller project counts and rejects invalid time or count inputs', () => {
    for (const projects of [1, 2, 5]) {
      const fleet = createDemoFleet({ now: NOW, projects });
      fleet.tick(600_000);
      expect(fleet.snapshot().projects).toHaveLength(projects);
      checkReferences(fleet.snapshot());
    }
    const fleet = createDemoFleet({ now: NOW });
    expect(fleet.tick(0)).toEqual([]);
    for (const value of [-1, NaN, Infinity]) {
      expect(() => fleet.tick(value)).toThrow(RangeError);
      expect(() => fleet.history(value)).toThrow(RangeError);
    }
    for (const projects of [0, 1.5, NaN, 25]) expect(() => createDemoFleet({ projects })).toThrow(RangeError);
  });
});
