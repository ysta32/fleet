import { describe, expect, it } from 'vitest';
import type { FleetEvent } from '@fleet/shared';
import * as THREE from 'three';
import { SceneStore } from './store';

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
