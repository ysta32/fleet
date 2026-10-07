import type {
  Actor,
  CIFailureItem,
  CommitItem,
  Digest,
  DigestTotals,
  DeploymentItem,
  IssueItem,
  ProjectActivity,
  PullRequestItem,
  ReleaseItem,
} from '../types.js';
import { DIGEST_SCHEMA } from '../types.js';
import { computeTotals, sortProjects } from '../digest.js';
import { computeHealth } from '../summarize/fallback.js';

/** Synthetic demo data: all names, repos and people are fictional. */

const OWNER = 'acme-dev';
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2020, 0, 1);

const HUMAN: Actor = { login: 'acme-dev', isBot: false };
const CLAUDE: Actor = { login: 'claude[bot]', isBot: true };
const CODEX: Actor = { login: 'codex-agent[bot]', isBot: true };
const RENOVATE: Actor = { login: 'renovate[bot]', isBot: true };

interface RepoSpec {
  name: string;
  description: string;
  vercel: boolean;
  topics: string[];
}

const REPOS: RepoSpec[] = [
  {
    name: 'lantern-api',
    description: 'REST and event API for the Lantern platform',
    vercel: true,
    topics: ['auth', 'pagination', 'rate limiter', 'webhooks', 'search endpoint'],
  },
  {
    name: 'tidepool-web',
    description: 'Customer dashboard for Tidepool',
    vercel: true,
    topics: ['billing page', 'dark mode', 'onboarding flow', 'chart tooltips', 'settings form'],
  },
  {
    name: 'quill-cli',
    description: 'Command line client for Quill notes',
    vercel: false,
    topics: ['sync command', 'config loader', 'shell completions', 'export flag', 'progress bar'],
  },
  {
    name: 'harbor-infra',
    description: 'Terraform and deployment tooling',
    vercel: false,
    topics: ['staging cluster', 'backup job', 'IAM policy', 'autoscaling', 'DNS records'],
  },
  {
    name: 'sparrow-ios',
    description: 'iOS app for Sparrow messaging',
    vercel: false,
    topics: ['push handling', 'offline queue', 'onboarding', 'widget', 'keychain storage'],
  },
  {
    name: 'orbit-docs',
    description: 'Documentation site for Orbit',
    vercel: true,
    topics: ['quickstart', 'API reference', 'search index', 'changelog page', 'sidebar'],
  },
  {
    name: 'ember-ui',
    description: 'Shared React component library',
    vercel: true,
    topics: ['button variants', 'modal focus trap', 'date picker', 'tokens', 'tooltip'],
  },
  {
    name: 'kiln-workers',
    description: 'Background job workers',
    vercel: false,
    topics: ['retry policy', 'queue metrics', 'cron scheduler', 'batch import', 'dead letter queue'],
  },
  {
    name: 'meadow-site',
    description: 'Marketing site for Meadow',
    vercel: true,
    topics: ['pricing table', 'hero section', 'blog feed', 'contact form', 'sitemap'],
  },
  {
    name: 'compass-sdk',
    description: 'Client SDK for the Compass API',
    vercel: false,
    topics: ['typed errors', 'retry wrapper', 'pagination helper', 'browser build', 'auth refresh'],
  },
];

const FEAT_VERBS = ['add', 'implement', 'introduce', 'support'];
const FIX_VERBS = ['fix', 'resolve', 'handle', 'correct'];
const CHORE_TITLES = [
  'bump dependencies',
  'update lockfile',
  'tidy lint config',
  'refresh CI cache',
  'update snapshots',
];
const WORKFLOWS = ['ci', 'test', 'build', 'lint'];
const LABELS = ['enhancement', 'bug', 'chore', 'docs', 'dependencies'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }
  hex(len: number): string {
    let out = '';
    while (out.length < len) out += this.int(0, 15).toString(16);
    return out;
  }
}

function parseDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  }
  return ms;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function isoAt(since: number, rng: Rng): string {
  return new Date(since + rng.int(0, DAY_MS / 60_000 - 1) * 60_000).toISOString();
}

function version(repoIdx: number, dayIdx: number): string {
  const major = repoIdx % 3;
  return `${major}.${Math.floor(dayIdx / 30) + 1}.${dayIdx % 30}`;
}

function prTitle(rng: Rng, spec: RepoSpec): { title: string; label: string; bot: Actor } {
  const kind = rng.float();
  const topic = rng.pick(spec.topics);
  if (kind < 0.4) {
    return {
      title: `feat: ${rng.pick(FEAT_VERBS)} ${topic}`,
      label: 'enhancement',
      bot: rng.chance(0.5) ? CLAUDE : CODEX,
    };
  }
  if (kind < 0.75) {
    return {
      title: `fix: ${rng.pick(FIX_VERBS)} ${topic} edge case`,
      label: 'bug',
      bot: rng.chance(0.5) ? CLAUDE : CODEX,
    };
  }
  return {
    title: `chore: ${rng.pick(CHORE_TITLES)}`,
    label: rng.chance(0.5) ? 'dependencies' : 'chore',
    bot: RENOVATE,
  };
}

function buildProject(
  spec: RepoSpec,
  repoIdx: number,
  dayIdx: number,
  since: number,
  forceRed: boolean,
  rng: Rng,
  counters: { pr: number },
): ProjectActivity {
  const base = `https://github.com/${OWNER}/${spec.name}`;
  const siteUrl = spec.vercel ? `https://${spec.name}.example.app` : undefined;
  const quiet = !forceRed && rng.chance(0.15);

  const mergedPRs: PullRequestItem[] = [];
  const openPRs: PullRequestItem[] = [];
  const commits: CommitItem[] = [];
  const releases: ReleaseItem[] = [];
  const ciFailures: CIFailureItem[] = [];
  const issues: IssueItem[] = [];
  const deployments: DeploymentItem[] = [];

  if (!quiet) {
    const prCount = rng.int(0, 3);
    for (let i = 0; i < prCount; i++) {
      const number = 100 + dayIdx * 3 + repoIdx * 40 + i + counters.pr++ * 0;
      const t = prTitle(rng, spec);
      const author = rng.chance(0.25) ? HUMAN : t.bot;
      mergedPRs.push({
        number,
        title: t.title,
        url: `${base}/pull/${number}`,
        author,
        at: isoAt(since, rng),
        additions: rng.int(4, 420),
        deletions: rng.int(0, 180),
        labels: [t.label],
      });
    }
    const commitCount = rng.int(prCount === 0 ? 1 : 0, 5);
    for (let i = 0; i < commitCount; i++) {
      const sha = rng.hex(40);
      const topic = rng.pick(spec.topics);
      const author = rng.pick([HUMAN, HUMAN, CLAUDE, CODEX, RENOVATE]);
      commits.push({
        sha,
        message: rng.chance(0.5) ? `${rng.pick(FIX_VERBS)} ${topic}` : `refactor ${topic}`,
        url: `${base}/commit/${sha}`,
        author,
        at: isoAt(since, rng),
        branch: 'main',
      });
    }
    if (rng.chance(0.15)) {
      const tag = `v${version(repoIdx, dayIdx)}`;
      releases.push({
        tag,
        name: `${spec.name} ${tag}`,
        url: `${base}/releases/tag/${tag}`,
        at: isoAt(since, rng),
        prerelease: false,
        notes: `Includes ${plural(mergedPRs.length, 'merged change')} since the previous release.`,
      });
    }
    if (rng.chance(0.3)) {
      const number = 300 + dayIdx * 2 + repoIdx * 20;
      const closed = rng.chance(0.4);
      issues.push({
        number,
        title: `${rng.pick(spec.topics)} ${rng.pick(['behaves oddly', 'is slow', 'needs docs', 'crashes on empty input'])}`,
        url: `${base}/issues/${number}`,
        author: HUMAN,
        at: isoAt(since, rng),
        state: closed ? 'closed' : 'opened',
        labels: [closed ? 'resolved' : 'triage'],
      });
    }
    if (rng.chance(0.3)) {
      const number = 500 + dayIdx + repoIdx * 10;
      const attention: NonNullable<PullRequestItem['attention']> = [
        rng.pick(['review_requested', 'stale', 'approved_unmerged', 'conflicts'] as const),
      ];
      openPRs.push({
        number,
        title: `feat: ${rng.pick(FEAT_VERBS)} ${rng.pick(spec.topics)}`,
        url: `${base}/pull/${number}`,
        author: rng.pick([CLAUDE, CODEX, HUMAN]),
        at: isoAt(since, rng),
        labels: [rng.pick(LABELS)],
        draft: false,
        attention,
      });
    }
    if (spec.vercel) {
      const depCount = rng.int(1, 3);
      for (let i = 0; i < depCount; i++) {
        const production = i === 0 && mergedPRs.length > 0;
        deployments.push({
          id: `dpl_${rng.hex(9)}`,
          project: spec.name,
          url: `https://${spec.name}.example.app`,
          target: production ? 'production' : 'preview',
          state: 'READY',
          at: isoAt(since, rng),
          commitMessage: mergedPRs[0]?.title ?? commits[0]?.message,
          branch: production ? 'main' : `feature/${rng.pick(spec.topics).replace(/\s+/g, '-')}`,
        });
      }
    }
    if (rng.chance(0.12)) {
      ciFailures.push(makeCiFailure(base, since, rng, 'main', commits[0]?.message));
    }
    if (rng.chance(0.12)) {
      ciFailures.push(
        makeCiFailure(base, since, rng, `feature/${rng.pick(spec.topics).replace(/\s+/g, '-')}`, undefined),
      );
    }
    if (rng.chance(0.1)) {
      const first = deployments[0];
      if (first) first.state = 'ERROR';
    }
  }

  if (forceRed) {
    if (spec.vercel) {
      if (deployments.length === 0) {
        deployments.push({
          id: `dpl_${rng.hex(9)}`,
          project: spec.name,
          url: `https://${spec.name}.example.app`,
          target: 'production',
          state: 'READY',
          at: isoAt(since, rng),
          branch: 'main',
        });
      }
      const dep = deployments[0] as DeploymentItem;
      dep.target = 'production';
      dep.branch = 'main';
      dep.state = 'ERROR';
      dep.at = new Date(since + DAY_MS - 60_000).toISOString();
    } else {
      ciFailures.push(makeCiFailure(base, since, rng, 'main', commits[0]?.message));
    }
    if (mergedPRs.length === 0 && commits.length === 0) {
      const sha = rng.hex(40);
      commits.push({
        sha,
        message: `fix ${rng.pick(spec.topics)}`,
        url: `${base}/commit/${sha}`,
        author: HUMAN,
        at: isoAt(since, rng),
        branch: 'main',
      });
    }
  }

  const hasActivity =
    mergedPRs.length +
      commits.length +
      releases.length +
      ciFailures.length +
      issues.length +
      deployments.length >
    0;

  const stars = 40 + repoIdx * 37 + dayIdx;
  const starsDelta = hasActivity ? rng.int(0, 6) : 0;
  const project: ProjectActivity = {
    id: `${OWNER}/${spec.name}`,
    name: spec.name,
    url: base,
    description: spec.description,
    defaultBranch: 'main',
    ...(spec.vercel ? { vercelProject: spec.name, siteUrl } : {}),
    mergedPRs: mergedPRs.sort((a, b) => a.at.localeCompare(b.at)),
    openPRs,
    commits: commits.sort((a, b) => a.at.localeCompare(b.at)),
    releases,
    ciFailures,
    issues,
    deployments,
    stats: {
      stars: stars + starsDelta,
      forks: 3 + repoIdx + Math.floor(dayIdx / 20),
      starsDelta,
      forksDelta: rng.chance(0.05) ? 1 : 0,
      openIssues: rng.int(2, 18),
    },
    health: 'green',
    summary: '',
    highlights: [],
  };
  project.health = computeHealth(project);
  const text = describe(project);
  project.summary = text.summary;
  project.highlights = text.highlights;
  return project;
}

function makeCiFailure(
  base: string,
  since: number,
  rng: Rng,
  branch: string,
  commitMessage: string | undefined,
): CIFailureItem {
  const runId = rng.int(9_000_000_000, 9_999_999_999);
  return {
    workflow: rng.pick(WORKFLOWS),
    runId,
    url: `${base}/actions/runs/${runId}`,
    branch,
    at: isoAt(since, rng),
    conclusion: rng.pick(['failure', 'failure', 'timed_out'] as const),
    ...(commitMessage ? { commitMessage } : {}),
  };
}

function describe(p: ProjectActivity): { summary: string; highlights: string[] } {
  if (p.health === 'quiet') {
    return { summary: `${p.name} had a quiet night with no new activity.`, highlights: [] };
  }
  const parts: string[] = [];
  const agentPRs = p.mergedPRs.filter((pr) => pr.author.isBot).length;
  if (p.mergedPRs.length > 0) {
    const lead = p.mergedPRs[0] as PullRequestItem;
    parts.push(
      `${plural(p.mergedPRs.length, 'pull request')} merged${agentPRs > 0 ? `, ${agentPRs} by agents` : ''}, led by "${lead.title}".`,
    );
  } else if (p.commits.length > 0) {
    parts.push(`${plural(p.commits.length, 'commit')} landed directly on main.`);
  }
  const rel = p.releases[0];
  if (rel) parts.push(`Released ${rel.tag}.`);
  const prod = p.deployments.find((d) => d.target === 'production' && d.state === 'ERROR');
  const mainCi = p.ciFailures.find((c) => c.branch === 'main');
  if (prod) parts.push('The production deploy failed and needs a look.');
  else if (mainCi) parts.push(`CI is failing on main (${mainCi.workflow}).`);
  else if (p.ciFailures.length > 0) parts.push('A CI run failed on a feature branch.');
  if (p.openPRs.length > 0)
    parts.push(`${plural(p.openPRs.length, 'open pull request')} waiting on attention.`);
  if (parts.length === 0) parts.push('Minor activity overnight.');

  const highlights: string[] = [];
  for (const pr of p.mergedPRs.slice(0, 2)) highlights.push(`Merged #${pr.number}: ${pr.title}`);
  if (rel) highlights.push(`Release ${rel.tag}`);
  if (prod) highlights.push('Production deploy failed');
  if (mainCi) highlights.push(`CI failing on main: ${mainCi.workflow}`);
  for (const pr of p.openPRs.slice(0, 1))
    highlights.push(`Needs attention: #${pr.number} (${(pr.attention ?? []).join(', ')})`);
  if (p.commits.length > 0 && highlights.length < 5)
    highlights.push(`${plural(p.commits.length, 'commit')} on main`);
  return { summary: parts.join(' '), highlights: highlights.slice(0, 5) };
}

function headlineFor(totals: DigestTotals, projects: ProjectActivity[]): string {
  const red = projects.filter((p) => p.health === 'red');
  const yellow = projects.filter((p) => p.health === 'yellow');
  const first = `${plural(totals.mergedPRs, 'pull request')} merged and ${plural(totals.commits, 'commit')} pushed across ${plural(totals.projectsActive, 'project')}, with ${totals.agentContributions} contributions from agents.`;
  if (red.length > 0) {
    const tail =
      yellow.length > 0
        ? ` and ${yellow.length} more ${yellow.length === 1 ? 'is' : 'are'} worth a look`
        : '';
    return `${first} ${red.map((p) => p.name).join(' and ')} ${red.length === 1 ? 'needs' : 'need'} attention${tail}.`;
  }
  if (yellow.length > 0) {
    return `${first} ${plural(yellow.length, 'project')} ${yellow.length === 1 ? 'has' : 'have'} minor items to review.`;
  }
  return `${first} Everything looks healthy.`;
}

export function syntheticDigest(date: string, seed = 7): Digest {
  const untilMs = parseDate(date) + 6 * 3_600_000;
  const sinceMs = untilMs - DAY_MS;
  const dayIdx = Math.max(0, Math.round((parseDate(date) - EPOCH) / DAY_MS));
  const rng = new Rng((seed ^ hashString(date)) >>> 0);
  const redIdx = rng.chance(0.85) ? rng.int(0, REPOS.length - 1) : -1;
  const counters = { pr: 0 };
  const built = REPOS.map((spec, i) => buildProject(spec, i, dayIdx, sinceMs, i === redIdx, rng, counters));
  const projects = sortProjects(built);
  const totals = computeTotals(projects);
  const until = new Date(untilMs).toISOString();
  return {
    schema: DIGEST_SCHEMA,
    id: date,
    generatedAt: until,
    window: { since: new Date(sinceMs).toISOString(), until },
    owner: OWNER,
    headline: headlineFor(totals, projects),
    summarizer: { kind: 'llm', model: 'claude-sonnet-5-5' },
    totals,
    projects,
    warnings: [],
  };
}

/** Returns `days` digests ending at `endDate` (inclusive), oldest first. */
export function syntheticArchive(days: number, endDate: string): Digest[] {
  const end = parseDate(endDate);
  const out: Digest[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(syntheticDigest(new Date(end - i * DAY_MS).toISOString().slice(0, 10)));
  }
  return out;
}
