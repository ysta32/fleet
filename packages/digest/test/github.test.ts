import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectGitHub, detectAgent } from '../src/collect/github.js';
import type { CollectContext, FetchLike, OvernightConfig } from '../src/types.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const DETAIL = fixture('github-detail.json');
const RUNS = fixture('github-runs.json');
const WINDOW = { since: '2026-10-06T06:00:00.000Z', until: '2026-10-07T06:00:00.000Z' };
const RECENT = '2026-10-07T02:00:00Z';
const OLD = '2026-09-01T00:00:00Z';

function config(over: Partial<OvernightConfig> = {}): OvernightConfig {
  return {
    owner: 'acme',
    include: [],
    exclude: [],
    includeForks: false,
    includeArchived: false,
    agents: ['my-agent'],
    timezone: 'UTC',
    defaultSince: '24h',
    staleDays: 14,
    vercelProjects: {},
    llm: { enabled: false, model: 'x', maxProjects: 10 },
    outDir: 'out',
    stateDir: 'state',
    siteTitle: 'Overnight',
    deliver: {
      notion: { enabled: false },
      email: { enabled: false },
      ntfy: { enabled: false, server: 'https://ntfy.sh' },
    },
    ...over,
  };
}

interface RepoSpec {
  name: string;
  pushedAt?: string;
  openPRs?: number;
  isFork?: boolean;
  isArchived?: boolean;
  commits?: Array<{
    oid: string;
    messageHeadline: string;
    messageBody?: string;
    committedDate: string;
    login?: string;
  }>;
  stars?: number;
}

function listNode(r: RepoSpec) {
  return {
    name: r.name,
    nameWithOwner: `acme/${r.name}`,
    url: `https://github.com/acme/${r.name}`,
    description: `${r.name} repo`,
    isFork: r.isFork ?? false,
    isArchived: r.isArchived ?? false,
    stargazerCount: r.stars ?? 10,
    forkCount: 2,
    pushedAt: r.pushedAt ?? OLD,
    issues: { totalCount: 3 },
    pullRequests: { totalCount: r.openPRs ?? 0 },
    defaultBranchRef: {
      name: 'main',
      target: {
        history: {
          nodes: (r.commits ?? []).map((c) => ({
            oid: c.oid,
            messageHeadline: c.messageHeadline,
            messageBody: c.messageBody,
            url: `https://github.com/acme/${r.name}/commit/${c.oid}`,
            committedDate: c.committedDate,
            author: { name: 'Someone', user: c.login ? { login: c.login } : null },
          })),
        },
      },
    },
  };
}

type Resp = Awaited<ReturnType<FetchLike>>;
function resp(body: unknown, status = 200, headers: Record<string, string> = {}): Resp {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

interface FakeOpts {
  repos: RepoSpec[];
  listHeaders?: Record<string, string>;
  detailStatus?: number;
  detailBody?: unknown;
  repoDetail?: Record<string, unknown>;
  detailErrorFor?: string;
  runsStatus?: (repo: string) => number;
  runsBody?: unknown;
}

function fakeGitHub(opts: FakeOpts) {
  const calls = {
    graphql: 0,
    list: 0,
    detail: 0,
    light: [] as string[],
    runs: [] as string[],
    other: [] as string[],
  };
  const authHeaders: string[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    authHeaders.push(init?.headers?.Authorization ?? '');
    if (url === 'https://api.github.com/graphql') {
      calls.graphql++;
      const { query, variables } = JSON.parse(init?.body ?? '{}') as {
        query: string;
        variables: Record<string, string>;
      };
      if (query.includes('OvernightRepos')) {
        calls.list++;
        return resp(
          {
            data: {
              repositoryOwner: {
                repositories: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: opts.repos.map(listNode),
                },
              },
            },
          },
          200,
          opts.listHeaders,
        );
      }
      if (query.includes('OvernightDetail')) {
        calls.detail++;
        if (opts.detailStatus) return resp(opts.detailBody ?? { message: 'nope' }, opts.detailStatus);
        const data: Record<string, unknown> = {};
        const errors: unknown[] = [];
        for (let i = 0; variables[`n${i}`] !== undefined; i++) {
          const name = variables[`n${i}`];
          if (name === opts.detailErrorFor) {
            data[`r${i}`] = null;
            errors.push({ message: 'Resource not accessible', path: [`r${i}`] });
            continue;
          }
          const full =
            name === 'alpha'
              ? (opts.repoDetail ?? (DETAIL as Record<string, unknown>))
              : { merged: { nodes: [] }, open: { nodes: [] } };
          if (query.includes(`r${i}: repository(owner: $o${i}, name: $n${i}) { ...OvernightRepoLight }`)) {
            calls.light.push(name ?? '');
            data[`r${i}`] = { releases: full.releases, issues: full.issues };
          } else {
            expect(query).toContain(
              `r${i}: repository(owner: $o${i}, name: $n${i}) { ...OvernightRepoDetail }`,
            );
            data[`r${i}`] = full;
          }
        }
        return resp(errors.length ? { data, errors } : { data });
      }
      throw new Error(`unexpected graphql query`);
    }
    const m = /^https:\/\/api\.github\.com\/repos\/acme\/([^/]+)\/actions\/runs\?(.*)$/.exec(url);
    if (m) {
      const repo = m[1] ?? '';
      calls.runs.push(repo);
      expect(decodeURIComponent(m[2] ?? '')).toContain(`created=${WINDOW.since}..${WINDOW.until}`);
      const status = opts.runsStatus?.(repo) ?? 200;
      if (status !== 200) return resp(opts.runsBody ?? { message: 'err' }, status);
      return resp(repo === 'alpha' ? RUNS : { total_count: 0, workflow_runs: [] });
    }
    calls.other.push(url);
    return resp({}, 404);
  });
  return { fetch, calls, authHeaders };
}

function ctx(fetch: FetchLike, over: Partial<CollectContext> = {}): CollectContext {
  return {
    config: config(),
    secrets: { githubToken: 'test-token' },
    window: WINDOW,
    state: { repoStats: { 'acme/alpha': { stars: 7, forks: 2 } } },
    fetch,
    log: () => {},
    ...over,
  };
}

describe('detectAgent', () => {
  it.each([
    ['Co-Authored-By: Claude <noreply@anthropic.com>', 'claude'],
    ['Fix bug\n\ncO-aUtHoReD-bY:\tCLAUDE Code <noreply@anthropic.com>\r\n', 'claude'],
    ['Summary\n\n🤖 Generated with [Claude Code](https://example.com)', 'claude'],
    ['Summary\nhttps://CLAUDE.COM/claude-code', 'claude'],
    ['Co-authored-by: OpenAI Codex <agent@example.com>', 'codex'],
    ['Co-authored-by: Agent <CODEX@example.com>', 'codex'],
    ['Summary\nGenerated by OPENAI CODEX', 'codex'],
    ['Co-authored-by: Copilot <agent@example.com>', 'copilot'],
    ['Co-authored-by: GitHub <COPILOT@GITHUB.COM>', 'copilot'],
    ['Generated by DEVIN-AI-INTEGRATION', 'devin'],
    ['Generated by CursorAgent', 'cursor'],
    ['Generated by CURSOR AGENT', 'cursor'],
  ])('detects %j as %s', (text, agent) => {
    expect(detectAgent(text)).toBe(agent);
  });

  it.each([
    '',
    'Ask Claude about it',
    'Fix claude integration',
    'Discuss codex and copilot',
    'Example Co-Authored-By: Claude <agent@example.com>',
    ' Co-Authored-By: Claude <agent@example.com>',
    '> Co-authored-by: Codex <agent@example.com>',
    'Example Co-authored-by: Copilot <copilot@github.com>',
    'Co-authored-by: Alice\nAsk codex about it',
    'Co-authored-by:\nClaude',
    'Co-authored-by: Claudette <human@example.com>',
  ])('does not classify ordinary prose or misplaced trailers: %j', (text) => {
    expect(detectAgent(text)).toBeUndefined();
  });
});

describe('collectGitHub', () => {
  it('detects human-login agent contributions using existing queries and preserves output fields', async () => {
    const pr = (number: number, body: string, login = 'alice', labels = ['feature']) => ({
      number,
      title: 'Change',
      body,
      url: `https://github.com/acme/alpha/pull/${number}`,
      author: { login },
      labels: { nodes: labels.map((name) => ({ name })) },
      mergedAt: RECENT,
      updatedAt: RECENT,
      reviewRequests: { totalCount: 1 },
    });
    const { fetch, calls } = fakeGitHub({
      repos: [
        {
          name: 'alpha',
          pushedAt: RECENT,
          openPRs: 1,
          commits: [
            {
              oid: 'agent',
              messageHeadline: 'Fix bug',
              messageBody: 'Co-Authored-By: Claude <agent@example.com>',
              committedDate: RECENT,
              login: 'alice',
            },
            {
              oid: 'human',
              messageHeadline: 'Ask Claude about it',
              messageBody: 'Ask Claude about it',
              committedDate: RECENT,
              login: 'alice',
            },
            {
              oid: 'bot',
              messageHeadline: 'Update',
              messageBody: '',
              committedDate: RECENT,
              login: 'renovate[bot]',
            },
            { oid: 'configured', messageHeadline: 'Update', committedDate: RECENT, login: 'my-agent' },
          ],
        },
      ],
      repoDetail: {
        merged: {
          nodes: [
            pr(1, 'Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)'),
            pr(2, 'Ask Claude about it'),
            pr(3, `${'x'.repeat(4000)}\nOpenAI Codex`),
            pr(4, 'Ask Claude about it', 'renovate[bot]'),
            pr(5, 'OpenAI Codex', 'alice', ['agent:codex']),
            pr(6, `${'x'.repeat(3987)}\nOpenAI Codex`),
          ],
        },
        open: { nodes: [pr(7, 'Co-authored-by: Copilot <copilot@github.com>')] },
      },
    });
    const result = await collectGitHub(ctx(fetch));
    expect(result.warnings).toEqual([]);
    const project = result.projects[0];
    expect(project?.commits.map((c) => c.author.isBot)).toEqual([true, false, true, true]);
    expect(project?.commits[0]).toEqual({
      sha: 'agent',
      message: 'Fix bug',
      url: 'https://github.com/acme/alpha/commit/agent',
      author: { login: 'alice', isBot: true },
      at: RECENT,
      branch: 'main',
    });
    expect(project?.mergedPRs.map((p) => p.author.isBot)).toEqual([true, false, false, true, true, true]);
    expect(project?.mergedPRs.map((p) => p.labels)).toEqual([
      ['feature', 'agent:claude'],
      ['feature'],
      ['feature'],
      ['feature'],
      ['agent:codex'],
      ['feature', 'agent:codex'],
    ]);
    expect(project?.openPRs[0]).toMatchObject({
      author: { login: 'alice', isBot: true },
      labels: ['feature', 'agent:copilot'],
    });
    expect(project?.mergedPRs.every((p) => !('body' in p))).toBe(true);
    expect(calls).toEqual({ graphql: 2, list: 1, detail: 1, light: [], runs: ['alpha'], other: [] });
    expect(fetch).toHaveBeenCalledTimes(3);
    const queries = fetch.mock.calls
      .filter(([url]) => url.endsWith('/graphql'))
      .map(([, init]) => (JSON.parse(init?.body ?? '{}') as { query: string }).query);
    expect(queries[0]).toMatch(/\bmessageHeadline messageBody\b/);
    expect(queries[1]?.match(/number title body url/g)).toHaveLength(2);
  });

  it('throws when the token is missing', async () => {
    const { fetch } = fakeGitHub({ repos: [] });
    await expect(collectGitHub(ctx(fetch, { secrets: {} }))).rejects.toThrow(
      'GitHub token missing: set OVERNIGHT_GITHUB_TOKEN',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps PRs, commits, releases, issues, CI failures and stats for a repo', async () => {
    const { fetch, authHeaders } = fakeGitHub({
      repos: [
        {
          name: 'alpha',
          pushedAt: RECENT,
          openPRs: 3,
          stars: 12,
          commits: [
            { oid: 'a1', messageHeadline: 'Fix bug', committedDate: '2026-10-07T01:00:00Z', login: 'alice' },
            {
              oid: 'a2',
              messageHeadline: 'Merge pull request #41 from acme/x',
              committedDate: '2026-10-07T02:00:00Z',
              login: 'alice',
            },
            {
              oid: 'a3',
              messageHeadline: 'Agent change',
              committedDate: '2026-10-07T03:00:00Z',
              login: 'my-agent',
            },
            {
              oid: 'a4',
              messageHeadline: 'Bot change',
              committedDate: '2026-10-07T03:30:00Z',
              login: 'renovate[bot]',
            },
          ],
        },
      ],
    });
    const res = await collectGitHub(ctx(fetch));
    expect(res.warnings).toEqual([]);
    expect(authHeaders.every((h) => /^bearer test-token$/i.test(h))).toBe(true);
    const p = res.projects[0];
    expect(res.projects).toHaveLength(1);
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.id).toBe('acme/alpha');
    expect(p.defaultBranch).toBe('main');
    expect(p.deployments).toEqual([]);
    expect(p.stats).toEqual({ stars: 12, forks: 2, starsDelta: 5, forksDelta: 0, openIssues: 3 });

    expect(p.commits.map((c) => c.sha)).toEqual(['a1', 'a3', 'a4']);
    expect(p.commits.map((c) => c.author.isBot)).toEqual([false, true, true]);
    expect(p.commits[0]?.branch).toBe('main');

    expect(p.mergedPRs).toHaveLength(1);
    expect(p.mergedPRs[0]).toMatchObject({
      number: 41,
      at: '2026-10-07T02:00:00Z',
      author: { login: 'devin-ai-integration', isBot: true },
      labels: ['feature'],
      additions: 120,
    });

    expect(p.openPRs.map((x) => x.number)).toEqual([50, 30]);
    expect(p.openPRs[0]?.attention).toEqual([
      'review_requested',
      'ci_failing',
      'conflicts',
      'approved_unmerged',
    ]);
    expect(p.openPRs[1]).toMatchObject({ attention: ['stale'], draft: true, author: { isBot: true } });

    expect(p.releases).toEqual([
      {
        tag: 'v1.2.0',
        name: 'v1.2.0',
        url: 'https://github.com/acme/alpha/releases/tag/v1.2.0',
        at: '2026-10-07T03:05:00Z',
        prerelease: false,
        notes: 'Login flow and fixes',
      },
    ]);

    expect(p.issues.map((i) => [i.number, i.state])).toEqual([
      [7, 'opened'],
      [7, 'closed'],
      [3, 'closed'],
    ]);

    expect(p.ciFailures.map((c) => [c.runId, c.conclusion])).toEqual([
      [9001, 'failure'],
      [9004, 'cancelled'],
      [9005, 'timed_out'],
    ]);
    // timestamp is created_at (the field the window filter uses), never a later updated_at
    expect(p.ciFailures.find((c) => c.runId === 9005)?.at).toBe('2026-10-07T05:50:00Z');
    expect(p.ciFailures.every((c) => c.at >= WINDOW.since && c.at <= WINDOW.until)).toBe(true);
    expect(p.ciFailures[0]?.commitMessage).toBe('Add login flow');
  });

  it('keeps call count small: 12 repos -> 1 list + batched detail + REST only for active repos', async () => {
    const repos: RepoSpec[] = [];
    for (let i = 0; i < 12; i++) {
      // 0-5 active, 6-7 quiet but with open PRs, 8-11 quiet
      repos.push({ name: `r${i}`, pushedAt: i < 6 ? RECENT : OLD, openPRs: i === 6 || i === 7 ? 1 : 0 });
    }
    const { fetch, calls } = fakeGitHub({ repos });
    const res = await collectGitHub(ctx(fetch));
    expect(res.projects).toHaveLength(12);
    expect(calls.list).toBe(1);
    // 8 full (PR) repos + 4 light (releases/issues only) repos fit one detail query
    expect(calls.detail).toBe(1);
    expect(calls.light.sort()).toEqual(['r10', 'r11', 'r8', 'r9']);
    expect(calls.graphql).toBeLessThanOrEqual(4);
    expect(calls.runs.sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    expect(calls.other).toEqual([]);
    // quiet repos still carry stats
    expect(res.projects.find((p) => p.id === 'acme/r11')?.stats?.stars).toBe(10);
  });

  it('splits detail queries into batches of at most 10 repos', async () => {
    const repos: RepoSpec[] = Array.from({ length: 12 }, (_, i) => ({ name: `r${i}`, pushedAt: RECENT }));
    const { fetch, calls } = fakeGitHub({ repos });
    await collectGitHub(ctx(fetch));
    expect(calls.detail).toBe(2);
    expect(calls.graphql).toBe(3);
    expect(calls.runs).toHaveLength(12);
  });

  it('applies include/exclude, fork and archive filters', async () => {
    const { fetch } = fakeGitHub({
      repos: [
        { name: 'web-app' },
        { name: 'web-legacy' },
        { name: 'api' },
        { name: 'web-fork', isFork: true },
        { name: 'web-old', isArchived: true },
      ],
    });
    const res = await collectGitHub(
      ctx(fetch, { config: config({ include: ['web-*'], exclude: ['*legacy'] }) }),
    );
    expect(res.projects.map((p) => p.name)).toEqual(['web-app']);

    const { fetch: f2 } = fakeGitHub({
      repos: [
        { name: 'web-fork', isFork: true },
        { name: 'web-old', isArchived: true },
      ],
    });
    const res2 = await collectGitHub(
      ctx(f2, { config: config({ includeForks: true, includeArchived: true }) }),
    );
    expect(res2.projects.map((p) => p.name)).toEqual(['web-fork', 'web-old']);
  });

  it('stops after a response with x-ratelimit-remaining=0 and returns partial results', async () => {
    const { fetch, calls } = fakeGitHub({
      repos: [{ name: 'alpha', pushedAt: RECENT }],
      listHeaders: { 'x-ratelimit-remaining': '0' },
    });
    const res = await collectGitHub(ctx(fetch));
    expect(calls.graphql).toBe(1);
    expect(calls.runs).toEqual([]);
    expect(res.projects).toHaveLength(1);
    expect(res.warnings.some((w) => /rate limit/i.test(w))).toBe(true);
  });

  it('stops on a secondary-rate-limit 403 from the detail query without making REST calls', async () => {
    const { fetch, calls } = fakeGitHub({
      repos: [{ name: 'alpha', pushedAt: RECENT }],
      detailStatus: 403,
      detailBody: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' },
    });
    const res = await collectGitHub(ctx(fetch));
    expect(calls.detail).toBe(1);
    expect(calls.runs).toEqual([]);
    expect(res.projects).toHaveLength(1);
    expect(res.warnings.some((w) => /rate limit hit \(HTTP 403\)/.test(w))).toBe(true);
  });

  it('continues past a permission-denied 403 on the detail query (per-repo warnings)', async () => {
    const { fetch, calls } = fakeGitHub({
      repos: [
        { name: 'a', pushedAt: RECENT },
        { name: 'b', pushedAt: RECENT },
      ],
      detailStatus: 403,
      detailBody: { message: 'Resource not accessible by integration' },
    });
    const res = await collectGitHub(ctx(fetch));
    expect(calls.runs.sort()).toEqual(['a', 'b']);
    expect(res.projects).toHaveLength(2);
    expect(res.warnings.filter((w) => w.includes('details unavailable')).length).toBe(2);
    expect(res.warnings.some((w) => /rate limit/i.test(w))).toBe(false);
  });

  it('continues past a permission-denied 403 on REST runs', async () => {
    const { fetch, calls } = fakeGitHub({
      repos: [
        { name: 'a', pushedAt: RECENT },
        { name: 'b', pushedAt: RECENT },
      ],
      runsStatus: (r) => (r === 'a' ? 403 : 200),
      runsBody: { message: 'Resource not accessible by personal access token' },
    });
    const res = await collectGitHub(ctx(fetch));
    expect(calls.runs).toEqual(['a', 'b']);
    expect(res.warnings).toEqual([
      'acme/a: workflow runs unavailable (HTTP 403: Resource not accessible by personal access token)',
    ]);
  });

  it('stops on a 403 with x-ratelimit-remaining=0 (primary rate limit)', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      resp({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }),
    );
    const res = await collectGitHub(ctx(fetch));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.projects).toEqual([]);
    expect(res.warnings.some((w) => /rate limit hit/.test(w))).toBe(true);
  });

  it('collects issues and releases for quiet repos without PR queries', async () => {
    const { fetch, calls } = fakeGitHub({ repos: [{ name: 'alpha', pushedAt: OLD, openPRs: 0 }] });
    const res = await collectGitHub(ctx(fetch));
    const p = res.projects[0];
    expect(calls.light).toEqual(['alpha']);
    expect(p?.mergedPRs).toEqual([]);
    expect(p?.openPRs).toEqual([]);
    expect(p?.releases.map((r) => r.tag)).toEqual(['v1.2.0']);
    expect(p?.issues.map((i) => [i.number, i.state])).toEqual([
      [7, 'opened'],
      [7, 'closed'],
      [3, 'closed'],
    ]);
    // a release in the window counts as activity, so CI runs are checked too
    expect(calls.runs).toEqual(['alpha']);
  });

  it('stops on 429 from REST runs', async () => {
    const { fetch, calls } = fakeGitHub({
      repos: [
        { name: 'a', pushedAt: RECENT },
        { name: 'b', pushedAt: RECENT },
      ],
      runsStatus: () => 429,
    });
    const res = await collectGitHub(ctx(fetch));
    expect(calls.runs).toHaveLength(1);
    expect(res.projects).toHaveLength(2);
    expect(res.warnings.some((w) => w.includes('429'))).toBe(true);
  });

  it('turns per-repo GraphQL and REST errors into warnings', async () => {
    const { fetch } = fakeGitHub({
      repos: [
        { name: 'alpha', pushedAt: RECENT, openPRs: 3 },
        { name: 'secret', pushedAt: RECENT },
      ],
      detailErrorFor: 'secret',
      runsStatus: (r) => (r === 'secret' ? 404 : 200),
    });
    const res = await collectGitHub(ctx(fetch));
    expect(res.projects).toHaveLength(2);
    expect(res.projects[0]?.mergedPRs).toHaveLength(1);
    expect(res.warnings).toEqual([
      'acme/secret: Resource not accessible',
      'acme/secret: workflow runs unavailable (HTTP 404)',
    ]);
  });

  it('returns a warning when the owner cannot be listed', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      resp({
        data: { repositoryOwner: null },
        errors: [{ message: 'Could not resolve to a RepositoryOwner' }],
      }),
    );
    const res = await collectGitHub(ctx(fetch));
    expect(res.projects).toEqual([]);
    expect(res.warnings[0]).toContain('Could not resolve');
  });

  it('only fetches traffic when OVERNIGHT_TRAFFIC=1', async () => {
    const prev = process.env.OVERNIGHT_TRAFFIC;
    try {
      delete process.env.OVERNIGHT_TRAFFIC;
      const a = fakeGitHub({ repos: [{ name: 'beta', pushedAt: RECENT }] });
      await collectGitHub(ctx(a.fetch));
      expect(a.calls.other).toEqual([]);

      process.env.OVERNIGHT_TRAFFIC = '1';
      const b = fakeGitHub({ repos: [{ name: 'beta', pushedAt: RECENT }] });
      const res = await collectGitHub(ctx(b.fetch));
      expect(b.calls.other).toEqual(['https://api.github.com/repos/acme/beta/traffic/views']);
      expect(res.warnings).toEqual(['acme/beta: traffic unavailable (HTTP 404)']);
    } finally {
      if (prev === undefined) delete process.env.OVERNIGHT_TRAFFIC;
      else process.env.OVERNIGHT_TRAFFIC = prev;
    }
  });
});
