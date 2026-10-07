import { describe, it, expect } from 'vitest';
import { buildDigest, computeTotals, sortProjects } from '../src/digest.js';
import type { OvernightConfig, ProjectActivity } from '../src/types.js';

const bot = { login: 'a[bot]', isBot: true };
const me = { login: 'me', isBot: false };
const proj = (
  name: string,
  health: ProjectActivity['health'],
  o: Partial<ProjectActivity> = {},
): ProjectActivity => ({
  id: `o/${name}`,
  name,
  url: 'u',
  mergedPRs: [],
  openPRs: [],
  commits: [],
  releases: [],
  ciFailures: [],
  issues: [],
  deployments: [],
  health,
  summary: '',
  highlights: [],
  ...o,
});
const pr = (n: number, author = me) => ({ number: n, title: 't', url: 'u', author, at: 'x', labels: [] });
const commit = (author = me) => ({ sha: 's', message: 'm', url: 'u', author, at: 'x', branch: 'main' });

describe('computeTotals', () => {
  it('aggregates', () => {
    const t = computeTotals([
      proj('a', 'green', {
        mergedPRs: [pr(1, bot), pr(2)],
        commits: [commit(bot), commit()],
        issues: [
          { number: 1, title: 't', url: 'u', author: me, at: 'x', state: 'opened', labels: [] },
          { number: 2, title: 't', url: 'u', author: me, at: 'x', state: 'closed', labels: [] },
        ],
        deployments: [
          { id: '1', project: 'a', url: 'u', target: 'production', state: 'ERROR', at: 'x' },
          { id: '2', project: 'a', url: 'u', target: 'production', state: 'READY', at: 'x' },
        ],
        stats: { stars: 1, forks: 0, starsDelta: 3, forksDelta: 0, openIssues: 0 },
      }),
      proj('b', 'quiet'),
    ]);
    expect(t).toMatchObject({
      projectsActive: 1,
      mergedPRs: 2,
      commits: 2,
      issuesOpened: 1,
      issuesClosed: 1,
      deployments: 2,
      deploymentsFailed: 1,
      starsDelta: 3,
      agentContributions: 2,
    });
  });
});

describe('sortProjects', () => {
  it('orders by health, volume, then name', () => {
    const out = sortProjects([
      proj('q', 'quiet'),
      proj('g', 'green'),
      proj('b', 'yellow'),
      proj('z', 'red'),
      proj('a', 'yellow'),
      proj('big', 'yellow', { commits: [commit(), commit()] }),
    ]);
    expect(out.map((p) => p.name)).toEqual(['z', 'big', 'a', 'b', 'g', 'q']);
  });
});

describe('buildDigest', () => {
  it('builds with timezone-aware id', () => {
    const config = { owner: 'me', timezone: 'America/Los_Angeles' } as OvernightConfig;
    const d = buildDigest({
      config,
      window: { since: '2026-10-06T06:00:00Z', until: '2026-10-07T03:00:00Z' },
      projects: [proj('a', 'quiet'), proj('b', 'red')],
      headline: 'h',
      summarizer: { kind: 'fallback' },
      warnings: ['w'],
      now: new Date('2026-10-07T06:00:00Z'),
    });
    expect(d.id).toBe('2026-10-06');
    expect(d.schema).toBe('overnight.digest/v1');
    expect(d.generatedAt).toBe('2026-10-07T06:00:00.000Z');
    expect(d.owner).toBe('me');
    expect(d.projects.map((p) => p.name)).toEqual(['b', 'a']);
    expect(d.warnings).toEqual(['w']);
  });
});
