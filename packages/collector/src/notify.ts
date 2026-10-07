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

  handle(e: FleetEvent, snap: FleetSnapshot): Alert | undefined {
    const kind = alertKindOf(e);
    if (!kind || !this.cfg.kinds.includes(kind)) return undefined;

    const now = this.now();
    for (const [k, t] of this.seen) if (now - t >= DEDUPE_MS) this.seen.delete(k);
    const ref = e.taskId ?? e.sessionId ?? '';
    const key = `${kind}\u0000${e.projectId}\u0000${ref}`;
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
