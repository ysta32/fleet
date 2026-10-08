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
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let costTotal = 0;
  let costToday = 0;
  for (const session of snapshot.sessions) {
    costTotal += session.costUsd;
    if (session.startedAt >= day.getTime() && session.startedAt <= now) costToday += session.costUsd;
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
  return { tokens, costTotal, costToday, projects };
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

export interface NeedsYouItem {
  id: string;
  kind: 'alert' | 'blocked' | 'waiting';
  projectId: string;
  title: string;
  at: number;
  /** alert ids that resolving this item clears */
  alertIds: string[];
}

/** Everything that is waiting on the operator, oldest first (cost of delay grows with age). */
export function needsYou(
  snapshot: FleetSnapshot,
  dismissed: ReadonlySet<string> = new Set(),
): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  for (const alert of snapshot.alerts) {
    if (alert.cleared || dismissed.has(alert.id)) continue;
    items.push({
      id: `alert:${alert.id}`,
      kind: 'alert',
      projectId: alert.projectId,
      title: alertTitle(alert),
      at: alert.at,
      alertIds: [alert.id],
    });
  }
  for (const session of snapshot.sessions) {
    if (session.status !== 'waiting') continue;
    items.push({
      id: `waiting:${session.id}`,
      kind: 'waiting',
      projectId: session.projectId,
      title: `${session.title ?? 'Session'} is waiting on you`,
      at: session.lastActivity,
      alertIds: [],
    });
  }
  for (const project of snapshot.projects) {
    const run = project.orch;
    if (!run) continue;
    const blockedTasks = run.tasks.filter((task) => task.state === 'blocked');
    if (run.phase !== 'blocked' && !run.blocked.length && !blockedTasks.length) continue;
    // an active army.blocked alert already represents this project
    if (
      items.some(
        (item) =>
          item.kind === 'alert' &&
          item.projectId === project.id &&
          snapshot.alerts.some((alert) => item.alertIds.includes(alert.id) && alert.kind === 'army.blocked'),
      )
    )
      continue;
    const count = run.blocked.length + blockedTasks.length;
    items.push({
      id: `blocked:${project.id}`,
      kind: 'blocked',
      projectId: project.id,
      title: count ? `Army blocked on ${count} ${count === 1 ? 'item' : 'items'}` : 'Army blocked',
      at: run.updatedAt,
      alertIds: [],
    });
  }
  return items.sort((a, b) => a.at - b.at);
}

export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => field?.toLowerCase().includes(q));
}

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
