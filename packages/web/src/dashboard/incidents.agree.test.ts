import { describe, expect, it } from 'vitest';
import { createDemoFleet, createDemoWorld } from '@fleet/shared';
import type { FleetSnapshot } from '@fleet/shared';
import {
  buildTimeline,
  incidentMoments,
  normalizeHistory,
  openIncidentIds,
  reconstruct,
} from '../data/replay';
import { liveHistory } from '../data/liveTape';
import {
  aggregateFleet,
  headerVitals,
  incidentsByProject,
  needsYou,
  nowWorking,
  stationNeeds,
  withDismissed,
} from './model';

const NOW = new Date(2026, 9, 8, 1, 4).getTime();
const MIN = 60_000;

/** Every needs-you surface, read the way the app reads it. */
function surfaces(snapshot: FleetSnapshot, dismissed: ReadonlySet<string> = new Set()) {
  const list = needsYou(snapshot, dismissed);
  // the harbour gets the snapshot with dismissed alerts cleared (App passes withDismissed to FleetScene)
  const scene = withDismissed(snapshot, dismissed);
  const stations = scene.projects.map((project) => stationNeeds(scene, project.id));
  return {
    overview: list.length,
    alerts: list.map((incident) => incident.id),
    badge: list.length,
    stations: stations.reduce((sum, count) => sum + count, 0),
    byProject: new Map(scene.projects.map((project, index) => [project.id, stations[index]!])),
    list,
  };
}

/** Mirrors FleetScene's station `needs`: the per-project incident count of the snapshot it is given. */
function stationTagShown(scene: FleetSnapshot, projectId: string): boolean {
  return (incidentsByProject(scene).get(projectId) ?? 0) > 0;
}

describe('one incident list behind every needs-you surface (demo world)', () => {
  it('station, Overview, Alerts, nav badge and the live tape agree at load and through a day', () => {
    const fleet = createDemoWorld({ now: NOW }).fleet;
    let sawWait = false;
    let sawCi = false;
    let sawCalm = false;
    for (let step = 0; step < 72; step++) {
      const snapshot = fleet.snapshot();
      const seen = surfaces(snapshot);
      expect(seen.stations).toBe(seen.overview);
      expect(seen.badge).toBe(seen.overview);
      expect(seen.alerts).toHaveLength(seen.overview);
      // one incident at a time in the demo, and it is one row: a wait is its task (never a separate
      // "Army blocked"); a CI failure is its alert alone, with no blocked task or waiting agent behind it
      expect(seen.overview).toBeLessThanOrEqual(1);
      for (const incident of seen.list) {
        const labels = incident.reasons.map((reason) => reason.label).sort();
        if (incident.kind === 'alert') {
          expect(labels).toEqual(['CI failed']);
          expect(incident.taskId).toBeUndefined();
          sawCi = true;
        } else {
          expect(incident.taskId).toBeTruthy();
          expect(incident.title).toMatch(/is waiting on you$/);
          expect(labels).toEqual(['Army blocked', 'Waiting on you']);
          sawWait = true;
        }
        expect(stationTagShown(withDismissed(snapshot, new Set()), incident.projectId)).toBe(true);
        expect(seen.byProject.get(incident.projectId)).toBe(1);
      }
      // the live tape's open notch is the incident listed right now
      const tape = liveHistory(fleet.history(1), snapshot, []);
      expect(openIncidentIds(normalizeHistory(tape)).sort()).toEqual([...seen.alerts].sort());
      const notches = buildTimeline(normalizeHistory(tape)).notches;
      expect(notches.some((notch) => notch.open)).toBe(seen.overview > 0);
      if (!seen.overview) sawCalm = true;
      fleet.tick(20 * MIN);
    }
    expect(sawWait).toBe(true);
    expect(sawCi).toBe(true);
    expect(sawCalm).toBe(true);
  });

  it('a CI-only incident lights its station badge, and clearing the alert clears the station', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 42 });
    const history = normalizeHistory(fleet.history(12));
    const ciAt = history.events.find((event) => event.kind === 'ci' && event.data?.alert === true)?.ts;
    expect(ciAt).toBeDefined();
    const snapshot = reconstruct(history, ciAt! + MIN).snapshot!;
    const list = needsYou(snapshot);
    expect(list).toHaveLength(1);
    const incident = list[0]!;
    expect(incident.kind).toBe('alert');
    // nothing live (no blocked task, no waiting agent) backs it: the badge comes from the alert alone
    const project = snapshot.projects.find((entry) => entry.id === incident.projectId)!;
    expect(project.orch?.tasks.some((task) => task.state === 'blocked') ?? false).toBe(false);
    expect(
      snapshot.agents.some((agent) => agent.projectId === project.id && agent.status === 'waiting'),
    ).toBe(false);
    expect(stationTagShown(snapshot, project.id)).toBe(true);
    expect(stationNeeds(snapshot, project.id)).toBe(1);
    expect(surfaces(snapshot).stations).toBe(1);
    const cleared = surfaces(snapshot, new Set(incident.alertIds));
    expect(cleared.overview).toBe(0);
    expect(cleared.stations).toBe(0);
    expect(stationTagShown(withDismissed(snapshot, new Set(incident.alertIds)), project.id)).toBe(false);
  });

  it('clearing an incident drops it from the station as well as the Overview', () => {
    const snapshot = createDemoWorld({ now: NOW }).snapshot;
    const before = surfaces(snapshot);
    expect(before.overview).toBe(1);
    const dismissed = new Set(before.list.flatMap((incident) => incident.alertIds));
    expect(dismissed.size).toBe(2);
    const after = surfaces(snapshot, dismissed);
    // live state (the blocked task and its waiting coder) still needs you, now as one reason-light row
    expect(after.overview).toBe(1);
    expect(after.stations).toBe(after.overview);
    expect(after.list[0]!.alertIds).toEqual([]);
    expect(withDismissed(snapshot, new Set())).toBe(snapshot);
  });

  it('replay notches open and close exactly where the reconstructed dashboard lists the incident', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 42 });
    const history = normalizeHistory(fleet.history(12));
    const moments = incidentMoments(history);
    expect(moments.length).toBeGreaterThanOrEqual(3);
    expect(moments.length).toBeLessThanOrEqual(5);
    const model = buildTimeline(history);
    expect(model.notches.reduce((sum, notch) => sum + notch.count, 0)).toBe(moments.length);
    const playheads = [
      history.from,
      ...moments.flatMap((moment) => [moment.ts, moment.ts + MIN, moment.end - 1, moment.end]),
      history.from + 5 * 60 * MIN,
      history.to,
    ].filter((at) => at >= history.from && at <= history.to);
    for (const at of playheads) {
      const snapshot = reconstruct(history, at).snapshot!;
      const listed = needsYou(snapshot)
        .map((incident) => incident.id)
        .sort();
      const notched = moments
        .filter((moment) => moment.ts <= at && (moment.open || moment.end > at))
        .map((moment) => moment.id)
        .sort();
      expect(notched, `playhead ${(at - history.from) / MIN} min`).toEqual(listed);
      expect(surfaces(snapshot).stations).toBe(listed.length);
    }
  });
});

describe('header vitals', () => {
  it('reads Today live and the playhead in replay, from the Overview selectors', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 42 });
    const history = normalizeHistory(fleet.history(6));
    const at = history.from + 7 * MIN;
    const snapshot = reconstruct(history, at).snapshot!;
    const replay = headerVitals(snapshot, at, true);
    expect(replay.label).toMatch(/^At \d\d:\d\d$/);
    expect(replay.working).toBe(nowWorking(snapshot, at).agents);
    expect(replay.costUsd).toBe(aggregateFleet(snapshot, at).costToday);
    const live = headerVitals(fleet.snapshot(), NOW, false);
    expect(live.label).toBe('Today');
    expect(live.costUsd).toBe(aggregateFleet(fleet.snapshot(), NOW).costToday);
  });
});

describe('live tape history', () => {
  it('ends at the live snapshot, keeps one copy of each event and drops events outside the hour', () => {
    const fleet = createDemoFleet({ now: NOW, seed: 7 });
    const tape = fleet.history(1);
    const streamed = fleet.tick(3 * MIN);
    const snapshot = fleet.snapshot();
    const merged = liveHistory(tape, snapshot, [...tape.events.slice(-5), ...streamed]);
    expect(merged.to).toBe(snapshot.generatedAt);
    expect(merged.from).toBe(snapshot.generatedAt - 60 * MIN);
    expect(merged.frames.at(-1)).toBe(snapshot);
    const ids = merged.events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(merged.events.every((event) => event.ts >= merged.from && event.ts <= merged.to)).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(streamed.map((event) => event.id)));
    // with no loaded tape (collector unreachable) it still draws from the streamed events
    const bare = liveHistory(null, snapshot, streamed);
    expect(bare.frames).toEqual([snapshot]);
    expect(buildTimeline(bare).buckets.some((bucket) => bucket.count > 0)).toBe(true);
  });
});
