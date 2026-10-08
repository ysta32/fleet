import { execFile } from 'node:child_process';
import type { CiState, Deploy, FleetEvent, PullRequest, Release } from '@fleet/shared';

export type ExecFn = (cmd: string, args: string[], cwd?: string) => Promise<string>;

interface Snapshot {
  prs: PullRequest[];
  releases: Release[];
  deploys: Deploy[];
}

interface Result extends Snapshot {
  events: FleetEvent[];
}

interface RepoState {
  snapshot?: Snapshot;
  nextPoll: number;
}

const BACKOFF_MS = 10 * 60 * 1000;
let eventSequence = 0;

const defaultExec: ExecFn = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 20_000, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

function records(json: string): Record<string, unknown>[] {
  const value: unknown = JSON.parse(json);
  if (
    !Array.isArray(value) ||
    value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error('Invalid GitHub response');
  }
  return value as Record<string, unknown>[];
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid GitHub string');
  return value;
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(string(value));
  if (!Number.isFinite(parsed)) throw new Error('Invalid GitHub timestamp');
  return parsed;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid GitHub number');
  }
  return value;
}

function ciState(value: unknown): CiState {
  if (value == null) return 'none';
  if (!Array.isArray(value)) throw new Error('Invalid GitHub checks');
  const states = value
    .map((check: unknown) => {
      if (!check || typeof check !== 'object') throw new Error('Invalid GitHub check');
      const item = check as Record<string, unknown>;
      return String(item.conclusion || item.state || item.status || '').toUpperCase();
    })
    .filter((state) => !['CANCELLED', 'STALE', 'SKIPPED', 'NEUTRAL'].includes(state));
  if (states.some((state) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE'].includes(state)))
    return 'failure';
  if (
    states.some((state) =>
      ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED', 'EXPECTED', 'ACTION_REQUIRED'].includes(
        state,
      ),
    )
  )
    return 'pending';
  if (states.length && states.every((state) => state === 'SUCCESS')) return 'success';
  return 'none';
}

function deployState(value: unknown): Deploy['state'] {
  switch (value) {
    case 'success':
      return 'ready';
    case 'failure':
    case 'error':
      return 'error';
    case 'inactive':
      return 'canceled';
    case undefined:
    case 'pending':
    case 'in_progress':
    case 'queued':
      return 'building';
    default:
      throw new Error('Invalid GitHub deployment state');
  }
}

function diff(previous: Snapshot, next: Snapshot, ts: number): FleetEvent[] {
  const events: FleetEvent[] = [];
  const add = (
    kind: FleetEvent['kind'],
    severity: FleetEvent['severity'],
    label: string,
    data?: FleetEvent['data'],
  ): void => {
    events.push({
      id: `${ts}-${++eventSequence}`,
      ts,
      kind,
      severity,
      projectId: '',
      label,
      ...(data ? { data } : {}),
    });
  };
  for (const pr of next.prs) {
    const old = previous.prs.find((item) => item.number === pr.number);
    if (old && old.state !== 'merged' && pr.state === 'merged')
      add('merge', 'success', `PR #${pr.number} merged`);
    if (pr.ci === 'failure' && old?.ci !== 'failure') add('ci', 'error', `PR #${pr.number} CI failed`);
    if (pr.ci === 'success' && old?.ci === 'failure') add('ci', 'success', `PR #${pr.number} CI recovered`);
  }
  for (const release of next.releases) {
    if (!previous.releases.some((item) => item.tag === release.tag))
      add('release', 'success', 'Release published');
  }
  for (const deploy of next.deploys) {
    const old = previous.deploys.find((item) => item.id === deploy.id);
    if (!old || old.state !== deploy.state) {
      add(
        deploy.state === 'error' ? 'failure' : 'deploy',
        deploy.state === 'error' ? 'error' : deploy.state === 'ready' ? 'success' : 'info',
        `Deployment ${deploy.state}`,
        deploy.state === 'error' ? { source: 'deploy' } : undefined,
      );
    }
  }
  return events;
}

export class GithubPoller {
  private readonly exec: ExecFn;
  private readonly pollMs: number;
  private readonly repos = new Map<string, RepoState>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private pending: Promise<unknown> = Promise.resolve();

  constructor(opts: { exec?: ExecFn; pollMs: number }) {
    this.exec = opts.exec ?? defaultExec;
    this.pollMs = opts.pollMs;
  }

  private async run(cmd: string, args: string[], cwd?: string): Promise<string> {
    if (this.active >= 3) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await this.exec(cmd, args, cwd);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  async repoFor(projectPath: string): Promise<string | undefined> {
    try {
      const remote = (await this.run('git', ['-C', projectPath, 'remote', 'get-url', 'origin'])).trim();
      const match =
        /^(?:https:\/\/github\.com\/|(?:git@)?github\.com:|ssh:\/\/(?:git@)?github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(
          remote,
        );
      if (!match) return undefined;
      const name = match[2].replace(/\.git$/, '');
      if (!name || [match[1], name].some((part) => part === '.' || part === '..')) return undefined;
      return `${match[1]}/${name}`;
    } catch {
      return undefined;
    }
  }

  poll(projects: { id: string; path: string }[]): Promise<Result> {
    const pending = this.pending.then(() => this.collect(projects));
    this.pending = pending.catch(() => undefined);
    return pending;
  }

  private async fetch(repo: string): Promise<Snapshot> {
    const prs = records(
      await this.run('gh', [
        'pr',
        'list',
        '--repo',
        repo,
        '--state',
        'all',
        '--limit',
        '15',
        '--json',
        'number,title,state,headRefName,updatedAt,url,statusCheckRollup',
      ]),
    ).map((pr): PullRequest => {
      const state = string(pr.state).toLowerCase();
      if (state !== 'open' && state !== 'merged' && state !== 'closed')
        throw new Error('Invalid GitHub PR state');
      return {
        projectId: '',
        number: number(pr.number),
        title: string(pr.title),
        state,
        headRef: string(pr.headRefName),
        updatedAt: timestamp(pr.updatedAt),
        url: string(pr.url),
        ci: ciState(pr.statusCheckRollup),
      };
    });
    const releases = records(
      await this.run('gh', [
        'release',
        'list',
        '--repo',
        repo,
        '--limit',
        '5',
        '--json',
        'tagName,name,publishedAt',
      ]),
    ).map((release): Release => {
      const tag = string(release.tagName);
      return {
        projectId: '',
        tag,
        name: string(release.name),
        publishedAt: timestamp(release.publishedAt),
        url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
      };
    });
    const deployments = records(await this.run('gh', ['api', `repos/${repo}/deployments?per_page=5`]));
    const deploys: Deploy[] = [];
    const latest = deployments[0];
    if (latest) {
      const id = String(number(latest.id));
      const status = records(await this.run('gh', ['api', `repos/${repo}/deployments/${id}/statuses`]))[0];
      const url = status?.environment_url || status?.target_url;
      deploys.push({
        projectId: '',
        id,
        environment: string(latest.environment),
        state: deployState(status?.state),
        createdAt: timestamp(latest.created_at),
        ...(url ? { url: string(url) } : {}),
      });
    }
    return { prs, releases, deploys };
  }

  private async collect(projects: { id: string; path: string }[]): Promise<Result> {
    const groups = new Map<string, string[]>();
    const resolved = await Promise.all(
      projects.map(async (project) => ({ ...project, repo: await this.repoFor(project.path) })),
    );
    for (const project of resolved) {
      if (!project.repo) continue;
      const ids = groups.get(project.repo) ?? [];
      if (!ids.includes(project.id)) ids.push(project.id);
      groups.set(project.repo, ids);
    }
    const results = await Promise.all(
      [...groups].map(async ([repo, ids]): Promise<Result> => {
        const state = this.repos.get(repo) ?? { nextPoll: 0 };
        let events: FleetEvent[] = [];
        if (Date.now() >= state.nextPoll) {
          try {
            const snapshot = await this.fetch(repo);
            const now = Date.now();
            if (state.snapshot) events = diff(state.snapshot, snapshot, now);
            state.snapshot = snapshot;
            state.nextPoll = now + this.pollMs;
          } catch {
            state.nextPoll = Date.now() + BACKOFF_MS;
          }
          this.repos.set(repo, state);
        }
        const snapshot = state.snapshot ?? { prs: [], releases: [], deploys: [] };
        return {
          prs: ids.flatMap((projectId) => snapshot.prs.map((pr) => ({ ...pr, projectId }))),
          releases: ids.flatMap((projectId) =>
            snapshot.releases.map((release) => ({ ...release, projectId })),
          ),
          deploys: ids.flatMap((projectId) => snapshot.deploys.map((deploy) => ({ ...deploy, projectId }))),
          events: ids.flatMap((projectId) =>
            events.map((event) => ({ ...event, projectId, id: `${event.ts}-${++eventSequence}` })),
          ),
        };
      }),
    );
    return {
      prs: results.flatMap((result) => result.prs),
      releases: results.flatMap((result) => result.releases),
      deploys: results.flatMap((result) => result.deploys),
      events: results.flatMap((result) => result.events),
    };
  }
}
