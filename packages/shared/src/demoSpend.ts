import { createDemoFleet, demoModelId } from './demo.js';
import type { DemoDigest, SyntheticFleet } from './demo.js';
import { estimateCostUsd } from './pricing.js';
import { sessionSpend } from './spend.js';
import type { SpendBucket, SpendDimension, SpendSummary, SpendTokens } from './spend.js';
import { localStartOfDay } from './time.js';
import type { FleetSnapshot } from './types.js';

const DAY_MS = 86_400_000;
const r2 = (value: number) => Math.round(value * 100) / 100;

/** Tokens for a cost at a blended $/M rate. */
function tokensFor(costUsd: number, usdPerM = 2.5): SpendTokens {
  const total = Math.round((costUsd / usdPerM) * 1_000_000);
  return {
    input: Math.round(total * 0.08),
    output: Math.round(total * 0.04),
    cacheRead: Math.round(total * 0.82),
    cacheWrite5m: Math.round(total * 0.06),
    cacheWrite1h: 0,
  };
}

function bucket(key: string, costUsd: number, usdPerM?: number): SpendBucket {
  const cost = r2(costUsd);
  return { key, costUsd: cost, tokens: tokensFor(cost, usdPerM), records: Math.round(cost * 11) };
}

const sorted = (buckets: SpendBucket[]) => buckets.sort((a, b) => b.costUsd - a.costUsd);

/** Deterministic 0..1 noise per (seed, day). */
function noise(seed: number, key: string): number {
  let hash = 2166136261 ^ seed;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10_000) / 10_000;
}

const pad = (value: number) => String(value).padStart(2, '0');
const localKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Synthetic Spend summary derived from a demo snapshot, so the Spend tab agrees with the harbour:
 * `todayUsd` is exactly the top bar's "Today" (sessions started since local midnight), repos are the
 * demo projects, the model mix comes from the live agents, and `generatedAt` is the snapshot clock.
 * Earlier days are a seeded estimate at the fleet's current burn rate.
 */
export function demoSpendSummary(snapshot: FleetSnapshot, opts: { seed?: number } = {}): SpendSummary {
  const seed = opts.seed ?? 42;
  const now = snapshot.generatedAt;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const { todayUsd, totalUsd: sessionsUsd } = sessionSpend(snapshot.sessions, now);
  const earliest = Math.min(now, ...snapshot.sessions.map((session) => session.startedAt));
  const burnUsdPerHour = sessionsUsd / Math.max(1, (now - earliest) / 3_600_000);
  // Agents run about half the day; earlier days are estimated at that duty cycle.
  const typicalDay = burnUsdPerHour * 12;

  const daily: SpendBucket[] = Array.from({ length: 31 }, (_, index) => {
    const at = now - (30 - index) * DAY_MS;
    const key = localKey(at);
    if (index === 30) return bucket(key, todayUsd);
    const weekday = new Date(at).getDay();
    const weekend = weekday === 0 || weekday === 6;
    const ramp = 0.55 + (0.45 * index) / 30;
    return bucket(key, typicalDay * ramp * (weekend ? 0.35 : 1) * (0.8 + 0.4 * noise(seed, key)));
  });
  const monthPrefix = localKey(now).slice(0, 8);
  const monthDays = daily.filter((day) => day.key.startsWith(monthPrefix));
  const monthToDateUsd = r2(monthDays.reduce((sum, day) => sum + day.costUsd, 0));
  const lastWeek = daily.slice(-8, -1).reduce((sum, day) => sum + day.costUsd, 0) / 7;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const forecastMonthEndUsd = r2(monthToDateUsd + lastWeek * (daysInMonth - today.getDate()));
  const budget = 1500;
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();

  // Shares of the month from what the fleet is doing now.
  const byModel = new Map<string, number>();
  for (const agent of snapshot.agents) {
    const id = demoModelId(agent.model);
    const cost = estimateCostUsd(id, agent.tokens);
    byModel.set(id, (byModel.get(id) ?? 0) + cost);
  }
  const modelTotal = [...byModel.values()].reduce((sum, value) => sum + value, 0) || 1;
  const names = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const byRepo = new Map<string, number>();
  for (const session of snapshot.sessions) {
    const name = names.get(session.projectId) ?? 'unknown';
    byRepo.set(name, (byRepo.get(name) ?? 0) + session.costUsd);
  }
  const share = (map: Map<string, number>, total: number, rate?: (key: string) => number) =>
    sorted([...map].map(([key, value]) => bucket(key, (monthToDateUsd * value) / total, rate?.(key))));
  const codexShare = (byModel.get('gpt-demo') ?? 0) / modelTotal;
  const live = snapshot.sessions.filter((session) => session.agentIds.length > 0);
  const runs = snapshot.projects.filter((project) => project.orch);
  const topRepo = [...byRepo].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'the busiest project';

  const breakdown: Record<SpendDimension, SpendBucket[]> = {
    source: sorted([
      bucket('claude-code', monthToDateUsd * (1 - codexShare)),
      bucket('codex', monthToDateUsd * codexShare),
    ]),
    model: share(byModel, modelTotal, (key) => (key.includes('opus') || key.includes('fable') ? 9 : 1.6)),
    repo: share(byRepo, sessionsUsd || 1),
    branch: sorted([
      bucket('main', monthToDateUsd * 0.3),
      ...runs.map((project) =>
        bucket(project.orch!.branch ?? `${project.name} army`, (monthToDateUsd * 0.7) / runs.length),
      ),
    ]),
    task: sorted(
      runs.flatMap((project) =>
        project
          .orch!.tasks.filter((task) => task.state !== 'queued')
          .slice(-2)
          .map((task) => bucket(`${project.name} ${task.id} ${task.slug}`, (todayUsd * 0.05) / runs.length)),
      ),
    ),
    session: sorted(live.map((session) => bucket(session.title ?? session.id, session.costUsd))),
    army: sorted(runs.map((project) => bucket(`${project.name} army`, (monthToDateUsd * 0.7) / runs.length))),
    day: sorted(monthDays.map((day) => ({ ...day }))),
  };

  return {
    generatedAt: now,
    priceTableVersion: '2026-10-01',
    monthStart,
    monthToDateUsd,
    todayUsd,
    forecastMonthEndUsd,
    burnUsdPerHour: r2(burnUsdPerHour),
    budget: { monthlyUsd: budget, warnAt: [0.5, 0.8] },
    breakdown,
    daily,
    tips: [
      {
        id: 'critic-to-sonnet',
        title: 'Use Sonnet for short reviews',
        detail:
          'Most critic passes in the demo fleet read under 2k tokens. Assumes the same tokens at Sonnet rates.',
        estMonthlySavingsUsd: r2(forecastMonthEndUsd * 0.08),
      },
      {
        id: 'cache-reuse',
        title: 'Keep sessions warm to reuse cache',
        detail: `Cache writes repeat after idle gaps over 5 minutes in ${topRepo}.`,
        estMonthlySavingsUsd: r2(forecastMonthEndUsd * 0.03),
      },
    ],
    alerts:
      forecastMonthEndUsd > budget
        ? [
            {
              id: 'forecast-over',
              level: 'warn',
              title: 'Forecast is over budget',
              body: `On pace for $${Math.round(forecastMonthEndUsd)} against a $${budget} budget.`,
              at: now - 3_600_000,
            },
          ]
        : [],
    sources: [
      { source: 'claude-code', records: Math.round(monthToDateUsd * (1 - codexShare) * 11), status: 'ok' },
      { source: 'codex', records: Math.round(monthToDateUsd * codexShare * 11), status: 'ok' },
    ],
    unpricedModels: [],
  };
}

/** Seed shared by the app demo and the marketing site, so both show the same world. */
export const DEMO_SEED = 42;

export interface DemoWorldOptions {
  /** default DEMO_SEED */
  seed?: number;
  /** the demo clock (epoch ms); default Date.now() */
  now?: number;
  /** default 6 */
  projects?: number;
  /** overnight digest window in hours (default 8, max 12) */
  digestHours?: number;
}

export interface DemoWorld {
  fleet: SyntheticFleet;
  /** the harbour at `now` */
  snapshot: FleetSnapshot;
  /** Spend tab summary; `todayUsd` equals `sessionSpend(snapshot.sessions, now).todayUsd` */
  spend: SpendSummary;
  /** overnight digest ending at `now`, from the same simulation */
  digest: DemoDigest;
}

/**
 * One demo world (harbour, Spend and overnight digest) for a seed and clock. The app and the site call
 * this with the same `seed`/`now` to render the same numbers. Days roll over at local midnight.
 */
export function createDemoWorld(opts: DemoWorldOptions = {}): DemoWorld {
  const seed = opts.seed ?? DEMO_SEED;
  const fleet = createDemoFleet({
    seed,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.projects !== undefined ? { projects: opts.projects } : {}),
    startOfDay: localStartOfDay,
  });
  const snapshot = fleet.snapshot();
  return {
    fleet,
    snapshot,
    spend: demoSpendSummary(snapshot, { seed }),
    digest: fleet.overnight(opts.digestHours ?? 8),
  };
}
