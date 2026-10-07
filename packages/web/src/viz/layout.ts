/**
 * Pure layout + animation math for the fleet visualizer.
 * No three.js / React dependency so it can be unit tested in node.
 * Functions taking an `out` parameter write into it and return it (no per-frame allocation).
 */
import type { LocationKind } from '@fleet/shared';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Height at which stations float above the grid floor. */
export const STATION_Y = 2.2;
/** Number of task satellites per orbit ring before a new, wider ring starts. */
export const TASKS_PER_RING = 12;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

/** FNV-1a 32-bit hash, stable across runs; used for per-entity phases. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash mapped to [0, 1). */
export function hash01(s: string): number {
  return hashString(s) / 4294967296;
}

/** Normalise task ids so "t04", "04" and "4" all match. */
export function normTaskId(id: string): string {
  const m = /^t?0*(\d+)/i.exec(id.trim());
  if (m) return String(Number(m[1]));
  return id.trim().toLowerCase();
}

/**
 * Station position for project index `i` of `n` (ids should be sorted for stability).
 * One project sits at the origin, up to 8 on a ring, more on a golden-angle spiral.
 */
export function stationPosition(i: number, n: number, out: Vec3 = vec3()): Vec3 {
  out.y = STATION_Y;
  if (n <= 1) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  if (n <= 8) {
    const r = Math.max(9, n * 2.6);
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.x = Math.cos(a) * r;
    out.z = Math.sin(a) * r;
    return out;
  }
  const r = 7 + 4.6 * Math.sqrt(i + 0.5);
  const a = i * GOLDEN_ANGLE;
  out.x = Math.cos(a) * r;
  out.z = Math.sin(a) * r;
  return out;
}

/** Radius of the camera-fit bounds for n stations. */
export function layoutRadius(n: number): number {
  if (n <= 1) return 6;
  if (n <= 8) return Math.max(9, n * 2.6) + 4;
  return 7 + 4.6 * Math.sqrt(n - 0.5) + 4;
}

/** Camera position that frames a layout of radius `r` (looking at the origin). */
export function cameraFitPosition(r: number, out: Vec3 = vec3()): Vec3 {
  out.x = r * 0.1;
  out.y = r * 0.95;
  out.z = r * 1.85;
  return out;
}

/**
 * Whether the camera should be refitted: always on the first non-empty layout (fitted === null),
 * otherwise when the layout radius changed by more than `tolerance` (relative).
 */
export function needsRefit(
  fitted: number | null,
  next: number,
  projectCount: number,
  tolerance = 0.35,
): boolean {
  if (projectCount <= 0) return false;
  if (fitted === null) return true;
  return Math.abs(next - fitted) / Math.max(1e-6, fitted) > tolerance;
}

/** Station scale 0.8..1.8 from activity (working agents, running tasks, recency). */
export function stationScale(workingAgents: number, runningTasks: number, msSinceActivity: number): number {
  const recency = msSinceActivity < 60_000 ? 1 : msSinceActivity < 15 * 60_000 ? 0.5 : 0;
  const score = workingAgents * 1.0 + runningTasks * 0.6 + recency;
  return 0.8 + Math.min(1, Math.log1p(score) / Math.log1p(12));
}

/** Radius of the task orbit ring `ring` for a station of scale `scale`. */
export function taskOrbitRadius(ring: number, scale: number): number {
  return 1.9 * scale + 0.75 * ring;
}

/**
 * Offset of task satellite `i` of `n` around its station at time `t` (seconds).
 * Rings of TASKS_PER_RING alternate direction and tilt slightly.
 */
export function taskOrbitOffset(i: number, n: number, t: number, scale: number, out: Vec3 = vec3()): Vec3 {
  const ring = Math.floor(i / TASKS_PER_RING);
  const inRing = Math.min(TASKS_PER_RING, n - ring * TASKS_PER_RING);
  const j = i - ring * TASKS_PER_RING;
  const dir = ring % 2 === 0 ? 1 : -1;
  const speed = 0.18 / (1 + ring * 0.5);
  const a = (j / Math.max(1, inRing)) * Math.PI * 2 + t * speed * dir + ring * 0.4;
  const r = taskOrbitRadius(ring, scale);
  const tilt = 0.18 + ring * 0.08;
  out.x = Math.cos(a) * r;
  out.z = Math.sin(a) * r;
  out.y = Math.sin(a) * r * tilt * dir + Math.sin(t * 0.9 + i) * 0.06;
  return out;
}

/** Unit outward direction (in xz) of a station from the origin; +x for the origin station. */
export function outwardDir(station: Vec3, out: Vec3 = vec3()): Vec3 {
  const l = Math.hypot(station.x, station.z);
  if (l < 1e-6) {
    out.x = 1;
    out.y = 0;
    out.z = 0;
  } else {
    out.x = station.x / l;
    out.y = 0;
    out.z = station.z / l;
  }
  return out;
}

/**
 * Fixed anchors around a station: the review gate sits to the side (tangent),
 * the CI/deploy beacon sits outward. Returned as offsets from the station centre.
 */
export function anchorOffset(
  kind: 'review' | 'ci' | 'deploy' | 'worktree',
  station: Vec3,
  scale: number,
  slot: number,
  out: Vec3 = vec3(),
): Vec3 {
  const u = outwardDir(station, out);
  const ux = u.x;
  const uz = u.z;
  // tangent = up x outward
  const vx = uz;
  const vz = -ux;
  const d = 2.4 * scale + 1.1;
  switch (kind) {
    case 'review':
      out.x = vx * d;
      out.z = vz * d;
      out.y = 0.2;
      return out;
    case 'ci':
      out.x = ux * d;
      out.z = uz * d;
      out.y = -0.4;
      return out;
    case 'deploy':
      out.x = ux * d;
      out.z = uz * d;
      out.y = 2.2;
      return out;
    case 'worktree': {
      const a = slot * 1.1 + 2.2;
      const r = 1.5 * scale + 0.6;
      out.x = Math.cos(a) * r;
      out.z = Math.sin(a) * r;
      out.y = -1.2;
      return out;
    }
  }
}

/** Map a location kind to a coarse category used to decide whether a bot needs to travel. */
export function locationKey(kind: LocationKind, projectId: string, ref?: string): string {
  return `${kind}|${projectId}|${ref ?? ''}`;
}

/** Idle hover-orbit offset for a bot around its target. */
export function hoverOffset(phase: number, t: number, radius: number, out: Vec3 = vec3()): Vec3 {
  const a = t * (0.35 + phase * 0.3) + phase * Math.PI * 2;
  out.x = Math.cos(a) * radius;
  out.z = Math.sin(a) * radius;
  out.y = Math.sin(t * 1.3 + phase * 9) * 0.18 + 0.25;
  return out;
}

/** Flight duration (s) for a trip of length `dist`. */
export function flightDuration(dist: number): number {
  return clamp(0.7 + dist * 0.07, 0.8, 2.8);
}

/** Arc height for a trip of length `dist`. */
export function arcHeight(dist: number): number {
  return clamp(dist * 0.35, 0.6, 7);
}

/**
 * Position along an eased arc from `a` to `b` at normalised time `t` (0..1),
 * lifted by a sine bump of height `arcHeight(dist)` above the straight line.
 */
export function arcPoint(a: Vec3, b: Vec3, t: number, out: Vec3 = vec3()): Vec3 {
  const e = easeInOutCubic(t);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const h = arcHeight(dist);
  out.x = a.x + dx * e;
  out.y = a.y + dy * e + Math.sin(Math.PI * clamp(t, 0, 1)) * h;
  out.z = a.z + dz * e;
  return out;
}

export interface PulseState {
  scale: number;
  opacity: number;
  alive: boolean;
}

/** Expanding ring: scale grows from `from` to `to` with ease-out, opacity fades out. */
export function ringPulse(
  age: number,
  duration: number,
  from: number,
  to: number,
  out: PulseState,
): PulseState {
  const t = duration > 0 ? age / duration : 1;
  out.alive = t >= 0 && t < 1;
  const e = easeOutCubic(t);
  out.scale = lerp(from, to, e);
  out.opacity = out.alive ? Math.pow(1 - clamp(t, 0, 1), 1.6) : 0;
  return out;
}

/** Bucket counts of task states (for HUD + station brightness). */
export function countBy<T extends string>(items: readonly { state: T }[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const it of items) out[it.state] = (out[it.state] ?? 0) + 1;
  return out;
}

/** Format a duration in ms as "3h 04m" / "12m 05s" / "42s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Compact token count "12.3k", "1.2M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
