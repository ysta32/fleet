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

/** What an alert-worthy event is about. */
export interface IncidentSubject {
  /** incident ref within the project: `task:<key>`, `agent:<id>`, `session:<id>` or `kind:<kind>` */
  ref: string;
  /** the task id as written by its source, when the event is about a task */
  taskId?: string;
}

/**
 * The task (directly, or via the agent/session that is on it), else the agent or session, else the
 * alert kind for project-level events. Events about the same subject are one incident, whatever their
 * kind: a blocked task and its waiting coder are one incident.
 */
export function incidentSubject(e: FleetEvent, kind: AlertKind, snap: FleetSnapshot): IncidentSubject {
  if (e.taskId) return { ref: `task:${taskKey(e.taskId)}`, taskId: e.taskId };
  if (e.agentId || e.sessionId) {
    const agents = snap.agents.filter(
      (a) => a.projectId === e.projectId && (e.agentId ? a.id === e.agentId : a.sessionId === e.sessionId),
    );
    const waiting = agents.filter((a) => a.status === 'waiting');
    const onTask = (waiting.length ? waiting : agents).filter(
      (a): a is typeof a & { currentTask: string } => !!a.currentTask,
    );
    const tasks = new Set(onTask.map((a) => taskKey(a.currentTask)));
    if (tasks.size === 1) {
      const key = [...tasks][0]!;
      return { ref: `task:${key}`, taskId: onTask.find((a) => taskKey(a.currentTask) === key)!.currentTask };
    }
    return { ref: e.agentId ? `agent:${e.agentId}` : `session:${e.sessionId!}` };
  }
  return { ref: `kind:${kind}` };
}

/** Result of handling an alert-worthy event: the alert to store, and whether it was notified. */
export interface NotifyResult {
  alert: Alert;
  /** true when this alert was delivered (macOS / ntfy) and should also go out as web push */
  notify: boolean;
}

interface OpenIncident {
  /** when it was last notified */
  at: number;
  /** a high-priority alert has been notified for it */
  high: boolean;
  /** waiting sessions/agents holding it open */
  holders: Set<string>;
  /** a blocked task holds it open */
  task: boolean;
}

export class Notifier {
  /** alert dedupe: identical alerts (kind + incident + holder) inside the window are dropped */
  private readonly seen = new Map<string, { at: number; incident: string; holder?: string }>();
  /** delivery dedupe: one notification per incident transition */
  private readonly open = new Map<string, OpenIncident>();
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
   * Watch non-alert events for incidents ending, so the next one is a new transition that notifies
   * (instead of waiting out the window): a task leaving "blocked" closes its incident; any later
   * activity (or end) of a waiting session or agent releases its hold, closing the incident when
   * nothing else holds it open.
   */
  observe(e: FleetEvent): void {
    if (e.kind === 'task.state' && e.taskId && e.data?.state !== 'blocked') {
      this.close(`${e.projectId}\u0000task:${taskKey(e.taskId)}`);
      return;
    }
    if (!this.seen.size && !this.open.size) return;
    const holders = new Set<string>();
    if (e.agentId) holders.add(e.agentId);
    if (e.sessionId && (e.kind === 'session.end' || !e.agentId || e.agentId === e.sessionId))
      holders.add(e.sessionId);
    if (holders.size) this.release(e.projectId, holders);
  }

  handle(e: FleetEvent, snap: FleetSnapshot): NotifyResult | undefined {
    const kind = alertKindOf(e);
    if (!kind || !this.cfg.kinds.includes(kind)) return undefined;

    const now = this.now();
    for (const [k, v] of this.seen) if (now - v.at >= DEDUPE_MS) this.seen.delete(k);
    for (const [k, v] of this.open) if (now - v.at >= DEDUPE_MS) this.open.delete(k);
    const subject = incidentSubject(e, kind, snap);
    const incident = `${e.projectId}\u0000${subject.ref}`;
    const holder = kind === 'session.waiting' ? (e.agentId ?? e.sessionId) : undefined;
    const alertKey = `${kind}\u0000${incident}\u0000${holder ?? ''}`;
    if (this.seen.has(alertKey)) return undefined;
    this.seen.set(alertKey, { at: now, incident, ...(holder ? { holder } : {}) });

    const meta = LABELS[kind];
    const existing = this.open.get(incident);
    const holds = (entry: OpenIncident) => {
      if (holder) entry.holders.add(holder);
      if (kind === 'army.blocked' && subject.taskId) entry.task = true;
    };
    // a new incident notifies; so does a high-priority escalation of one notified at low priority
    let notify = !existing || (meta.high && !existing.high);
    this.sent = this.sent.filter((t) => now - t < RATE_WINDOW_MS);
    if (notify && this.sent.length >= RATE_MAX) notify = false;
    if (notify) {
      this.sent.push(now);
      const entry: OpenIncident = existing ?? { at: now, high: false, holders: new Set(), task: false };
      entry.at = now;
      entry.high ||= meta.high;
      holds(entry);
      this.open.set(incident, entry);
    } else if (existing) holds(existing);

    const project = snap.projects.find((p) => p.id === e.projectId)?.name ?? 'project';
    const alert: Alert = {
      id: `alert-${e.ts}-${this.seq++}`,
      kind,
      projectId: e.projectId,
      title: meta.title,
      body: project,
      at: e.ts,
    };
    if (subject.taskId) alert.taskId = subject.taskId;
    if (e.sessionId) alert.sessionId = e.sessionId;
    if (notify) this.deliver(alert, meta);
    return { alert, notify };
  }

  private close(incident: string): void {
    this.open.delete(incident);
    for (const [k, v] of this.seen) if (v.incident === incident) this.seen.delete(k);
  }

  private release(projectId: string, holders: ReadonlySet<string>): void {
    const prefix = `${projectId}\u0000`;
    for (const [k, v] of this.seen)
      if (v.holder && holders.has(v.holder) && v.incident.startsWith(prefix)) this.seen.delete(k);
    for (const [incident, entry] of this.open) {
      if (!incident.startsWith(prefix)) continue;
      let changed = false;
      for (const h of holders) changed = entry.holders.delete(h) || changed;
      if (changed && !entry.holders.size && !entry.task) this.close(incident);
    }
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
