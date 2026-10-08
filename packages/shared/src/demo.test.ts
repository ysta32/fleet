import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createDemoFleet } from './demo.js';
import type { FleetEvent, FleetSnapshot } from './types.js';

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
    if (session.status === 'ended' && agents.length === 0) {
      // Archived and rolled-up sessions keep their usage after their agents leave the harbour.
      expect(session.costUsd).toBeGreaterThanOrEqual(0);
      expect(session.agentIds).toEqual([]);
      continue;
    }
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

  it('runs the visual task lifecycle with a busy event cadence and costs', () => {
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
      'army.done',
      'session.end',
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
    const done = events.findIndex((event) => event.kind === 'army.done');
    expect(events.slice(done + 1).some((event) => event.kind === 'session.start')).toBe(true);
    expect(fleet.snapshot().sessions.reduce((sum, session) => sum + session.costUsd, 0)).toBeGreaterThan(0);
    expect(events.every((event) => event.label.length <= 80)).toBe(true);
  });

  it.each([42, 7, 999])('keeps a believable business pace over an 8h night (seed %i)', (seed) => {
    const fleet = createDemoFleet({ seed, now: NOW });
    const events: FleetEvent[] = [];
    const open: number[] = [];
    for (let hour = 0; hour < 8; hour++) {
      open.push(fleet.snapshot().prs.filter((pr) => pr.state === 'open').length);
      for (let step = 0; step < 30; step++) events.push(...fleet.tick(120_000));
    }
    const count = (kind: FleetEvent['kind'], severity?: FleetEvent['severity']) =>
      events.filter((event) => event.kind === kind && (!severity || event.severity === severity)).length;
    expect(count('merge')).toBeGreaterThanOrEqual(15);
    expect(count('merge')).toBeLessThanOrEqual(35);
    expect(count('ci', 'error')).toBeGreaterThanOrEqual(1);
    expect(count('ci', 'error')).toBeLessThanOrEqual(3);
    expect(count('release')).toBeLessThanOrEqual(2);
    expect(count('deploy')).toBeGreaterThanOrEqual(3);
    expect(count('deploy')).toBeLessThanOrEqual(10);
    for (const value of open) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(8);
    }
    const totals = fleet.overnight(8).totals;
    // Every CI failure is repaired later on the same project (repairs take up to 80 minutes, so keep
    // running past the night to see repairs of failures from its last hour).
    const after = Array.from({ length: 45 }, () => fleet.tick(120_000)).flat();
    const all = [...events, ...after];
    events.forEach((event, index) => {
      if (event.kind !== 'ci' || event.severity !== 'error') return;
      expect(
        all
          .slice(index + 1)
          .some(
            (next) =>
              next.projectId === event.projectId && next.kind === 'ci' && next.label === 'CI repaired',
          ),
      ).toBe(true);
    });
    expect(totals.mergedPRs).toBe(count('merge'));
    expect(totals.ciFailures).toBe(count('ci', 'error'));
    expect(totals.commits).toBeGreaterThanOrEqual(2 * totals.mergedPRs);
    expect(totals.commits).toBeLessThanOrEqual(5 * totals.mergedPRs);
    // The harbour stays busy: visual events far outnumber business ones.
    expect(count('agent.tool')).toBeGreaterThan(50 * count('merge'));
  });

  it('keeps references and dependency states valid through multiple army restarts', () => {
    const fleet = createDemoFleet({ now: NOW });
    for (let step = 0; step < 1800; step++) {
      fleet.tick(800);
      checkReferences(fleet.snapshot());
    }
    const snapshot = fleet.snapshot();
    expect(snapshot.sessions.filter((session) => session.status !== 'ended').length).toBeLessThanOrEqual(6);
    expect(snapshot.sessions.length).toBeLessThanOrEqual(6 + 12 + 12);
    expect(snapshot.agents.length).toBeLessThanOrEqual(36);
  });

  it('isolates snapshots, events and historical frames from caller mutation', () => {
    const fleet = createDemoFleet({ now: NOW });
    // tick until a move event comes out (holds can keep the first seconds quiet)
    let event: FleetEvent | undefined;
    for (let step = 0; step < 200 && !event; step++) event = fleet.tick(800).find((entry) => entry.to);
    expect(event).toBeDefined();
    event!.to!.projectId = 'mutated';
    const before = fleet.snapshot();
    const detached = fleet.snapshot();
    const running = detached.projects.findIndex((project) => project.orch);
    detached.projects[running]!.orch!.tasks[0]!.depends.push('missing');
    detached.agents[0]!.tokens.input = -1;
    detached.agents[0]!.location.projectId = 'missing';
    detached.sessions[0]!.agentIds.length = 0;
    expect(fleet.snapshot()).toEqual(before);
    const history = fleet.history(0.1);
    const live = fleet.snapshot();
    const first = JSON.stringify(history.frames[0]);
    history.frames[1]!.projects.find((project) => project.orch)!.orch!.tasks[0]!.depends.push('missing');
    expect(JSON.stringify(history.frames[0])).toBe(first);
    history.events[0]!.label = 'mutated';
    expect(fleet.snapshot()).toEqual(live);
    expect(fleet.history(0.1).events[0]!.label).not.toBe('mutated');
  });

  it('pre-simulates history on creation and continues the same trajectory live', () => {
    const start = performance.now();
    const fleet = createDemoFleet({ now: NOW, seed: 17 });
    const history = fleet.history(6);
    // Smoke budget against pathological slowdowns: ~100ms locally, but shared CI runners are 5x slower and noisy.
    expect(performance.now() - start).toBeLessThan(1500);
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
    // Notable events cover the whole window, not just its tail.
    const notable = history.events.filter((event) =>
      ['merge', 'ci', 'release', 'deploy', 'review', 'test.run'].includes(event.kind),
    );
    expect(notable[0]!.ts - history.from).toBeLessThan(10 * 60_000);
    expect(history.events.every((event) => event.ts >= history.from && event.ts <= NOW)).toBe(true);
    expect(history.events.map((event) => event.ts)).toEqual(
      history.events.map((event) => event.ts).sort((a, b) => a - b),
    );
    // Same seed and clock reproduce the same past and the same future.
    const twin = createDemoFleet({ now: NOW, seed: 17 });
    expect(twin.history(6)).toEqual(history);
    expect(fleet.tick(60_000)).toEqual(twin.tick(60_000));
    const current = fleet.snapshot();
    expect(current).toEqual(twin.snapshot());
    expect(fleet.history(6).frames.at(-1)).toEqual(current);
    expect(fleet.snapshot()).toEqual(current);
    expect(fleet.history(6).events.at(-1)!.ts).toBeGreaterThan(NOW);
  });

  it('starts with a past at first paint and exactly one army waiting on the user', () => {
    const snapshot = createDemoFleet({ now: NOW }).snapshot();
    expect(snapshot.prs.some((pr) => pr.state === 'merged')).toBe(true);
    expect(snapshot.prs.some((pr) => pr.state === 'open')).toBe(true);
    expect(snapshot.prs.some((pr) => pr.ci !== 'pending')).toBe(true);
    expect(snapshot.releases.length).toBeGreaterThan(0);
    expect(snapshot.deploys.length).toBeGreaterThan(0);
    expect(snapshot.sessions.reduce((sum, session) => sum + session.costUsd, 0)).toBeGreaterThan(1);
    expect(snapshot.sessions.filter((session) => session.status === 'waiting')).toHaveLength(1);
    expect(snapshot.agents.filter((agent) => agent.status === 'waiting')).toHaveLength(1);
    expect(
      snapshot.alerts.filter((alert) => !alert.cleared && alert.kind === 'session.waiting'),
    ).toHaveLength(1);
    const runs = snapshot.projects.flatMap((project) => (project.orch ? [project.orch] : []));
    expect(runs.some((run) => run.tasks.some((task) => task.state === 'landed'))).toBe(true);
    // Every lead does its own work, so a lead never shows zero tokens next to a nonzero cost.
    for (const session of snapshot.sessions.filter(
      (entry) => entry.status !== 'ended' && entry.costUsd > 0,
    )) {
      const lead = snapshot.agents.find((agent) => agent.id === session.id)!;
      expect(lead.tokens.input).toBeGreaterThan(0);
      expect(lead.label).not.toMatch(/lead lead/);
    }
    checkReferences(snapshot);
  });

  it('varies army DAGs across runs', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 5 });
    const shapes = new Set<string>();
    for (let step = 0; step < 60; step++) {
      fleet.tick(120_000);
      for (const project of fleet.snapshot().projects)
        if (project.orch) shapes.add(project.orch.tasks.map((task) => task.depends.join('+')).join('|'));
    }
    expect(shapes.size).toBeGreaterThan(3);
  });

  it.each([1, 9, 42, 7, 999, 2024])(
    'keeps needs-you incidents to 3-5 in every rolling 12h window, each 5 to 45 minutes (seed %i)',
    (seed) => {
      const fleet = createDemoFleet({ now: NOW, seed });
      // The pre-simulated night (with the wait left open at load) plus 24h live, collected once each.
      // An incident is a wait or the one CI failure a night that needs the operator (its alert).
      const isStart = (event: FleetEvent) =>
        event.kind === 'session.waiting' || (event.kind === 'ci' && event.data?.alert === true);
      const events = fleet.history(12).events;
      for (let step = 0; step < 720; step++) {
        events.push(...fleet.tick(120_000));
        // Windows that end mid-step past load (e.g. 361 steps) are read straight from history too.
        if (step === 360) {
          const night = fleet.history(12).events.filter(isStart);
          expect(night.length).toBeGreaterThanOrEqual(3);
          expect(night.length).toBeLessThanOrEqual(5);
        }
      }
      const starts = events.filter(isStart);
      const waits = starts.filter((event) => event.kind === 'session.waiting');
      const ci = starts.filter((event) => event.kind === 'ci');
      expect(events.filter((event) => event.kind === 'blocked')).toHaveLength(waits.length);
      // the demo shows a CI-failure incident, at most one in any 12h
      expect(ci.length).toBeGreaterThanOrEqual(1);
      for (const [index, failure] of ci.entries())
        if (index > 0) expect(failure.ts - ci[index - 1]!.ts).toBeGreaterThanOrEqual(12 * 3_600_000);
      const last = NOW + 720 * 120_000;
      for (let from = NOW - 12 * 3_600_000; from + 12 * 3_600_000 <= last; from += 10 * 60_000) {
        const count = starts.filter((event) => event.ts >= from && event.ts < from + 12 * 3_600_000).length;
        expect(count, `window starting ${(from - NOW) / 60_000} min`).toBeGreaterThanOrEqual(3);
        expect(count, `window starting ${(from - NOW) / 60_000} min`).toBeLessThanOrEqual(5);
      }
      for (const [index, begin] of starts.entries()) {
        // Scheduled waits start 185-232 minutes apart, so they never overlap; only the wait settled
        // at load (at NOW) may follow sooner, after ending any wait in progress.
        const next = starts[index + 1];
        if (next && next.ts !== NOW) {
          expect(next.ts - begin.ts).toBeGreaterThanOrEqual(185 * 60_000);
          expect(next.ts - begin.ts).toBeLessThan(240 * 60_000);
        }
        const end = events.find((event) =>
          begin.kind === 'ci'
            ? event.ts > begin.ts &&
              event.projectId === begin.projectId &&
              event.label === 'CI repaired' &&
              event.data?.number === begin.data?.number
            : event.ts > begin.ts &&
              event.sessionId === begin.sessionId &&
              event.label === 'Approved, resuming',
        );
        if (!end) continue;
        expect(end.ts - begin.ts).toBeGreaterThanOrEqual(5 * 60_000);
        expect(end.ts - begin.ts).toBeLessThanOrEqual(45 * 60_000 + 3_000);
      }
    },
  );

  it.each([42, 7, 999])('varies tool targets, model mixes and step pacing by seed (seed %i)', (seed) => {
    const fleet = createDemoFleet({ seed, now: NOW });
    const snapshot = fleet.snapshot();
    // last tools ("Read · HANDOFF.md") differ across sessions: none on more than a third of them
    const targets = snapshot.sessions.flatMap((session) =>
      session.lastTool ? [`${session.lastTool.name} ${session.lastTool.target}`] : [],
    );
    expect(targets.length).toBeGreaterThanOrEqual(6);
    const most = Math.max(
      ...[...new Set(targets)].map((target) => targets.filter((t) => t === target).length),
    );
    expect(most).toBeLessThanOrEqual(Math.ceil(targets.length / 3));
    // each army staffs its roles with its own model mix
    const mixes = snapshot.projects
      .filter((project) => project.orch)
      .map((project) =>
        snapshot.agents
          .filter((agent) => agent.projectId === project.id && agent.role !== 'lead')
          .map((agent) => agent.model)
          .join(','),
      );
    expect(new Set(mixes).size).toBeGreaterThan(1);
    // steps take uneven time: gaps between a task's events span more than the 2.4s turn grid
    const byTask = new Map<string, number[]>();
    for (const event of fleet.history(1).events) {
      if (!event.taskId) continue;
      const key = `${event.sessionId}/${event.taskId}`;
      byTask.set(key, [...(byTask.get(key) ?? []), event.ts]);
    }
    const gaps = new Set<number>();
    for (const times of byTask.values())
      for (let index = 1; index < times.length; index++)
        gaps.add(Math.round((times[index]! - times[index - 1]!) / 1000));
    expect([...gaps].filter((gap) => gap >= 5).length).toBeGreaterThanOrEqual(3);
    // same seed, same choices
    expect(createDemoFleet({ seed, now: NOW }).snapshot()).toEqual(snapshot);
  });

  it('raises wait alerts about their task and session, and CI alerts only for incident failures', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 9 });
    let ciAlerts = 0;
    for (let step = 0; step < 360; step++) {
      const events = fleet.tick(120_000);
      const snapshot = fleet.snapshot();
      const incidentFailures = events.filter((event) => event.kind === 'ci' && event.data?.alert === true);
      for (const failure of incidentFailures) {
        // the alert names the PR, has no task or session, and lives until the repair
        const alert = snapshot.alerts.find(
          (entry) =>
            entry.kind === 'ci.failed' && entry.at === failure.ts && entry.projectId === failure.projectId,
        );
        expect(alert?.body).toContain(`#${failure.data!.number}`);
        ciAlerts++;
      }
      for (const alert of snapshot.alerts) {
        if (alert.kind === 'ci.failed') {
          expect(alert.taskId).toBeUndefined();
          continue;
        }
        expect(alert.taskId).toMatch(/^t\d\d$/);
        expect(snapshot.sessions.some((session) => session.id === alert.sessionId) || alert.cleared).toBe(
          true,
        );
      }
      for (const agent of snapshot.agents.filter((entry) => entry.status === 'waiting')) {
        const run = snapshot.projects.find((project) => project.id === agent.projectId)!.orch!;
        expect(run.blocked).toEqual([agent.currentTask]);
      }
    }
    expect(ciAlerts).toBeGreaterThanOrEqual(1);
    expect(ciAlerts).toBeLessThanOrEqual(1);
  });

  it('uses realistic, unprefixed titles and ids', () => {
    const fleet = createDemoFleet({ now: NOW });
    for (let step = 0; step < 120; step++) fleet.tick(120_000);
    const snapshot = fleet.snapshot();
    // `path` is never displayed and keeps its /synthetic/ privacy marker; everything else is user-facing.
    const shown = { ...snapshot, projects: snapshot.projects.map(({ path: _path, ...project }) => project) };
    expect(snapshot.projects.every((project) => project.path === `/synthetic/${project.name}`)).toBe(true);
    const text = JSON.stringify([shown, fleet.history(12).events, fleet.overnight(12)]);
    expect(text).not.toMatch(/synthetic/i);
    expect(text).not.toMatch(/checkpoint/i);
    for (const project of snapshot.projects) expect(project.id).toBe(project.name);
    for (const run of snapshot.projects.flatMap((project) => (project.orch ? [project.orch] : [])))
      for (const entry of run.inflight) {
        expect(entry.agent).toMatch(/^[a-z][a-z0-9-]*:run-\d+:a\d$/);
        expect(entry.started).toMatch(/^\d{2}:\d{2}$/);
      }
    for (const pr of snapshot.prs) expect(pr.title).toMatch(/^[A-Z][^#]{8,}$/);
    for (const session of snapshot.sessions) expect(session.title).not.toMatch(/^(Synthetic|Demo)\b/);
  });

  it('summarizes the night ending now from the same simulation', () => {
    const fleet = createDemoFleet({ now: NOW });
    const digest = fleet.overnight();
    const snapshot = fleet.snapshot();
    expect(digest.window.until).toBe(new Date(NOW).toISOString());
    expect(Date.parse(digest.window.until) - Date.parse(digest.window.since)).toBe(8 * 3_600_000);
    expect(digest.projects.map((project) => project.name)).toEqual(
      snapshot.projects.map((project) => project.name),
    );
    expect(digest.totals.projectsActive).toBe(snapshot.projects.length);
    expect(digest.totals.mergedPRs).toBeGreaterThan(0);
    const waiting = snapshot.sessions.find((session) => session.status === 'waiting')!;
    expect(digest.projects.find((project) => project.id === waiting.projectId)!.health).toBe('red');
    expect(digest.headline).toMatch(/needs? you/);
    const prs = new Set(snapshot.prs.map((pr) => `${pr.projectId}#${pr.number}`));
    const latest = digest.projects.flatMap((project) =>
      project.mergedPRs.slice(0, 1).map((pr) => `${project.id}#${pr.number}`),
    );
    expect(latest.some((key) => prs.has(key))).toBe(true);
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
    expect(history.events.length).toBeLessThanOrEqual(28_000);
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
    // Twelve hours: waits (paired alerts) are the only alerts and they are rare, so sample a long span.
    for (let step = 0; step < 360; step++) {
      fleet.tick(120_000);
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
    const initial = fleet
      .snapshot()
      .sessions.filter((session) => session.agentIds.length > 0)
      .map((session) => session.id);
    // Long enough to outlast the needs-you wait seeded at load (at most 30 minutes) plus a full run.
    for (let step = 0; step < 4500; step++) {
      fleet.tick(800);
      const snapshot = fleet.snapshot();
      expect(snapshot.sessions.filter((session) => session.agentIds.length > 0)).toHaveLength(3);
      expect(snapshot.agents).toHaveLength(18);
      for (const session of snapshot.sessions.filter((entry) => entry.agentIds.length === 0))
        expect(snapshot.agents.some((agent) => agent.sessionId === session.id)).toBe(false);
      expect(snapshot.projects.filter((project) => project.orch)).toHaveLength(3);
      for (const project of snapshot.projects.filter((project) => !project.orch)) {
        expect(
          snapshot.sessions.some(
            (session) => session.projectId === project.id && session.agentIds.length > 0,
          ),
        ).toBe(false);
        expect(snapshot.agents.some((agent) => agent.projectId === project.id)).toBe(false);
      }
    }
    expect(
      fleet
        .snapshot()
        .sessions.filter((session) => session.agentIds.length > 0)
        .every((session) => !initial.includes(session.id)),
    ).toBe(true);
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
