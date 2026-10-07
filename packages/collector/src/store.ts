import { EventEmitter } from 'node:events';
import {
  promises as fsp,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  PROTOCOL_VERSION,
  type Agent,
  type Alert,
  type Deploy,
  type FleetEvent,
  type FleetSnapshot,
  type HistoryResponse,
  type OrchRun,
  type Project,
  type PullRequest,
  type Release,
  type Session,
} from '@fleet/shared';

export const HISTORY_FILE = 'history.json';
const HISTORY_FILE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** max events written to history.json */
export const PERSIST_MAX_EVENTS = 20_000;

export interface FleetStoreOptions {
  /** directory for history.json; when set, start() enables periodic saves and close() saves */
  dataDir?: string;
  /** clock, injectable for tests */
  now?: () => number;
  /** max events kept in the ring (default 20000) */
  maxEvents?: number;
  /** retention for events, keyframes and ended sessions (default 24h) */
  retentionMs?: number;
  /** keyframe interval (default 30s) */
  keyframeMs?: number;
  /** min interval between periodic saves (default 60s) */
  saveMs?: number;
  /** 'change' debounce (default 250ms) */
  changeDebounceMs?: number;
  /** max alerts kept (default 500) */
  maxAlerts?: number;
  /** history.json keeps at most one keyframe per this interval (default 5min); memory keeps all */
  persistFrameMs?: number;
}

export interface GithubState {
  prs: PullRequest[];
  releases: Release[];
  deploys: Deploy[];
}

interface HistoryFile {
  version: number;
  savedAt: number;
  state: FleetSnapshot | null;
  frames: FleetSnapshot[];
  events: FleetEvent[];
}

/**
 * In-memory fleet state + 24h history ring.
 * Emits 'event' (FleetEvent) for every emitEvent() and 'change' (debounced) when state changes.
 */
export class FleetStore extends EventEmitter {
  private readonly projects = new Map<string, Project>();
  private readonly sessions = new Map<string, Session>();
  private readonly agents = new Map<string, Agent>();
  private readonly orch = new Map<string, OrchRun>();
  private readonly github = new Map<string, GithubState>();
  private readonly alerts = new Map<string, Alert>();
  private events: FleetEvent[] = [];
  private frames: FleetSnapshot[] = [];

  private readonly now: () => number;
  private readonly maxEvents: number;
  private readonly retentionMs: number;
  private readonly keyframeMs: number;
  private readonly saveMs: number;
  private readonly changeDebounceMs: number;
  private readonly maxAlerts: number;
  private readonly persistFrameMs: number;
  private readonly dataDir?: string;

  private changeTimer?: NodeJS.Timeout;
  private keyframeTimer?: NodeJS.Timeout;
  private saveTimer?: NodeJS.Timeout;
  private changedSinceKeyframe = false;
  private dirtySinceSave = false;
  private saving?: Promise<void>;
  private closed = false;

  constructor(opts: FleetStoreOptions = {}) {
    super();
    this.now = opts.now ?? Date.now;
    this.maxEvents = opts.maxEvents ?? 20_000;
    this.retentionMs = opts.retentionMs ?? DAY_MS;
    this.keyframeMs = opts.keyframeMs ?? 30_000;
    this.saveMs = opts.saveMs ?? 60_000;
    this.changeDebounceMs = opts.changeDebounceMs ?? 250;
    this.maxAlerts = opts.maxAlerts ?? 500;
    this.persistFrameMs = opts.persistFrameMs ?? 5 * 60_000;
    this.dataDir = opts.dataDir;
  }

  /* ---------------- mutations ---------------- */

  upsertProject(p: Project): void {
    // the orch map is authoritative: an embedded orch is moved into it and stripped from the stored project
    this.projects.set(p.id, stripOrch(p));
    if (p.orch) this.orch.set(p.id, p.orch);
    this.markChanged();
  }

  upsertSession(s: Session): void {
    this.sessions.set(s.id, s);
    this.markChanged();
  }

  upsertAgent(a: Agent): void {
    this.agents.set(a.id, a);
    this.markChanged();
  }

  removeSession(sessionId: string): void {
    const had = this.sessions.delete(sessionId);
    let removedAgent = false;
    for (const [id, a] of this.agents) {
      if (a.sessionId === sessionId) {
        this.agents.delete(id);
        removedAgent = true;
      }
    }
    if (had || removedAgent) this.markChanged();
  }

  setOrch(projectId: string, orch: OrchRun | undefined): void {
    if (orch) this.orch.set(projectId, orch);
    else this.orch.delete(projectId);
    this.markChanged();
  }

  setGithub(projectId: string, gh: GithubState): void {
    this.github.set(projectId, {
      prs: gh.prs.filter((x) => x.projectId === projectId),
      releases: gh.releases.filter((x) => x.projectId === projectId),
      deploys: gh.deploys.filter((x) => x.projectId === projectId),
    });
    this.markChanged();
  }

  addAlert(a: Alert): void {
    this.alerts.set(a.id, a);
    if (this.alerts.size > this.maxAlerts) {
      const sorted = [...this.alerts.values()].sort((x, y) => x.at - y.at);
      for (const old of sorted.slice(0, this.alerts.size - this.maxAlerts)) this.alerts.delete(old.id);
    }
    this.markChanged();
  }

  /** marks an alert cleared (kept for history); returns false if unknown */
  clearAlert(id: string): boolean {
    const a = this.alerts.get(id);
    if (!a) return false;
    if (!a.cleared) {
      this.alerts.set(id, { ...a, cleared: true });
      this.markChanged();
    }
    return true;
  }

  /** clears all alerts, optionally only for one project */
  clearAlerts(projectId?: string): void {
    let changed = false;
    for (const [id, a] of this.alerts) {
      if (a.cleared || (projectId !== undefined && a.projectId !== projectId)) continue;
      this.alerts.set(id, { ...a, cleared: true });
      changed = true;
    }
    if (changed) this.markChanged();
  }

  emitEvent(e: FleetEvent): void {
    this.events.push(e);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.dirtySinceSave = true;
    this.emit('event', e);
  }

  /* ---------------- reads ---------------- */

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  snapshot(): FleetSnapshot {
    const projects = [...this.projects.values()]
      .map((p) => {
        const orch = this.orch.get(p.id);
        return orch ? { ...p, orch } : p;
      })
      .sort((a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
    const sessions = [...this.sessions.values()].sort(
      (a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id),
    );
    const agents = [...this.agents.values()].sort(
      (a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id),
    );
    const prs: PullRequest[] = [];
    const releases: Release[] = [];
    const deploys: Deploy[] = [];
    for (const g of this.github.values()) {
      prs.push(...g.prs);
      releases.push(...g.releases);
      deploys.push(...g.deploys);
    }
    prs.sort((a, b) => b.updatedAt - a.updatedAt);
    releases.sort((a, b) => b.publishedAt - a.publishedAt);
    deploys.sort((a, b) => b.createdAt - a.createdAt);
    const alerts = [...this.alerts.values()].sort((a, b) => b.at - a.at);
    return {
      version: PROTOCOL_VERSION,
      generatedAt: this.now(),
      projects,
      sessions,
      agents,
      prs,
      releases,
      deploys,
      alerts,
    };
  }

  /** keyframes in [from,to] plus the last keyframe before `from`; events with ts in [from,to] */
  history(from: number, to: number): HistoryResponse {
    if (!(from <= to)) return { from, to, frames: [], events: [] };
    const frames: FleetSnapshot[] = [];
    let before: FleetSnapshot | undefined;
    for (const f of this.frames) {
      if (f.generatedAt < from) {
        if (!before || f.generatedAt >= before.generatedAt) before = f;
      } else if (f.generatedAt <= to) {
        frames.push(f);
      }
    }
    if (before) frames.unshift(before);
    const events = this.events.filter((e) => e.ts >= from && e.ts <= to).sort((a, b) => a.ts - b.ts);
    return { from, to, frames, events };
  }

  /* ---------------- lifecycle ---------------- */

  /** starts keyframe timer (and periodic save timer when dataDir is set) */
  start(): void {
    if (this.closed || this.keyframeTimer) return;
    this.keyframe();
    this.keyframeTimer = setInterval(() => {
      this.prune();
      this.keyframe();
    }, this.keyframeMs);
    this.keyframeTimer.unref();
    if (this.dataDir) {
      const dir = this.dataDir;
      this.saveTimer = setInterval(() => {
        if (!this.dirtySinceSave) return;
        this.save(dir).catch((err: unknown) => {
          if (this.listenerCount('error') > 0) this.emit('error', err);
          else console.error('[fleet] history save failed:', err);
        });
      }, this.saveMs);
      this.saveTimer.unref();
    }
  }

  /** stops timers and writes history (when dataDir is set) */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.keyframeTimer) clearInterval(this.keyframeTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.keyframeTimer = this.saveTimer = this.changeTimer = undefined;
    if (this.dataDir) {
      // an in-flight save's failure is reported to its own caller; we overwrite with a sync save below
      if (this.saving) await this.saving.catch(() => undefined);
      this.keyframe();
      this.saveSync(this.dataDir);
    }
  }

  /** captures a keyframe if state changed since the last one; returns true if captured */
  keyframe(now = this.now()): boolean {
    if (!this.changedSinceKeyframe && this.frames.length > 0) return false;
    if (!this.changedSinceKeyframe && this.projects.size === 0 && this.sessions.size === 0) return false;
    const snap = structuredClone(this.snapshot());
    snap.generatedAt = now;
    this.frames.push(snap);
    this.changedSinceKeyframe = false;
    this.dirtySinceSave = true;
    this.pruneFrames(now);
    return true;
  }

  /** drops events/frames older than retention and sessions ended more than retention ago */
  prune(now = this.now()): void {
    const cutoff = now - this.retentionMs;
    const before = this.events.length;
    this.events = this.events.filter((e) => e.ts >= cutoff);
    if (this.events.length !== before) this.dirtySinceSave = true;
    this.pruneFrames(now);
    for (const s of [...this.sessions.values()]) {
      if (s.status === 'ended' && s.lastActivity < cutoff) this.removeSession(s.id);
    }
  }

  private pruneFrames(now: number): void {
    const kept = retainFrames(this.frames, now - this.retentionMs);
    if (kept.length !== this.frames.length) {
      this.frames = kept;
      this.dirtySinceSave = true;
    }
  }

  private markChanged(): void {
    this.changedSinceKeyframe = true;
    this.dirtySinceSave = true;
    if (this.changeTimer || this.closed) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      this.emit('change');
    }, this.changeDebounceMs);
    this.changeTimer.unref();
  }

  /* ---------------- persistence ---------------- */

  private serialize(): string {
    const file: HistoryFile = {
      version: HISTORY_FILE_VERSION,
      savedAt: this.now(),
      state: this.snapshot(),
      frames: thinFrames(this.frames, this.persistFrameMs),
      events: this.events.slice(Math.max(0, this.events.length - PERSIST_MAX_EVENTS)),
    };
    return JSON.stringify(file);
  }

  /** atomic write of dir/history.json (tmp + rename). Concurrent calls are serialized. */
  async save(dir: string): Promise<void> {
    const prev = this.saving ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async () => {
        this.dirtySinceSave = false;
        const target = join(dir, HISTORY_FILE);
        const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
        try {
          const data = this.serialize();
          await fsp.mkdir(dir, { recursive: true });
          await fsp.writeFile(tmp, data, { mode: 0o600 });
          await fsp.rename(tmp, target);
        } catch (err) {
          this.dirtySinceSave = true;
          await fsp.rm(tmp, { force: true });
          throw err;
        }
      });
    this.saving = run;
    try {
      await run;
    } finally {
      if (this.saving === run) this.saving = undefined;
    }
  }

  /** synchronous variant used on shutdown */
  saveSync(dir: string): void {
    this.dirtySinceSave = false;
    const target = join(dir, HISTORY_FILE);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      const data = this.serialize();
      mkdirSync(dir, { recursive: true });
      writeFileSync(tmp, data, { mode: 0o600 });
      renameSync(tmp, target);
    } catch (err) {
      this.dirtySinceSave = true;
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  /**
   * Loads dir/history.json: restores state, keyframes and events (pruned to retention).
   * Returns false if no file exists; throws on a malformed file.
   */
  load(dir: string): boolean {
    const target = join(dir, HISTORY_FILE);
    if (!existsSync(target)) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(target, 'utf8'));
    } catch (err) {
      throw new Error(`fleet: malformed history file ${target}`, { cause: err });
    }
    if (!isHistoryFile(parsed)) throw new Error(`fleet: unsupported history file ${target}`);
    const now = this.now();
    const cutoff = now - this.retentionMs;
    this.frames = retainFrames(
      parsed.frames.filter((f) => f.generatedAt <= now).sort((a, b) => a.generatedAt - b.generatedAt),
      cutoff,
    );
    const events = parsed.events.filter((e) => e.ts >= cutoff);
    this.events = events.slice(Math.max(0, events.length - this.maxEvents));
    const st = parsed.state;
    if (st) {
      for (const p of st.projects) {
        if (this.projects.has(p.id)) continue;
        this.projects.set(p.id, stripOrch(p));
        if (p.orch && !this.orch.has(p.id)) this.orch.set(p.id, p.orch);
      }
      for (const s of st.sessions) if (!this.sessions.has(s.id)) this.sessions.set(s.id, s);
      for (const a of st.agents) if (!this.agents.has(a.id)) this.agents.set(a.id, a);
      for (const a of st.alerts) if (!this.alerts.has(a.id)) this.alerts.set(a.id, a);
      const gh = new Map<string, GithubState>();
      const bucket = (id: string): GithubState => {
        let g = gh.get(id);
        if (!g) gh.set(id, (g = { prs: [], releases: [], deploys: [] }));
        return g;
      };
      for (const x of st.prs) bucket(x.projectId).prs.push(x);
      for (const x of st.releases) bucket(x.projectId).releases.push(x);
      for (const x of st.deploys) bucket(x.projectId).deploys.push(x);
      for (const [id, g] of gh) if (!this.github.has(id)) this.github.set(id, g);
    }
    this.prune(now);
    this.markChanged();
    return true;
  }
}

function stripOrch(p: Project): Project {
  if (p.orch === undefined) return p;
  const copy = { ...p };
  delete copy.orch;
  return copy;
}

/** frames (chronological) at/after cutoff, plus the immediate predecessor so replay has an initial state */
function retainFrames(frames: FleetSnapshot[], cutoff: number): FleetSnapshot[] {
  const first = frames.findIndex((f) => f.generatedAt >= cutoff);
  if (first === -1) return frames.length > 0 ? [frames[frames.length - 1]] : [];
  return frames.slice(Math.max(0, first - 1));
}

/** at most one frame per `bucketMs` bucket (the latest in each), so the newest frame is always kept */
function thinFrames(frames: FleetSnapshot[], bucketMs: number): FleetSnapshot[] {
  const out: FleetSnapshot[] = [];
  let lastBucket: number | undefined;
  for (const f of frames) {
    const b = Math.floor(f.generatedAt / bucketMs);
    if (b === lastBucket) out[out.length - 1] = f;
    else out.push(f);
    lastBucket = b;
  }
  return out;
}

function isHistoryFile(v: unknown): v is HistoryFile {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.version !== HISTORY_FILE_VERSION) return false;
  if (!Array.isArray(o.frames) || !Array.isArray(o.events)) return false;
  if (o.state !== null && o.state !== undefined) {
    const s = o.state as Record<string, unknown>;
    for (const k of ['projects', 'sessions', 'agents', 'prs', 'releases', 'deploys', 'alerts']) {
      if (!Array.isArray(s[k])) return false;
    }
  }
  return true;
}
