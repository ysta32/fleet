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
import { MODEL_COLORS, THEME } from './theme';

export interface ProjectLayout {
  id: string;
  index: number;
  pos: THREE.Vector3;
  scale: number;
  worktrees: string[];
  /** worktree id -> normalised task id */
  inflightWt: Map<string, string>;
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
}
export interface BeamFx {
  active: boolean;
  start: number;
  dur: number;
  height: number;
  radius: number;
  pos: THREE.Vector3;
  color: THREE.Color;
}
export interface ParticleFx {
  active: boolean;
  start: number;
  life: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  size: number;
}

const tmpV = vec3();
/** global effect brightness: restrained, instrument-like bloom */
const FX_GAIN = 0.6;
const tmpColor = new THREE.Color();

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
  /** projectId -> scene time until which the station flickers red */
  flicker = new Map<string, number>();
  /** projectId -> scene time of the last "activity" event (station pulse) */
  activityAt = new Map<string, number>();
  /** agent.move events applied ahead of the next snapshot */
  locOverride = new Map<string, { loc: AgentLocation; ts: number }>();
  /** data-source mode + playhead last seen; used to invalidate pending move overrides */
  private clockMode: string | null = null;
  private playhead = -Infinity;
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
      });
    for (let i = 0; i < PARTICLE_POOL; i++)
      this.particles.push({
        active: false,
        start: 0,
        life: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        color: new THREE.Color(),
        size: 1,
      });
  }

  /**
   * Track the data clock. Pending agent.move overrides are dropped when the source mode changes
   * (live <-> demo <-> replay) or the playhead moves backward (replay seek), since they describe a
   * future that no longer applies. Idempotent for repeated calls with the same values.
   */
  syncClock(mode: string, playhead: number): void {
    if ((this.clockMode !== null && mode !== this.clockMode) || playhead < this.playhead)
      this.locOverride.clear();
    this.clockMode = mode;
    this.playhead = playhead;
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
        l = { id, index, pos: new THREE.Vector3(), scale: 1, worktrees: [], inflightWt: new Map() };
        this.layouts.set(id, l);
      }
      l.index = index;
      stationPosition(index, ids.length, tmpV);
      l.pos.set(tmpV.x, tmpV.y, tmpV.z);
      const running = p.orch ? p.orch.tasks.filter((t) => t.state === 'running').length : 0;
      l.scale = stationScale(working.get(id) ?? 0, running, snap.generatedAt - p.lastActivity);
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
  ): void {
    if (this.reduced) {
      from = to;
      dur = Math.min(dur, 0.6);
      rise = 0;
    }
    const r = this.rings[this.ringCursor]!;
    this.ringCursor = (this.ringCursor + 1) % RING_POOL;
    r.active = true;
    r.kind = kind;
    r.start = this.t;
    r.dur = dur;
    r.from = from;
    r.to = to;
    r.rise = rise;
    r.pos.copy(pos);
    r.color.set(color).multiplyScalar(intensity * FX_GAIN);
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
    b.color.set(color).multiplyScalar(intensity * FX_GAIN);
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
    tmpColor.set(color).multiplyScalar(intensity * FX_GAIN);
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
      p.color.copy(tmpColor);
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
    switch (e.kind) {
      case 'merge': {
        this.spawnRing('shock', scratch, THEME.success, 3, 0.6 * s, 7 * s, 1.6);
        this.spawnRing('shock', scratch, THEME.success, 1.6, 0.4 * s, 4.5 * s, 1.1);
        this.spawnBurst(scratch, THEME.success, 3, 48, 4.5, 1.4);
        return;
      }
      case 'army.done': {
        this.spawnRing('shock', scratch, THEME.release, 3, 0.6 * s, 11 * s, 2.2);
        this.spawnRing('shock', scratch, THEME.success, 2, 0.6 * s, 7 * s, 1.6);
        this.spawnBurst(scratch, THEME.release, 3, 90, 6, 2);
        return;
      }
      case 'deploy':
      case 'release': {
        const err = e.severity === 'error';
        anchorOffset('ci', l.pos, s, 0, tmpV);
        scratch.x += tmpV.x;
        scratch.y += tmpV.y;
        scratch.z += tmpV.z;
        const c = err ? THEME.failure : e.kind === 'release' ? THEME.release : THEME.beam;
        this.spawnBeam(scratch, c, 0.9, 14, 0.32, 1.8);
        this.spawnBeam(scratch, c, 3.2, 16, 0.045, 1.2);
        this.spawnRing('shock', scratch, c, 2.5, 0.2, 3, 1);
        this.spawnBurst(scratch, c, 2.5, 30, 3, 1.2, 0.8);
        if (err) this.flicker.set(e.projectId, this.t + 1.4);
        return;
      }
      case 'failure':
      case 'blocked': {
        this.spawnRing('pulse', scratch, THEME.failure, 3, 0.8 * s, 5 * s, 1.2);
        this.spawnRing('pulse', scratch, THEME.failure, 2, 0.8 * s, 3.5 * s, 0.9);
        this.flicker.set(e.projectId, this.t + (e.kind === 'failure' ? 1.6 : 0.9));
        return;
      }
      case 'ci': {
        anchorOffset('ci', l.pos, s, 0, tmpV);
        scratch.x += tmpV.x;
        scratch.y += tmpV.y;
        scratch.z += tmpV.z;
        if (e.severity === 'error') {
          this.spawnRing('pulse', scratch, THEME.failure, 3, 0.3, 3.2, 1.1);
          this.flicker.set(e.projectId, this.t + 1.2);
        } else if (e.severity === 'success') this.spawnRing('ping', scratch, THEME.success, 2.2, 0.2, 2, 0.9);
        return;
      }
      case 'test.run': {
        this.spawnRing('scan', scratch, THEME.scan, 2.2, 1.35 * s, 1.35 * s, 0.9, 2.4 * s);
        return;
      }
      case 'review': {
        anchorOffset('review', l.pos, s, 0, tmpV);
        scratch.x += tmpV.x;
        scratch.y += tmpV.y;
        scratch.z += tmpV.z;
        this.spawnRing('ping', scratch, THEME.gate, 2.6, 0.2, 2.2, 1);
        return;
      }
      case 'task.state': {
        const tp = e.taskId ? this.taskPos.get(`${l.id}/${normTaskId(e.taskId)}`) : undefined;
        if (!tp) return;
        const st = e.data?.state;
        const c =
          st === 'landed'
            ? THEME.success
            : st === 'review'
              ? THEME.gate
              : st === 'blocked' || st === 'failed'
                ? THEME.failure
                : THEME.scan;
        this.spawnRing('ping', tp, c, 2.4, 0.1, 1.1, 0.7);
        if (st === 'landed') this.spawnBurst(tp, c, 2.5, 14, 1.8, 0.8);
        return;
      }
      case 'agent.tool': {
        const bp = e.agentId ? this.botPos.get(e.agentId) : undefined;
        const a = e.agentId ? this.agents.get(e.agentId) : undefined;
        if (!bp) return;
        this.spawnBurst(bp, a ? MODEL_COLORS[a.model] : THEME.beam, 3, 6, 1.4, 0.45, 0.2);
        return;
      }
      case 'agent.spawn':
      case 'session.start': {
        this.spawnRing('ping', scratch, THEME.hairline, 2, 0.4 * s, 2.6 * s, 0.8);
        this.spawnBurst(scratch, THEME.hairline, 2, 16, 2.2, 0.8);
        return;
      }
      case 'session.waiting': {
        this.spawnRing('ping', scratch, THEME.warn, 2, 0.6 * s, 3 * s, 1.2);
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
