import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIGEST_CSS,
  DIGEST_SCRIPT,
  renderDigestFragment,
  renderDigestHtml,
  renderIndexHtml,
  writeArchive,
} from '../src/render/html.js';
import { HALYARD_FONT_URL, HALYARD_TOKENS_CSS } from '../src/render/halyard.generated.js';
import type { Digest, DigestIndex, DigestTotals, ProjectActivity } from '../src/types.js';

/** Our own trusted inline SVGs (icons, health shapes, sparklines) — stripped before checking for injected <svg>. */
const stripOwnSvgs = (html: string) => html.replace(/<svg class="ovn-(icon|shape|spark)[^"]*"[^>]*>/g, '');

const bot = { login: 'claude[bot]', isBot: true };
const human = { login: 'acme-dev', isBot: false };

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
    owner: 'acme-dev',
    headline: 'Agents shipped a new Fleet release overnight; one production deploy on lumen failed.',
    summarizer: { kind: 'llm', model: 'claude-sonnet-4-5' },
    totals: totals(),
    projects: [
      project({
        id: 'acme-dev/lumen',
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
            url: 'https://github.com/acme-dev/lumen/pull/88',
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
            url: 'https://github.com/acme-dev/lumen/pull/91',
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
            url: 'https://github.com/acme-dev/lumen/commit/a1b2c3d',
            author: bot,
            at: '2026-10-07T02:10:00.000Z',
            branch: 'main',
          },
          {
            sha: 'b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
            message: 'fix: guard empty album',
            url: 'https://github.com/acme-dev/lumen/commit/b1b2c3d',
            author: human,
            at: '2026-10-06T23:40:00.000Z',
            branch: 'main',
          },
        ],
        ciFailures: [
          {
            workflow: 'test',
            runId: 1,
            url: 'https://github.com/acme-dev/lumen/actions/runs/1',
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
        id: 'acme-dev/fleet',
        name: 'fleet',
        health: 'yellow',
        summary: 'Fleet 0.9 shipped with the digest package; one PR is waiting on review.',
        highlights: ['Released v0.9.0', 'Digest package merged'],
        stats: { stars: 1480, forks: 61, starsDelta: 0, forksDelta: 1, openIssues: 12 },
        releases: [
          {
            tag: 'v0.9.0',
            name: 'Overnight',
            url: 'https://github.com/acme-dev/fleet/releases/tag/v0.9.0',
            at: '2026-10-07T04:00:00.000Z',
            prerelease: false,
          },
        ],
        mergedPRs: [
          {
            number: 301,
            title: 'Add digest package',
            url: 'https://github.com/acme-dev/fleet/pull/301',
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
            url: 'https://github.com/acme-dev/fleet/pull/305',
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
            url: 'https://github.com/acme-dev/fleet/issues/77',
            author: human,
            at: '2026-10-07T01:00:00.000Z',
            state: 'opened',
            labels: [],
          },
        ],
      }),
      project({ id: 'acme-dev/dotfiles', name: 'dotfiles', health: 'quiet' }),
      project({ id: 'acme-dev/notes', name: 'notes', health: 'quiet' }),
    ],
    warnings: ['acme-dev/private-thing: 403 Resource not accessible by integration'],
    ...over,
  };
}

describe('renderDigestFragment', () => {
  it('has no document wrapper and only ovn- prefixed classes', () => {
    const html = renderDigestFragment(makeDigest());
    expect(html.startsWith('<div class="ovn-root">')).toBe(true);
    expect(html).not.toMatch(/<(html|head|body|script|dialog|style|link)[\s>]|<!doctype/i);
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
    expect(html).toMatch(/No activity \(2\):<\/span> <a[^>]*>dotfiles<\/a>.*>notes<\/a><\/p>/);
    expect(html).not.toContain('ovn-proj ovn-proj-quiet');
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
    // exactly one script element, and it is our own constant keyboard script
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).toContain(`<script>${DIGEST_SCRIPT}</script>`);
    expect(html).not.toContain('<script>alert');
    expect(stripOwnSvgs(html)).not.toMatch(/<img|<svg|<b |<i>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(4)&gt;');
    expect(html).toContain('&lt;i&gt;bot&lt;/i&gt;');
  });

  it('treats backslash-prefixed nav links as protocol-relative, never as relative paths', () => {
    const html = renderDigestHtml(d, {
      siteTitle: 'Overnight',
      nav: { prev: '\\\\evil.example', next: '/\\evil.example', index: '\\/javascript:alert(1)' },
    });
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(hrefs.some((h) => h.includes('\\'))).toBe(false);
    expect(html).not.toMatch(/javascript:/i);
    for (const h of hrefs)
      expect(h === '#' || /^https?:\/\//.test(h) || /^\.\.?\/|^[\w-]+\.html$|^#/.test(h)).toBe(true);
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
    const poisonedHistory = [d, poison(makeDigest('2026-10-06')) as Digest, makeDigest('2026-10-05')];
    const outputs = [
      renderDigestFragment(d),
      renderDigestFragment(d, { history: poisonedHistory, edition: payload as unknown as number }),
      renderDigestFragment(makeDigest(), { history: poisonedHistory, edition: payload as unknown as number }),
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
    expect(outputs[0]).toContain('No activity');
    expect(outputs[0]).not.toContain('ovn-proj ovn-proj-');
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
  it('scopes every class selector under ovn- and maps Halyard tokens in one block', () => {
    const classSelectors = [...DIGEST_CSS.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
    expect(classSelectors.length).toBeGreaterThan(30);
    for (const c of classSelectors) expect(c).toMatch(/^ovn-/);
    // one mapping block: .ovn-root{--ovn-*: var(--fl-*)}; components below it use only --ovn-* vars
    const mapEnd = DIGEST_CSS.indexOf('}');
    const mapping = DIGEST_CSS.slice(0, mapEnd);
    const components = DIGEST_CSS.slice(mapEnd + 1);
    expect(mapping.startsWith('.ovn-root {')).toBe(true);
    expect(mapping).toContain('--ovn-bg: var(--fl-bg)');
    expect(mapping).toContain('--ovn-accent: var(--fl-accent)');
    expect(components).not.toContain('--fl-');
    expect(components).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const v of components.matchAll(/var\((--[\w-]+)/g)) expect(v[1]).toMatch(/^--ovn-/);
    // theme comes from Halyard; motion is opt-in and switched off for reduced motion
    expect(DIGEST_CSS).toContain('prefers-reduced-motion: reduce');
    expect(DIGEST_CSS).toContain('@media print');
    expect(DIGEST_CSS).not.toMatch(/@import|@font-face/);
    // every rule's selector list starts from .ovn-root
    const selectors = DIGEST_CSS.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
      .replace(/@(media|container)[^{]*\{/g, '')
      .split('}')
      .map((chunk) => chunk.split('{')[0]?.trim() ?? '')
      .filter((sel) => sel.length > 0);
    expect(selectors.length).toBeGreaterThan(30);
    for (const sel of selectors)
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.ovn-root\b/);
  });
});

describe('renderDigestHtml', () => {
  it('is a full page with Halyard tokens, font link, inline CSS, keyboard script and prev/next nav', () => {
    const html = renderDigestHtml(makeDigest(), {
      siteTitle: 'Overnight',
      nav: { prev: '2026-10-06.html', next: '2026-10-08.html', index: '../index.html' },
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('name="viewport"');
    expect(html).toContain(`<link rel="stylesheet" href="${HALYARD_FONT_URL.replace(/&/g, '&amp;')}">`);
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    expect(html).toContain(HALYARD_TOKENS_CSS);
    expect(html).toContain(DIGEST_CSS);
    expect(html.indexOf(HALYARD_TOKENS_CSS)).toBeLessThan(html.indexOf(DIGEST_CSS));
    expect(html).not.toMatch(/Inter|Roboto|Arial/);
    expect(html).toContain('href="2026-10-06.html" rel="prev"');
    expect(html).toContain('href="2026-10-08.html" rel="next"');
    expect(html).toContain('Wednesday, 7 October 2026');
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).toContain('<dialog class="ovn-keys" id="ovn-keys"');
  });
});

describe('states', () => {
  const quietAll = () =>
    makeDigest('2026-10-07', {
      headline: 'A quiet night.',
      totals: totals({
        projectsActive: 0,
        mergedPRs: 0,
        commits: 0,
        releases: 0,
        ciFailures: 0,
        deployments: 0,
      }),
      projects: [
        project({ id: 'acme-dev/a', name: 'alpha', health: 'quiet' }),
        project({ id: 'acme-dev/b', name: 'beta', health: 'quiet' }),
      ],
      warnings: [],
    });

  it('quiet night keeps the masthead, drops numbers and agents, and lists projects on one line', () => {
    const html = renderDigestHtml(quietAll(), { siteTitle: 'Overnight' });
    expect(html).toContain('class="ovn-mast"');
    expect(html).toContain('Wednesday,');
    expect(html).toContain('No activity in this window. Nothing needs you this morning.');
    expect(html).not.toContain('id="ovn-numbers-h"');
    expect(html).not.toContain('id="ovn-agents-h"');
    expect(html).not.toContain('id="ovn-needs-h"');
    expect(html).toMatch(/No activity \(2\):<\/span> <a[^>]*>alpha<\/a>/);
    expect(html).toContain('ovn-page-quiet');
    expect(html).not.toContain('class="ovn-tally"');
  });

  it('all-green omits Needs you with one understated line', () => {
    const d = makeDigest('2026-10-07', {
      projects: [
        project({
          id: 'acme-dev/a',
          name: 'alpha',
          health: 'green',
          commits: makeDigest().projects[0]!.commits,
        }),
      ],
      warnings: [],
    });
    const html = renderDigestFragment(d);
    expect(html).not.toContain('id="ovn-needs-h"');
    expect(html).toContain('Nothing needs you this morning. Everything that ran, passed.');
    expect(html).toContain('ovn-page-green');
  });

  it('rough night caps Needs you at 5 and puts the rest behind +N more', () => {
    const base = makeDigest();
    const ci = base.projects[0]!.ciFailures[0]!;
    const reds = [0, 1, 2].map((i) =>
      project({
        id: `acme-dev/r${i}`,
        name: `red${i}`,
        health: 'red',
        ciFailures: [ci, { ...ci, runId: 2 + i }, { ...ci, runId: 9 + i }],
      }),
    );
    const html = renderDigestFragment(makeDigest('2026-10-07', { projects: reds, warnings: [] }));
    expect(html).toContain('ovn-page-rough');
    expect(html).toContain('ovn-lead ovn-lead-rough');
    // one red project is not a rough night, however long its list
    expect(renderDigestFragment(makeDigest('2026-10-07', { projects: [reds[0]!] }))).not.toContain('rough');
    const needsSection = html.slice(html.indexOf('id="ovn-needs-h"'), html.indexOf('id="ovn-projects-h"'));
    const [top, more] = needsSection.split('<details class="ovn-more">');
    expect(top?.match(/<li class="ovn-need /g)).toHaveLength(5);
    expect(more).toContain('+4 more');
    expect(more?.match(/<li class="ovn-need /g)).toHaveLength(4);
  });

  it('llm fallback shows a small deterministic note', () => {
    const html = renderDigestFragment(makeDigest('2026-10-07', { summarizer: { kind: 'fallback' } }));
    expect(html).toContain('summaries: deterministic');
    expect(html).not.toContain('Summarized by');
  });

  it('partial warnings render a collapsible warn notice and tag the affected project', () => {
    const html = renderDigestFragment(
      makeDigest('2026-10-07', { warnings: ['acme-dev/lumen: 403 forbidden', 'vercel: timeout'] }),
    );
    expect(html).toMatch(/<details class="ovn-notice">.*2 sources were unavailable or degraded/);
    expect(html).toContain('<li>acme-dev/lumen: 403 forbidden</li>');
    expect(html).toContain('<span class="ovn-pill ovn-pill-yellow">partial data</span>');
    expect(html.match(/partial data/g)).toHaveLength(1);
  });

  it('first edition says so; later editions do not', () => {
    expect(renderDigestFragment(makeDigest(), { edition: 1 })).toContain('This is the first edition.');
    const later = renderDigestFragment(makeDigest(), { edition: 12 });
    expect(later).not.toContain('first edition');
    expect(later).toContain('No. 012');
  });

  it('health is always shape + word, never colour alone', () => {
    const html = renderDigestFragment(makeDigest());
    expect(html).toMatch(
      /<span class="ovn-health ovn-health-red"><svg class="ovn-shape ovn-shape-red"[^>]*><rect/,
    );
    expect(html).toContain('<span class="ovn-health-word">Failing</span>');
    expect(html).toContain('<span class="ovn-health-word">Watch</span>');
    expect(html).toMatch(/<ul class="ovn-tally" aria-label="Project health">/);
  });

  it('splits agent vs human contributions', () => {
    const html = renderDigestFragment(makeDigest());
    // lumen: PR #88 + 1 commit by bot, 1 commit by human; fleet: PR #301 by bot
    expect(html).toContain('aria-label="Agents 3, you 1"');
    expect(html).toContain('Agents made 3 of 4 changes, 75% of the night’s work.');
    expect(html).toMatch(/<li class="ovn-agent-login"><span class="ovn-author">claude\[bot\]<\/span>/);
  });
});

describe('sparklines', () => {
  it('draws 14-night trends from history, marking red nights and missing days', () => {
    const history = ['2026-10-04', '2026-10-05', '2026-10-06'].map((id) => makeDigest(id));
    // a future and an out-of-window digest must be ignored
    history.push(makeDigest('2026-10-09'), makeDigest('2026-09-01'));
    const html = renderDigestFragment(makeDigest(), { history });
    const overall = /<svg class="ovn-spark ovn-spark-overall"[^>]*aria-label="([^"]*)"/.exec(html);
    expect(overall?.[1]).toBe('4 of 14 nights: 4 active, 4 red, last red tonight');
    const lumen = /<svg class="ovn-spark ovn-spark-project"[^>]*aria-label="([^"]*)"/.exec(html);
    expect(lumen?.[1]).toBe('4 of 14 nights: 4 active, 4 red, last red tonight');
    expect(html.match(/class="ovn-spark-red"/g)?.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('class="ovn-spark-gap"');
    expect(html).toMatch(/<path class="ovn-spark-line" d="M[\d. L]+"><\/path>/);
  });

  it('shows a single point and "1 of 14 nights" without history', () => {
    const html = renderDigestFragment(makeDigest());
    expect(html).toContain('aria-label="1 of 14 nights: 1 active, 1 red, last red tonight"');
    expect(html).not.toContain('class="ovn-spark-line"');
  });
});

describe('keyboard script', () => {
  it('is small, dependency-free, inert-safe and handles j/k, arrows, g i and ?', () => {
    expect(Buffer.byteLength(DIGEST_SCRIPT, 'utf8')).toBeLessThan(2048);
    // can never close its own element or open a tag
    expect(DIGEST_SCRIPT).not.toContain('<');
    expect(DIGEST_SCRIPT).not.toMatch(/import|fetch|eval|innerHTML|localStorage/);
    for (const k of ["k=='j'", "'ArrowLeft'", "'ArrowRight'", "k=='g'", "k=='i'", "k=='?'", 'showModal'])
      expect(DIGEST_SCRIPT).toContain(k);
    expect(DIGEST_SCRIPT).toContain('prefers-reduced-motion: reduce');
  });

  it('j/k skip rows hidden inside a closed <details> (e.g. "+N more") and reach the projects', () => {
    type Row = { id: string; visible: boolean; tabIndex: number; focus: () => void };
    let active: Row | null = null;
    const mk = (id: string, visible: boolean): Row => {
      const r: Row = {
        id,
        visible,
        tabIndex: -1,
        focus: () => {
          active = r;
        },
      };
      return r;
    };
    const rows = [mk('need1', true), mk('need6-hidden', false), mk('need7-hidden', false), mk('proj1', true)];
    const dom = (r: Row) =>
      Object.assign(r, {
        getClientRects: () => (r.visible ? [{}] : []),
        closest: () => r,
        hasAttribute: () => true,
        scrollIntoView: () => undefined,
      });
    rows.forEach(dom);
    let onKey: ((e: unknown) => void) | undefined;
    const root = { setAttribute: () => undefined, querySelectorAll: () => rows, querySelector: () => null };
    const doc = {
      querySelector: () => root,
      getElementById: () => null,
      addEventListener: (_t: string, f: (e: unknown) => void) => {
        onKey = f;
      },
      get activeElement() {
        return active;
      },
    };
    const run = new Function(
      'document',
      'matchMedia',
      'location',
      'addEventListener',
      'setTimeout',
      DIGEST_SCRIPT,
    );
    run(
      doc,
      () => ({ matches: true }),
      {},
      () => undefined,
      setTimeout,
    );
    const press = (key: string) =>
      onKey?.({ key, target: { tagName: 'BODY' }, preventDefault: () => undefined, defaultPrevented: false });
    press('j');
    expect((active as Row | null)?.id).toBe('need1');
    press('j');
    expect((active as Row | null)?.id).toBe('proj1');
    press('k');
    expect((active as Row | null)?.id).toBe('need1');
  });

  it('is only on full pages; the fragment stays script-free with ovn- classes only', () => {
    expect(
      renderIndexHtml(
        { schema: 'overnight.index/v1', owner: 'o', updatedAt: '', digests: [] },
        { siteTitle: 'O' },
      ),
    ).toContain(`<script>${DIGEST_SCRIPT}</script>`);
    const frag = renderDigestFragment(makeDigest(), { history: [makeDigest('2026-10-06')], edition: 2 });
    expect(frag).not.toMatch(/<script|<dialog|ovn-hints/);
    const classes = [...frag.matchAll(/class="([^"]*)"/g)].flatMap((m) => (m[1] ?? '').split(/\s+/));
    for (const c of classes) expect(c).toMatch(/^ovn-/);
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
      owner: 'acme-dev',
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

  it('counts issue-only nights as activity in row marks and the trend', () => {
    const zero = totals({
      projectsActive: 1,
      mergedPRs: 0,
      commits: 0,
      releases: 0,
      ciFailures: 0,
      openPRsNeedingAttention: 0,
      deployments: 0,
      deploymentsFailed: 0,
      starsDelta: 0,
      agentContributions: 0,
      issuesOpened: 2,
      issuesClosed: 1,
    });
    const index: DigestIndex = {
      schema: 'overnight.index/v1',
      owner: 'acme-dev',
      updatedAt: '2026-10-07T06:00:00.000Z',
      digests: [
        {
          id: '2026-10-07',
          headline: 'Two issues opened, one closed.',
          window: { since: '2026-10-06T06:00:00.000Z', until: '2026-10-07T06:00:00.000Z' },
          totals: zero,
          path: 'digests/2026-10-07.html',
        },
      ],
    };
    const html = renderIndexHtml(index, { siteTitle: 'Overnight' });
    expect(html).not.toContain('aria-label="No activity"');
    expect(html).toContain('aria-label="Activity, no failures"');
    expect(html).toContain('aria-label="1 of 14 nights: 1 active, none red"');
  });

  it('first run shows the single edition and what to expect', () => {
    const index: DigestIndex = {
      schema: 'overnight.index/v1',
      owner: 'acme-dev',
      updatedAt: '2026-10-07T06:00:00.000Z',
      digests: [
        {
          id: '2026-10-07',
          headline: 'First',
          window: { since: '2026-10-06T06:00:00.000Z', until: '2026-10-07T06:00:00.000Z' },
          totals: totals(),
          path: 'digests/2026-10-07.html',
        },
      ],
    };
    const html = renderIndexHtml(index, { siteTitle: 'Overnight' });
    expect(html.match(/class="ovn-archive-item"/g)).toHaveLength(1);
    expect(html).toContain('Earlier editions will appear here.');
    expect(html).toContain('aria-label="Failures overnight"');
    const empty = renderIndexHtml({ ...index, digests: [] }, { siteTitle: 'Overnight' });
    expect(empty).toContain('No editions yet.');
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
      expect(index.owner).toBe('acme-dev');
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
      // history from <out>/digests feeds the trend; edition counts stored digests up to the page
      expect(newer).toContain('No. 002');
      expect(newer).toMatch(/aria-label="2 of 14 nights: [^"]*"/);
      expect(older).toContain('No. 001');
      expect(older).toMatch(/aria-label="1 of 14 nights: [^"]*"/);
      const indexHtml = await readFile(join(out, 'index.html'), 'utf8');
      expect(indexHtml).toMatch(/class="ovn-latest" href="digests\/2026-10-07\.html"/);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('skips corrupt historical digests with a warning and still publishes today, latest and index', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ovn-html-'));
    try {
      const quietWarn = () => undefined;
      for (const id of ['2026-10-04', '2026-10-05', '2026-10-06'])
        await writeArchive(makeDigest(id), out, { siteTitle: 'Overnight', warn: quietWarn });
      await writeFile(join(out, 'digests/2026-10-04.json'), JSON.stringify({ schema: 'other' }));
      await writeFile(join(out, 'digests/2026-10-06.json'), '{not json');
      // outside the 14-night window: must never be read
      await writeFile(join(out, 'digests/2026-09-01.json'), '{not json');
      const warnings: string[] = [];
      const written = await writeArchive(makeDigest('2026-10-07'), out, {
        siteTitle: 'Overnight',
        warn: (m) => warnings.push(m),
      });
      expect(written).toContain(join(out, 'latest.json'));
      expect(written).toContain(join(out, 'index.html'));
      expect(written).not.toContain(join(out, 'digests/2026-10-06.html'));
      const latest = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8')) as Digest;
      expect(latest.id).toBe('2026-10-07');
      expect(warnings.some((w) => w.includes('2026-10-04.json') && w.includes('not a valid digest'))).toBe(
        true,
      );
      expect(warnings.some((w) => w.includes('2026-10-06.json') && w.includes('could not be read'))).toBe(
        true,
      );
      expect(warnings.join('\n')).not.toContain('2026-09-01');
      // trend uses the valid 2026-10-05 plus today only
      const page = await readFile(join(out, 'digests/2026-10-07.html'), 'utf8');
      expect(page).toMatch(/class="ovn-spark ovn-spark-overall"[^>]*aria-label="2 of 14 nights/);
      // the index itself stays strictly validated
      await writeFile(join(out, 'index.json'), '{not json');
      await expect(
        writeArchive(makeDigest('2026-10-08'), out, { siteTitle: 'O', warn: quietWarn }),
      ).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('skips a stored neighbour that passes the schema tag but lacks window/totals (regression)', async () => {
    const out = await mkdtemp(join(tmpdir(), 'ovn-html-'));
    try {
      const quietWarn = () => undefined;
      await writeArchive(makeDigest('2026-10-06'), out, { siteTitle: 'Overnight', warn: quietWarn });
      const before = await readFile(join(out, 'digests/2026-10-06.html'), 'utf8');
      const broken = { ...makeDigest('2026-10-06') } as Partial<Digest>;
      delete broken.window;
      await writeFile(join(out, 'digests/2026-10-06.json'), JSON.stringify(broken));
      const warnings: string[] = [];
      const written = await writeArchive(makeDigest('2026-10-07'), out, {
        siteTitle: 'Overnight',
        warn: (m) => warnings.push(m),
      });
      expect(written).toContain(join(out, 'latest.json'));
      expect(written).toContain(join(out, 'index.json'));
      expect(written).toContain(join(out, 'index.html'));
      expect(written).not.toContain(join(out, 'digests/2026-10-06.html'));
      expect(await readFile(join(out, 'digests/2026-10-06.html'), 'utf8')).toBe(before);
      expect(warnings.some((w) => w.includes('2026-10-06.json') && w.includes('not a valid digest'))).toBe(
        true,
      );
      // other shape faults are rejected the same way
      for (const bad of [
        { ...makeDigest('2026-10-06'), totals: null },
        { ...makeDigest('2026-10-06'), totals: { commits: 'many' } },
        { ...makeDigest('2026-10-06'), headline: 7 },
        { ...makeDigest('2026-10-06'), window: { since: 1, until: 2 } },
        { ...makeDigest('2026-10-06'), projects: [null] },
      ]) {
        await writeFile(join(out, 'digests/2026-10-06.json'), JSON.stringify(bad));
        await expect(
          writeArchive(makeDigest('2026-10-07'), out, { siteTitle: 'Overnight', warn: quietWarn }),
        ).resolves.toContain(join(out, 'latest.json'));
      }
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
