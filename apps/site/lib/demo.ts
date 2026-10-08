// Build-time synthetic fleet for the static UI previews. Deterministic: fixed seed and clock.
// Uses createDemoFleet from @fleet/shared only. Never reads ~/.claude or any real data.
import { createDemoFleet, estimateCostUsd } from '@fleet/shared';
import type { AlertKind, FleetSnapshot, ModelFamily } from '@fleet/shared';

export const DEMO_SEED = 7;
const CLOCK = Date.UTC(2026, 9, 7, 22, 40);

export interface InboxItem {
  id: string;
  kind: AlertKind | 'agent.waiting';
  project: string;
  title: string;
  detail: string;
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
  inbox: InboxItem[];
  sessions: SessionRow[];
  totals: { agents: number; working: number; projects: number; cost: number; tokens: number };
}

const KIND_TITLE: Record<InboxItem['kind'], string> = {
  'session.waiting': 'Waiting on you',
  'army.blocked': 'Army blocked',
  'army.done': 'Army finished',
  'ci.failed': 'CI failed',
  'deploy.failed': 'Deploy failed',
  'spend.budget': 'Spend budget reached',
  'agent.waiting': 'Agent waiting',
};

function interesting(s: FleetSnapshot): boolean {
  return s.alerts.filter((a) => !a.cleared).length >= 2 && s.sessions.some((x) => x.status === 'waiting');
}

let cached: DemoPreview | null = null;

export function demoPreview(): DemoPreview {
  if (cached) return cached;
  const fleet = createDemoFleet({ seed: DEMO_SEED, now: CLOCK });
  let snapshot = fleet.snapshot();
  // Advance the synthetic clock to the first moment where something needs the operator.
  for (let i = 0; i < 720 && !interesting(snapshot); i++) {
    fleet.tick(30_000);
    snapshot = fleet.snapshot();
  }
  // Then let it run a few more minutes so the waits have an age.
  fleet.tick(14 * 60_000);
  const later = fleet.snapshot();
  if (interesting(later)) snapshot = later;

  const name = new Map(snapshot.projects.map((p) => [p.id, p.name]));
  const now = snapshot.generatedAt;
  const inbox: InboxItem[] = snapshot.alerts
    .filter((a) => !a.cleared)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      project: name.get(a.projectId) ?? a.projectId,
      title: KIND_TITLE[a.kind],
      detail: a.body,
      minutes: Math.max(1, Math.round((now - a.at) / 60_000)),
    }));
  for (const agent of snapshot.agents.filter((a) => a.status === 'waiting')) {
    inbox.push({
      id: agent.id,
      kind: 'agent.waiting',
      project: name.get(agent.projectId) ?? agent.projectId,
      title: KIND_TITLE['agent.waiting'],
      detail: `${agent.label}${agent.currentTask ? ` on ${agent.currentTask}` : ''}`,
      minutes: Math.max(1, Math.round((now - agent.lastActivity) / 60_000)),
    });
  }
  inbox.sort((a, b) => b.minutes - a.minutes);

  const sessions: SessionRow[] = snapshot.sessions.map((s) => ({
    id: s.id,
    project: name.get(s.projectId) ?? s.projectId,
    model: s.model,
    status: s.status,
    agents: s.agentIds.length,
    tokens: s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite,
    cost: s.costUsd,
  }));
  const totals = {
    agents: snapshot.agents.length,
    working: snapshot.agents.filter((a) => a.status === 'working').length,
    projects: snapshot.projects.length,
    cost: sessions.reduce((t, s) => t + s.cost, 0),
    tokens: sessions.reduce((t, s) => t + s.tokens, 0),
  };
  cached = { snapshot, inbox: inbox.slice(0, 4), sessions, totals };
  return cached;
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
  };
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
