import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addTokens,
  createDemoFleet,
  projectIdFromPath,
  projectNameFromPath,
  type Agent,
  type DemoFleet,
  type FleetConfig,
  type FleetEvent,
  type FleetSnapshot,
  type HistoryResponse,
  type OrchRun,
  type Project,
  type Session,
  type SpendBrief,
  type SpendSummary,
} from '@fleet/shared';
import { dataDir as defaultDataDir } from './config.js';
import { GithubPoller, type ExecFn } from './github/poller.js';
import { Notifier, alertKindOf, type NotifierDeps } from './notify.js';
import { diffOrch, readOrchRun, worktreeOf } from './orch/reader.js';
import { createServer, type StoreLike } from './server.js';
import { FleetStore } from './store.js';
import { SessionParser } from './transcripts/parse.js';
import { Tailer, type TranscriptFile } from './transcripts/tailer.js';

export interface DaemonOptions {
  /** run on the synthetic demo generator; reads nothing from disk. Default: FLEET_DEMO=1 */
  demo?: boolean;
  /** built web UI; default: the collector package's `web/` dir when present */
  webDir?: string;
  /** history.json dir (real mode only); default config dataDir() */
  dataDir?: string;
  /** status refresh / idle clock tick (default 5000) */
  tickMs?: number;
  /** orch re-read interval (default 5000) */
  orchMs?: number;
  /** fleet-spend brief refresh interval and summary cache TTL (default 30000) */
  spendMs?: number;
  /** seam: resolves the fleet-spend module, or undefined when absent (default: optional import) */
  loadSpend?: () => Promise<unknown>;
  /** demo generator tick (default 1000) */
  demoTickMs?: number;
  /** transcript poll interval passed to the tailer (default 1500) */
  tailPollMs?: number;
  /** notifier side-effect hooks (tests) */
  notifierDeps?: NotifierDeps;
  /** exec used by the GitHub poller (tests) */
  githubExec?: ExecFn;
  log?: (msg: string, err?: unknown) => void;
}

export interface Daemon {
  server: http.Server;
  /** bound port (useful with cfg.port = 0) */
  port: number;
  host: string;
  snapshot(): FleetSnapshot;
  close(): Promise<void>;
}

/** events older than this at ingest time are backlog replay and never trigger notifications */
const NOTIFY_MAX_AGE_MS = 5 * 60_000;
/** lines buffered per transcript while waiting for the first `cwd` */
const MAX_BUFFERED_LINES = 2000;
/** fleet-spend cache / refresh cadence */
const SPEND_TTL_MS = 30_000;

function homeDir(): string {
  return process.env.HOME || osHomedir();
}

function defaultWebDir(): string | undefined {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
  return existsSync(dir) ? dir : undefined;
}

const defaultLog = (msg: string, err?: unknown): void => {
  console.error(`[fleet] ${msg}`, err instanceof Error ? err.message : (err ?? ''));
};

/** Snapshot/history source handed to the server; relays 'event'/'change' from the backing state. */
class View extends EventEmitter implements StoreLike {
  constructor(
    private readonly snap: () => FleetSnapshot,
    private readonly hist: (from: number, to: number) => HistoryResponse,
  ) {
    super();
  }
  snapshot(): FleetSnapshot {
    return this.snap();
  }
  history(from: number, to: number): HistoryResponse {
    return this.hist(from, to);
  }
}

interface SpendLoadOpts {
  now?: number;
  configPath?: string;
}

/** the surface of the optional `fleet-spend` package the daemon uses */
export interface SpendModule {
  loadSpendSummary: (opts?: SpendLoadOpts) => Promise<SpendSummary>;
  loadSpendBrief: (opts?: SpendLoadOpts) => Promise<SpendBrief>;
}

const SPEND_SPECIFIER = 'fleet-spend';

/** default loader: optional dynamic import; resolves undefined when the package is not installed */
async function importFleetSpend(): Promise<unknown> {
  try {
    return await import(SPEND_SPECIFIER);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    const msg = err instanceof Error ? err.message : '';
    // "not installed" (node: ERR_MODULE_NOT_FOUND; vite: "Failed to load url") is silent; a broken install throws
    const absent =
      msg.includes(SPEND_SPECIFIER) &&
      (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /failed to load url/i.test(msg));
    if (absent) return undefined;
    throw err;
  }
}

async function loadSpendModule(
  loader: () => Promise<unknown>,
  log: (msg: string, err?: unknown) => void,
): Promise<SpendModule | undefined> {
  let mod: unknown;
  try {
    mod = await loader();
  } catch (err) {
    log('fleet-spend failed to load; spend disabled', err);
    return undefined;
  }
  if (mod === undefined || mod === null) return undefined;
  const m = mod as Record<string, unknown>;
  if (typeof m.loadSpendSummary !== 'function' || typeof m.loadSpendBrief !== 'function') {
    log('fleet-spend lacks loadSpendSummary/loadSpendBrief; spend disabled');
    return undefined;
  }
  return {
    loadSpendSummary: m.loadSpendSummary as SpendModule['loadSpendSummary'],
    loadSpendBrief: m.loadSpendBrief as SpendModule['loadSpendBrief'],
  };
}

function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    // SSE streams are long-lived; drop them so close() can finish
    server.closeAllConnections();
  });
}

/** Wires every source into a store and serves it. Read-only toward everything it observes. */
export async function runDaemon(cfg: FleetConfig, opts: DaemonOptions = {}): Promise<Daemon> {
  const demo = opts.demo ?? process.env.FLEET_DEMO === '1';
  return demo ? runDemo(cfg, opts) : runReal(cfg, opts);
}

/* ---------------- demo ---------------- */

async function runDemo(cfg: FleetConfig, opts: DaemonOptions): Promise<Daemon> {
  const fleet: DemoFleet = createDemoFleet({ now: Date.now() });
  const view = new View(
    () => fleet.snapshot(),
    (from, to) => {
      const now = fleet.snapshot().generatedAt;
      const hours = Math.min(24, Math.max(0, Math.ceil((now - from) / 3_600_000)));
      const h = fleet.history(hours);
      return {
        from,
        to,
        frames: h.frames.filter((f) => f.generatedAt >= from && f.generatedAt <= to),
        events: h.events.filter((e) => e.ts >= from && e.ts <= to),
      };
    },
  );
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.max(0, now - last);
    last = now;
    for (const e of fleet.tick(dt)) view.emit('event', e);
    view.emit('change');
  }, opts.demoTickMs ?? 1000);
  timer.unref();

  // no digest (even a configured one is real content), no spend, no history file, no notifications
  const server = createServer({
    store: view,
    config: cfg,
    webDir: opts.webDir ?? defaultWebDir(),
  });
  const host = cfg.lan ? '0.0.0.0' : '127.0.0.1';
  let port: number;
  try {
    port = await listen(server, cfg.port, host);
  } catch (err) {
    clearInterval(timer);
    throw err;
  }
  let closing: Promise<void> | undefined;
  return {
    server,
    port,
    host,
    snapshot: () => view.snapshot(),
    close: () => {
      closing ??= (async () => {
        clearInterval(timer);
        await closeServer(server);
      })();
      return closing;
    },
  };
}

/* ---------------- real ---------------- */

interface FileEntry {
  file: TranscriptFile;
  parser?: SessionParser;
  projectId?: string;
  buffer: string[];
  /** set after the first ingest (the backlog replay) */
  ingested?: boolean;
}

/** first absolute `cwd` in a batch of transcript lines (only that field is read) */
function firstCwd(lines: string[]): string | undefined {
  for (const raw of lines) {
    if (!raw.includes('"cwd"')) continue;
    try {
      const o = JSON.parse(raw) as { cwd?: unknown };
      if (typeof o.cwd === 'string' && path.isAbsolute(o.cwd)) return path.normalize(o.cwd);
    } catch {
      // partial line: not transcript data
    }
  }
  return undefined;
}

function orchKey(o: OrchRun): string {
  return JSON.stringify({ ...o, updatedAt: 0 });
}

async function runReal(cfg: FleetConfig, opts: DaemonOptions): Promise<Daemon> {
  const log = opts.log ?? defaultLog;
  const histDir = opts.dataDir ?? defaultDataDir();
  const store = new FleetStore({ dataDir: histDir });
  let restored = false;
  try {
    restored = store.load(histDir);
  } catch (err) {
    log('could not load history; starting fresh', err);
  }

  let closed = false;
  let spend: SpendBrief | undefined;

  const view = new View(
    () => (spend ? { ...store.snapshot(), spend } : store.snapshot()),
    (from, to) => store.history(from, to),
  );
  store.on('event', (e: FleetEvent) => view.emit('event', e));
  store.on('change', () => view.emit('change'));
  store.on('error', (err: unknown) => log('store error', err));

  /* notifications: every source's events go through the store */
  const notifier = new Notifier(cfg.notify, { log, ...opts.notifierDeps });
  /** true while emitting events derived from a transcript's first (backlog) ingest */
  let replaying = false;
  store.on('event', (e: FleetEvent) => {
    if (closed || replaying || !alertKindOf(e) || Date.now() - e.ts > NOTIFY_MAX_AGE_MS) return;
    const alert = notifier.handle(e, store.snapshot());
    if (alert) store.addAlert(alert);
  });

  /* projects */
  const projects = new Map<string, Project>();
  const projectJson = new Map<string, string>();
  const putProject = (p: Project): void => {
    projects.set(p.id, p);
    const json = JSON.stringify(p);
    if (projectJson.get(p.id) === json) return;
    projectJson.set(p.id, json);
    store.upsertProject(p);
  };
  const ensureProject = (id: string, root: string | undefined, fallbackName: string): void => {
    if (projects.has(id)) return;
    const existing = store.getProject(id);
    putProject({
      id,
      name: root ? projectNameFromPath(root) || root : fallbackName,
      path: root ?? '',
      lastActivity: existing?.lastActivity ?? 0,
      ...(existing?.repo ? { repo: existing.repo } : {}),
      ...(existing?.branch ? { branch: existing.branch } : {}),
    });
  };

  /* transcripts */
  const files = new Map<string, FileEntry>();
  const sessionJson = new Map<string, string>();
  const agentJson = new Map<string, string>();

  const mainOf = (sid: string): FileEntry | undefined => {
    for (const f of files.values()) if (!f.file.isSubagent && f.file.sessionId === sid && f.parser) return f;
    return undefined;
  };
  const subsOf = (sid: string): FileEntry[] =>
    [...files.values()].filter((f) => f.file.isSubagent && f.file.parentSessionId === sid && f.parser);

  const startParser = (entry: FileEntry, cwd: string | undefined): void => {
    let projectId: string;
    const parent = entry.file.isSubagent ? mainOf(entry.file.parentSessionId ?? '') : undefined;
    if (parent?.projectId) {
      projectId = parent.projectId;
    } else if (cwd) {
      const root = worktreeOf(cwd)?.projectPath ?? cwd;
      projectId = projectIdFromPath(root);
      ensureProject(projectId, root, root);
    } else {
      projectId = entry.file.projectId;
      ensureProject(projectId, undefined, entry.file.projectDir);
    }
    entry.projectId = projectId;
    entry.parser = new SessionParser({ ...entry.file, projectId });
  };

  /** folds subagents into the parent session and upserts what changed; returns the session */
  const syncSession = (sid: string, now: number): Session | undefined => {
    const main = mainOf(sid);
    if (!main?.parser || !main.projectId) return undefined;
    const projectId = main.projectId;
    const s = main.parser.session(now);
    const agents: Agent[] = main.parser.agents(now);
    for (const sub of subsOf(sid)) {
      const ss = sub.parser!.session(now);
      for (const id of ss.agentIds) if (!s.agentIds.includes(id)) s.agentIds.push(id);
      s.tokens = addTokens(s.tokens, ss.tokens);
      s.costUsd += ss.costUsd;
      for (const a of sub.parser!.agents(now)) {
        agents.push({ ...a, sessionId: sid, projectId, location: { ...a.location, projectId } });
      }
    }
    const sj = JSON.stringify(s);
    if (sessionJson.get(sid) !== sj) {
      sessionJson.set(sid, sj);
      store.upsertSession(s);
    }
    for (const a of agents) {
      const aj = JSON.stringify(a);
      if (agentJson.get(a.id) === aj) continue;
      agentJson.set(a.id, aj);
      store.upsertAgent(a);
    }
    const p = projects.get(projectId);
    if (p && (s.lastActivity > p.lastActivity || (s.gitBranch && p.branch === undefined))) {
      putProject({
        ...p,
        lastActivity: Math.max(p.lastActivity, s.lastActivity),
        ...(s.gitBranch && s.lastActivity >= p.lastActivity ? { branch: s.gitBranch } : {}),
      });
    }
    return s;
  };

  const emitAll = (events: FleetEvent[], projectId: string | undefined, replay = false): void => {
    // emit is synchronous, so the flag covers exactly these events
    replaying = replay;
    try {
      for (const e of events)
        store.emitEvent(projectId && e.projectId !== projectId ? { ...e, projectId } : e);
    } finally {
      replaying = false;
    }
  };

  const sessionIdOf = (f: TranscriptFile): string =>
    f.isSubagent ? (f.parentSessionId ?? f.sessionId) : f.sessionId;

  const onLines = (file: TranscriptFile, lines: string[]): void => {
    if (closed) return;
    let entry = files.get(file.path);
    if (!entry) {
      entry = { file, buffer: [] };
      files.set(file.path, entry);
    }
    let batch = lines;
    if (!entry.parser) {
      const cwd = firstCwd(lines);
      const parentKnown = file.isSubagent && mainOf(file.parentSessionId ?? '') !== undefined;
      if (!cwd && !parentKnown && entry.buffer.length + lines.length <= MAX_BUFFERED_LINES) {
        entry.buffer.push(...lines);
        return;
      }
      startParser(entry, cwd ?? firstCwd(entry.buffer));
      batch = entry.buffer.length ? [...entry.buffer, ...lines] : lines;
      entry.buffer = [];
    }
    const now = Date.now();
    // the first ingest replays the transcript backlog (e.g. a turn that ended before a restart): it
    // records state and events but must not re-notify
    const replay = !entry.ingested;
    entry.ingested = true;
    const events = entry.parser!.ingest(batch, now);
    syncSession(sessionIdOf(file), now);
    emitAll(events, entry.projectId, replay);
  };

  const tailer = new Tailer({
    root: cfg.claudeProjectsDir,
    recentWindowMs: cfg.recentWindowMs,
    pollMs: opts.tailPollMs,
  });
  tailer.on('lines', onLines);
  tailer.on('file', (file: TranscriptFile) => {
    if (!files.has(file.path)) files.set(file.path, { file, buffer: [] });
  });

  /** clock tick: advances idle / waiting / ended states */
  const refresh = (): void => {
    if (closed) return;
    const now = Date.now();
    const sids = new Set<string>();
    for (const entry of files.values()) {
      if (!entry.parser) continue;
      emitAll(entry.parser.ingest([], now), entry.projectId);
      sids.add(sessionIdOf(entry.file));
    }
    for (const sid of sids) syncSession(sid, now);
  };

  /** sessions restored from history.json that no transcript backs anymore are ended */
  const reconcileRestored = (): void => {
    if (closed || !restored) return;
    const snap = store.snapshot();
    // restored projects not seen in transcripts still get one orch read, so stale restored orch state clears
    for (const p of snap.projects) {
      if (projects.has(p.id) || !p.path || !path.isAbsolute(p.path)) continue;
      const rest: Project = { ...p };
      delete rest.orch;
      projects.set(p.id, rest);
      projectJson.set(p.id, JSON.stringify(rest));
    }
    const live = new Set([...files.values()].filter((f) => f.parser).map((f) => sessionIdOf(f.file)));
    for (const s of snap.sessions) {
      if (live.has(s.id) || s.status === 'ended') continue;
      store.upsertSession({ ...s, status: 'ended' });
    }
    for (const a of snap.agents) {
      if (live.has(a.sessionId) || a.status === 'done' || a.status === 'failed') continue;
      store.upsertAgent({ ...a, status: 'done' });
    }
  };

  /* orch: projects discovered from transcripts only; reads, never writes */
  const orchPrev = new Map<string, OrchRun | undefined>();
  const orchKeys = new Map<string, string>();
  let orchBusy = false;
  const pollOrch = async (): Promise<void> => {
    if (orchBusy || closed) return;
    orchBusy = true;
    try {
      for (const p of [...projects.values()]) {
        if (!p.path || closed) continue;
        let run: OrchRun | undefined;
        try {
          run = await readOrchRun(p.path, p.id);
        } catch (err) {
          log(`orch read failed for ${p.name}`, err);
          continue;
        }
        if (closed) return;
        const seen = orchPrev.has(p.id);
        const prev = orchPrev.get(p.id);
        orchPrev.set(p.id, run);
        if (!run) {
          // a first read also clears orch state restored from history.json (.orch removed while stopped)
          if (prev || (!seen && restored)) {
            orchKeys.delete(p.id);
            store.setOrch(p.id, undefined);
          }
          continue;
        }
        const key = orchKey(run);
        if (orchKeys.get(p.id) !== key) {
          orchKeys.set(p.id, key);
          store.setOrch(p.id, run);
        }
        // the first read is a baseline, not a change: no replayed task/army events on startup
        if (seen) for (const e of diffOrch(prev, run, Date.now())) store.emitEvent(e);
      }
    } finally {
      orchBusy = false;
    }
  };

  /* GitHub (read-only via gh) */
  const poller = cfg.github
    ? new GithubPoller({ exec: opts.githubExec, pollMs: cfg.githubPollMs })
    : undefined;
  const repoChecked = new Set<string>();
  let ghBusy = false;
  const pollGithub = async (): Promise<void> => {
    if (!poller || ghBusy || closed) return;
    ghBusy = true;
    try {
      const cutoff = Date.now() - cfg.recentWindowMs;
      const active = [...projects.values()].filter((p) => p.path && p.lastActivity >= cutoff);
      if (active.length === 0) return;
      for (const p of active) {
        if (repoChecked.has(p.id)) continue;
        repoChecked.add(p.id);
        const repo = await poller.repoFor(p.path);
        if (closed) return;
        const cur = projects.get(p.id);
        if (repo && cur && cur.repo !== repo) putProject({ ...cur, repo });
      }
      const res = await poller.poll(active.map((p) => ({ id: p.id, path: p.path })));
      if (closed) return;
      for (const p of active) {
        store.setGithub(p.id, {
          prs: res.prs.filter((x) => x.projectId === p.id),
          releases: res.releases.filter((x) => x.projectId === p.id),
          deploys: res.deploys.filter((x) => x.projectId === p.id),
        });
      }
      for (const e of res.events) store.emitEvent(e);
    } catch (err) {
      log('github poll failed', err);
    } finally {
      ghBusy = false;
    }
  };

  /* optional fleet-spend: each scan reads usage logs (~1s), so scans are serialized, one at a time */
  const spendMod = await loadSpendModule(opts.loadSpend ?? importFleetSpend, log);
  const spendTtl = opts.spendMs ?? SPEND_TTL_MS;
  let spendQueue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = spendQueue.then(fn, fn);
    spendQueue = run.catch(() => undefined);
    return run;
  };
  let summaryCache: { at: number; value: SpendSummary } | undefined;
  let summaryInflight: Promise<SpendSummary> | undefined;
  const spendSummary = (): Promise<SpendSummary> => {
    if (summaryCache && Date.now() - summaryCache.at < spendTtl) return Promise.resolve(summaryCache.value);
    summaryInflight ??= exclusive(() => spendMod!.loadSpendSummary({ now: Date.now() }))
      .then((value) => {
        summaryCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        summaryInflight = undefined;
      });
    return summaryInflight;
  };
  let briefInflight = false;
  const pollSpend = async (): Promise<void> => {
    if (!spendMod || briefInflight || closed) return;
    briefInflight = true;
    try {
      const brief = await exclusive(() => spendMod.loadSpendBrief({ now: Date.now() }));
      if (closed) return;
      if (brief && typeof brief === 'object') {
        spend = brief;
        view.emit('change');
      }
    } catch (err) {
      log('fleet-spend refresh failed', err);
    } finally {
      briefInflight = false;
    }
  };

  const server = createServer({
    store: view,
    config: cfg,
    webDir: opts.webDir ?? defaultWebDir(),
    digestDir: cfg.digestDir ?? path.join(homeDir(), '.overnight', 'archive'),
    onExternalAlert: (alert) => {
      if (!closed) store.addAlert(alert);
    },
    ...(spendMod
      ? {
          extraGet: {
            '/api/spend': () => spendSummary(),
          },
        }
      : {}),
  });

  const host = cfg.lan ? '0.0.0.0' : '127.0.0.1';
  const port = await listen(server, cfg.port, host);

  store.start();
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, fn: () => void): void => {
    const t = setInterval(fn, ms);
    t.unref();
    timers.push(t);
  };
  every(opts.tickMs ?? 5000, refresh);
  every(opts.orchMs ?? 5000, () => void pollOrch());
  if (poller) every(Math.max(5000, cfg.githubPollMs), () => void pollGithub());
  if (spendMod) {
    every(spendTtl, () => void pollSpend());
    void pollSpend();
  }

  const tailerStarted = tailer.start().then(
    () => {
      reconcileRestored();
      void pollOrch();
      void pollGithub();
    },
    (err: unknown) => log('transcript tailer failed to start', err),
  );

  let closing: Promise<void> | undefined;
  return {
    server,
    port,
    host,
    snapshot: () => view.snapshot(),
    close: () => {
      closing ??= (async () => {
        closed = true;
        for (const t of timers) clearInterval(t);
        tailer.stop();
        await tailerStarted;
        await closeServer(server);
        await store.close();
      })();
      return closing;
    },
  };
}
