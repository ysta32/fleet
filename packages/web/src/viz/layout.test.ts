import { describe, expect, it } from 'vitest';
import {
  STATION_Y,
  TASKS_PER_RING,
  anchorOffset,
  cameraFitPosition,
  needsRefit,
  fitScaleForAspect,
  cameraFitDistance,
  cameraMaxDistance,
  fogRange,
  alertPulse,
  ALERT_STATIC_GLOW,
  layoutRadius,
  arcHeight,
  arcPoint,
  easeInOutCubic,
  flightDuration,
  formatElapsed,
  formatTokens,
  hash01,
  hashString,
  normTaskId,
  ringPulse,
  stationPosition,
  stationScale,
  taskOrbitOffset,
  taskOrbitRadius,
  vec3,
} from './layout';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('easing', () => {
  it('easeInOutCubic is clamped, monotonic and symmetric', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
  });
});

describe('hash', () => {
  it('is stable and in range', () => {
    expect(hashString('synthetic-a')).toBe(hashString('synthetic-a'));
    expect(hashString('synthetic-a')).not.toBe(hashString('synthetic-b'));
    for (const s of ['', 'x', 'synthetic-project-42']) {
      const h = hash01(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe('normTaskId', () => {
  it('matches t-prefixed and zero padded ids', () => {
    expect(normTaskId('t04')).toBe('4');
    expect(normTaskId('04')).toBe('4');
    expect(normTaskId('4')).toBe('4');
    expect(normTaskId('12-viz')).toBe('12');
    expect(normTaskId('Alpha')).toBe('alpha');
  });
});

describe('stationPosition', () => {
  it('single project sits at origin at station height', () => {
    expect(stationPosition(0, 1)).toEqual({ x: 0, y: STATION_Y, z: 0 });
  });
  it('ring layout keeps stations apart and equidistant from origin', () => {
    const n = 6;
    const ps = Array.from({ length: n }, (_, i) => stationPosition(i, n));
    const r0 = Math.hypot(ps[0]!.x, ps[0]!.z);
    for (const p of ps) expect(Math.hypot(p.x, p.z)).toBeCloseTo(r0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) expect(dist(ps[i]!, ps[j]!)).toBeGreaterThan(5);
  });
  it('spiral layout for many projects has no overlapping stations', () => {
    const n = 30;
    const ps = Array.from({ length: n }, (_, i) => stationPosition(i, n));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) expect(dist(ps[i]!, ps[j]!)).toBeGreaterThan(3);
  });
  it('writes into the provided out vector', () => {
    const out = vec3();
    expect(stationPosition(1, 4, out)).toBe(out);
  });
});

describe('stationScale', () => {
  it('grows with activity and stays bounded', () => {
    const idle = stationScale(0, 0, 3_600_000);
    const busy = stationScale(5, 4, 1000);
    const huge = stationScale(500, 500, 0);
    expect(idle).toBeCloseTo(0.8);
    expect(busy).toBeGreaterThan(idle);
    expect(huge).toBeLessThanOrEqual(1.8 + 1e-9);
  });
});

describe('taskOrbitOffset', () => {
  it('places tasks on their ring radius in xz', () => {
    const n = TASKS_PER_RING + 3;
    for (let i = 0; i < n; i++) {
      const o = taskOrbitOffset(i, n, 0, 1);
      const ring = Math.floor(i / TASKS_PER_RING);
      expect(Math.hypot(o.x, o.z)).toBeCloseTo(taskOrbitRadius(ring, 1));
    }
  });
  it('rotates over time', () => {
    const a = { ...taskOrbitOffset(0, 4, 0, 1) };
    const b = taskOrbitOffset(0, 4, 5, 1);
    expect(dist(a, b)).toBeGreaterThan(0.1);
  });
});

describe('anchorOffset', () => {
  it('review gate is perpendicular to the outward CI beacon', () => {
    const station = { x: 10, y: STATION_Y, z: 0 };
    const ci = { ...anchorOffset('ci', station, 1, 0) };
    const review = { ...anchorOffset('review', station, 1, 0) };
    expect(ci.x).toBeGreaterThan(0);
    expect(Math.abs(ci.z)).toBeLessThan(1e-9);
    expect(ci.x * review.x + ci.z * review.z).toBeCloseTo(0);
  });
  it('deploy sits above ci', () => {
    const station = { x: 0, y: STATION_Y, z: 0 };
    const ci = { ...anchorOffset('ci', station, 1, 0) };
    const dep = anchorOffset('deploy', station, 1, 0);
    expect(dep.y).toBeGreaterThan(ci.y);
  });
});

describe('arcPoint', () => {
  const a = { x: 0, y: 2, z: 0 };
  const b = { x: 10, y: 2, z: 0 };
  it('starts at a and ends at b', () => {
    const s = arcPoint(a, b, 0);
    const e = arcPoint(a, b, 1);
    expect(dist(s, a)).toBeCloseTo(0);
    expect(dist(e, b)).toBeCloseTo(0);
  });
  it('arcs above the straight line at the midpoint', () => {
    const m = arcPoint(a, b, 0.5);
    expect(m.x).toBeCloseTo(5);
    expect(m.y).toBeCloseTo(2 + arcHeight(10));
  });
  it('flight duration grows with distance within bounds', () => {
    expect(flightDuration(0)).toBeGreaterThanOrEqual(0.8);
    expect(flightDuration(10)).toBeGreaterThan(flightDuration(1));
    expect(flightDuration(1000)).toBeLessThanOrEqual(2.8);
  });
});

describe('ringPulse', () => {
  it('expands and fades, then dies', () => {
    const st = { scale: 0, opacity: 0, alive: false };
    ringPulse(0, 1, 0.5, 5, st);
    expect(st.alive).toBe(true);
    expect(st.scale).toBeCloseTo(0.5);
    expect(st.opacity).toBeCloseTo(1);
    ringPulse(0.5, 1, 0.5, 5, st);
    expect(st.scale).toBeGreaterThan(2.75);
    expect(st.opacity).toBeLessThan(0.5);
    ringPulse(1.2, 1, 0.5, 5, st);
    expect(st.alive).toBe(false);
    expect(st.opacity).toBe(0);
  });
});

describe('formatting', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(42_000)).toBe('42s');
    expect(formatElapsed(12 * 60_000 + 5_000)).toBe('12m 05s');
    expect(formatElapsed(3 * 3_600_000 + 4 * 60_000)).toBe('3h 04m');
    expect(formatElapsed(-5)).toBe('0s');
  });
  it('formats tokens', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_345)).toBe('12.3k');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });
});

describe('camera fit', () => {
  it('refits on first non-empty layout and on large radius changes only', () => {
    expect(needsRefit(null, 10, 0)).toBe(false);
    expect(needsRefit(null, 10, 3)).toBe(true);
    expect(needsRefit(10, 11, 4)).toBe(false);
    expect(needsRefit(10, 20, 12)).toBe(true);
    expect(needsRefit(20, 10, 2)).toBe(true);
  });
  it('fit position grows with radius and looks down at the layout', () => {
    const a = { ...cameraFitPosition(6) };
    const b = cameraFitPosition(20);
    expect(Math.hypot(b.x, b.y, b.z)).toBeGreaterThan(Math.hypot(a.x, a.y, a.z));
    expect(b.y).toBeGreaterThan(0);
  });
});

describe('fitScaleForAspect', () => {
  it('leaves landscape alone and backs off for portrait', () => {
    expect(fitScaleForAspect(16 / 9)).toBe(1);
    expect(fitScaleForAspect(375 / 812)).toBeGreaterThan(3);
    expect(fitScaleForAspect(1)).toBeCloseTo(1.6);
    expect(fitScaleForAspect(0)).toBe(1);
  });
});

describe('cameraMaxDistance', () => {
  it('never clamps the fitted (or intro) pose, even on portrait screens', () => {
    for (const n of [1, 3, 5, 8, 12, 40]) {
      for (const aspect of [16 / 9, 1, 375 / 812, 0.3]) {
        const framed = layoutRadius(n) * fitScaleForAspect(aspect);
        const fit = cameraFitDistance(framed);
        const max = cameraMaxDistance(framed);
        expect(max).toBeGreaterThanOrEqual(fit * 1.45);
        expect(max).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

describe('fogRange', () => {
  it('keeps the whole layout inside the fog far plane at the fitted pose, across aspects', () => {
    for (const n of [1, 3, 5, 8, 12, 40]) {
      const r = layoutRadius(n);
      for (const aspect of [21 / 9, 16 / 9, 1, 375 / 812, 0.3]) {
        const { near, far } = fogRange(r, aspect);
        expect(far).toBeGreaterThan(cameraFitDistance(r * fitScaleForAspect(aspect)) + r);
        expect(near).toBeGreaterThanOrEqual(0);
        expect(near).toBeLessThan(far);
      }
    }
  });
});

describe('alertPulse', () => {
  it('pulses once (scale + glow) and is silent outside the alert window', () => {
    expect(alertPulse(-0.1, false)).toEqual({ scale: 0, glow: 0 });
    expect(alertPulse(1, false)).toEqual({ scale: 0, glow: 0 });
    const mid = alertPulse(0.2, false); // rising edge (the alert curve overshoots past 1 later)
    expect(mid.scale).toBeGreaterThan(0);
    expect(mid.glow).toBe(mid.scale);
  });
  it('never scales under reduced motion; glow is static for the whole alert', () => {
    for (const u of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      expect(alertPulse(u, true)).toEqual({ scale: 0, glow: ALERT_STATIC_GLOW });
    }
    expect(alertPulse(1, true)).toEqual({ scale: 0, glow: 0 });
  });
});
