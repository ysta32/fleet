import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIGEST_CSS,
  renderDigestFragment,
  renderDigestHtml,
  renderIndexHtml,
  writeArchive,
} from '../src/render/html.js';
import type { Digest, DigestIndex, DigestTotals, ProjectActivity } from '../src/types.js';

const bot = { login: 'claude[bot]', isBot: true };
const human = { login: 'ysta32', isBot: false };

function totals(over: Partial<DigestTotals> = {}): DigestTotals {
  return {
    projectsActive: 3,
    mergedPRs: 4,
    commits: 17,
    releases: 1,
    ciFailures: 1,
    openPRsNeedingAttention: 2,
    issuesOpened: 2,
    issuesClosed: 1,
    deployments: 5,
    deploymentsFailed: 1,
    starsDelta: 3,
    agentContributions: 9,
    ...over,
  };
}

function project(over: Partial<ProjectActivity> & Pick<ProjectActivity, 'id' | 'name'>): ProjectActivity {
  return {
    url: `https://github.com/${over.id}`,
    mergedPRs: [],
    openPRs: [],
    commits: [],
    releases: [],
    ciFailures: [],
    issues: [],
    deployments: [],
    health: 'green',
    summary: '',
    highlights: [],
    ...over,
  };
}

function makeDigest(id = '2026-10-07', over: Partial<Digest> = {}): Digest {
  return {
    schema: 'overnight.digest/v1',
    id,
    generatedAt: `${id}T06:00:00.000Z`,
    window: { since: `2026-10-06T06:00:00.000Z`, until: `${id}T06:00:00.000Z` },
    owner: 'ysta32',
    headline: 'Agents shipped a new Fleet release overnight; one production deploy on lumen failed.',
    summarizer: { kind: 'llm', model: 'claude-sonnet-4-5' },
    totals: totals(),
    projects: [
      project({
        id: 'ysta32/lumen',
        name: 'lumen',
        health: 'red',
        siteUrl: 'https://lumen.example.com',
        description: 'Photo journal with on-device search.',
        summary:
          'A search refactor landed, but the production deploy that followed it errored and CI is red on main.',
        highlights: ['Search index rebuilt with embeddings', 'Prod deploy failed after merge'],
        stats: { stars: 212, forks: 9, starsDelta: 3, forksDelta: 0, openIssues: 4 },
        mergedPRs: [
          {
            number: 88,
            title: 'Rebuild search index with embeddings',
            url: 'https://github.com/ysta32/lumen/pull/88',
            author: bot,
            at: '2026-10-07T02:14:00.000Z',
            additions: 412,
            deletions: 97,
            labels: [],
          },
        ],
        openPRs: [
          {
            number: 91,
            title: 'Bump sharp to 0.34',
            url: 'https://github.com/ysta32/lumen/pull/91',
            author: { login: 'dependabot[bot]', isBot: true },
            at: '2026-10-06T21:02:00.000Z',
            labels: ['deps'],
            attention: ['ci_failing', 'review_requested'],
          },
        ],
        commits: [
          {
            sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
            message: 'search: switch to embedding index',
            url: 'https://github.com/ysta32/lumen/commit/a1b2c3d',
            author: bot,
            at: '2026-10-07T02:10:00.000Z',
            branch: 'main',
          },
          {
            sha: 'b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
            message: 'fix: guard empty album',
            url: 'https://github.com/ysta32/lumen/commit/b1b2c3d',
            author: human,
            at: '2026-10-06T23:40:00.000Z',
            branch: 'main',
          },
        ],
        ciFailures: [
          {
            workflow: 'test',
            runId: 1,
            url: 'https://github.com/ysta32/lumen/actions/runs/1',
            branch: 'main',
            at: '2026-10-07T02:20:00.000Z',
            conclusion: 'failure',
            commitMessage: 'search: switch to embedding index',
          },
        ],
        deployments: [
          {
            id: 'dpl_1',
            project: 'lumen',
            url: 'https://lumen-abc.vercel.app',
            target: 'production',
            state: 'ERROR',
            at: '2026-10-07T02:25:00.000Z',
            commitMessage: 'search: switch to embedding index',
            branch: 'main',
          },
          {
            id: 'dpl_0',
            project: 'lumen',
            url: 'https://lumen-xyz.vercel.app',
            target: 'preview',
            state: 'READY',
            at: '2026-10-07T01:05:00.000Z',
            branch: 'feat/search',
          },
        ],
      }),
      project({
        id: 'ysta32/fleet',
        name: 'fleet',
        health: 'yellow',
        summary: 'Fleet 0.9 shipped with the digest package; one PR is waiting on review.',
        highlights: ['Released v0.9.0', 'Digest package merged'],
        stats: { stars: 1480, forks: 61, starsDelta: 0, forksDelta: 1, openIssues: 12 },
        releases: [
          {
            tag: 'v0.9.0',
            name: 'Overnight',
            url: 'https://github.com/ysta32/fleet/releases/tag/v0.9.0',
            at: '2026-10-07T04:00:00.000Z',
            prerelease: false,
          },
        ],
        mergedPRs: [
          {
            number: 301,
            title: 'Add digest package',
            url: 'https://github.com/ysta32/fleet/pull/301',
            author: bot,
            at: '2026-10-07T03:30:00.000Z',
            additions: 2300,
            deletions: 12,
            labels: [],
          },
        ],
        openPRs: [
          {
            number: 305,
            title: 'Daemon: serve latest.json',
            url: 'https://github.com/ysta32/fleet/pull/305',
            author: human,
            at: '2026-10-01T10:00:00.000Z',
            labels: [],
            attention: ['stale', 'approved_unmerged'],
          },
        ],
        issues: [
          {
            number: 77,
            title: 'Docs: explain agent detection',
            url: 'https://github.com/ysta32/fleet/issues/77',
            author: human,
            at: '2026-10-07T01:00:00.000Z',
            state: 'opened',
            labels: [],
          },
        ],
      }),
      project({ id: 'ysta32/dotfiles', name: 'dotfiles', health: 'quiet' }),
      project({ id: 'ysta32/notes', name: 'notes', health: 'quiet' }),
    ],
    warnings: ['ysta32/private-thing: 403 Resource not accessible by integration'],
    ...over,
  };
}

describe('renderDigestFragment', () => {
  it('has no document wrapper and only ovn- prefixed classes', () => {
    const html = renderDigestFragment(makeDigest());
    expect(html.startsWith('<div class="ovn-root">')).toBe(true);
    expect(html).not.toMatch(/<(html|head|body|script)[\s>]|<!doctype/i);
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => (m[1] ?? '').split(/\s+/));
    expect(classes.length).toBeGreaterThan(20);
    for (const c of classes) expect(c).toMatch(/^ovn-/);
  });

  it('puts Needs you before project cards, with red items first and attention pills', () => {
    const html = renderDigestFragment(makeDigest());
    const needs = html.indexOf('Needs you');
    const projects = html.indexOf('id="ovn-projects-h"');
    expect(needs).toBeGreaterThan(-1);
    expect(needs).toBeLessThan(projects);
    expect(html).toContain('Production deploy failed');
    expect(html).toContain('review requested');
    expect(html).toContain('approved, not merged');
    const firstRed = html.indexOf('ovn-need ovn-need-red');
    const firstYellow = html.indexOf('ovn-need ovn-need-yellow');
    expect(firstRed).toBeGreaterThan(-1);
    expect(firstRed).toBeLessThan(firstYellow);
  });

  it('collapses quiet projects into one line and marks agents with a pill', () => {
    const html = renderDigestFragment(makeDigest());
    expect(html).toMatch(/Quiet overnight \(2\):<\/span> <a[^>]*>dotfiles<\/a>.*>notes<\/a><\/p>/);
    expect(html).not.toContain('ovn-card ovn-card-quiet');
    expect(html).toContain('<span class="ovn-pill ovn-pill-agent">agent</span>');
    expect(html).toContain('<details class="ovn-details">');
  });

  it('renders absolute HH:MM in the requested timezone', () => {
    const d = makeDigest();
    const utc = renderDigestFragment(d);
    expect(utc).toContain('>02:14</time>');
    const ny = renderDigestFragment(d, { timezone: 'America/New_York' });
    // 02:14Z = 22:14 EDT on the previous calendar day, so the short date is prefixed
    expect(ny).toContain('>6 Oct 22:14</time>');
    // 04:00Z = 00:00 EDT on the digest day itself: bare HH:MM
    expect(ny).toContain('>00:00</time>');
    const bad = renderDigestFragment(d, { timezone: 'Not/AZone' });
    expect(bad).toContain('Unknown timezone');
  });
});

describe('escaping and URL safety', () => {
  const evil = '<script>alert(1)</script>';
  const d = makeDigest('2026-10-07', {
    headline: `Headline ${evil}`,
    owner: '"><img src=x onerror=alert(2)>',
    warnings: [evil],
    projects: [
      project({
        id: 'x/evil',
        name: evil,
        url: 'javascript:alert(1)',
        siteUrl: ' JaVaScRiPt:alert(1)',
        health: 'red',
        summary: `Summary ${evil}`,
        highlights: [`<b onmouseover=alert(3)>hi</b>`],
        mergedPRs: [
          {
            number: 1,
            title: `"><svg onload=alert(4)>`,
            url: 'java\tscript:alert(5)',
            author: { login: '<i>bot</i>', isBot: true },
            at: '2026-10-07T01:00:00.000Z',
            labels: [],
          },
        ],
        commits: [
          {
            sha: '<deadbeef>',
            message: `msg ${evil}`,
            url: 'data:text/html,<script>alert(6)</script>',
            author: human,
            at: '2026-10-07T01:00:00.000Z',
            branch: 'main',
          },
        ],
        deployments: [
          {
            id: 'd',
            project: 'evil',
            url: 'vbscript:msgbox(1)',
            target: 'production',
            state: 'ERROR',
            at: '2026-10-07T01:00:00.000Z',
            commitMessage: evil,
          },
        ],
      }),
    ],
  });

  it('escapes all user text', () => {
    const html = renderDigestHtml(d, { siteTitle: `Site ${evil}` });
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img|<svg|<b |<i>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(4)&gt;');
    expect(html).toContain('&lt;i&gt;bot&lt;/i&gt;');
  });

  it('neutralises non-http(s) urls to #', () => {
    const html = renderDigestHtml(d, {
      siteTitle: 'Overnight',
      nav: { prev: 'javascript:alert(7)', next: 'java\nscript:alert(8)', index: '../index.html' },
      baseHref: 'javascript:alert(9)',
    });
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/vbscript:|data:text/i);
    expect(html).not.toMatch(/href="\s*java/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
    for (const h of hrefs) expect(h === '#' || /^https?:\/\//.test(h) || /^\.\.?\//.test(h)).toBe(true);
    expect(hrefs.filter((h) => h === '#').length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('href="../index.html"');
  });
});

describe('untrusted digest JSON', () => {
  const payload = '"><img src=x onerror=1>';
  /** Replace every string and number leaf (including enums, ids, dates, totals, stats) with the payload. */
  function poison(x: unknown): unknown {
    if (typeof x === 'string' || typeof x === 'number') return payload;
    if (Array.isArray(x)) return x.map(poison);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, poison(v)]));
    }
    return x;
  }

  it('never emits markup from any string/number field', () => {
    const d = poison(makeDigest()) as Digest;
    const index = poison({
      schema: 'overnight.index/v1',
      owner: 'o',
      updatedAt: 'u',
      digests: [{ id: 'i', headline: 'h', window: { since: 's', until: 'u' }, totals: totals(), path: 'p' }],
    }) as DigestIndex;
    const outputs = [
      renderDigestFragment(d),
      renderDigestFragment(d, { timezone: payload }),
      renderDigestHtml(d, {
        siteTitle: payload,
        baseHref: payload,
        timezone: payload,
        nav: { prev: payload, next: payload, index: payload },
      }),
      renderIndexHtml(index, { siteTitle: payload, latest: d, timezone: payload }),
      renderIndexHtml(index, { siteTitle: payload }),
    ];
    for (const html of outputs) {
      expect(html).not.toContain('<img');
      // The payload may survive only as inert escaped text; no real tag may carry an onerror attribute.
      const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
      expect(tags.length).toBeGreaterThan(10);
      for (const tag of tags) {
        // well-formed tag: name followed only by name or name="value" attributes (no quote breakout)
        expect(tag).toMatch(/^<[a-z][a-z0-9]*(\s+[a-z-]+(="[^"<>]*")?)*\s*>$/i);
        const attrNames = [...tag.replace(/="[^"]*"/g, '').matchAll(/\s([a-z-]+)(?=\s|>)/gi)].map((m) =>
          (m[1] ?? '').toLowerCase(),
        );
        for (const name of attrNames) expect(name.startsWith('on')).toBe(false);
      }
      expect(html.replace(/&quot;&gt;&lt;img src=x onerror=1&gt;/g, '')).not.toContain('onerror=');
    }
    // unparseable dates render no clock time rather than a bogus one
    expect(outputs[0]).not.toMatch(/<time/);
    // poisoned health falls back to the quiet bucket instead of leaking into class attributes
    expect(outputs[0]).toContain('Quiet overnight');
    expect(outputs[0]).not.toContain('ovn-card ovn-card-');
  });

  it('does not render non-numeric diff sizes or unknown attention reasons', () => {
    const d = makeDigest();
    const lumen = d.projects[0]!;
    const pr = lumen.mergedPRs[0]!;
    (pr as unknown as Record<string, unknown>).additions = '<img src=x onerror=2>';
    (pr as unknown as Record<string, unknown>).deletions = Infinity;
    (lumen.openPRs[0] as unknown as Record<string, unknown>).attention = ['constructor', 'stale', '<b>'];
    const html = renderDigestFragment(d);
    expect(html).not.toContain('ovn-diff"><span class="ovn-add">+&lt;');
    expect(html).not.toMatch(/onerror|<b>|Infinity|undefined/);
    expect(html).toContain('<span class="ovn-pill ovn-pill-yellow">stale</span>');
  });
});

describe('DIGEST_CSS', () => {
  it('scopes every class selector under ovn- and defines light/dark variables on .ovn-root', () => {
    const classSelectors = [...DIGEST_CSS.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
    expect(classSelectors.length).toBeGreaterThan(30);
    for (const c of classSelectors) expect(c).toMatch(/^ovn-/);
    expect(DIGEST_CSS).toContain('prefers-color-scheme: dark');
    // every rule's selector list starts from .ovn-root
    const selectors = DIGEST_CSS.replace(/@media[^{]*\{/g, '')
      .split('}')
      .map((chunk) => chunk.split('{')[0]?.trim() ?? '')
      .filter((sel) => sel.length > 0);
    expect(selectors.length).toBeGreaterThan(30);
    for (const sel of selectors)
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.ovn-root\b/);
  });
});

describe('renderDigestHtml', () => {
  it('is a full page with inline CSS, Inter link and prev/next nav', () => {
    const html = renderDigestHtml(makeDigest(), {
      siteTitle: 'Overnight',
      nav: { prev: '2026-10-06.html', next: '2026-10-08.html', index: '../index.html' },
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('fonts.googleapis.com/css2?family=Inter');
    expect(html).toContain(DIGEST_CSS);
    expect(html).toContain('href="2026-10-06.html" rel="prev"');
    expect(html).toContain('href="2026-10-08.html" rel="next"');
    expect(html).toContain('Wednesday, 7 October 2026');
    expect(html).not.toMatch(/<script/i);
  });
});

describe('renderIndexHtml', () => {
  it('groups by month, newest first, links latest', () => {
    const entry = (id: string, headline: string) => ({
      id,
      headline,
      window: { since: `${id}T00:00:00.000Z`, until: `${id}T06:00:00.000Z` },
      totals: totals(),
      path: `digests/${id}.html`,
    });
    const index: DigestIndex = {
      schema: 'overnight.index/v1',
      owner: 'ysta32',
      updatedAt: '2026-10-07T06:00:00.000Z',
      digests: [
        entry('2026-09-30', 'Sept <b>end</b>'),
        entry('2026-10-02', 'Oct two'),
        entry('2026-10-01', 'Oct one'),
      ],
    };
    const html = renderIndexHtml(index, { siteTitle: 'Overnight', latest: makeDigest('2026-10-02') });
    const oct = html.indexOf('October 2026');
    const sep = html.indexOf('September 2026');
    expect(oct).toBeGreaterThan(-1);
    expect(sep).toBeGreaterThan(oct);
    expect(html.indexOf('Oct two')).toBeLessThan(html.indexOf('Oct one'));
    expect(html).toContain('Sept &lt;b&gt;end&lt;/b&gt;');
    expect(html).toMatch(/class="ovn-latest" href="digests\/2026-10-02\.html"/);
    expect(html).toContain('4 PRs · 17 commits · 1 release · 5 deploys');
  });
});

describe('writeArchive', () => {
  it('writes all files, upserts the index and links neighbours', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ovn-html-'));
    try {
      const p1 = await writeArchive(makeDigest('2026-10-06'), out, { siteTitle: 'Overnight' });
      expect(p1.sort()).toEqual(
        [
          'digests/2026-10-06.json',
          'digests/2026-10-06.html',
          'latest.json',
          'index.json',
          'index.html',
          'styles.css',
        ]
          .map((f) => join(out, f))
          .sort(),
      );

      const p2 = await writeArchive(makeDigest('2026-10-07'), out, { siteTitle: 'Overnight' });
      // older neighbour re-rendered so it gains a "next" link
      expect(p2).toContain(join(out, 'digests/2026-10-06.html'));

      // re-run of an existing day upserts rather than duplicating
      await writeArchive(makeDigest('2026-10-06', { headline: 'Updated headline' }), out, {
        siteTitle: 'Overnight',
      });

      const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8')) as DigestIndex;
      expect(index.schema).toBe('overnight.index/v1');
      expect(index.owner).toBe('ysta32');
      expect(index.digests.map((e) => e.id)).toEqual(['2026-10-07', '2026-10-06']);
      expect(index.digests[1]?.headline).toBe('Updated headline');
      expect(index.digests[1]?.path).toBe('digests/2026-10-06.html');

      // backfilling an older day must not regress latest.json
      const latest = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8')) as Digest;
      expect(latest.id).toBe('2026-10-07');

      const stored = JSON.parse(await readFile(join(out, 'digests/2026-10-06.json'), 'utf8')) as Digest;
      expect(stored.headline).toBe('Updated headline');
      expect(await readFile(join(out, 'digests/2026-10-06.json'), 'utf8')).toContain('\n  "schema"');

      const newer = await readFile(join(out, 'digests/2026-10-07.html'), 'utf8');
      expect(newer).toContain('href="2026-10-06.html" rel="prev"');
      expect(newer).not.toContain('rel="next"');
      expect(newer).toContain('href="../index.html"');
      const older = await readFile(join(out, 'digests/2026-10-06.html'), 'utf8');
      expect(older).toContain('href="2026-10-07.html" rel="next"');

      expect(await readFile(join(out, 'styles.css'), 'utf8')).toBe(DIGEST_CSS + '\n');
      const indexHtml = await readFile(join(out, 'index.html'), 'utf8');
      expect(indexHtml).toMatch(/class="ovn-latest" href="digests\/2026-10-07\.html"/);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('refuses unsafe ids and corrupt index files', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ovn-html-'));
    try {
      await expect(writeArchive(makeDigest('../../etc'), out, { siteTitle: 'O' })).rejects.toThrow(
        /invalid digest id/,
      );
      await writeFile(join(out, 'index.json'), '{not json');
      await expect(writeArchive(makeDigest(), out, { siteTitle: 'O' })).rejects.toThrow(/not valid JSON/);
      await writeFile(join(out, 'index.json'), JSON.stringify({ schema: 'other', digests: [] }));
      await expect(writeArchive(makeDigest(), out, { siteTitle: 'O' })).rejects.toThrow(
        /overnight\.index\/v1/,
      );
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
