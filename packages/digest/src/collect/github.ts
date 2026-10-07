import type {
  Actor,
  CIFailureItem,
  CollectContext,
  CollectResult,
  CommitItem,
  IssueItem,
  OvernightConfig,
  PullRequestItem,
  RawProject,
  ReleaseItem,
  TrafficStats,
} from '../types.js';
import { matchRepo } from '../config.js';

const GRAPHQL_URL = 'https://api.github.com/graphql';
const REST_BASE = 'https://api.github.com';
const DETAIL_BATCH_SIZE = 10;
const MAX_LIST_PAGES = 10;
const NOTES_MAX = 2000;
const DAY_MS = 86_400_000;

/** Logins of well-known AI coding agents (compared case-insensitively, "[bot]" suffix stripped). */
const KNOWN_AGENT_LOGINS = [
  'copilot',
  'copilot-swe-agent',
  'github-copilot',
  'devin-ai-integration',
  'claude',
  'claude-code',
  'codex',
  'chatgpt-codex-connector',
  'openai-codex',
  'cursor',
  'cursoragent',
  'jules',
  'google-labs-jules',
  'openhands-agent',
  'sweep-ai',
  'sourcegraph-amp',
];

// ---------------------------------------------------------------------------
// GraphQL response shapes (only the fields we request)
// ---------------------------------------------------------------------------

interface GqlActor {
  login?: string | null;
  __typename?: string | null;
}

interface GqlLabels {
  nodes?: Array<{ name?: string | null } | null> | null;
}

interface GqlCommitNode {
  oid: string;
  messageHeadline: string;
  url: string;
  committedDate: string;
  author?: { name?: string | null; user?: { login?: string | null } | null } | null;
}

interface GqlRepoListNode {
  name: string;
  nameWithOwner: string;
  url: string;
  description?: string | null;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  forkCount: number;
  pushedAt?: string | null;
  issues?: { totalCount: number } | null;
  pullRequests?: { totalCount: number } | null;
  defaultBranchRef?: {
    name: string;
    target?: { history?: { nodes?: Array<GqlCommitNode | null> | null } | null } | null;
  } | null;
}

interface GqlListData {
  repositoryOwner?: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      nodes?: Array<GqlRepoListNode | null> | null;
    };
  } | null;
}

interface GqlPrNode {
  number: number;
  title: string;
  url: string;
  isDraft?: boolean | null;
  additions?: number | null;
  deletions?: number | null;
  author?: GqlActor | null;
  labels?: GqlLabels | null;
  mergedAt?: string | null;
  updatedAt?: string | null;
  mergeable?: string | null;
  reviewDecision?: string | null;
  reviewRequests?: { totalCount: number } | null;
  commits?: {
    nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string | null } | null } | null } | null> | null;
  } | null;
}

interface GqlReleaseNode {
  tagName: string;
  name?: string | null;
  url: string;
  createdAt: string;
  publishedAt?: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  description?: string | null;
}

interface GqlIssueNode {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  closedAt?: string | null;
  author?: GqlActor | null;
  labels?: GqlLabels | null;
}

interface GqlRepoDetail {
  merged?: { nodes?: Array<GqlPrNode | null> | null } | null;
  open?: { nodes?: Array<GqlPrNode | null> | null } | null;
  releases?: { nodes?: Array<GqlReleaseNode | null> | null } | null;
  issues?: { nodes?: Array<GqlIssueNode | null> | null } | null;
}

interface GqlError {
  message?: string;
  type?: string;
  path?: Array<string | number>;
}

interface GqlResponse<T> {
  data?: T | null;
  errors?: GqlError[];
}

interface RestRun {
  id: number;
  name?: string | null;
  html_url: string;
  head_branch?: string | null;
  conclusion?: string | null;
  created_at: string;
  head_commit?: { message?: string | null } | null;
}

/** Thrown internally when the GitHub budget is exhausted; collection stops and returns partial results. */
class RateLimitError extends Error {}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const LIST_QUERY = `query OvernightRepos($owner: String!, $since: GitTimestamp!, $until: GitTimestamp!, $after: String) {
  repositoryOwner(login: $owner) {
    repositories(first: 100, after: $after, ownerAffiliations: [OWNER], orderBy: {field: PUSHED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name nameWithOwner url description isFork isArchived stargazerCount forkCount pushedAt
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        defaultBranchRef {
          name
          target {
            ... on Commit {
              history(since: $since, until: $until, first: 50) {
                nodes { oid messageHeadline url committedDate author { name user { login } } }
              }
            }
          }
        }
      }
    }
  }
}`;

const PR_COMMON =
  'number title url isDraft additions deletions author { login __typename } labels(first: 10) { nodes { name } }';

/** Cheap per-repo fields fetched for every listed repo (activity that does not bump pushedAt). */
const REPO_LIGHT_FRAGMENT = `fragment OvernightRepoLight on Repository {
  releases(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) {
    nodes { tagName name url createdAt publishedAt isPrerelease isDraft description }
  }
  issues(first: 50, filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: DESC}) {
    nodes { number title url createdAt closedAt author { login __typename } labels(first: 10) { nodes { name } } }
  }
}`;

/** Full per-repo fields: light fields plus PR queries (only for repos with pushes or open PRs). */
const REPO_DETAIL_FRAGMENT = `fragment OvernightRepoDetail on Repository {
  ...OvernightRepoLight
  merged: pullRequests(states: MERGED, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
    nodes { ${PR_COMMON} mergedAt }
  }
  open: pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
    nodes {
      ${PR_COMMON} updatedAt mergeable reviewDecision
      reviewRequests(first: 1) { totalCount }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`;

/** `full[i]` selects the PR-inclusive fragment for alias r<i>; otherwise only releases + issues. */
function buildDetailQuery(full: boolean[]): string {
  const vars: string[] = ['$since: DateTime!'];
  const fields: string[] = [];
  full.forEach((isFull, i) => {
    vars.push(`$o${i}: String!`, `$n${i}: String!`);
    const frag = isFull ? 'OvernightRepoDetail' : 'OvernightRepoLight';
    fields.push(`  r${i}: repository(owner: $o${i}, name: $n${i}) { ...${frag} }`);
  });
  const fragments = full.some((f) => f)
    ? `${REPO_DETAIL_FRAGMENT}\n${REPO_LIGHT_FRAGMENT}`
    : REPO_LIGHT_FRAGMENT;
  return `query OvernightDetail(${vars.join(', ')}) {\n${fields.join('\n')}\n}\n${fragments}`;
}

/** Group repos into queries: a full repo costs 2, a light one 1; max cost 20 => ≤10 full repos per query. */
function batchByCost<T>(items: T[], isFull: (t: T) => boolean, maxCost = DETAIL_BATCH_SIZE * 2): T[][] {
  const batches: T[][] = [];
  let cur: T[] = [];
  let cost = 0;
  for (const item of items) {
    const c = isFull(item) ? 2 : 1;
    if (cur.length > 0 && cost + c > maxCost) {
      batches.push(cur);
      cur = [];
      cost = 0;
    }
    cur.push(item);
    cost += c;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActorFactory(
  config: OvernightConfig,
): (login: string | null | undefined, typename?: string | null) => Actor {
  const agents = new Set(
    [...KNOWN_AGENT_LOGINS, ...config.agents].map((a) => a.toLowerCase().replace(/\[bot\]$/, '')),
  );
  return (login, typename) => {
    const l = login && login.length > 0 ? login : 'ghost';
    const lower = l.toLowerCase();
    const isBot = typename === 'Bot' || lower.endsWith('[bot]') || agents.has(lower.replace(/\[bot\]$/, ''));
    return { login: l, isBot };
  };
}

function compact<T>(arr: Array<T | null | undefined> | null | undefined): T[] {
  return (arr ?? []).filter((x): x is T => x !== null && x !== undefined);
}

function labelNames(l: GqlLabels | null | undefined): string[] {
  return compact(l?.nodes)
    .map((n) => n.name)
    .filter((n): n is string => typeof n === 'string');
}

function inWindow(at: string | null | undefined, sinceMs: number, untilMs: number): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && t >= sinceMs && t <= untilMs;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export async function collectGitHub(ctx: CollectContext): Promise<CollectResult> {
  const token = ctx.secrets.githubToken;
  if (!token) throw new Error('GitHub token missing: set OVERNIGHT_GITHUB_TOKEN');

  const { config, window, state } = ctx;
  const warnings: string[] = [];
  const sinceMs = Date.parse(window.since);
  const untilMs = Date.parse(window.until);
  const actor = makeActorFactory(config);
  let budgetExhausted = false;

  /**
   * Halts collection only on confirmed rate limiting: 429, x-ratelimit-remaining=0 (on an error status),
   * or a 403 whose body mentions a (secondary) rate limit. Other 403s (permission denied) are returned
   * to the caller as ordinary errors. Returns the error body text (already consumed) for non-ok responses.
   */
  const checkRateLimit = async (res: Awaited<ReturnType<CollectContext['fetch']>>, what: string) => {
    const remaining = res.headers.get('x-ratelimit-remaining');
    let text = '';
    if (!res.ok) text = await res.text().catch((e: unknown) => `(body unreadable: ${errMsg(e)})`);
    const limited =
      res.status === 429 ||
      (!res.ok && remaining === '0') ||
      (res.status === 403 && (res.headers.get('retry-after') !== null || /rate limit/i.test(text)));
    if (limited) {
      budgetExhausted = true;
      throw new RateLimitError(
        `GitHub rate limit hit (HTTP ${res.status}) during ${what}; results are partial`,
      );
    }
    if (remaining === '0') {
      // The current response is still usable; stop issuing further requests afterwards.
      budgetExhausted = true;
      warnings.push(
        `GitHub rate limit exhausted after ${what}; remaining requests skipped, results are partial`,
      );
    }
    return text;
  };

  const gql = async <T>(
    query: string,
    variables: Record<string, unknown>,
    what: string,
  ): Promise<GqlResponse<T>> => {
    if (budgetExhausted) throw new RateLimitError(`GitHub rate limit reached; skipped ${what}`);
    const res = await ctx.fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'overnight-digest',
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await checkRateLimit(res, what);
    if (!res.ok) {
      throw new Error(`GitHub GraphQL ${what} failed: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
    }
    const body = (await res.json()) as GqlResponse<T>;
    if (body.errors?.some((e) => e.type === 'RATE_LIMITED')) {
      budgetExhausted = true;
      throw new RateLimitError(`GitHub GraphQL rate limit hit during ${what}; results are partial`);
    }
    return body;
  };

  const rest = async (path: string, what: string): Promise<unknown> => {
    if (budgetExhausted) throw new RateLimitError(`GitHub rate limit reached; skipped ${what}`);
    const res = await ctx.fetch(`${REST_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'overnight-digest',
      },
    });
    const text = await checkRateLimit(res, what);
    if (!res.ok) {
      const detail = /"message"\s*:\s*"([^"]{1,120})"/.exec(text)?.[1];
      throw new Error(`HTTP ${res.status}${res.status === 403 && detail ? `: ${detail}` : ''}`);
    }
    return res.json();
  };

  const finish = (projects: RawProject[], e?: unknown): CollectResult => {
    if (e !== undefined) {
      if (!(e instanceof RateLimitError)) throw e;
      warnings.push(e.message);
      ctx.log(`github: ${e.message}`);
    }
    return { projects, warnings };
  };

  // ---- Phase 1: list repos (1 call per 100 repos) -------------------------
  const listed: GqlRepoListNode[] = [];
  try {
    let after: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const body: GqlResponse<GqlListData> = await gql<GqlListData>(
        LIST_QUERY,
        { owner: config.owner, since: window.since, until: window.until, after },
        'repository listing',
      );
      const owner = body.data?.repositoryOwner;
      if (!owner) {
        const msg = body.errors?.map((e) => e.message).join('; ') || 'not found';
        if (listed.length === 0) {
          warnings.push(`GitHub owner "${config.owner}" could not be listed: ${msg}`);
          return { projects: [], warnings };
        }
        warnings.push(`GitHub repository listing incomplete: ${msg}`);
        break;
      }
      if (body.errors?.length) {
        for (const e of body.errors) warnings.push(`GitHub listing: ${e.message ?? 'unknown error'}`);
      }
      listed.push(...compact(owner.repositories.nodes));
      const { hasNextPage, endCursor } = owner.repositories.pageInfo;
      if (!hasNextPage || !endCursor) break;
      if (page === MAX_LIST_PAGES - 1) {
        warnings.push(`GitHub listing truncated at ${listed.length} repositories`);
        break;
      }
      after = endCursor;
      if (budgetExhausted) break;
    }
  } catch (e) {
    if (!(e instanceof RateLimitError)) throw e;
    if (listed.length === 0) return finish([], e);
    warnings.push(e.message);
  }

  const repos = listed.filter(
    (r) =>
      matchRepo(r.name, config) &&
      (config.includeForks || !r.isFork) &&
      (config.includeArchived || !r.isArchived),
  );

  const projects: RawProject[] = [];
  const byId = new Map<string, { project: RawProject; repo: GqlRepoListNode; active: boolean }>();

  for (const r of repos) {
    const id = r.nameWithOwner;
    const defaultBranch = r.defaultBranchRef?.name;
    const commits: CommitItem[] = compact(r.defaultBranchRef?.target?.history?.nodes)
      .filter((c) => !c.messageHeadline.startsWith('Merge pull request'))
      .filter((c) => inWindow(c.committedDate, sinceMs, untilMs))
      .map((c) => ({
        sha: c.oid,
        message: c.messageHeadline,
        url: c.url,
        author: actor(c.author?.user?.login ?? c.author?.name ?? null),
        at: c.committedDate,
        branch: defaultBranch ?? '',
      }));
    const prev = state.repoStats[id];
    const project: RawProject = {
      id,
      name: r.name,
      url: r.url,
      ...(r.description ? { description: r.description } : {}),
      ...(defaultBranch ? { defaultBranch } : {}),
      mergedPRs: [],
      openPRs: [],
      commits,
      releases: [],
      ciFailures: [],
      issues: [],
      deployments: [],
      stats: {
        stars: r.stargazerCount,
        forks: r.forkCount,
        starsDelta: prev ? r.stargazerCount - prev.stars : 0,
        forksDelta: prev ? r.forkCount - prev.forks : 0,
        openIssues: r.issues?.totalCount ?? 0,
      },
    };
    const pushedRecently = r.pushedAt ? Date.parse(r.pushedAt) >= sinceMs : false;
    const active = pushedRecently || commits.length > 0;
    projects.push(project);
    byId.set(id, { project, repo: r, active });
  }

  if (budgetExhausted) return finish(projects);

  // ---- Phase 2: batched per-repo detail ---------------------------------------
  // Every repo gets releases + issues (these don't bump pushedAt). PR queries are only added for
  // repos with a push in the window or open PRs (which may need attention).
  const needsPRs = (e: { active: boolean; repo: GqlRepoListNode }) =>
    e.active || (e.repo.pullRequests?.totalCount ?? 0) > 0;
  const batches = batchByCost([...byId.values()], needsPRs);
  const staleCutoff = untilMs - config.staleDays * DAY_MS;

  try {
    for (const [bi, batch] of batches.entries()) {
      const variables: Record<string, unknown> = { since: window.since };
      batch.forEach((e, j) => {
        const [o, n] = e.project.id.split('/');
        variables[`o${j}`] = o;
        variables[`n${j}`] = n;
      });
      let body: GqlResponse<Record<string, GqlRepoDetail | null>>;
      try {
        body = await gql<Record<string, GqlRepoDetail | null>>(
          buildDetailQuery(batch.map(needsPRs)),
          variables,
          `detail batch ${bi + 1}`,
        );
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        for (const entry of batch) warnings.push(`${entry.project.id}: details unavailable (${errMsg(e)})`);
        continue;
      }
      const errorsByAlias = new Map<string, string[]>();
      for (const err of body.errors ?? []) {
        const alias = typeof err.path?.[0] === 'string' ? err.path[0] : undefined;
        if (alias === undefined) {
          warnings.push(`GitHub detail query: ${err.message ?? 'unknown error'}`);
          continue;
        }
        const list = errorsByAlias.get(alias) ?? [];
        list.push(err.message ?? 'unknown error');
        errorsByAlias.set(alias, list);
      }
      batch.forEach((entry, j) => {
        const alias = `r${j}`;
        const errs = errorsByAlias.get(alias);
        if (errs) warnings.push(`${entry.project.id}: ${errs.join('; ')}`);
        const detail = body.data?.[alias];
        if (!detail) {
          if (!errs) warnings.push(`${entry.project.id}: no detail data returned`);
          return;
        }
        applyDetail(entry.project, detail);
      });
      if (budgetExhausted) break;
    }
  } catch (e) {
    return finish(projects, e);
  }

  function applyDetail(p: RawProject, d: GqlRepoDetail): void {
    p.mergedPRs = compact(d.merged?.nodes)
      .filter((pr) => inWindow(pr.mergedAt, sinceMs, untilMs))
      .map((pr) => ({
        ...basePr(pr),
        at: pr.mergedAt as string,
      }));

    const open: PullRequestItem[] = [];
    for (const pr of compact(d.open?.nodes)) {
      const attention: NonNullable<PullRequestItem['attention']> = [];
      if ((pr.reviewRequests?.totalCount ?? 0) > 0) attention.push('review_requested');
      const rollup = compact(pr.commits?.nodes)[0]?.commit?.statusCheckRollup?.state;
      if (rollup === 'FAILURE' || rollup === 'ERROR') attention.push('ci_failing');
      const updated = pr.updatedAt ? Date.parse(pr.updatedAt) : NaN;
      if (Number.isFinite(updated) && updated < staleCutoff) attention.push('stale');
      if (pr.mergeable === 'CONFLICTING') attention.push('conflicts');
      if (pr.reviewDecision === 'APPROVED') attention.push('approved_unmerged');
      if (attention.length === 0) continue;
      open.push({ ...basePr(pr), at: pr.updatedAt ?? window.until, attention });
    }
    p.openPRs = open;

    p.releases = compact(d.releases?.nodes)
      .filter((r) => !r.isDraft && inWindow(r.publishedAt ?? r.createdAt, sinceMs, untilMs))
      .map((r): ReleaseItem => {
        const notes = r.description?.trim();
        return {
          tag: r.tagName,
          name: r.name && r.name.length > 0 ? r.name : r.tagName,
          url: r.url,
          at: r.publishedAt ?? r.createdAt,
          prerelease: r.isPrerelease,
          ...(notes ? { notes: notes.slice(0, NOTES_MAX) } : {}),
        };
      });

    const issues: IssueItem[] = [];
    for (const is of compact(d.issues?.nodes)) {
      const base = {
        number: is.number,
        title: is.title,
        url: is.url,
        author: actor(is.author?.login, is.author?.__typename),
        labels: labelNames(is.labels),
      };
      if (inWindow(is.createdAt, sinceMs, untilMs))
        issues.push({ ...base, at: is.createdAt, state: 'opened' });
      if (is.closedAt && inWindow(is.closedAt, sinceMs, untilMs))
        issues.push({ ...base, at: is.closedAt, state: 'closed' });
    }
    p.issues = issues;
  }

  function basePr(pr: GqlPrNode): Omit<PullRequestItem, 'at'> {
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: actor(pr.author?.login, pr.author?.__typename),
      ...(typeof pr.additions === 'number' ? { additions: pr.additions } : {}),
      ...(typeof pr.deletions === 'number' ? { deletions: pr.deletions } : {}),
      labels: labelNames(pr.labels),
      ...(pr.isDraft ? { draft: true } : {}),
    };
  }

  if (budgetExhausted) return finish(projects);

  // ---- Phase 3: REST workflow runs, only for repos active in the window ----
  const activeEntries = [...byId.values()].filter(
    (e) => e.active || e.project.mergedPRs.length > 0 || e.project.releases.length > 0,
  );
  try {
    for (const entry of activeEntries) {
      const p = entry.project;
      const created = encodeURIComponent(`${window.since}..${window.until}`);
      let data: unknown;
      try {
        data = await rest(
          `/repos/${p.id}/actions/runs?created=${created}&per_page=50`,
          `${p.id} workflow runs`,
        );
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        warnings.push(`${p.id}: workflow runs unavailable (${errMsg(e)})`);
        continue;
      }
      const runs = compact((data as { workflow_runs?: Array<RestRun | null> } | null)?.workflow_runs);
      p.ciFailures = runs.flatMap((run): CIFailureItem[] => {
        const c = run.conclusion;
        const keep =
          c === 'failure' ||
          c === 'timed_out' ||
          c === 'startup_failure' ||
          (c === 'cancelled' && !!p.defaultBranch && run.head_branch === p.defaultBranch);
        if (!keep || !inWindow(run.created_at, sinceMs, untilMs)) return [];
        const commitMessage = run.head_commit?.message?.split('\n')[0];
        return [
          {
            workflow: run.name ?? 'workflow',
            runId: run.id,
            url: run.html_url,
            branch: run.head_branch ?? '',
            at: run.created_at,
            conclusion: c,
            ...(commitMessage ? { commitMessage } : {}),
          },
        ];
      });
      if (budgetExhausted) break;
    }

    // ---- Phase 4 (opt-in): traffic, gated by OVERNIGHT_TRAFFIC=1 to save budget ----
    if (!budgetExhausted && process.env.OVERNIGHT_TRAFFIC === '1') {
      const sinceDay = Math.floor(sinceMs / DAY_MS) * DAY_MS;
      for (const entry of activeEntries) {
        const p = entry.project;
        let data: unknown;
        try {
          data = await rest(`/repos/${p.id}/traffic/views`, `${p.id} traffic`);
        } catch (e) {
          if (e instanceof RateLimitError) throw e;
          warnings.push(`${p.id}: traffic unavailable (${errMsg(e)})`);
          continue;
        }
        const buckets = compact(
          (data as { views?: Array<{ timestamp: string; count: number } | null> } | null)?.views,
        ).filter((b) => {
          const t = Date.parse(b.timestamp);
          return Number.isFinite(t) && t >= sinceDay && t <= untilMs;
        });
        const traffic: TrafficStats = {
          source: 'github',
          views: buckets.reduce((s, b) => s + b.count, 0),
        };
        p.traffic = traffic;
        if (budgetExhausted) break;
      }
    }
  } catch (e) {
    return finish(projects, e);
  }

  return finish(projects);
}
