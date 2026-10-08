import { describe, it, expect } from 'vitest';
import {
  computeHealth,
  fallbackHeadline,
  fallbackProjectSummary,
  fallbackSummarizer,
} from '../src/summarize/fallback.js';
import type { PullRequestItem, RawProject, ProjectActivity, DeploymentItem } from '../src/types.js';

const human = { login: 'sam', isBot: false };
const bot = { login: 'claude[bot]', isBot: true };
const pr = (n: number, a = human, extra: Partial<PullRequestItem> = {}): PullRequestItem => ({
  number: n,
  title: `Change ${n}`,
  url: 'u',
  author: a,
  at: '2026-10-07T01:00:00Z',
  labels: [],
  ...extra,
});
const dep = (
  target: 'production' | 'preview',
  state: DeploymentItem['state'],
  at: string,
): DeploymentItem => ({
  id: at + target + state,
  project: 'x',
  url: 'u',
  target,
  state,
  at,
});
const base = (o: Partial<RawProject> = {}): RawProject => ({
  id: 'o/x',
  name: 'x',
  url: 'u',
  mergedPRs: [],
  openPRs: [],
  commits: [],
  releases: [],
  ciFailures: [],
  issues: [],
  deployments: [],
  ...o,
});
const fail = (branch: string, at: string) => ({
  workflow: 'ci',
  runId: 1,
  url: 'u',
  branch,
  at,
  conclusion: 'failure' as const,
});

describe('computeHealth', () => {
  it('quiet with no activity', () => expect(computeHealth(base())).toBe('quiet'));
  it('green with merged PRs', () => expect(computeHealth(base({ mergedPRs: [pr(1)] }))).toBe('green'));
  it('red for main CI failure', () =>
    expect(computeHealth(base({ ciFailures: [fail('main', '2026-10-07T02:00:00Z')] }))).toBe('red'));
  it('yellow for CI failure on other branch', () =>
    expect(computeHealth(base({ ciFailures: [fail('feat', '2026-10-07T02:00:00Z')] }))).toBe('yellow'));
  it('main failure older than successful prod deploy is not red', () =>
    expect(
      computeHealth(
        base({
          ciFailures: [fail('main', '2026-10-07T01:00:00Z')],
          deployments: [dep('production', 'READY', '2026-10-07T02:00:00Z')],
        }),
      ),
    ).toBe('yellow'));
  it('red when latest prod deploy errored', () =>
    expect(
      computeHealth(
        base({
          deployments: [
            dep('production', 'READY', '2026-10-07T01:00:00Z'),
            dep('production', 'ERROR', '2026-10-07T02:00:00Z'),
          ],
        }),
      ),
    ).toBe('red'));
  it('green when prod error was followed by success', () =>
    expect(
      computeHealth(
        base({
          deployments: [
            dep('production', 'ERROR', '2026-10-07T01:00:00Z'),
            dep('production', 'READY', '2026-10-07T02:00:00Z'),
          ],
        }),
      ),
    ).toBe('green'));
  it('red for open PR with failing CI', () =>
    expect(computeHealth(base({ openPRs: [pr(2, human, { attention: ['ci_failing'] })] }))).toBe('red'));
  it('yellow for open PR needing review or failed preview', () => {
    expect(computeHealth(base({ openPRs: [pr(2, human, { attention: ['stale'] })] }))).toBe('yellow');
    expect(computeHealth(base({ deployments: [dep('preview', 'ERROR', '2026-10-07T02:00:00Z')] }))).toBe(
      'yellow',
    );
  });
});

describe('fallbackProjectSummary', () => {
  it('describes a busy project', () => {
    const p = base({
      mergedPRs: [pr(1, bot), pr(2, bot), pr(3)],
      releases: [{ tag: 'v1.4.0', name: 'v1.4.0', url: 'u', at: 'x', prerelease: false }],
      deployments: [dep('production', 'READY', 'a'), dep('production', 'READY', 'b')],
      ciFailures: [fail('main', 'c')],
    });
    const r = fallbackProjectSummary(p);
    expect(r.summary).toBe(
      'Merged 3 PRs (2 by agents), shipped v1.4.0, and deployed to production twice. 1 CI run failed on main.',
    );
    expect(r.highlights[0]).toBe('#1 Change 1');
    expect(r.highlights).toContain('Release v1.4.0');
    expect(r.highlights.length).toBeLessThanOrEqual(5);
  });
  it('caps highlights at 5', () => {
    const p = base({
      mergedPRs: [1, 2, 3, 4].map((n) => pr(n)),
      ciFailures: [fail('main', 'a'), fail('main', 'b'), fail('x', 'c')],
    });
    expect(fallbackProjectSummary(p).highlights).toHaveLength(5);
  });
  it('handles quiet project', () => {
    expect(fallbackProjectSummary(base())).toEqual({ summary: 'No activity overnight.', highlights: [] });
  });
});

describe('headline and summarizer', () => {
  it('quiet headline', () => expect(fallbackHeadline([])).toBe('A quiet night — nothing shipped.'));
  it('summarizes via fallbackSummarizer', async () => {
    const cfg = {} as never;
    const w = { since: 'a', until: 'b' };
    const res = await fallbackSummarizer.summarize(
      [
        base({
          name: 'a',
          mergedPRs: [pr(1)],
          releases: [{ tag: 'v1', name: 'v1', url: 'u', at: 'x', prerelease: false }],
        }),
        base({ name: 'b', ciFailures: [fail('main', '2026-10-07T02:00:00Z')] }),
        base({ name: 'c' }),
      ],
      w,
      cfg,
    );
    expect(res.summarizer).toEqual({ kind: 'fallback' });
    expect(res.projects.map((p: ProjectActivity) => p.health)).toEqual(['green', 'red', 'quiet']);
    expect(res.headline).toBe(
      '2 projects moved overnight: 1 PR merged, 1 release, 1 failing project needs a look.',
    );
  });
});
