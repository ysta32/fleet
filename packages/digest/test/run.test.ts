import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDigest } from '../src/run.js';
import type { FetchLike, StateSnapshot } from '../src/types.js';
import detailFixture from './fixtures/github-detail.json' with { type: 'json' };
import runsFixture from './fixtures/github-runs.json' with { type: 'json' };

const FAKE_ENV = {
  OVERNIGHT_GITHUB_TOKEN: 'fake-gh-token-123',
  VERCEL_TOKEN: 'fake-vercel-token-456',
  NTFY_TOKEN: 'fake-ntfy-token-789',
};

const listResponse = {
  data: {
    repositoryOwner: {
      repositories: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            name: 'alpha',
            nameWithOwner: 'acme/alpha',
            url: 'https://github.com/acme/alpha',
            description: 'Alpha app',
            isFork: false,
            isArchived: false,
            stargazerCount: 12,
            forkCount: 3,
            pushedAt: '2026-10-07T02:00:00Z',
            issues: { totalCount: 4 },
            pullRequests: { totalCount: 3 },
            defaultBranchRef: {
              name: 'main',
              target: {
                history: {
                  nodes: [
                    {
                      oid: 'a'.repeat(40),
                      messageHeadline: 'Fix login redirect',
                      url: 'https://github.com/acme/alpha/commit/aaa',
                      committedDate: '2026-10-07T01:00:00Z',
                      author: { name: 'Alice', user: { login: 'alice' } },
                    },
                    {
                      oid: 'b'.repeat(40),
                      messageHeadline: 'Bump deps',
                      url: 'https://github.com/acme/alpha/commit/bbb',
                      committedDate: '2026-10-07T03:00:00Z',
                      author: { name: 'bot', user: { login: 'renovate[bot]' } },
                    },
                  ],
                },
              },
            },
          },
          {
            name: 'beta',
            nameWithOwner: 'acme/beta',
            url: 'https://github.com/acme/beta',
            description: null,
            isFork: false,
            isArchived: false,
            stargazerCount: 5,
            forkCount: 0,
            pushedAt: '2026-01-01T00:00:00Z',
            issues: { totalCount: 0 },
            pullRequests: { totalCount: 0 },
            defaultBranchRef: { name: 'main', target: { history: { nodes: [] } } },
          },
        ],
      },
    },
  },
};

const EMPTY_DETAIL = { releases: { nodes: [] }, issues: { nodes: [] } };

const vercelProjects = {
  projects: [
    {
      id: 'prj_alpha',
      name: 'alpha-web',
      link: { type: 'github', repo: 'alpha', org: 'acme' },
      targets: { production: { alias: ['alpha.example.com'] } },
    },
  ],
};

const vercelDeployments = {
  deployments: [
    {
      uid: 'dpl_1',
      name: 'alpha-web',
      projectId: 'prj_alpha',
      url: 'alpha-1.vercel.app',
      state: 'READY',
      target: 'production',
      created: Date.parse('2026-10-07T03:30:00Z'),
      meta: { githubCommitMessage: 'Fix login redirect', githubCommitRef: 'main' },
    },
    {
      uid: 'dpl_2',
      name: 'alpha-web',
      projectId: 'prj_alpha',
      url: 'alpha-2.vercel.app',
      state: 'ERROR',
      target: null,
      created: Date.parse('2026-10-07T04:30:00Z'),
    },
  ],
  pagination: { next: null },
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-ratelimit-remaining' ? '4999' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetch(): { fetch: FetchLike; calls: Call[]; unexpected: string[] } {
  const calls: Call[] = [];
  const unexpected: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
    if (url === 'https://api.github.com/graphql') {
      const req = JSON.parse(init?.body ?? '{}') as { query: string; variables: Record<string, unknown> };
      if (req.query.includes('OvernightRepos')) return json(200, listResponse);
      if (req.query.includes('OvernightDetail')) {
        const data: Record<string, unknown> = {};
        for (let j = 0; `n${j}` in req.variables; j++) {
          data[`r${j}`] = req.variables[`n${j}`] === 'alpha' ? detailFixture : EMPTY_DETAIL;
        }
        return json(200, { data });
      }
    }
    if (url.startsWith('https://api.github.com/repos/acme/alpha/actions/runs?'))
      return json(200, runsFixture);
    if (url.startsWith('https://api.github.com/repos/acme/beta/actions/runs?'))
      return json(200, { total_count: 0, workflow_runs: [] });
    if (url.startsWith('https://api.vercel.com/v9/projects')) return json(200, vercelProjects);
    if (url.startsWith('https://api.vercel.com/v6/deployments')) return json(200, vercelDeployments);
    if (url === 'https://ntfy.example.test/overnight-test') return json(200, { id: 'msg1' });
    unexpected.push(url);
    return json(404, { message: 'Not Found' });
  };
  return { fetch, calls, unexpected };
}

let dir: string;
let outDir: string;
let stateDir: string;
let configPath: string;

beforeEach(async () => {
  for (const name of [
    'OVERNIGHT_OWNER',
    'OVERNIGHT_OUT',
    'OVERNIGHT_STATE',
    'OVERNIGHT_SITE_URL',
    'OVERNIGHT_INCLUDE',
    'OVERNIGHT_EXCLUDE',
    'OVERNIGHT_NTFY_TOPIC',
    'OVERNIGHT_NOTION_DATABASE_ID',
    'OVERNIGHT_NOTION_PAGE_ID',
    'OVERNIGHT_EMAIL_TO',
    'OVERNIGHT_EMAIL_FROM',
    'OVERNIGHT_TRAFFIC',
  ]) {
    vi.stubEnv(name, '');
  }
  dir = await mkdtemp(join(tmpdir(), 'overnight-run-'));
  outDir = join(dir, 'out');
  stateDir = join(dir, 'state');
  configPath = join(dir, 'overnight.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      owner: 'acme',
      timezone: 'UTC',
      outDir: join(dir, 'unused-out'),
      stateDir,
      siteTitle: 'Acme Overnight',
      deliver: { ntfy: { enabled: true, topic: 'overnight-test', server: 'https://ntfy.example.test' } },
    }),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('runDigest', () => {
  it('collects, summarizes, writes the archive, delivers, and saves state', async () => {
    const { fetch, calls, unexpected } = makeFetch();
    const logs: string[] = [];
    const { digest, paths, deliveries } = await runDigest({
      configPath,
      outDir,
      llm: false,
      fetch,
      env: { ...FAKE_ENV, ANTHROPIC_API_KEY: 'fake-anthropic-key' },
      now: new Date('2026-10-07T06:00:00Z'),
      log: (m) => logs.push(m),
    });

    expect(unexpected).toEqual([]);
    expect(digest.window).toEqual({ since: '2026-10-06T06:00:00.000Z', until: '2026-10-07T06:00:00.000Z' });
    expect(digest.id).toBe('2026-10-07');
    expect(digest.owner).toBe('acme');
    expect(digest.summarizer).toEqual({ kind: 'fallback' });
    expect(digest.totals).toEqual({
      projectsActive: 1,
      mergedPRs: 1,
      commits: 2,
      releases: 1,
      ciFailures: 3,
      openPRsNeedingAttention: 2,
      issuesOpened: 1,
      issuesClosed: 2,
      deployments: 2,
      deploymentsFailed: 1,
      starsDelta: 0,
      agentContributions: 2,
    });
    const alpha = digest.projects.find((p) => p.id === 'acme/alpha');
    expect(alpha?.siteUrl).toBe('https://alpha.example.com');
    expect(alpha?.vercelProject).toBe('alpha-web');
    expect(digest.projects.map((p) => p.id)).toEqual(['acme/alpha', 'acme/beta']);

    // Files written to the --out override, not the config outDir.
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.startsWith(outDir)).toBe(true);
    const latest = JSON.parse(await readFile(join(outDir, 'latest.json'), 'utf8'));
    expect(latest).toEqual(digest);
    const archived = JSON.parse(await readFile(join(outDir, 'digests', '2026-10-07.json'), 'utf8'));
    expect(archived.id).toBe('2026-10-07');
    expect(await readFile(join(outDir, 'digests', '2026-10-07.html'), 'utf8')).toContain('<html');

    expect(deliveries).toEqual([{ channel: 'ntfy', ok: true, detail: expect.any(String) }]);
    const ntfyCall = calls.find((c) => c.url.startsWith('https://ntfy.example.test/'));
    expect(ntfyCall?.method).toBe('POST');

    const state = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8')) as StateSnapshot;
    expect(state).toEqual({
      lastRunAt: '2026-10-07T06:00:00.000Z',
      repoStats: { 'acme/alpha': { stars: 12, forks: 3 }, 'acme/beta': { stars: 5, forks: 0 } },
    });

    // Never leak secrets into logs, outputs, or URLs.
    const secrets = [...Object.values(FAKE_ENV), 'fake-anthropic-key'];
    const haystack = [logs.join('\n'), JSON.stringify(digest), ...calls.map((c) => c.url)].join('\n');
    for (const s of secrets) expect(haystack).not.toContain(s);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('uses lastRunAt from the previous run as the next window start and computes star deltas', async () => {
    const first = makeFetch();
    await runDigest({
      configPath,
      outDir,
      llm: false,
      deliver: false,
      fetch: first.fetch,
      env: FAKE_ENV,
      now: new Date('2026-10-07T06:00:00Z'),
    });

    listResponse.data.repositoryOwner.repositories.nodes[0]!.stargazerCount = 15;
    try {
      const second = makeFetch();
      const { digest, deliveries } = await runDigest({
        configPath,
        outDir,
        llm: false,
        deliver: false,
        fetch: second.fetch,
        env: FAKE_ENV,
        now: new Date('2026-10-08T06:00:00Z'),
      });
      expect(digest.window).toEqual({ since: '2026-10-07T06:00:00.000Z', until: '2026-10-08T06:00:00.000Z' });
      expect(deliveries).toEqual([]);
      expect(second.calls.some((c) => c.url.includes('ntfy'))).toBe(false);
      expect(digest.totals.starsDelta).toBe(3);
      const listCall = second.calls.find((c) => c.body?.includes('OvernightRepos'));
      expect(JSON.parse(listCall?.body ?? '{}').variables.since).toBe('2026-10-07T06:00:00.000Z');

      const state = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8')) as StateSnapshot;
      expect(state.lastRunAt).toBe('2026-10-08T06:00:00.000Z');
      expect(state.repoStats['acme/alpha']).toEqual({ stars: 15, forks: 3 });
      const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));
      expect(index.digests.map((d: { id: string }) => d.id).sort()).toEqual(['2026-10-07', '2026-10-08']);
    } finally {
      listResponse.data.repositoryOwner.repositories.nodes[0]!.stargazerCount = 12;
    }
  });

  it('dry run writes nothing and saves no state', async () => {
    const { fetch, calls } = makeFetch();
    const { digest, paths, deliveries } = await runDigest({
      configPath,
      outDir,
      llm: false,
      dryRun: true,
      fetch,
      env: FAKE_ENV,
      now: new Date('2026-10-07T06:00:00Z'),
    });
    expect(digest.totals.mergedPRs).toBe(1);
    expect(paths).toEqual([]);
    expect(deliveries).toEqual([]);
    expect(calls.some((c) => c.url.includes('ntfy'))).toBe(false);
    await expect(readFile(join(outDir, 'latest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(stateDir, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails clearly when no owner is configured', async () => {
    await writeFile(configPath, JSON.stringify({ owner: '', stateDir }));
    const { fetch, calls } = makeFetch();
    await expect(runDigest({ configPath, outDir, fetch, env: FAKE_ENV })).rejects.toThrow(
      'set OVERNIGHT_OWNER or owner in overnight.config.json',
    );
    expect(calls).toEqual([]);
  });
});
