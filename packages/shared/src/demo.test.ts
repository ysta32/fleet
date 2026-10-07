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

  it('is deterministic by seed and independent of tick chunking within the catch-up limit', () => {
    const a = createDemoFleet({ seed: 71, now: NOW });
    const b = createDemoFleet({ seed: 71, now: NOW });
    const aEvents = a.tick(120_000);
    const bEvents = Array.from({ length: 240 }, () => b.tick(500)).flat();
    expect(aEvents).toEqual(bEvents);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(createDemoFleet({ seed: 72, now: NOW }).tick(120_000)).not.toEqual(aEvents);
    expect(new Set(aEvents.map((event) => event.id)).size).toBe(aEvents.length);
    expect(aEvents.map((event) => event.ts)).toEqual(aEvents.map((event) => event.ts).sort((x, y) => x - y));
    expect(aEvents.every((event) => event.ts > NOW && event.ts <= NOW + 600_000)).toBe(true);
  });

  it('runs the complete lifecycle with realistic overall event cadence and costs', () => {
    const fleet = createDemoFleet({ seed: 42, now: NOW });
    const events = Array.from({ length: 5 }, () => fleet.tick(120_000)).flat();
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
    const live = fleet.snapshot();
    const first = JSON.stringify(history.frames[0]);
    history.frames[1]!.projects[0]!.orch!.tasks[0]!.depends.push('missing');
    expect(JSON.stringify(history.frames[0])).toBe(first);
    history.events[0]!.label = 'mutated';
    expect(fleet.snapshot()).toEqual(live);
    expect(fleet.history(0.1).events[0]!.label).not.toBe('mutated');
  });

  it('prewarms bounded history and continues the live fleet from its final state', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 17 });
    const start = performance.now();
    const history = fleet.history(6);
    expect(performance.now() - start).toBeLessThan(500);
    expect(history.from).toBe(NOW - 6 * 3_600_000);
    expect(history.to).toBe(NOW);
    expect(history.frames.length).toBeLessThanOrEqual(720);
    expect(history.frames[0]!.generatedAt).toBe(history.from);
    expect(
      history.frames.every(
        (frame, index) => index === 0 || frame.generatedAt - history.frames[index - 1]!.generatedAt >= 30_000,
      ),
    ).toBe(true);
    expect(history.frames.at(-1)).toEqual(fleet.snapshot());
    const replay = createDemoFleet({ seed: 17, now: history.from });
    const events = [];
    for (let elapsed = 0; elapsed < 6 * 3_600_000; elapsed += 30_000) {
      events.push(...replay.tick(30_000));
    }
    expect(history.events).toHaveLength(20_000);
    expect(history.events).toEqual(events.slice(-20_000));
    expect(fleet.snapshot()).toEqual(replay.snapshot());
    expect(fleet.tick(60_000)).toEqual(replay.tick(60_000));
    const current = fleet.snapshot();
    expect(fleet.history(6).frames.at(-1)).toEqual(current);
    expect(fleet.snapshot()).toEqual(current);
    expect(fleet.history(6).events.at(-1)!.ts).toBeGreaterThan(NOW);
  });

  it('uses the current state for zero history and caps history to twelve hours', () => {
    const fleet = createDemoFleet({ now: NOW, projects: 1 });
    fleet.tick(1000);
    expect(fleet.history(0)).toEqual({
      from: NOW + 1000,
      to: NOW + 1000,
      frames: [fleet.snapshot()],
      events: [],
    });
    const history = fleet.history(25);
    expect(history.to - history.from).toBe(12 * 3_600_000);
    expect(history.frames.length).toBeLessThanOrEqual(720);
    expect(history.events.length).toBeLessThanOrEqual(20_000);
    expect(history.frames.at(-1)).toEqual(fleet.snapshot());
    checkReferences(fleet.snapshot());
  });

  it('includes the live endpoint when the history duration is not a frame interval', () => {
    const fleet = createDemoFleet({ now: NOW });
    const history = fleet.history(0.001);
    expect(history.frames.at(-1)!.generatedAt).toBe(NOW);
    expect(history.frames.at(-1)).toEqual(fleet.snapshot());
    fleet.tick(800);
    expect(fleet.history(0.001).frames.at(-1)).toEqual(fleet.snapshot());
  });

  it('assigns distinct increasing alert ids even to alerts emitted in the same step', () => {
    const fleet = createDemoFleet({ now: NOW });
    const seen = new Map<string, number>();
    let lastSequence = -1;
    let pairedAlerts = false;
    for (let step = 0; step < 1500; step++) {
      fleet.tick(800);
      const alerts = fleet.snapshot().alerts;
      expect(new Set(alerts.map((alert) => alert.id)).size).toBe(alerts.length);
      for (const alert of alerts) {
        if (seen.has(alert.id)) continue;
        const sequence = Number(alert.id.split('-').at(-1));
        expect(sequence).toBeGreaterThan(lastSequence);
        lastSequence = sequence;
        seen.set(alert.id, alert.at);
      }
      if (alerts.some((a, i) => alerts.some((b, j) => i !== j && a.at === b.at))) pairedAlerts = true;
    }
    expect(pairedAlerts).toBe(true);
    expect(seen.size).toBeGreaterThan(12);
  });

  it('caps catch-up at two minutes and silently skips the remaining time in under 50ms', () => {
    const fleet = createDemoFleet({ now: NOW });
    const limited = createDemoFleet({ now: NOW });
    const expected = limited.tick(120_000);
    const start = performance.now();
    const events = fleet.tick(1e12);
    expect(performance.now() - start).toBeLessThan(50);
    expect(events).toEqual(expected);
    expect(fleet.snapshot()).toEqual({ ...limited.snapshot(), generatedAt: NOW + 1e12 });
    expect(fleet.tick(0)).toEqual([]);
    expect(fleet.tick(799)).toEqual([]);
    const next = fleet.tick(1);
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((event) => event.ts === NOW + 1e12 + 800)).toBe(true);
    const warmed = createDemoFleet({ now: NOW });
    warmed.history(0.1);
    const warmedStart = performance.now();
    warmed.tick(1e12);
    expect(performance.now() - warmedStart).toBeLessThan(50);
    const history = warmed.history(12);
    expect(history.frames).toEqual([warmed.snapshot()]);
    expect(history.events).toEqual([]);
  });

  it('removes completed armies from their old projects after relocation', () => {
    const fleet = createDemoFleet({ now: NOW });
    const initial = fleet.snapshot().sessions.map((session) => session.id);
    for (let step = 0; step < 900; step++) {
      fleet.tick(800);
      const snapshot = fleet.snapshot();
      expect(snapshot.sessions).toHaveLength(3);
      expect(snapshot.agents).toHaveLength(18);
      expect(snapshot.projects.filter((project) => project.orch)).toHaveLength(3);
      for (const project of snapshot.projects.filter((project) => !project.orch)) {
        expect(snapshot.sessions.some((session) => session.projectId === project.id)).toBe(false);
        expect(snapshot.agents.some((agent) => agent.projectId === project.id)).toBe(false);
      }
    }
    expect(fleet.snapshot().sessions.every((session) => !initial.includes(session.id))).toBe(true);
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
