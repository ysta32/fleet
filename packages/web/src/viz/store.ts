/**
 * Mutable per-scene runtime store shared by all visualizer components.
 * Holds layout results, live positions and pooled effects so useFrame loops never allocate.
 */
import { createContext, useContext } from 'react';
import * as THREE from 'three';
import type { Agent, AgentLocation, FleetEvent, FleetSnapshot, Session } from '@fleet/shared';
import type { Selection } from '../data/contract';
import {
  anchorOffset,
  hash01,
  hashString,
  normTaskId,
  stationScale,
  stationPosition,
  vec3,
  type Vec3,
} from './layout';
import { vizTheme, type VizTheme } from './theme';

export interface ProjectLayout {
  id: string;
  index: number;
  pos: THREE.Vector3;
  scale: number;
  worktrees: string[];
  /** worktree id -> normalised task id */
  inflightWt: Map<string, string>;
  /** has running tasks or working agents (drives orbit motion) */
  busy: boolean;
  /** accumulated orbit clock (s); advances only while busy */
  orbitT: number;
}

export const RING_POOL = 64;
export const BEAM_POOL = 24;
export const PARTICLE_POOL = 640;

export type RingKind = 'shock' | 'pulse' | 'scan' | 'ping';
export interface RingFx {
  active: boolean;
  kind: RingKind;
  start: number;
  dur: number;
  from: number;
  to: number;
  /** vertical travel for scan rings */
  rise: number;
  pos: THREE.Vector3;
  color: THREE.Color;
  gain: number;
}
export interface BeamFx {
  active: boolean;
  start: number;
  dur: number;
  height: number;
  radius: number;
  pos: THREE.Vector3;
  color: THREE.Color;
  gain: number;
}
export interface ParticleFx {
  active: boolean;
  start: number;
  life: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  gain: number;
  size: number;
}

const tmpV = vec3();
/** forward playhead jump (ms) treated as a scrub rather than playback */
export const SEEK_JUMP_MS = 10_000;
/** global effect brightness: restrained, instrument-like bloom */
const FX_GAIN = 0.6;

export class SceneStore {
  /** scene clock (s), advanced by the root frame loop; drives effect lifetimes */
  t = 0;
  /** ambient clock (s): orbits, hover, spin. Frozen when the user prefers reduced motion. */
  at = 0;
  /** prefers-reduced-motion: no drift, instant transitions, no particle bursts */
  reduced = false;
  snapshot: FleetSnapshot | null = null;
  layouts = new Map<string, ProjectLayout>();
  projectCount = 0;
  agents = new Map<string, Agent>();
  sessions = new Map<string, Session>();
  /** "<projectId>/<normTaskId>" -> live world position of the task satellite */
  taskPos = new Map<string, THREE.Vector3>();
  /** agentId -> live world position of the bot */
  botPos = new Map<string, THREE.Vector3>();
  /** active theme (colours for effects) */
  vt: VizTheme = vizTheme('dark');
  /**
   * projectId -> one-shot `alert` motion (DESIGN.md: one overshoot pulse, never looped).
   * kind 'needs' = blocked/waiting (signal orange), 'fail' = failure/CI red (danger).
   */
  alerts = new Map<string, { start: number; kind: 'needs' | 'fail' }>();
  /** projectId -> scene time of the last "activity" event (station pulse) */
  activityAt = new Map<string, number>();
  /** agent.move events applied ahead of the next snapshot */
  locOverride = new Map<string, { loc: AgentLocation; ts: number }>();
  /** data-source mode + playhead last seen; used to invalidate pending move overrides */
  private clockMode: string | null = null;
  private playhead = -Infinity;
  /**
   * Bumped on a discontinuity of the data clock (mode switch, replay seek backward, or a forward
   * jump larger than playback can produce). Vessels snap and transient effects clear, so a scrubbed
   * scene is a function of the playhead rather than of the path taken to it.
   */
  seekEpoch = 0;

  /** True while the scene is driven by a replay playhead. */
  get replaying(): boolean {
    return this.clockMode === 'replay';
  }

  /**
   * Replay clock (s) for ambient motion (hover, spin, task orbits): a pure function of the playhead,
   * so revisiting a playhead reproduces the same scene. Only meaningful while `replaying`.
   */
  get replaySec(): number {
    return Number.isFinite(this.playhead) ? this.playhead / 1000 : 0;
  }
  rings: RingFx[] = [];
  beams: BeamFx[] = [];
  particles: ParticleFx[] = [];
  private ringCursor = 0;
  private beamCursor = 0;
  private particleCursor = 0;
  private seed = 1;

  constructor() {
    for (let i = 0; i < RING_POOL; i++)
      this.rings.push({
        active: false,
        kind: 'shock',
        start: 0,
        dur: 1,
        from: 0,
        to: 1,
        rise: 0,
        pos: new THREE.Vector3(),
        color: new THREE.Color(),
        gain: 1,
      });
    for (let i = 0; i < BEAM_POOL; i++)
      this.beams.push({
        active: false,
        start: 0,
        dur: 1,
        height: 1,
        radius: 1,
        pos: new THREE.Vector3(),
        color: new THREE.Color(),
        gain: 1,
      });
    for (let i = 0; i < PARTICLE_POOL; i++)
      this.particles.push({
        active: false,
        start: 0,
        life: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        color: new THREE.Color(),
        gain: 1,
        size: 1,
      });
  }

  /**
   * Track the data clock. Pending agent.move overrides are dropped when the source mode changes
   * (live <-> demo <-> replay) or the playhead moves backward (replay seek), since they describe a
   * future that no longer applies. Idempotent for repeated calls with the same values.
   */
  syncClock(mode: string, playhead: number, playing = true): void {
    const switched = this.clockMode !== null && mode !== this.clockMode;
    const back = playhead < this.playhead;
    if (switched || back) this.locOverride.clear();
    const moved = playhead !== this.playhead && Number.isFinite(this.playhead);
    // replay: a paused playhead only moves by an explicit seek; while playing, playback advances at
    // most 100ms x 60 per frame, so a backward move or a larger jump is a seek too
    const seek = mode === 'replay' && moved && (!playing || back || playhead - this.playhead > SEEK_JUMP_MS);
    if (switched || seek) this.discontinuity();
    this.clockMode = mode;
    this.playhead = playhead;
  }

  /** Drop everything transient (effects, alerts, pending moves) and start a new seek epoch. */
  discontinuity(): void {
    this.seekEpoch++;
    this.locOverride.clear();
    this.alerts.clear();
    this.activityAt.clear();
    for (const r of this.rings) r.active = false;
    for (const b of this.beams) b.active = false;
    for (const p of this.particles) p.active = false;
  }

  /** Apply a new snapshot: recompute station layout (stable by sorted id). Called during render, idempotent. */
  setSnapshot(snap: FleetSnapshot | null): void {
    if (snap === this.snapshot) return;
    this.snapshot = snap;
    this.agents.clear();
    this.sessions.clear();
    if (!snap) return;
    for (const a of snap.agents) this.agents.set(a.id, a);
    for (const s of snap.sessions) this.sessions.set(s.id, s);
    for (const [id, o] of this.locOverride) if (snap.generatedAt >= o.ts) this.locOverride.delete(id);
    const ids = snap.projects.map((p) => p.id).sort();
    this.projectCount = ids.length;
    const keep = new Set(ids);
    for (const id of this.layouts.keys()) if (!keep.has(id)) this.layouts.delete(id);
    const working = new Map<string, number>();
    for (const a of snap.agents)
      if (a.status === 'working') working.set(a.projectId, (working.get(a.projectId) ?? 0) + 1);
    const byId = new Map(snap.projects.map((p) => [p.id, p]));
    ids.forEach((id, index) => {
      const p = byId.get(id)!;
      let l = this.layouts.get(id);
      if (!l) {
        l = {
          id,
          index,
          pos: new THREE.Vector3(),
          scale: 1,
          worktrees: [],
          inflightWt: new Map(),
          busy: false,
          orbitT: hash01(id) * 40,
        };
        this.layouts.set(id, l);
      }
      l.index = index;
      stationPosition(index, ids.length, tmpV);
      l.pos.set(tmpV.x, tmpV.y, tmpV.z);
      const running = p.orch ? p.orch.tasks.filter((t) => t.state === 'running').length : 0;
      l.scale = stationScale(working.get(id) ?? 0, running, snap.generatedAt - p.lastActivity);
      l.busy = running > 0 || (working.get(id) ?? 0) > 0;
      l.worktrees = p.orch?.worktrees ?? [];
      l.inflightWt.clear();
      for (const f of p.orch?.inflight ?? []) l.inflightWt.set(f.worktree, normTaskId(f.task));
    });
  }

  effectiveLocation(a: Agent): AgentLocation {
    return this.locOverride.get(a.id)?.loc ?? a.location;
  }

  /**
   * Resolve where a location is in world space (writes `out`). Returns the hover radius bots should
   * orbit at; 0 if the project is unknown (out set to origin).
   */
  resolveLocation(loc: AgentLocation, fallbackProject: string, out: THREE.Vector3): number {
    const l = this.layouts.get(loc.projectId) ?? this.layouts.get(fallbackProject);
    if (!l) {
      out.set(0, 3, 0);
      return 1;
    }
    out.copy(l.pos);
    switch (loc.kind) {
      case 'project':
        return 1.25 * l.scale + 0.55;
      case 'task': {
        const tp = loc.ref ? this.taskPos.get(`${l.id}/${normTaskId(loc.ref)}`) : undefined;
        if (tp) {
          out.copy(tp);
          return 0.32;
        }
        return 1.25 * l.scale + 0.55;
      }
      case 'worktree': {
        const ref = loc.ref ?? '';
        const task = l.inflightWt.get(ref);
        const tp = task ? this.taskPos.get(`${l.id}/${task}`) : undefined;
        if (tp) {
          out.copy(tp);
          return 0.32;
        }
        const idx = l.worktrees.indexOf(ref);
        const slot = idx >= 0 ? idx : hashString(ref) % 7;
        anchorOffset('worktree', l.pos, l.scale, slot, tmpV);
        out.x += tmpV.x;
        out.y += tmpV.y;
        out.z += tmpV.z;
        return 0.3;
      }
      case 'review':
      case 'ci':
      case 'deploy': {
        anchorOffset(loc.kind, l.pos, l.scale, 0, tmpV);
        out.x += tmpV.x;
        out.y += tmpV.y;
        out.z += tmpV.z;
        return 0.55;
      }
    }
  }

  /** World position of the current selection (writes out); false if unknown. */
  selectionPosition(sel: Selection, out: THREE.Vector3): boolean {
    if (!sel) return false;
    if (sel.kind === 'project') {
      const l = this.layouts.get(sel.id);
      if (!l) return false;
      out.copy(l.pos);
      return true;
    }
    if (sel.kind === 'agent') {
      const p = this.botPos.get(sel.id);
      if (!p) return false;
      out.copy(p);
      return true;
    }
    const p = this.botPos.get(sel.id);
    if (p) {
      out.copy(p);
      return true;
    }
    const s = this.sessions.get(sel.id);
    const l = s ? this.layouts.get(s.projectId) : undefined;
    if (!l) return false;
    out.copy(l.pos);
    return true;
  }

  private rand(): number {
    // xorshift, deterministic; no allocation
    let x = (this.seed = (this.seed * 1664525 + 1013904223) >>> 0);
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  }

  spawnRing(
    kind: RingKind,
    pos: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    from: number,
    to: number,
    dur: number,
    rise = 0,
    delay = 0,
  ): void {
    if (this.reduced) {
      delay = 0;
      from = to;
      dur = Math.min(dur, 0.6);
      rise = 0;
    }
    const r = this.rings[this.ringCursor]!;
    this.ringCursor = (this.ringCursor + 1) % RING_POOL;
    r.active = true;
    r.kind = kind;
    r.start = this.t + delay;
    r.dur = dur;
    r.from = from;
    r.to = to;
    r.rise = rise;
    r.pos.copy(pos);
    r.color.set(color);
    r.gain = intensity * FX_GAIN;
  }

  spawnBeam(
    pos: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    height: number,
    radius: number,
    dur: number,
  ): void {
    const b = this.beams[this.beamCursor]!;
    this.beamCursor = (this.beamCursor + 1) % BEAM_POOL;
    b.active = true;
    b.start = this.t;
    b.dur = dur;
    b.height = height;
    b.radius = radius;
    b.pos.copy(pos);
    b.color.set(color);
    b.gain = intensity * FX_GAIN;
  }

  spawnBurst(
    pos: THREE.Vector3,
    color: THREE.ColorRepresentation,
    intensity: number,
    count: number,
    speed: number,
    life: number,
    upBias = 0.3,
  ): void {
    if (this.reduced) return;
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleCursor]!;
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL;
      const u = this.rand() * 2 - 1;
      const th = this.rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + this.rand() * 0.6);
      p.active = true;
      p.start = this.t;
      p.life = life * (0.6 + this.rand() * 0.6);
      p.pos.copy(pos);
      p.vel.set(Math.cos(th) * s * v, (Math.abs(u) * (1 - upBias) + upBias) * v, Math.sin(th) * s * v);
      p.color.set(color);
      p.gain = intensity * FX_GAIN;
      p.size = 0.6 + this.rand() * 0.8;
    }
  }

  private stationOr(projectId: string, out: THREE.Vector3): ProjectLayout | null {
    const l = this.layouts.get(projectId);
    if (!l) return null;
    out.copy(l.pos);
    return l;
  }

  /** Translate a fleet event into visual effects. Never reads label text into the scene. */
  handleEvent(e: FleetEvent, scratch: THREE.Vector3): void {
    if (e.kind === 'agent.move' && e.agentId && e.to) {
      this.locOverride.set(e.agentId, { loc: e.to, ts: e.ts });
      return;
    }
    const l = this.stationOr(e.projectId, scratch);
    if (!l) return;
    this.activityAt.set(e.projectId, this.t);
    const s = l.scale;
    const c = this.vt;
    switch (e.kind) {
      case 'merge': {
        // land: one clean success shockwave, a second faint echo, a sparse spray
        this.spawnRing('shock', scratch, c.success, 2.6, 0.5 * s, 6.5 * s, 1.9);
        this.spawnRing('shock', scratch, c.success, 1.2, 0.4 * s, 4 * s, 1.3);
        this.spawnBurst(scratch, c.success, 2.8, 40, 4, 1.6);
        return;
      }
      case 'army.done': {
        this.spawnRing('shock', scratch, c.success, 2.6, 0.6 * s, 10 * s, 2.2);
        this.spawnRing('shock', scratch, c.fg, 1.4, 0.6 * s, 6.5 * s, 1.6);
        this.spawnBurst(scratch, c.success, 2.6, 70, 5.5, 2);
        return;
      }
      case 'deploy':
      case 'release': {
        const err = e.severity === 'error';
        anchorOffset('ci', l.pos, s, 0, tmpV);
        scratch.x += tmpV.x;
        scratch.y += tmpV.y;
        scratch.z += tmpV.z;
        const col = err ? c.danger : e.kind === 'release' ? c.focus : c.fg;
        // launch: a short hairline beam with a ring climbing it (reads as "shipped", not a light show)
        this.spawnBeam(scratch, col, 0.5, 5.5, 0.14, 1.4);
        this.spawnBeam(scratch, col, 2.6, 6.5, 0.022, 1.1);
        this.spawnRing('scan', scratch, col, 2.4, 0.5, 0.5, 1.2, 9);
        this.spawnRing('shock', scratch, col, 2, 0.2, 2.6, 0.9);
        this.spawnBurst(scratch, col, 2, 16, 2.4, 1, 0.8);
        if (err) this.alerts.set(e.projectId, { start: this.t, kind: 'fail' });
        return;
      }
      case 'failure': {
        // two staggered red rings: reads as an alarm at a glance, without looping
        this.spawnRing('pulse', scratch, c.danger, 2.8, 0.8 * s, 4.8 * s, 1.3);
        this.spawnRing('pulse', scratch, c.danger, 1.6, 0.8 * s, 3.2 * s, 1.0, 0, 0.16);
        this.alerts.set(e.projectId, { start: this.t, kind: 'fail' });
        return;
      }
      case 'blocked':
      case 'session.waiting': {
        // needs you: the only orange moment
        this.spawnRing('pulse', scratch, c.accent, 2.8, 0.8 * s, 4.5 * s, 0.9);
        this.alerts.set(e.projectId, { start: this.t, kind: 'needs' });
        return;
      }
      case 'ci': {
        anchorOffset('ci', l.pos, s, 0, tmpV);
        scratch.x += tmpV.x;
        scratch.y += tmpV.y;
        scratch.z += tmpV.z;
        if (e.severity === 'error') {
          this.spawnRing('pulse', scratch, c.danger, 2.6, 0.3, 3, 0.9);
          this.alerts.set(e.projectId, { start: this.t, kind: 'fail' });
        } else if (e.severity === 'success') this.spawnRing('ping', scratch, c.success, 2, 0.2, 2, 0.9);
        return;
      }
      case 'test.run': {
        this.spawnRing('scan', scratch, c.fg, 1.6, 1.35 * s, 1.35 * s, 0.9, 2.4 * s);
        return;
      }
      case 'review': {
        anchorOffset('review', l.pos, s, 0, tmpV);
        scratch.x += tmpV.x;
        scratch.y += tmpV.y;
        scratch.z += tmpV.z;
        this.spawnRing('ping', scratch, c.warn, 2.2, 0.2, 2.2, 1);
        return;
      }
      case 'task.state': {
        const tp = e.taskId ? this.taskPos.get(`${l.id}/${normTaskId(e.taskId)}`) : undefined;
        if (!tp) return;
        const st = e.data?.state;
        const col =
          st === 'landed'
            ? c.success
            : st === 'review'
              ? c.warn
              : st === 'blocked'
                ? c.accent
                : st === 'failed'
                  ? c.danger
                  : c.fg;
        this.spawnRing('ping', tp, col, 2.2, 0.1, 1.1, 0.7);
        if (st === 'landed') this.spawnBurst(tp, col, 2.2, 12, 1.8, 0.8);
        return;
      }
      case 'agent.tool': {
        const bp = e.agentId ? this.botPos.get(e.agentId) : undefined;
        const a = e.agentId ? this.agents.get(e.agentId) : undefined;
        if (!bp) return;
        this.spawnBurst(bp, a ? c.model[a.model] : c.fg, 2.4, 5, 1.3, 0.4, 0.2);
        return;
      }
      case 'agent.spawn':
      case 'session.start': {
        this.spawnRing('ping', scratch, c.fg, 1.6, 0.4 * s, 2.6 * s, 0.8);
        return;
      }
      default:
        return;
    }
  }

  /** Per-bot deterministic phase in [0,1). */
  static phase(id: string): number {
    return hash01(id);
  }
}

export const SceneStoreContext = createContext<SceneStore | null>(null);

export function useSceneStore(): SceneStore {
  const s = useContext(SceneStoreContext);
  if (!s) throw new Error('useSceneStore outside FleetScene');
  return s;
}

export type { Vec3 };
