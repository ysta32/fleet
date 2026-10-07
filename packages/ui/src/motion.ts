/**
 * Halyard motion, JS mirror of the motion tokens in ../tokens.css for r3f / WebGL / JS animation.
 * Durations in milliseconds; easings as CSS strings and as cubic-bezier control points.
 * Keep in sync with tokens.css (enforced by motion-palette.test.ts).
 */
export type Bezier = readonly [number, number, number, number];

export const easing = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  spring: [0.34, 1.56, 0.64, 1],
  dispatch: [0.5, 0, 0.75, 0],
  land: [0.16, 1, 0.3, 1],
  alert: [0.34, 1.56, 0.64, 1],
} as const satisfies Record<string, Bezier>;
export type EasingName = keyof typeof easing;

export const duration = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 420,
  cinematic: 900,
  dispatch: 260,
  land: 420,
  alert: 640,
  stagger: 24,
} as const;
export type DurationName = keyof typeof duration;

/** Named motions: the three verbs of the Halyard motion language. */
export const named = {
  /** Something leaves: agent spawned, PR pushed, toast dismissed. Accelerates away. */
  dispatch: { duration: duration.dispatch, easing: easing.dispatch },
  /** Something arrives and settles: row inserted, panel opened, result landed. Long deceleration. */
  land: { duration: duration.land, easing: easing.land },
  /** Needs-you state: blocked, CI red, budget exceeded. One overshoot pulse, never looped. */
  alert: { duration: duration.alert, easing: easing.alert },
} as const;
export type MotionName = keyof typeof named;

/** Evaluate a cubic-bezier easing at progress t in [0,1] (Newton-Raphson + bisection fallback). */
export function ease(curve: Bezier, t: number): number {
  const [x1, y1, x2, y2] = curve;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const dsx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const err = sx(u) - t;
    if (Math.abs(err) < 1e-6) return ((ay * u + by) * u + cy) * u;
    const d = dsx(u);
    if (Math.abs(d) < 1e-6) break;
    u -= err / d;
  }
  let lo = 0;
  let hi = 1;
  u = t;
  for (let i = 0; i < 32; i++) {
    const x = sx(u);
    if (Math.abs(x - t) < 1e-6) break;
    if (x < t) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  return ((ay * u + by) * u + cy) * u;
}

export const cssEasing = (curve: Bezier): string => `cubic-bezier(${curve.join(', ')})`;

/** True when the user asked for reduced motion (always false outside a browser). */
export function prefersReducedMotion(): boolean {
  const g = globalThis as { matchMedia?: (q: string) => { matches: boolean } };
  return typeof g.matchMedia === 'function' && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Duration to actually use: 0 under reduced motion, mirroring the CSS override. */
export const dur = (name: DurationName, reduced: boolean = prefersReducedMotion()): number =>
  reduced ? 0 : duration[name];

export const motion = { easing, duration, named, ease, cssEasing, dur, prefersReducedMotion } as const;
