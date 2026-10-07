import { describe, it, expect } from 'vitest';
import type { Digest } from '../src/types.js';
import { renderMarkdown, renderPlainText, renderEmailHtml } from '../src/render/text.js';

function digest(): Digest {
  return {
    schema: 'overnight.digest/v1',
    id: '2026-10-07',
    owner: 'example',
    generatedAt: '2026-10-07T06:00:00Z',
    window: { since: '2026-10-06T06:00:00Z', until: '2026-10-07T06:00:00Z' },
    headline: 'Two changes shipped.',
    summarizer: { kind: 'fallback' },
    totals: {
      projectsActive: 1,
      mergedPRs: 1,
      commits: 1,
      releases: 0,
      ciFailures: 0,
      openPRsNeedingAttention: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      deployments: 0,
      deploymentsFailed: 0,
      starsDelta: 0,
      agentContributions: 1,
    },
    projects: [
      {
        id: 'example/app',
        name: 'app',
        url: 'https://example.test/app',
        mergedPRs: [],
        openPRs: [],
        commits: [],
        releases: [],
        ciFailures: [],
        issues: [],
        deployments: [],
        health: 'green',
        summary: 'A faster app.',
        highlights: ['Reduced startup time.'],
      },
    ],
    warnings: ['One repository was unavailable.'],
  };
}

describe('text renderers', () => {
  it('renders the date, headline, totals, project health, summary, highlights, warnings and archive link', () => {
    const output = renderMarkdown(digest(), { siteUrl: 'https://example.test/archive/' });
    for (const text of [
      '# Overnight — 2026-10-07',
      'Two changes shipped.',
      '1 PRs merged',
      '## app — green',
      'A faster app.',
      '- Reduced startup time.',
      'One repository was unavailable.',
      'https://example.test/archive/digests/2026-10-07.html',
    ])
      expect(output).toContain(text);
  });

  it('omits the optional link and supports an empty digest', () => {
    const d = digest();
    d.projects = [];
    d.warnings = [];
    for (const output of [renderMarkdown(d), renderPlainText(d), renderEmailHtml(d)]) {
      expect(output).toContain(d.headline);
      expect(output).not.toContain('View full digest');
      expect(output).not.toContain('Warnings');
    }
  });

  it('renders plain text without adding Markdown headings or links', () => {
    const output = renderPlainText(digest());
    expect(output).toContain('app — green\nA faster app.\n• Reduced startup time.');
    expect(output).toContain('Warnings\n• One repository was unavailable.');
    expect(output).not.toContain('##');
    expect(output).not.toContain('<');
  });

  it.each([0, 1, 20, 3500])('bounds plain text to %i characters', (limit) => {
    const d = digest();
    d.headline = 'a'.repeat(6000);
    expect(renderPlainText(d, limit).length).toBeLessThanOrEqual(limit);
    if (limit) expect(renderPlainText(d, limit)).toMatch(/…$/);
  });

  it('uses a 3500 character default and avoids broken surrogate pairs at truncation', () => {
    const d = digest();
    d.headline = '🌅'.repeat(4000);
    const result = renderPlainText(d);
    expect(result.length).toBeLessThanOrEqual(3500);
    expect(result).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(renderPlainText(d, -1)).toBe('');
  });

  it('escapes HTML in all dynamic text and attributes', () => {
    const d = digest();
    d.headline = '<img src=x onerror="alert(1)"> & news';
    d.projects[0]!.name = '<script>bad()</script>';
    d.projects[0]!.summary = '<b>summary</b>';
    d.projects[0]!.highlights = ['<svg onload="bad()">'];
    d.warnings = ['<iframe>'];
    const html = renderEmailHtml(d, { siteUrl: 'https://example.test/a"b' });
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp; news');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;summary&lt;/b&gt;');
    expect(html).toContain('&lt;svg');
    expect(html).toContain('&lt;iframe&gt;');
    expect(html).not.toMatch(/<(img|script|svg|iframe)\b/);
    expect(html).toContain('style="');
    expect(html).not.toContain('<style');
    expect(html).toContain('/digests/2026-10-07.html');
  });

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'not a URL'])(
    'does not emit unsafe archive links: %s',
    (siteUrl) => {
      expect(renderEmailHtml(digest(), { siteUrl })).not.toContain('href=');
      expect(renderMarkdown(digest(), { siteUrl })).not.toContain('View full digest');
    },
  );

  it('escapes markup supplied as digest text in Markdown', () => {
    const d = digest();
    d.headline = '[click](javascript:bad) <script>';
    expect(renderMarkdown(d)).toContain('\\[click\\]\\(javascript:bad\\) \\<script\\>');
  });
});
