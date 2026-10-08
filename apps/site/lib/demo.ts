// Build-time synthetic fleet for the static UI previews. Deterministic: the site's one world (lib/world.mjs,
// chosen by scripts/prebuild.mjs), the same seed and clock as the hero scene, spend beat and digest.
// Uses createDemoFleet from @fleet/shared only. Never reads ~/.claude or any real data.
import { createDemoFleet, estimateCostUsd } from '@fleet/shared';
import type { AlertKind, FleetSnapshot, ModelFamily } from '@fleet/shared';
import { openWorld } from './world.mjs';
import world from './world.generated.json';

export const DEMO_WORLD = world;

type Kind = AlertKind | 'agent.waiting';

/**
 * One incident: everything open about one thing that needs the operator. A waiting session, its blocked army
 * and the waiting agent behind them are one incident per project, not three alerts; other alerts stand alone.
 */
export interface Incident {
  id: string;
  kind: Kind;
  project: string;
  title: string;
  detail: string;
  /** the other signals folded into this incident, e.g. "army blocked" */
  also: string[];
  /** age of the oldest signal in the incident */
  minutes: number;
}

export interface SessionRow {
  id: string;
  project: string;
  model: ModelFamily;
  status: string;
  agents: number;
  tokens: number;
  cost: number;
}

export interface DemoPreview {
  snapshot: FleetSnapshot;
  /** open incidents: needs-you first, then longest wait first */
  inbox: Incident[];
  sessions: SessionRow[];
  totals: { agents: number; working: number; projects: number; cost: number; tokens: number };
}

const KIND_TITLE: Record<Kind, string> = {
  'session.waiting': 'Waiting on you',
  'army.blocked': 'Army blocked',
  'army.done': 'Army finished',
  'ci.failed': 'CI failed',
  'deploy.failed': 'Deploy failed',
  'spend.budget': 'Spend budget reached',
  'agent.waiting': 'Agent waiting',
};
const KIND_SHORT: Record<Kind, string> = {
  'session.waiting': 'session waiting',
  'army.blocked': 'army blocked',
  'army.done': 'army finished',
  'ci.failed': 'CI failed',
  'deploy.failed': 'deploy failed',
  'spend.budget': 'budget reached',
  'agent.waiting': 'agent waiting',
};
/** Kinds that mean "a person is needed on this project"; the first present names the incident. */
const NEEDS_YOU: Kind[] = ['session.waiting', 'army.blocked', 'agent.waiting'];

interface Signal {
  id: string;
  kind: Kind;
  project: string;
  detail: string;
  at: number;
}

/** Groups signals into incidents: needs-you kinds by project, every other alert on its own. */
export function groupIncidents(signals: Signal[], now: number): Incident[] {
  const groups = new Map<string, Signal[]>();
  for (const s of signals) {
    const key = NEEDS_YOU.includes(s.kind) ? `needs:${s.project}` : `alert:${s.id}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const incidents = [...groups.values()].map((list): Incident => {
    const lead = [...list].sort((a, b) => rank(a.kind) - rank(b.kind) || a.at - b.at)[0]!;
    const oldest = Math.min(...list.map((s) => s.at));
    const agent = list.find((s) => s.kind === 'agent.waiting');
    const also = [...new Set(list.filter((s) => s.kind !== lead.kind).map((s) => KIND_SHORT[s.kind]))];
    return {
      id: lead.id,
      kind: lead.kind,
      project: lead.project,
      title: KIND_TITLE[lead.kind],
      // the agent line says who and on what; it beats a generic alert body when both exist
      detail: agent && agent !== lead ? agent.detail : lead.detail,
      also,
      minutes: Math.max(1, Math.round((now - oldest) / 60_000)),
    };
  });
  // Someone waiting on the operator leads; within each band, longest wait first.
  return incidents.sort(
    (a, b) =>
      Number(!NEEDS_YOU.includes(a.kind)) - Number(!NEEDS_YOU.includes(b.kind)) || b.minutes - a.minutes,
  );
}
const rank = (k: Kind) => {
  const i = NEEDS_YOU.indexOf(k);
  return i < 0 ? NEEDS_YOU.length : i;
};

const STATUS_ORDER: Record<string, number> = { waiting: 0, active: 1, idle: 2, ended: 3 };

let cached: DemoPreview | null = null;
let night: ReplayTape | null = null;

export function demoPreview(): DemoPreview {
  if (cached) return cached;
  const fleet = openWorld(createDemoFleet, world);
  const snapshot = fleet.snapshot();
  night = tapeOf(fleet.overnight(NIGHT_HOURS), snapshot);
  const name = new Map(snapshot.projects.map((p) => [p.id, p.name]));
  const now = snapshot.generatedAt;
  const signals: Signal[] = snapshot.alerts
    .filter((a) => !a.cleared)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      project: name.get(a.projectId) ?? a.projectId,
      detail: a.body,
      at: a.at,
    }));
  for (const agent of snapshot.agents.filter((a) => a.status === 'waiting')) {
    signals.push({
      id: agent.id,
      kind: 'agent.waiting',
      project: name.get(agent.projectId) ?? agent.projectId,
      detail: `${agent.label}${agent.currentTask ? ` on ${agent.currentTask}` : ''}`,
      at: agent.lastActivity,
    });
  }
  const inbox = groupIncidents(signals, now);

  // Waiting first (the row the page is about), then live work, then the rest by cost.
  const sessions: SessionRow[] = snapshot.sessions
    .map((s) => ({
      id: s.id,
      project: name.get(s.projectId) ?? s.projectId,
      model: s.model,
      status: s.status,
      agents: s.agentIds.length,
      tokens: s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite,
      cost: s.costUsd,
    }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4) || b.cost - a.cost);
  const totals = {
    agents: snapshot.agents.length,
    working: snapshot.agents.filter((a) => a.status === 'working').length,
    projects: snapshot.projects.length,
    cost: sessions.reduce((t, s) => t + s.cost, 0),
    tokens: sessions.reduce((t, s) => t + s.tokens, 0),
  };
  cached = { snapshot, inbox, sessions, totals };
  return cached;
}

/** Hours on the replay tape: the app's demo night (packages/web DEMO_NIGHT_HOURS). */
const NIGHT_HOURS = 8;

export interface TapeMark {
  /** 0..1 along the tape */
  x: number;
  kind: 'merge' | 'release' | 'ci';
  label: string;
}
export interface ReplayTape {
  since: number;
  until: number;
  tracks: { project: string; marks: TapeMark[]; wait: { from: number; to: number } | null }[];
}

/** The world's last hours as replay tracks: one per project, marks where things happened, the open wait. */
function tapeOf(
  d: ReturnType<ReturnType<typeof createDemoFleet>['overnight']>,
  snap: FleetSnapshot,
): ReplayTape {
  const since = Date.parse(d.window.since);
  const until = Date.parse(d.window.until);
  const x = (iso: string | number) => {
    const at = typeof iso === 'number' ? iso : Date.parse(iso);
    return Math.min(1, Math.max(0, (at - since) / (until - since)));
  };
  const ids = new Map(snap.projects.map((p) => [p.name, p.id]));
  const tracks = d.projects.map((p) => {
    const waits = snap.alerts.filter(
      (a) => !a.cleared && a.kind === 'session.waiting' && a.projectId === ids.get(p.name),
    );
    const from = waits.length ? Math.min(...waits.map((a) => a.at)) : null;
    return {
      project: p.name,
      marks: [
        ...p.mergedPRs.map((m) => ({ x: x(m.at), kind: 'merge' as const, label: `#${m.number} merged` })),
        ...p.releases.map((r) => ({ x: x(r.at), kind: 'release' as const, label: `${r.tag} released` })),
        ...p.ciFailures.map((f) => ({ x: x(f.at), kind: 'ci' as const, label: `${f.workflow} failed` })),
      ].sort((a, b) => a.x - b.x),
      wait: from === null ? null : { from: x(from), to: 1 },
    };
  });
  return { since, until, tracks };
}

export function replayTape(): ReplayTape {
  demoPreview();
  if (!night) throw new Error('demo world has no replay tape');
  return night;
}

/** Worked cost example using the real pricing table from @fleet/shared. Token counts are illustrative. */
export function costExample() {
  const modelId = 'claude-sonnet-4-5';
  const tokens = { input: 182_400, output: 41_250, cacheRead: 1_240_000, cacheWrite: 96_000 };
  const part = (t: Partial<typeof tokens>) =>
    estimateCostUsd(modelId, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...t });
  return {
    modelId,
    tokens,
    lines: [
      { label: 'input', tokens: tokens.input, rate: '$3.00 / Mtok', usd: part({ input: tokens.input }) },
      { label: 'output', tokens: tokens.output, rate: '$15.00 / Mtok', usd: part({ output: tokens.output }) },
      {
        label: 'cache read',
        tokens: tokens.cacheRead,
        rate: '0.1 × input',
        usd: part({ cacheRead: tokens.cacheRead }),
      },
      {
        label: 'cache write',
        tokens: tokens.cacheWrite,
        rate: '1.25 × input',
        usd: part({ cacheWrite: tokens.cacheWrite }),
      },
    ],
    total: estimateCostUsd(modelId, tokens),
    /** The same tokens priced on other model families, from the same table. */
    alternatives: [
      { label: 'haiku', modelId: 'claude-haiku-4-5' },
      { label: 'sonnet', modelId },
      { label: 'opus', modelId: 'claude-opus-4-1' },
    ].map((m) => ({ ...m, usd: estimateCostUsd(m.modelId, tokens) })),
  };
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
