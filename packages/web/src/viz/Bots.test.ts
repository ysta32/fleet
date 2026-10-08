import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDemoFleet } from '@fleet/shared';
import { initRec, stepRec, type BotRec } from './Bots';
import { SceneStore } from './store';
import { vizTheme } from './theme';

const DT = 1 / 60;
function frames(s: SceneStore, recs: BotRec[], n: number) {
  for (let i = 0; i < n; i++) {
    s.t += DT;
    for (const r of recs) stepRec(s, r, DT);
  }
}

describe('vessel motion in replay is a function of the playhead', () => {
  it('revisiting a playhead after scrubbing elsewhere reproduces every position and spin', () => {
    const demo = createDemoFleet({ seed: 3, now: 1_700_000_000_000 });
    const snap = demo.snapshot();
    expect(snap.agents.length).toBeGreaterThan(0);
    const s = new SceneStore();
    const P = snap.generatedAt;
    s.syncClock('live', P);
    s.syncClock('replay', P, false);
    s.setSnapshot(snap);
    s.t = 5;
    // Bots marks vessels created while replaying to snap in place (epoch -1)
    const recs = snap.agents.map((a, order) => {
      const r = initRec(s, { a, order }, vizTheme('dark'));
      r.epoch = -1;
      return r;
    });
    frames(s, recs, 1);
    const at = recs.map((r) => [r.pos.clone(), r.spin] as const);

    s.syncClock('replay', P + 90_000, false); // explicit seek forward
    frames(s, recs, 45);
    s.syncClock('replay', P + 95_000, true); // some playback
    frames(s, recs, 45);
    s.syncClock('replay', P, false); // and back
    frames(s, recs, 1);
    recs.forEach((r, i) => {
      expect(r.pos.distanceTo(at[i]![0])).toBeLessThan(1e-9);
      expect(r.spin).toBeCloseTo(at[i]![1], 9);
      expect(r.flying).toBe(false);
    });
  });
});

describe('explicit seeks invalidate transients', () => {
  const v = new THREE.Vector3();
  it('a small forward seek while paused clears effects and starts a new epoch', () => {
    const s = new SceneStore();
    s.syncClock('replay', 10_000, false);
    s.syncClock('replay', 10_000, false); // re-render at the same playhead: not a seek
    const e0 = s.seekEpoch;
    s.spawnRing('shock', v, '#ffffff', 1, 0, 1, 1);
    s.syncClock('replay', 11_000, false);
    expect(s.seekEpoch).toBe(e0 + 1);
    expect(s.rings.some((r) => r.active)).toBe(false);
  });
  it('playback advance keeps effects running', () => {
    const s = new SceneStore();
    s.syncClock('replay', 10_000, true);
    s.spawnRing('shock', v, '#ffffff', 1, 0, 1, 1);
    s.syncClock('replay', 16_000, true);
    expect(s.seekEpoch).toBe(0);
    expect(s.rings.some((r) => r.active)).toBe(true);
  });
});
