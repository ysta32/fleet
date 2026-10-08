import { execFile } from 'node:child_process';
import type { Alert, AlertKind, FleetConfig, FleetEvent, FleetSnapshot } from '@fleet/shared';

export type NotifyExec = (cmd: string, args: string[]) => Promise<unknown> | unknown;
export type NotifyFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>;

export interface NotifierDeps {
  exec?: NotifyExec;
  fetch?: NotifyFetch;
  platform?: string;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

const DEDUPE_MS = 10 * 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;

const LABELS: Record<AlertKind, { title: string; tags: string; high: boolean }> = {
  'army.done': { title: 'Army finished', tags: 'white_check_mark', high: false },
  'army.blocked': { title: 'Army blocked', tags: 'warning', high: true },
  'ci.failed': { title: 'CI failed', tags: 'x', high: true },
  'session.waiting': { title: 'Session waiting', tags: 'hourglass', high: false },
  'deploy.failed': { title: 'Deploy failed', tags: 'rotating_light', high: false },
  'spend.budget': { title: 'Spend budget', tags: 'money_with_wings', high: true },
};

const defaultExec: NotifyExec = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

/** Escape text for use inside an AppleScript double-quoted string literal. */
export function appleScriptString(s: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function alertKindOf(e: FleetEvent): AlertKind | undefined {
  switch (e.kind) {
    case 'army.done':
      return 'army.done';
    case 'blocked':
      return 'army.blocked';
    case 'ci':
      return e.severity === 'error' ? 'ci.failed' : undefined;
    case 'session.waiting':
      return 'session.waiting';
    case 'failure':
      return e.data?.source === 'deploy' ? 'deploy.failed' : undefined;
    default:
      return undefined;
  }
}

/** Normalise task ids so "t04", "T4" and "04" name the same task. */
function taskKey(id: string): string {
  const trimmed = id.trim().toLowerCase();
  const numeric = /^t?0*(\d+)$/.exec(trimmed);
  return numeric ? numeric[1]! : trimmed;
}

/**
 * What an alert-worthy event is about: the task (directly, or via the agent/session that is on it),
 * else the agent or session, else the alert kind for project-level events. Events about the same
 * subject are one incident, whatever their kind: a blocked task and its waiting coder push once.
 */
export function incidentRef(e: FleetEvent, kind: AlertKind, snap: FleetSnapshot): string {
  if (e.taskId) return `task:${taskKey(e.taskId)}`;
  if (e.agentId || e.sessionId) {
    const agents = snap.agents.filter(
      (a) => a.projectId === e.projectId && (e.agentId ? a.id === e.agentId : a.sessionId === e.sessionId),
    );
    const waiting = agents.filter((a) => a.status === 'waiting');
    const tasks = new Set(
      (waiting.length ? waiting : agents)
        .map((a) => a.currentTask)
        .filter((t): t is string => !!t)
        .map(taskKey),
    );
    if (tasks.size === 1) return `task:${[...tasks][0]!}`;
    return e.agentId ? `agent:${e.agentId}` : `session:${e.sessionId!}`;
  }
  return `kind:${kind}`;
}

export class Notifier {
  private readonly seen = new Map<string, number>();
  private sent: number[] = [];
  private readonly exec: NotifyExec;
  private readonly fetchFn: NotifyFetch | undefined;
  private readonly platform: string;
  private readonly now: () => number;
  private readonly log: (msg: string, err?: unknown) => void;
  private seq = 0;

  constructor(
    private readonly cfg: FleetConfig['notify'],
    deps: NotifierDeps = {},
  ) {
    this.exec = deps.exec ?? defaultExec;
    this.fetchFn =
      deps.fetch ?? (typeof fetch === 'function' ? (fetch as unknown as NotifyFetch) : undefined);
    this.platform = deps.platform ?? process.platform;
    this.now = deps.now ?? Date.now;
    this.log =
      deps.log ?? ((m, err) => console.error(`[notify] ${m}`, err instanceof Error ? err.message : ''));
  }

  /**
   * Watch non-alert events for incidents ending: a task leaving "blocked" closes its incident, so
   * blocking again later is a new transition that notifies again (instead of waiting out the window).
   */
  observe(e: FleetEvent): void {
    if (e.kind !== 'task.state' || !e.taskId || e.data?.state === 'blocked') return;
    this.seen.delete(`${e.projectId}\u0000task:${taskKey(e.taskId)}`);
  }

  handle(e: FleetEvent, snap: FleetSnapshot): Alert | undefined {
    const kind = alertKindOf(e);
    if (!kind || !this.cfg.kinds.includes(kind)) return undefined;

    const now = this.now();
    for (const [k, t] of this.seen) if (now - t >= DEDUPE_MS) this.seen.delete(k);
    const key = `${e.projectId}\u0000${incidentRef(e, kind, snap)}`;
    if (this.seen.has(key)) return undefined;

    this.sent = this.sent.filter((t) => now - t < RATE_WINDOW_MS);
    if (this.sent.length >= RATE_MAX) return undefined;
    this.seen.set(key, now);
    this.sent.push(now);

    const project = snap.projects.find((p) => p.id === e.projectId)?.name ?? 'project';
    const meta = LABELS[kind];
    const alert: Alert = {
      id: `alert-${e.ts}-${this.seq++}`,
      kind,
      projectId: e.projectId,
      title: meta.title,
      body: project,
      at: e.ts,
    };
    this.deliver(alert, meta);
    return alert;
  }

  private deliver(alert: Alert, meta: { tags: string; high: boolean }): void {
    if (this.cfg.macos && this.platform === 'darwin') {
      const script = `display notification ${appleScriptString(alert.body)} with title ${appleScriptString(
        alert.title,
      )} sound name "Glass"`;
      this.safe(() => this.exec('osascript', ['-e', script]), 'osascript failed');
    }
    if (this.cfg.ntfyUrl && this.fetchFn) {
      const f = this.fetchFn;
      const url = this.cfg.ntfyUrl;
      const headers: Record<string, string> = {
        Title: headerSafe(alert.title),
        Tags: meta.tags,
        Priority: meta.high ? 'high' : 'default',
      };
      this.safe(async () => {
        const res = (await f(url, { method: 'POST', headers, body: alert.body })) as
          { ok?: boolean; status?: number } | undefined;
        if (res && res.ok === false) this.log(`ntfy delivery failed: HTTP ${res.status ?? 'unknown'}`);
      }, 'ntfy failed');
    }
  }

  private safe(fn: () => Promise<unknown> | unknown, msg: string): void {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((err) => this.log(msg, err));
      }
    } catch (err) {
      this.log(msg, err);
    }
  }
}

function headerSafe(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, ' ');
}
