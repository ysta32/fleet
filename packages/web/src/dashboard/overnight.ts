import type { Digest, DigestTotals, ProjectActivity } from '@fleet/digest';
import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import demoDigest from '../../../digest/fixtures/demo-digest.json';

export type OvernightProject = Pick<ProjectActivity, 'id' | 'name' | 'health' | 'summary'> & {
  mergedPRs: Pick<ProjectActivity['mergedPRs'][number], 'number' | 'title' | 'url' | 'at'>[];
  releases: Pick<ProjectActivity['releases'][number], 'tag' | 'name' | 'url' | 'at'>[];
  ciFailures: Pick<ProjectActivity['ciFailures'][number], 'runId' | 'workflow' | 'branch' | 'url' | 'at'>[];
};
export type OvernightDigest = Pick<Digest, 'schema' | 'headline' | 'window' | 'totals'> & {
  projects: OvernightProject[];
};

const invalid = () => new Error('The overnight digest could not be read.');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  return value;
}
function integer(value: unknown, signed = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!signed && value < 0)) throw invalid();
  return value;
}
function date(value: unknown): string {
  const text = string(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) throw invalid();
  return text;
}
function array<T>(value: unknown, parse: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map((item) => parse(object(item)));
}

/** Validate only the versioned fields consumed by this panel; additive fields are ignored. */
export function parseDigest(value: unknown): OvernightDigest {
  const data = object(value);
  if (data.schema !== 'overnight.digest/v1') throw invalid();
  const window = object(data.window);
  const since = date(window.since);
  const until = date(window.until);
  if (Date.parse(since) >= Date.parse(until)) throw invalid();
  const rawTotals = object(data.totals);
  const keys: (keyof DigestTotals)[] = [
    'projectsActive',
    'mergedPRs',
    'commits',
    'releases',
    'ciFailures',
    'openPRsNeedingAttention',
    'issuesOpened',
    'issuesClosed',
    'deployments',
    'deploymentsFailed',
    'starsDelta',
    'agentContributions',
  ];
  const totals = Object.fromEntries(
    keys.map((key) => [key, integer(rawTotals[key], key === 'starsDelta')]),
  ) as unknown as DigestTotals;
  const projects = array(data.projects, (project): OvernightProject => {
    const health = project.health;
    if (health !== 'red' && health !== 'yellow' && health !== 'green' && health !== 'quiet') throw invalid();
    return {
      id: string(project.id),
      name: string(project.name),
      summary: string(project.summary),
      health,
      mergedPRs: array(project.mergedPRs, (pr) => ({
        number: integer(pr.number),
        title: string(pr.title),
        url: string(pr.url),
        at: date(pr.at),
      })),
      releases: array(project.releases, (release) => ({
        tag: string(release.tag),
        name: string(release.name),
        url: string(release.url),
        at: date(release.at),
      })),
      ciFailures: array(project.ciFailures, (run) => ({
        runId: integer(run.runId),
        workflow: string(run.workflow),
        branch: string(run.branch),
        url: string(run.url),
        at: date(run.at),
      })),
    };
  });
  return { schema: data.schema, headline: string(data.headline), window: { since, until }, totals, projects };
}

export function safeDigestUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function summarizeDigest(digest: OvernightDigest) {
  const healthOrder = { red: 0, yellow: 1, green: 2, quiet: 3 };
  return {
    ...digest,
    from: Date.parse(digest.window.since),
    to: Date.parse(digest.window.until),
    needsAttention: digest.projects.filter(
      (project) => project.health === 'red' || project.health === 'yellow',
    ).length,
    projects: [...digest.projects].sort((a, b) => healthOrder[a.health] - healthOrder[b.health]),
    metrics: [
      { label: 'PRs merged', value: digest.totals.mergedPRs },
      { label: 'Commits', value: digest.totals.commits },
      { label: 'Releases', value: digest.totals.releases },
      { label: 'CI failures', value: digest.totals.ciFailures },
      { label: 'Active projects', value: digest.totals.projectsActive },
      { label: 'Agent contributions', value: digest.totals.agentContributions },
    ],
  };
}

export function getDemoDigest(): OvernightDigest {
  return parseDigest(demoDigest);
}

export function getDemoDigestHistory(): HistoryResponse {
  const digest = getDemoDigest();
  const from = Date.parse(digest.window.since);
  const to = Date.parse(digest.window.until);
  const events: FleetEvent[] = digest.projects
    .flatMap((project) => [
      ...project.mergedPRs.map((pr): FleetEvent => ({
        id: `${project.id}:merge:${pr.number}`,
        ts: Date.parse(pr.at),
        projectId: project.id,
        kind: 'merge',
        severity: 'success',
        label: `Merged #${pr.number}: ${pr.title}`.slice(0, 80),
      })),
      ...project.releases.map((release): FleetEvent => ({
        id: `${project.id}:release:${release.tag}`,
        ts: Date.parse(release.at),
        projectId: project.id,
        kind: 'release',
        severity: 'success',
        label: `Released ${release.tag}`.slice(0, 80),
      })),
      ...project.ciFailures.map((run): FleetEvent => ({
        id: `${project.id}:ci:${run.runId}`,
        ts: Date.parse(run.at),
        projectId: project.id,
        kind: 'ci',
        severity: 'error',
        label: `CI failed: ${run.workflow}`.slice(0, 80),
      })),
    ])
    .filter((event) => event.ts >= from && event.ts <= to)
    .sort((a, b) => a.ts - b.ts);
  const frame = (at: number): FleetSnapshot => ({
    version: 1,
    generatedAt: at,
    demo: true,
    projects: digest.projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: '',
      lastActivity: from,
    })),
    sessions: [],
    agents: [],
    deploys: [],
    alerts: [],
    prs: digest.projects.flatMap((project) =>
      project.mergedPRs
        .filter((pr) => Date.parse(pr.at) <= at)
        .map((pr) => ({
          projectId: project.id,
          number: pr.number,
          title: pr.title,
          state: 'merged' as const,
          ci: 'none' as const,
          url: pr.url,
          headRef: '',
          updatedAt: Date.parse(pr.at),
        })),
    ),
    releases: digest.projects.flatMap((project) =>
      project.releases
        .filter((release) => Date.parse(release.at) <= at)
        .map((release) => ({
          projectId: project.id,
          tag: release.tag,
          name: release.name,
          url: release.url,
          publishedAt: Date.parse(release.at),
        })),
    ),
  });
  return {
    from,
    to,
    events,
    frames: [...new Set([from, ...events.map((event) => event.ts), to])].map(frame),
  };
}

export async function fetchDigest(
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<OvernightDigest | null> {
  try {
    const response = await request('/api/digest/latest', { signal, credentials: 'same-origin' });
    if (response.status === 404) return null;
    if (!response.ok) throw invalid();
    return parseDigest(await response.json());
  } catch {
    throw invalid();
  }
}

const pad = (value: number) => String(value).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 6, 22:00 → Oct 7, 07:30 · 9h 30m" in local time; the date is omitted on the end when same-day. */
export function formatWindow(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  const day = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = a.toDateString() === b.toDateString();
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const span = hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
  return `${day(a)}, ${time(a)} → ${sameDay ? '' : `${day(b)}, `}${time(b)} · ${span}`;
}
