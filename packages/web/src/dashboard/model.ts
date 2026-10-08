import { formatLocalTime, formatUtcTime, sessionSpend } from '@fleet/shared';
import type {
  Alert,
  AlertKind,
  FleetSnapshot,
  ModelFamily,
  OrchTask,
  Session,
  TokenUsage,
} from '@fleet/shared';

export const MODEL_FAMILIES: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'fable', 'astra', 'unknown'];

export function totalTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatCost(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  'army.done': 'Army finished',
  'army.blocked': 'Army blocked',
  'ci.failed': 'CI failed',
  'session.waiting': 'Waiting on you',
  'deploy.failed': 'Deploy failed',
  'spend.budget': 'Over spend budget',
};

/** Human label for an alert kind; unknown kinds fall back to the raw value. */
export function alertKindLabel(kind: string): string {
  return (ALERT_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/** Readable alert headline: the collector title, unless it is empty or just echoes the kind. */
export function alertTitle(alert: Pick<Alert, 'kind' | 'title'>): string {
  const title = alert.title.trim();
  return !title || title === alert.kind ? alertKindLabel(alert.kind) : title;
}

export function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function aggregateFleet(snapshot: FleetSnapshot, now: number) {
  const spend = sessionSpend(snapshot.sessions, now);
  const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const session of snapshot.sessions) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const)
      tokens[key] += session.tokens[key];
  }
  const projects = snapshot.projects.map((project) => {
    const activeByModel: Record<ModelFamily, number> = {
      opus: 0,
      sonnet: 0,
      haiku: 0,
      fable: 0,
      astra: 0,
      unknown: 0,
    };
    for (const agent of snapshot.agents) {
      if (agent.projectId === project.id && agent.status === 'working') activeByModel[agent.model] += 1;
    }
    const activeAgents = Object.values(activeByModel).reduce((sum, count) => sum + count, 0);
    const working =
      activeAgents > 0 ||
      snapshot.sessions.some((session) => session.projectId === project.id && session.status === 'active') ||
      project.orch?.phase === 'running';
    return { project, activeByModel, activeAgents, working };
  });
  return { tokens, costTotal: spend.totalUsd, costToday: spend.todayUsd, spend, projects };
}

export type WorkingRow = ReturnType<typeof aggregateFleet>['projects'][number] & {
  /** why a project with no working agent still counts as working */
  reason: 'agents' | 'session' | 'army';
};

/**
 * The one selector behind "Now working": its rows and its header totals come from the same pass
 * over the given snapshot (live, demo or replay playhead), so the header can never disagree with
 * the rows. `agents` is the sum of the rows' working agents.
 */
export function nowWorking(
  snapshot: FleetSnapshot,
  now: number,
): { rows: WorkingRow[]; agents: number; projects: number } {
  const rows = aggregateFleet(snapshot, now)
    .projects.filter((item) => item.working)
    .map((item): WorkingRow => ({
      ...item,
      reason:
        item.activeAgents > 0
          ? 'agents'
          : snapshot.sessions.some(
                (session) => session.projectId === item.project.id && session.status === 'active',
              )
            ? 'session'
            : 'army',
    }));
  return { rows, agents: rows.reduce((sum, row) => sum + row.activeAgents, 0), projects: rows.length };
}

/**
 * Top-bar vitals. Live they read "Today"; in replay they read the playhead ("At 13:04") and count the
 * working agents and the day's spend in the snapshot at that moment, using the same selectors as the
 * Overview (nowWorking, sessionSpend), so the bar and the panel never disagree.
 */
export function headerVitals(
  snapshot: FleetSnapshot,
  at: number,
  replay: boolean,
): { label: string; title: string; working: number; costUsd: number } {
  return {
    label: replay ? `At ${clockTime(at)}` : 'Today',
    title: replay
      ? `Estimated spend for sessions started that day, as of ${clockTime(at)} local time`
      : 'Estimated spend for sessions started today, local time',
    working: nowWorking(snapshot, at).agents,
    costUsd: sessionSpend(snapshot.sessions, at).todayUsd,
  };
}

export type SessionSortKey =
  'project' | 'title' | 'model' | 'status' | 'lastTool' | 'tokens' | 'cost' | 'lastActivity';

export function sortSessions(
  sessions: readonly Session[],
  projectNames: ReadonlyMap<string, string>,
  key: SessionSortKey,
  direction: 'asc' | 'desc',
): Session[] {
  const value = (session: Session): string | number => {
    switch (key) {
      case 'project':
        return projectNames.get(session.projectId) ?? session.projectId;
      case 'title':
        return session.title ?? session.id;
      case 'lastTool':
        return session.lastTool?.name ?? '';
      case 'tokens':
        return totalTokens(session.tokens);
      case 'cost':
        return session.costUsd;
      default:
        return session[key];
    }
  };
  return [...sessions].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const comparison =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
    return (direction === 'asc' ? comparison : -comparison) || a.id.localeCompare(b.id);
  });
}

export interface DagNode {
  task: OrchTask;
  layer: number;
  x: number;
  y: number;
  unresolved: boolean;
}

export interface DagLayout {
  nodes: DagNode[];
  edges: { from: string; to: string }[];
  missingDependencies: { task: string; dependency: string }[];
  width: number;
  height: number;
}

export function dagLayout(tasks: readonly OrchTask[]): DagLayout {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const layers = new Map<string, number>();
  const pending = new Set(byId.keys());
  const edges: DagLayout['edges'] = [];
  const missingDependencies: DagLayout['missingDependencies'] = [];
  for (const task of byId.values()) {
    for (const dependency of new Set(task.depends)) {
      if (byId.has(dependency)) edges.push({ from: dependency, to: task.id });
      else missingDependencies.push({ task: task.id, dependency });
    }
  }
  while (pending.size) {
    let advanced = false;
    for (const id of pending) {
      const dependencies = byId.get(id)!.depends.filter((dependency) => byId.has(dependency));
      if (dependencies.every((dependency) => layers.has(dependency))) {
        layers.set(
          id,
          dependencies.reduce((layer, dependency) => Math.max(layer, layers.get(dependency)! + 1), 0),
        );
        pending.delete(id);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  const fallbackLayer = layers.size ? Math.max(...layers.values()) + 1 : 0;
  const rows = new Map<number, number>();
  const nodes = [...byId.values()].map((task) => {
    const layer = layers.get(task.id) ?? fallbackLayer;
    const row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return { task, layer, x: 24 + layer * 210, y: 24 + row * 80, unresolved: pending.has(task.id) };
  });
  return {
    nodes,
    edges,
    missingDependencies,
    width: Math.max(240, ...nodes.map((node) => node.x + 194)),
    height: Math.max(100, ...nodes.map((node) => node.y + 76)),
  };
}

/** Why an incident needs the operator. State reasons come from the live snapshot; the rest are alerts. */
export interface IncidentReason {
  kind: AlertKind | 'waiting' | 'blocked';
  /** short human label, e.g. "Waiting on you", "Army blocked" */
  label: string;
  /** extra context (an alert title that says more than its kind); never repeats the incident subject */
  text?: string;
  at: number;
  alertId?: string;
}

/**
 * One thing that needs the operator. Every signal about the same subject (project + task, else the
 * waiting session, else the alert kind) folds into one incident, so a single blocked task never
 * counts as several items.
 */
export interface Incident {
  /** stable key: `${projectId}:${ref}` */
  id: string;
  /** primary signal, for the icon: waiting beats blocked beats a bare alert */
  kind: 'alert' | 'blocked' | 'waiting';
  projectId: string;
  /** task id as the army writes it (e.g. "t04") */
  taskId?: string;
  /** task slug, when the army knows the task */
  taskSlug?: string;
  /** the waiting session, if one is part of this incident */
  sessionId?: string;
  sessionTitle?: string;
  title: string;
  /** alert body, only for incidents that are nothing but alerts (no task or session subject) */
  body?: string;
  /** distinct reasons, oldest first */
  reasons: IncidentReason[];
  /** oldest signal: the cost of delay grows with age */
  at: number;
  /** alert ids that resolving this incident clears */
  alertIds: string[];
}

/** A needs-you item is an incident. */
export type NeedsYouItem = Incident;

/** Normalise task ids so "t04", "T4" and "04" name the same task. */
export function taskKey(id: string): string {
  const trimmed = id.trim().toLowerCase();
  const numeric = /^t?0*(\d+)$/.exec(trimmed);
  return numeric ? numeric[1]! : trimmed;
}

interface Draft {
  id: string;
  projectId: string;
  ref: 'task' | 'session' | 'army' | 'alert' | 'kind';
  taskId?: string;
  taskSlug?: string;
  sessionId?: string;
  sessionTitle?: string;
  /** every waiting session folded into this incident */
  sessions: Set<string>;
  reasons: IncidentReason[];
  alerts: Alert[];
  order: number;
}

/**
 * Group everything that is waiting on the operator into incidents, oldest first.
 * Sources: blocked army tasks (run.blocked and tasks in state "blocked", deduped by task id),
 * waiting sessions (joined to the task their agent is on), and uncleared, undismissed alerts.
 * An alert joins an incident only on a confident subject match: its structured taskId/sessionId,
 * else (for army.blocked / session.waiting) exactly one live task named by an exact token in its
 * text. Anything else stays its own incident, so clearing one incident never clears another's alerts.
 */
export function incidents(snapshot: FleetSnapshot, dismissed: ReadonlySet<string> = new Set()): Incident[] {
  const drafts = new Map<string, Draft>();
  const draft = (id: string, projectId: string, ref: Draft['ref']): Draft => {
    let entry = drafts.get(id);
    if (!entry) {
      entry = { id, projectId, ref, sessions: new Set(), reasons: [], alerts: [], order: drafts.size };
      drafts.set(id, entry);
    }
    return entry;
  };
  const tasksByProject = new Map<string, Map<string, OrchTask>>();
  for (const project of snapshot.projects) {
    const run = project.orch;
    if (!run) continue;
    const tasks = new Map(run.tasks.map((task) => [taskKey(task.id), task]));
    tasksByProject.set(project.id, tasks);
    const ids = [
      ...run.blocked,
      ...run.tasks.filter((task) => task.state === 'blocked').map((task) => task.id),
    ];
    const seen = new Set<string>();
    for (const raw of ids) {
      const key = taskKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = draft(`${project.id}:task:${key}`, project.id, 'task');
      const task = tasks.get(key);
      entry.taskId = task?.id ?? raw.trim();
      entry.taskSlug = task?.slug;
      entry.reasons.push({ kind: 'blocked', label: 'Army blocked', at: run.updatedAt });
    }
    if (!seen.size && run.phase === 'blocked')
      draft(`${project.id}:army`, project.id, 'army').reasons.push({
        kind: 'blocked',
        label: 'Army blocked',
        at: run.updatedAt,
      });
  }
  for (const session of snapshot.sessions) {
    if (session.status !== 'waiting') continue;
    const agents = snapshot.agents.filter(
      (agent) => agent.sessionId === session.id || session.agentIds.includes(agent.id),
    );
    const waitingAgents = agents.filter((agent) => agent.status === 'waiting');
    const onTask = new Set(
      (waitingAgents.length ? waitingAgents : agents)
        .map((agent) => agent.currentTask)
        .filter((task): task is string => !!task)
        .map(taskKey),
    );
    // An agent with no current task still waits on the army's one blocked task when the session runs on
    // that army's branch (a wait raised before the task was dispatched).
    const run = snapshot.projects.find((project) => project.id === session.projectId)?.orch;
    const blockedKeys = run
      ? [...new Set([...run.blocked, ...run.tasks.filter((t) => t.state === 'blocked').map((t) => t.id)])]
          .map(taskKey)
          .filter((key, index, keys) => key && keys.indexOf(key) === index)
      : [];
    const task =
      onTask.size === 1
        ? [...onTask][0]!
        : !onTask.size && blockedKeys.length === 1 && !!session.gitBranch && session.gitBranch === run?.branch
          ? blockedKeys[0]!
          : undefined;
    const entry = task
      ? draft(`${session.projectId}:task:${task}`, session.projectId, 'task')
      : draft(`${session.projectId}:session:${session.id}`, session.projectId, 'session');
    if (task && !entry.taskId) {
      const known = tasksByProject.get(session.projectId)?.get(task);
      entry.taskId =
        known?.id ??
        (waitingAgents.length ? waitingAgents : agents).find(
          (agent) => agent.currentTask && taskKey(agent.currentTask) === task,
        )?.currentTask ??
        task;
      entry.taskSlug = known?.slug;
    }
    entry.sessions.add(session.id);
    if (!entry.sessionId) {
      entry.sessionId = session.id;
      entry.sessionTitle = session.title;
    }
    entry.reasons.push({ kind: 'waiting', label: 'Waiting on you', at: session.lastActivity });
  }
  const live = [...drafts.values()];
  const alertIncident = (alert: Alert): Draft => {
    const projectId = alert.projectId;
    const task = alert.taskId?.trim();
    if (task) {
      const key = taskKey(task);
      const entry = draft(`${projectId}:task:${key}`, projectId, 'task');
      if (!entry.taskId) {
        const known = tasksByProject.get(projectId)?.get(key);
        entry.taskId = known?.id ?? task;
        entry.taskSlug = known?.slug;
      }
      return entry;
    }
    const sessionId = alert.sessionId;
    if (sessionId) {
      const holder = live.find((item) => item.projectId === projectId && item.sessions.has(sessionId));
      if (holder) return holder;
      const entry = draft(`${projectId}:session:${sessionId}`, projectId, 'session');
      if (!entry.sessionId) {
        entry.sessionId = sessionId;
        entry.sessionTitle = snapshot.sessions.find((session) => session.id === sessionId)?.title;
        entry.sessions.add(sessionId);
      }
      return entry;
    }
    if (alert.kind === 'army.blocked' || alert.kind === 'session.waiting') {
      // exact tokens only: "t4" names task 4, never task 40
      const words = new Set(
        `${alert.title} ${alert.body}`
          .split(/[^A-Za-z0-9_-]+/)
          .filter(Boolean)
          .map(taskKey),
      );
      const named = live.filter(
        (item) => item.projectId === projectId && item.ref === 'task' && words.has(taskKey(item.taskId!)),
      );
      if (named.length === 1) return named[0]!;
      return draft(`${projectId}:alert:${alert.id}`, projectId, 'alert');
    }
    // repeats of the same alert collapse; a different body (another PR, another deploy) is its own
    return draft(`${projectId}:${alert.kind}:${alert.body.trim().toLowerCase()}`, projectId, 'kind');
  };
  for (const alert of snapshot.alerts) {
    if (alert.cleared || dismissed.has(alert.id)) continue;
    const entry = alertIncident(alert);
    const label = alertKindLabel(alert.kind);
    const title = alertTitle(alert);
    entry.alerts.push(alert);
    entry.reasons.push({
      kind: alert.kind,
      label,
      ...(title !== label ? { text: title } : {}),
      at: alert.at,
      alertId: alert.id,
    });
  }
  const out = [...drafts.values()].map((entry): Incident => {
    const sorted = [...entry.reasons].sort((a, b) => a.at - b.at);
    const reasons: IncidentReason[] = [];
    for (const reason of sorted) {
      const same = reasons.find((item) => item.label === reason.label && item.text === reason.text);
      if (!same) reasons.push(reason);
    }
    const waiting = reasons.some((reason) => reason.kind === 'waiting' || reason.kind === 'session.waiting');
    const blocked = reasons.some((reason) => reason.kind === 'blocked' || reason.kind === 'army.blocked');
    const subject = entry.taskId
      ? entry.taskSlug
        ? `${entry.taskId} · ${entry.taskSlug}`
        : `Task ${entry.taskId}`
      : entry.ref === 'session'
        ? (entry.sessionTitle ?? 'Session')
        : undefined;
    const latest = entry.alerts.reduce<Alert | undefined>(
      (last, alert) => (!last || alert.at >= last.at ? alert : last),
      undefined,
    );
    const title = subject
      ? `${subject} ${waiting ? 'is waiting on you' : 'is blocked'}`
      : entry.ref === 'army'
        ? 'Army blocked'
        : latest
          ? alertTitle(latest)
          : 'Needs you';
    const incident: Incident = {
      id: entry.id,
      kind: waiting ? 'waiting' : blocked ? 'blocked' : 'alert',
      projectId: entry.projectId,
      title,
      reasons,
      at: sorted[0]!.at,
      alertIds: entry.alerts.map((alert) => alert.id),
    };
    if (entry.taskId) incident.taskId = entry.taskId;
    if (entry.taskSlug) incident.taskSlug = entry.taskSlug;
    if (entry.sessionId) incident.sessionId = entry.sessionId;
    if (entry.sessionTitle) incident.sessionTitle = entry.sessionTitle;
    if (!subject && latest?.body.trim()) incident.body = latest.body.trim();
    return incident;
  });
  const order = new Map([...drafts.values()].map((entry) => [entry.id, entry.order]));
  return out.sort((a, b) => a.at - b.at || order.get(a.id)! - order.get(b.id)!);
}

/** Everything waiting on the operator, as incidents, oldest first. */
export function needsYou(snapshot: FleetSnapshot, dismissed: ReadonlySet<string> = new Set()): Incident[] {
  return incidents(snapshot, dismissed);
}

/**
 * The station's "needs you" count: this project's share of the same incidents() list the Overview,
 * Alerts and the nav badge count, so one blocked task with its waiting coder reads as 1 everywhere and
 * the stations add up to the Overview total. Pass the snapshot through `withDismissed` first so cleared
 * alerts drop out here too.
 */
export function stationNeeds(snapshot: FleetSnapshot, projectId: string): number {
  return incidents(snapshot).filter((incident) => incident.projectId === projectId).length;
}

/**
 * The snapshot with the operator's dismissed alerts marked cleared, for views (the harbour) that read
 * incidents without the dismissed set. Returns the same object when nothing changes.
 */
export function withDismissed(snapshot: FleetSnapshot, dismissed: ReadonlySet<string>): FleetSnapshot {
  if (!dismissed.size || !snapshot.alerts.some((alert) => !alert.cleared && dismissed.has(alert.id)))
    return snapshot;
  return {
    ...snapshot,
    alerts: snapshot.alerts.map((alert) =>
      !alert.cleared && dismissed.has(alert.id) ? { ...alert, cleared: true } : alert,
    ),
  };
}

export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => field?.toLowerCase().includes(q));
}

/** Local 24h "HH:MM"; pair with `formatUtcTime` in a title for the UTC instant. */
export function clockTime(at: number): string {
  return formatLocalTime(at);
}

/** Tooltip for any shown time: local clock, how long ago, and the UTC instant. */
export function timeTitle(at: number, now: number): string {
  return `${clockTime(at)} local, ${relativeTime(at, now)} · ${formatUtcTime(at)}`;
}
