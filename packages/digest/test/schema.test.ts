import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Digest, DigestIndex } from '../src/types.js';

type Obj = Record<string, unknown>;
const load = (f: string): Obj =>
  JSON.parse(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8')) as Obj;

const actor = { login: 'claude[bot]', isBot: true };
const at = '2026-10-07T05:00:00.000Z';
const totals = {
  projectsActive: 1,
  mergedPRs: 1,
  commits: 1,
  releases: 1,
  ciFailures: 1,
  openPRsNeedingAttention: 1,
  issuesOpened: 1,
  issuesClosed: 1,
  deployments: 1,
  deploymentsFailed: 1,
  starsDelta: 1,
  agentContributions: 1,
};
const window = { since: '2026-10-06T06:00:00.000Z', until: at };
const pr = {
  number: 1,
  title: 't',
  url: 'u',
  author: actor,
  at,
  additions: 1,
  deletions: 1,
  labels: [],
  draft: false,
  attention: ['ci_failing' as const],
};
const digest: Digest = {
  schema: 'overnight.digest/v1',
  id: '2026-10-07',
  generatedAt: at,
  window,
  owner: 'o',
  headline: 'h',
  summarizer: { kind: 'llm', model: 'm' },
  totals,
  warnings: [],
  projects: [
    {
      id: 'o/r',
      name: 'r',
      url: 'u',
      description: 'd',
      defaultBranch: 'main',
      vercelProject: 'v',
      siteUrl: 's',
      mergedPRs: [pr],
      openPRs: [pr],
      commits: [{ sha: 'a', message: 'm', url: 'u', author: actor, at, branch: 'main' }],
      releases: [{ tag: 'v1', name: 'n', url: 'u', at, prerelease: false, notes: 'x' }],
      ciFailures: [
        { workflow: 'w', runId: 1, url: 'u', branch: 'main', at, conclusion: 'failure', commitMessage: 'c' },
      ],
      issues: [{ number: 1, title: 't', url: 'u', author: actor, at, state: 'opened', labels: [] }],
      deployments: [
        {
          id: 'd',
          project: 'p',
          url: 'u',
          target: 'production',
          state: 'READY',
          at,
          commitMessage: 'c',
          branch: 'main',
        },
      ],
      traffic: { views: 1, uniqueVisitors: 1, source: 'github' },
      stats: { stars: 1, forks: 1, starsDelta: 1, forksDelta: 1, openIssues: 1 },
      health: 'green',
      summary: 's',
      highlights: ['h'],
    },
  ],
};
const index: DigestIndex = {
  schema: 'overnight.index/v1',
  owner: 'o',
  updatedAt: at,
  digests: [{ id: '2026-10-07', headline: 'h', window, totals, path: 'digests/2026-10-07.json' }],
};

const props = (s: Obj): string[] => Object.keys(s['properties'] as Obj).sort();
const required = (s: Obj): string[] => [...(s['required'] as string[])].sort();
const defs = (s: Obj): Obj => s['$defs'] as Obj;
const sorted = (o: object): string[] => Object.keys(o).sort();

function expectMatches(sample: object, schema: Obj, optional: string[] = []): void {
  expect(props(schema)).toEqual(sorted(sample));
  expect(required(schema)).toEqual(sorted(sample).filter((k) => !optional.includes(k)));
  expect(schema['additionalProperties']).toBe(true);
}

describe('digest.v1.json', () => {
  const s = load('digest.v1.json');
  const d = defs(s);
  it('has id and top-level keys', () => {
    expect(s['$id']).toBe('https://github.com/ysta32/fleet/packages/digest/schema/digest.v1.json');
    expect(s['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expectMatches(digest, s);
  });
  it('matches nested objects', () => {
    const p = digest.projects[0]!;
    expectMatches(digest.totals, d['totals'] as Obj);
    expectMatches(digest.window, d['timeWindow'] as Obj);
    expectMatches(actor, d['actor'] as Obj);
    expectMatches(p, d['project'] as Obj, [
      'description',
      'defaultBranch',
      'vercelProject',
      'siteUrl',
      'traffic',
      'stats',
    ]);
    expectMatches(pr, d['pullRequest'] as Obj, ['additions', 'deletions', 'draft', 'attention']);
    expectMatches(p.commits[0]!, d['commit'] as Obj);
    expectMatches(p.releases[0]!, d['release'] as Obj, ['notes']);
    expectMatches(p.ciFailures[0]!, d['ciFailure'] as Obj, ['commitMessage']);
    expectMatches(p.issues[0]!, d['issue'] as Obj);
    expectMatches(p.deployments[0]!, d['deployment'] as Obj, ['commitMessage', 'branch']);
    expectMatches(p.traffic!, d['traffic'] as Obj, ['views', 'uniqueVisitors']);
    expectMatches(p.stats!, d['repoStats'] as Obj);
  });
  it('lists enums', () => {
    const e = (k: string, f: string): unknown =>
      ((d[k] as Obj)['properties'] as Record<string, Obj>)[f]!['enum'];
    expect(e('project', 'health')).toEqual(['green', 'yellow', 'red', 'quiet']);
    expect(e('deployment', 'state')).toEqual(['READY', 'ERROR', 'CANCELED', 'BUILDING', 'QUEUED']);
    expect(e('deployment', 'target')).toEqual(['production', 'preview']);
    expect(e('issue', 'state')).toEqual(['opened', 'closed']);
    expect(e('ciFailure', 'conclusion')).toEqual(['failure', 'timed_out', 'cancelled', 'startup_failure']);
  });
});

describe('index.v1.json', () => {
  const s = load('index.v1.json');
  it('matches DigestIndex', () => {
    expect(s['$id']).toBe('https://github.com/ysta32/fleet/packages/digest/schema/index.v1.json');
    expectMatches(index, s);
    const item = (s['properties'] as Record<string, Obj>)['digests']!['items'] as Obj;
    expectMatches(index.digests[0]!, item);
  });
});
