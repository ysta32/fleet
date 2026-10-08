import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FleetSnapshot } from '@fleet/shared';
import { Notifier } from '../notify.js';
import { GithubPoller, type ExecFn } from './poller.js';

const date = '2026-01-01T00:00:00Z';
const projects = [{ id: 'synthetic', path: '/synthetic/project' }];

function fixture() {
  const data = {
    prs: [
      {
        number: 7,
        title: 'Synthetic change',
        state: 'OPEN',
        headRefName: 'synthetic-branch',
        updatedAt: date,
        url: 'https://github.com/synthetic/demo/pull/7',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }] as Record<string, string>[],
      },
    ],
    releases: [{ tagName: 'v1', name: 'Synthetic release', publishedAt: date }],
    deployments: [{ id: 10, environment: 'synthetic', created_at: date }],
    statuses: [{ state: 'pending', environment_url: 'https://synthetic.invalid' }],
  };
  const exec = vi.fn<ExecFn>(async (cmd, args) => {
    if (cmd === 'git') return 'git@github.com:synthetic/demo.git\n';
    if (args[0] === 'pr') return JSON.stringify(data.prs);
    if (args[0] === 'release') return JSON.stringify(data.releases);
    if (args[1].endsWith('/statuses')) return JSON.stringify(data.statuses);
    if (args[0] === 'api') return JSON.stringify(data.deployments);
    throw new Error('Unexpected command');
  });
  return { data, exec, poller: new GithubPoller({ exec, pollMs: 0 }) };
}

afterEach(() => vi.useRealTimers());

describe('GithubPoller', () => {
  it.each([
    ['https://github.com/synthetic/demo.git', 'synthetic/demo'],
    ['https://github.com/synthetic/demo', 'synthetic/demo'],
    ['git@github.com:synthetic/demo.git', 'synthetic/demo'],
    ['ssh://git@github.com/synthetic/demo.git', 'synthetic/demo'],
    ['https://github.com/synthetic/demo.git/', 'synthetic/demo'],
    ['https://github.com.evil.invalid/synthetic/demo.git', undefined],
    ['https://gitlab.com/synthetic/demo.git', undefined],
    ['https://github.com/synthetic/demo/extra', undefined],
    ['https://github.com/../demo', undefined],
    ['https://github.com/synthetic/demo?token=synthetic', undefined],
  ])('parses remote %s', async (remote, expected) => {
    const exec = vi.fn<ExecFn>().mockResolvedValue(remote);
    const poller = new GithubPoller({ exec, pollMs: 0 });
    expect(await poller.repoFor('/synthetic/path with spaces')).toBe(expected);
    expect(exec).toHaveBeenCalledWith(
      'git',
      ['-C', '/synthetic/path with spaces', 'remote', 'get-url', 'origin'],
      undefined,
    );
  });

  it('silently ignores a failed remote lookup', async () => {
    const exec = vi.fn<ExecFn>().mockRejectedValue(new Error('synthetic not a repository'));
    const poller = new GithubPoller({ exec, pollMs: 0 });
    expect(await poller.repoFor('/synthetic/missing')).toBeUndefined();
    expect(await poller.poll(projects)).toEqual({ prs: [], releases: [], deploys: [], events: [] });
  });

  it('maps the baseline and uses read-only commands with explicit repositories', async () => {
    const { poller, exec } = fixture();
    const result = await poller.poll(projects);
    expect(result.prs).toEqual([
      {
        projectId: 'synthetic',
        number: 7,
        title: 'Synthetic change',
        state: 'open',
        ci: 'success',
        url: 'https://github.com/synthetic/demo/pull/7',
        headRef: 'synthetic-branch',
        updatedAt: Date.parse(date),
      },
    ]);
    expect(result.releases).toEqual([
      {
        projectId: 'synthetic',
        tag: 'v1',
        name: 'Synthetic release',
        publishedAt: Date.parse(date),
        url: 'https://github.com/synthetic/demo/releases/tag/v1',
      },
    ]);
    expect(result.deploys).toEqual([
      {
        projectId: 'synthetic',
        id: '10',
        environment: 'synthetic',
        state: 'building',
        createdAt: Date.parse(date),
        url: 'https://synthetic.invalid',
      },
    ]);
    expect(result.events).toEqual([]);
    expect(exec.mock.calls.filter(([cmd]) => cmd === 'gh').map(([, args]) => args)).toEqual([
      [
        'pr',
        'list',
        '--repo',
        'synthetic/demo',
        '--state',
        'all',
        '--limit',
        '15',
        '--json',
        'number,title,state,headRefName,updatedAt,url,statusCheckRollup',
      ],
      ['release', 'list', '--repo', 'synthetic/demo', '--limit', '5', '--json', 'tagName,name,publishedAt'],
      ['api', 'repos/synthetic/demo/deployments?per_page=5'],
      ['api', 'repos/synthetic/demo/deployments/10/statuses'],
    ]);
    expect((await poller.poll(projects)).events).toEqual([]);
  });

  it.each([
    [[], 'none'],
    [[{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }], 'success'],
    [[{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }], 'pending'],
    [[{ state: 'PENDING' }], 'pending'],
    [[{ status: 'QUEUED' }], 'pending'],
    [[{ state: 'ERROR' }, { status: 'QUEUED' }], 'failure'],
    [[{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }], 'failure'],
    [[{ conclusion: 'TIMED_OUT' }], 'failure'],
    [[{ conclusion: 'STARTUP_FAILURE' }], 'failure'],
    [[{ conclusion: 'ACTION_REQUIRED' }, { conclusion: 'SUCCESS' }], 'pending'],
    [[{ conclusion: 'ACTION_REQUIRED' }, { conclusion: 'FAILURE' }], 'failure'],
  ])('rolls up checks %j as %s', async (checks, expected) => {
    const { poller, data } = fixture();
    data.prs[0].statusCheckRollup = checks;
    expect((await poller.poll(projects)).prs[0].ci).toBe(expected);
  });

  it.each(['CANCELLED', 'STALE', 'SKIPPED', 'NEUTRAL'])(
    'ignores %s checks when rolling up CI and emitting events',
    async (conclusion) => {
      const { poller, data } = fixture();
      await poller.poll(projects);
      for (const [checks, expected] of [
        [[{ conclusion, status: 'COMPLETED' }], 'none'],
        [[{ conclusion }, { conclusion: 'SUCCESS' }], 'success'],
        [[{ conclusion }, { status: 'IN_PROGRESS' }], 'pending'],
      ] as const) {
        data.prs[0].statusCheckRollup = [...checks];
        const result = await poller.poll(projects);
        expect(result.prs[0].ci).toBe(expected);
        expect(result.events).toEqual([]);
      }
      data.prs[0].statusCheckRollup = [{ conclusion }, { conclusion: 'FAILURE' }];
      const failed = await poller.poll(projects);
      expect(failed.prs[0].ci).toBe('failure');
      expect(failed.events).toEqual([expect.objectContaining({ kind: 'ci', severity: 'error' })]);
    },
  );

  it('treats action required as pending without emitting a CI error', async () => {
    const { poller, data } = fixture();
    await poller.poll(projects);
    data.prs[0].statusCheckRollup = [{ conclusion: 'ACTION_REQUIRED', status: 'COMPLETED' }];
    const result = await poller.poll(projects);
    expect(result.prs[0].ci).toBe('pending');
    expect(result.events).toEqual([]);
  });

  it('deploy failure events carry source=deploy and pass the notifier filter', async () => {
    const { poller, data } = fixture();
    await poller.poll(projects);
    data.statuses[0].state = 'error';
    const { events } = await poller.poll(projects);
    const failure = events.find((event) => event.kind === 'failure');
    expect(failure?.data).toEqual({ source: 'deploy' });
    const notifier = new Notifier(
      { macos: false, kinds: ['deploy.failed'] },
      { exec: vi.fn(), fetch: vi.fn(), platform: 'linux' },
    );
    const snap = { projects: [{ id: 'synthetic', name: 'demo', path: '/synthetic/project' }] };
    const alert = notifier.handle(failure!, snap as unknown as FleetSnapshot);
    expect(alert).toMatchObject({ kind: 'deploy.failed' });
  });

  it('emits only changed merge, CI, release and deployment events', async () => {
    const { poller, data } = fixture();
    await poller.poll(projects);
    data.prs[0].state = 'MERGED';
    data.prs[0].statusCheckRollup = [{ conclusion: 'FAILURE' }];
    data.releases.unshift({ tagName: 'v2/synthetic', name: 'Synthetic next release', publishedAt: date });
    data.statuses[0].state = 'error';
    const changed = await poller.poll(projects);
    expect(changed.events.map(({ kind, severity, projectId }) => ({ kind, severity, projectId }))).toEqual([
      { kind: 'merge', severity: 'success', projectId: 'synthetic' },
      { kind: 'ci', severity: 'error', projectId: 'synthetic' },
      { kind: 'release', severity: 'success', projectId: 'synthetic' },
      { kind: 'failure', severity: 'error', projectId: 'synthetic' },
    ]);
    expect(changed.releases[0].url).toBe('https://github.com/synthetic/demo/releases/tag/v2%2Fsynthetic');
    expect(new Set(changed.events.map((event) => event.id)).size).toBe(4);
    expect(changed.events.every((event) => event.label.length <= 80)).toBe(true);
    expect((await poller.poll(projects)).events).toEqual([]);
    data.prs[0].statusCheckRollup = [{ conclusion: 'SUCCESS' }];
    data.statuses[0].state = 'success';
    expect((await poller.poll(projects)).events.map(({ kind, severity }) => ({ kind, severity }))).toEqual([
      { kind: 'ci', severity: 'success' },
      { kind: 'deploy', severity: 'success' },
    ]);
    data.deployments[0].id = 11;
    data.statuses[0].state = 'queued';
    expect((await poller.poll(projects)).events).toEqual([
      expect.objectContaining({ kind: 'deploy', severity: 'info' }),
    ]);
  });

  it.each(['success', 'failure', 'error', 'pending', 'in_progress', 'queued', 'inactive'])(
    'maps deployment state %s',
    async (state) => {
      const { poller, data } = fixture();
      data.statuses[0].state = state;
      const expected =
        state === 'success'
          ? 'ready'
          : ['failure', 'error'].includes(state)
            ? 'error'
            : state === 'inactive'
              ? 'canceled'
              : 'building';
      expect((await poller.poll(projects)).deploys[0].state).toBe(expected);
    },
  );

  it('handles empty deployment statuses and repositories', async () => {
    const { poller, data } = fixture();
    data.statuses = [];
    expect((await poller.poll(projects)).deploys[0]).toEqual(expect.objectContaining({ state: 'building' }));
    data.deployments = [];
    data.prs = [];
    data.releases = [];
    expect(await poller.poll(projects)).toEqual({ prs: [], releases: [], deploys: [], events: [] });
  });

  it('backs off missing gh for ten minutes and retries at the boundary', async () => {
    vi.useFakeTimers();
    const { exec } = fixture();
    const execMissing = vi.fn<ExecFn>(async (cmd, args, cwd) => {
      if (cmd === 'gh') throw Object.assign(new Error('synthetic missing gh'), { code: 'ENOENT' });
      return exec(cmd, args, cwd);
    });
    const poller = new GithubPoller({ exec: execMissing, pollMs: 0 });
    expect((await poller.poll(projects)).events).toEqual([]);
    await vi.advanceTimersByTimeAsync(599_999);
    await poller.poll(projects);
    expect(execMissing.mock.calls.filter(([cmd]) => cmd === 'gh')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await poller.poll(projects);
    expect(execMissing.mock.calls.filter(([cmd]) => cmd === 'gh')).toHaveLength(2);
  });

  it.each(['command', 'json', 'shape'])(
    'keeps the complete baseline on %s errors and diffs after recovery',
    async (failure) => {
      vi.useFakeTimers();
      const { exec, data } = fixture();
      let broken = false;
      const injected: ExecFn = async (cmd, args, cwd) => {
        if (broken && args[0] === 'release') {
          if (failure === 'command') throw new Error('synthetic gh failure');
          return failure === 'json' ? '{' : '[{}]';
        }
        return exec(cmd, args, cwd);
      };
      const poller = new GithubPoller({ exec: injected, pollMs: 0 });
      const baseline = await poller.poll(projects);
      data.prs[0].state = 'MERGED';
      broken = true;
      expect(await poller.poll(projects)).toEqual(baseline);
      broken = false;
      expect(await poller.poll(projects)).toEqual(baseline);
      await vi.advanceTimersByTimeAsync(600_000);
      expect((await poller.poll(projects)).events).toEqual([expect.objectContaining({ kind: 'merge' })]);
    },
  );

  it('honors pollMs, groups shared repos and serializes overlapping polls', async () => {
    vi.useFakeTimers();
    const { exec, data } = fixture();
    const poller = new GithubPoller({ exec, pollMs: 1_000 });
    const shared = [...projects, { id: 'synthetic-other', path: '/synthetic/other' }];
    expect((await poller.poll(shared)).prs.map((pr) => pr.projectId)).toEqual([
      'synthetic',
      'synthetic-other',
    ]);
    expect(exec.mock.calls.filter(([cmd, args]) => cmd === 'gh' && args[0] === 'pr')).toHaveLength(1);
    data.prs[0].state = 'MERGED';
    expect((await poller.poll(shared)).events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    const results = await Promise.all([poller.poll(shared), poller.poll(shared)]);
    expect(results[0].events).toHaveLength(2);
    expect(new Set(results[0].events.map((event) => event.id)).size).toBe(2);
    expect(results[1].events).toEqual([]);
  });

  it('limits active commands to three and isolates a failing repository', async () => {
    let active = 0;
    let maximum = 0;
    const exec: ExecFn = async (cmd, args) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (cmd === 'git') return `https://github.com/synthetic/${args[1].split('/').pop()}.git`;
      if (args.includes('synthetic/repo0')) throw new Error('synthetic repo unavailable');
      if (args[0] === 'release')
        return JSON.stringify([{ tagName: 'v1', name: 'Synthetic release', publishedAt: date }]);
      return '[]';
    };
    const poller = new GithubPoller({ exec, pollMs: 0 });
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `p${index}`,
      path: `/synthetic/repo${index}`,
    }));
    const result = await poller.poll(many);
    expect(maximum).toBe(3);
    expect(result.releases).toHaveLength(7);
    expect(result.releases.some((release) => release.projectId === 'p0')).toBe(false);
  });
});
