import {
  DIGEST_SCHEMA,
  type Digest,
  type DigestTotals,
  type OvernightConfig,
  type ProjectActivity,
  type ProjectHealth,
  type TimeWindow,
} from './types.js';

function dateKey(until: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(until));
}

export function computeTotals(projects: ProjectActivity[]): DigestTotals {
  const t: DigestTotals = {
    projectsActive: 0,
    mergedPRs: 0,
    commits: 0,
    releases: 0,
    ciFailures: 0,
    openPRsNeedingAttention: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    deployments: 0,
    deploymentsFailed: 0,
    starsDelta: 0,
    agentContributions: 0,
  };
  for (const p of projects) {
    if (p.health !== 'quiet') t.projectsActive++;
    t.mergedPRs += p.mergedPRs.length;
    t.commits += p.commits.length;
    t.releases += p.releases.length;
    t.ciFailures += p.ciFailures.length;
    t.openPRsNeedingAttention += p.openPRs.length;
    t.issuesOpened += p.issues.filter((i) => i.state === 'opened').length;
    t.issuesClosed += p.issues.filter((i) => i.state === 'closed').length;
    t.deployments += p.deployments.length;
    t.deploymentsFailed += p.deployments.filter((d) => d.state === 'ERROR').length;
    t.starsDelta += p.stats?.starsDelta ?? 0;
    t.agentContributions +=
      p.mergedPRs.filter((x) => x.author.isBot).length + p.commits.filter((x) => x.author.isBot).length;
  }
  return t;
}

const HEALTH_ORDER: Record<ProjectHealth, number> = { red: 0, yellow: 1, green: 2, quiet: 3 };

function volume(p: ProjectActivity): number {
  return (
    p.mergedPRs.length +
    p.openPRs.length +
    p.commits.length +
    p.releases.length +
    p.ciFailures.length +
    p.issues.length +
    p.deployments.length
  );
}

export function sortProjects(projects: ProjectActivity[]): ProjectActivity[] {
  return [...projects].sort(
    (a, b) =>
      HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
      volume(b) - volume(a) ||
      a.name.localeCompare(b.name),
  );
}

export function buildDigest(args: {
  config: OvernightConfig;
  window: TimeWindow;
  projects: ProjectActivity[];
  headline: string;
  summarizer: Digest['summarizer'];
  warnings: string[];
  now?: Date;
}): Digest {
  const projects = sortProjects(args.projects);
  return {
    schema: DIGEST_SCHEMA,
    id: dateKey(args.window.until, args.config.timezone),
    generatedAt: (args.now ?? new Date()).toISOString(),
    window: args.window,
    owner: args.config.owner,
    headline: args.headline,
    summarizer: args.summarizer,
    totals: computeTotals(projects),
    projects,
    warnings: args.warnings,
  };
}
