import { describe, it, expect, vi } from 'vitest';
import type { CollectContext, FetchLike, RawProject } from '../src/types.js';
import { collectVercel } from '../src/collect/vercel.js';

const { collectGitHub } = vi.hoisted(() => ({ collectGitHub: vi.fn() }));
vi.mock('../src/collect/github.js', () => ({ collectGitHub }));

const since = Date.parse('2026-10-06T00:00:00Z');
const until = since + 86400000;
function raw(): RawProject {
  return {
    id: 'owner/Repo',
    name: 'Repo',
    url: 'https://github.com/owner/Repo',
    mergedPRs: [],
    openPRs: [],
    commits: [],
    releases: [],
    ciFailures: [],
    issues: [],
    deployments: [],
  };
}
function context(fetch: FetchLike): CollectContext {
  return {
    config: {
      owner: 'owner',
      include: [],
      exclude: [],
      includeForks: false,
      includeArchived: false,
      agents: [],
      timezone: 'UTC',
      defaultSince: '24h',
      staleDays: 7,
      vercelProjects: {},
      llm: { enabled: false, model: 'unused', maxProjects: 10 },
      outDir: '/tmp/digest',
      stateDir: '/tmp/state',
      siteTitle: 'Test',
      deliver: {
        notion: { enabled: false },
        email: { enabled: false },
        ntfy: { enabled: false, server: 'https://ntfy.sh' },
      },
    },
    secrets: { vercelToken: 'fake-test-token' },
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
    state: { repoStats: {} },
    fetch,
    log: vi.fn(),
  };
}
function response(body: unknown, status = 200): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status === 200,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => '',
  };
}
function deployment(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'd1',
    name: 'web',
    projectId: 'p1',
    url: 'web.vercel.app',
    readyState: 'READY',
    target: null,
    created: since + 1000,
    meta: { githubCommitMessage: 'Ship it', githubCommitRef: 'main', githubRepo: 'Repo' },
    ...overrides,
  };
}
function fake(catalog: unknown[], pages: unknown[]) {
  let page = 0;
  return vi.fn<FetchLike>(async (url) =>
    url.includes('/v9/projects') ? response({ projects: catalog }) : response(pages[page++]),
  );
}
const linkedProject = {
  id: 'p1',
  name: 'web',
  link: { type: 'github', repo: 'rEpO', org: 'owner' },
  targets: { production: { alias: ['site.example', 'other.example'] } },
};

describe('collectVercel', () => {
  it('returns the input unchanged without a token and makes no requests', async () => {
    const fetch = vi.fn<FetchLike>();
    const ctx = context(fetch);
    ctx.secrets = {};
    const input = [raw()];
    const result = await collectVercel(ctx, input);
    expect(result.projects).toBe(input);
    expect(result.warnings).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('links by project id and case-insensitive repo name, adds aliases and commit metadata', async () => {
    const fetch = fake([linkedProject], [{ deployments: [deployment()] }]);
    const ctx = context(fetch);
    ctx.config.vercelTeamId = 'team_test';
    const input = [raw()];
    const result = await collectVercel(ctx, input);
    expect(result.warnings).toEqual([]);
    expect(result.projects[0]).toMatchObject({
      vercelProject: 'web',
      siteUrl: 'https://site.example',
      deployments: [
        {
          id: 'd1',
          project: 'web',
          url: 'https://web.vercel.app',
          target: 'preview',
          state: 'READY',
          at: new Date(since + 1000).toISOString(),
          commitMessage: 'Ship it',
          branch: 'main',
        },
      ],
    });
    expect(input).toEqual([raw()]);
    for (const [url, init] of fetch.mock.calls) {
      expect(new URL(url).searchParams.get('teamId')).toBe('team_test');
      expect(new URL(url).searchParams.get('limit')).toBe('100');
      expect(init?.headers?.Authorization).toBe('Bearer fake-test-token');
    }
    const url = new URL(fetch.mock.calls[1]![0]);
    expect(url.searchParams.get('since')).toBe(String(since));
    expect(url.searchParams.get('until')).toBe(String(until));
  });

  it('uses configured mappings and top-level aliases, including projects without activity', async () => {
    const fetch = fake([{ id: 'p1', name: 'web', alias: ['fallback.example'] }], [{ deployments: [] }]);
    const ctx = context(fetch);
    ctx.config.vercelProjects = { web: 'repo' };
    expect((await collectVercel(ctx, [raw()])).projects[0]).toMatchObject({
      vercelProject: 'web',
      siteUrl: 'https://fallback.example',
      deployments: [],
    });
  });

  it('creates only active standalone projects and filters deployments to the window', async () => {
    const fetch = fake(
      [
        { id: 'p1', name: 'web' },
        { id: 'p2', name: 'quiet' },
      ],
      [
        {
          deployments: [
            deployment({ state: 'ERROR', target: 'production' }),
            deployment({ uid: 'old', created: since - 1 }),
            deployment({ uid: 'future', created: until + 1 }),
          ],
        },
      ],
    );
    const result = await collectVercel(context(fetch), []);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      id: 'vercel:web',
      name: 'web',
      url: 'https://vercel.com/web',
      deployments: [{ id: 'd1', state: 'ERROR', target: 'production' }],
    });
  });

  it('paginates with until cursors and deduplicates repeated deployments', async () => {
    const next = since + 2000;
    const fetch = fake(
      [linkedProject],
      [
        { deployments: [deployment()], pagination: { next } },
        { deployments: [deployment(), deployment({ uid: 'd2' })], pagination: { next: null } },
      ],
    );
    const result = await collectVercel(context(fetch), [raw()]);
    expect(result.projects[0]?.deployments.map((item) => item.id)).toEqual(['d1', 'd2']);
    expect(new URL(fetch.mock.calls[2]![0]).searchParams.get('until')).toBe(String(next));
  });

  it('caps deployment requests at five pages and warns about truncation', async () => {
    const fetch = fake(
      [],
      Array.from({ length: 5 }, (_, i) => ({ deployments: [], pagination: { next: until - i - 1 } })),
    );
    const result = await collectVercel(context(fetch), []);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(result.warnings.join(' ')).toContain('five-page');
  });

  it.each([0, 1, 2])('rolls back all changes when HTTP request %i fails', async (failureIndex) => {
    let call = 0;
    const fetch = vi.fn<FetchLike>(async () => {
      const current = call++;
      if (current === failureIndex) return response({}, 403);
      return current === 0
        ? response({ projects: [linkedProject] })
        : response({ deployments: [deployment()], pagination: { next: since + 2000 } });
    });
    const input = [raw()];
    const result = await collectVercel(context(fetch), input);
    expect(result.projects).toBe(input);
    expect(input).toEqual([raw()]);
    expect(result.warnings[0]).toContain('HTTP 403');
  });

  it('returns a sanitized warning on network and malformed response failures', async () => {
    for (const fetch of [
      vi.fn<FetchLike>(async () => {
        throw new Error('fake-test-token');
      }),
      fake([], [{}]),
    ]) {
      const input = [raw()];
      const result = await collectVercel(context(fetch), input);
      expect(result.projects).toBe(input);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).not.toContain('fake-test-token');
    }
  });
});

describe('collect', () => {
  it('passes GitHub projects to Vercel and concatenates warnings', async () => {
    const { collect } = await import('../src/collect/index.js');
    const input = [raw()];
    vi.mocked(collectGitHub).mockResolvedValueOnce({ projects: input, warnings: ['GitHub warning'] });
    const ctx = context(async () => response({}, 500));
    const result = await collect(ctx);
    expect(collectGitHub).toHaveBeenCalledWith(ctx);
    expect(result.projects).toBe(input);
    expect(result.warnings).toEqual(['GitHub warning', 'Vercel collection failed: HTTP 500 (/v9/projects).']);
  });

  it('propagates missing GitHub token errors before calling Vercel', async () => {
    const { collect } = await import('../src/collect/index.js');
    const error = new Error('Missing GitHub token');
    vi.mocked(collectGitHub).mockRejectedValueOnce(error);
    const fetch = vi.fn<FetchLike>();
    await expect(collect(context(fetch))).rejects.toBe(error);
    expect(fetch).not.toHaveBeenCalled();
  });
});
