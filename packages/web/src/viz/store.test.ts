import { describe, expect, it } from 'vitest';
import type { FleetEvent } from '@fleet/shared';
import * as THREE from 'three';
import { SceneStore, SEEK_JUMP_MS } from './store';

const move = (agentId: string, ts: number): FleetEvent => ({
  id: `${ts}-0`,
  ts,
  kind: 'agent.move',
  projectId: '-synthetic-a',
  agentId,
  severity: 'info',
  label: 'synthetic move',
  to: { kind: 'review', projectId: '-synthetic-a' },
});

describe('SceneStore move overrides', () => {
  const v = new THREE.Vector3();
  it('survive forward playback but clear on backward seek', () => {
    const s = new SceneStore();
    s.syncClock('replay', 1000);
    s.handleEvent(move('bot-1', 1500), v);
    s.syncClock('replay', 1200);
    expect(s.locOverride.has('bot-1')).toBe(true);
    s.syncClock('replay', 1200);
    expect(s.locOverride.has('bot-1')).toBe(true);
    s.syncClock('replay', 500);
    expect(s.locOverride.size).toBe(0);
  });
  it('clear on mode change', () => {
    const s = new SceneStore();
    s.syncClock('live', 1000);
    s.handleEvent(move('bot-1', 1500), v);
    s.syncClock('replay', 2000);
    expect(s.locOverride.size).toBe(0);
  });
});

describe('SceneStore replay determinism', () => {
  const v = new THREE.Vector3();
  it('a scrub (backward, or a forward jump beyond playback speed) starts a new epoch and clears transients', () => {
    const s = new SceneStore();
    s.syncClock('replay', 1_000);
    const e0 = s.seekEpoch;
    s.spawnRing('shock', v, '#ffffff', 1, 0, 1, 1);
    s.alerts.set('p', { start: 0, kind: 'fail' });
    s.syncClock('replay', 1_000 + 6_000); // one frame of 60x playback
    expect(s.seekEpoch).toBe(e0);
    expect(s.rings.some((r) => r.active)).toBe(true);
    s.syncClock('replay', 1_000 + 6_000 + SEEK_JUMP_MS + 1); // scrub forward
    expect(s.seekEpoch).toBe(e0 + 1);
    expect(s.rings.some((r) => r.active)).toBe(false);
    expect(s.alerts.size).toBe(0);
    s.syncClock('replay', 500); // scrub back
    expect(s.seekEpoch).toBe(e0 + 2);
  });
  it('live clock jitter never counts as a scrub; a mode switch does', () => {
    const s = new SceneStore();
    s.syncClock('live', 5_000);
    s.syncClock('live', 4_000);
    s.syncClock('live', 60_000);
    expect(s.seekEpoch).toBe(0);
    s.syncClock('replay', 1_000);
    expect(s.seekEpoch).toBe(1);
  });
});
