import { describe, it, expect } from 'vitest';
import type { Digest } from '../src/types.js';
import { renderMarkdown, renderPlainText, renderEmailHtml } from '../src/render/text.js';
import { syntheticDigest } from '../src/demo/synthetic.js';

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
    // The only <style> block is static CSS: no digest text may reach it.
    const styleBlocks = html.match(/<style>[\s\S]*?<\/style>/g) ?? [];
    expect(styleBlocks).toHaveLength(1);
    for (const needle of ['onerror', 'bad()', 'summary', 'iframe'])
      expect(styleBlocks[0]).not.toContain(needle);
    expect(html).toContain('/digests/2026-10-07.html');
  });

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'not a URL'])(
    'does not emit unsafe archive links: %s',
    (siteUrl) => {
      const html = renderEmailHtml(digest(), { siteUrl });
      expect(html).not.toContain('View full digest');
      expect(html).not.toContain('/digests/');
      expect(html).not.toMatch(/href="(?!https?:\/\/)/);
      expect(renderMarkdown(digest(), { siteUrl })).not.toContain('View full digest');
    },
  );

  it('escapes markup supplied as digest text in Markdown', () => {
    const d = digest();
    d.headline = '[click](javascript:bad) <script>';
    expect(renderMarkdown(d)).toContain('\\[click\\]\\(javascript:bad\\) \\<script\\>');
  });
});

function roughDigest(): Digest {
  const d = digest();
  const actor = { login: 'claude[bot]', isBot: true };
  d.projects[0]!.health = 'red';
  d.projects[0]!.ciFailures = [
    {
      workflow: 'ci <main>',
      runId: 9,
      url: 'https://example.test/runs/9',
      branch: 'main',
      at: '2026-10-07T03:00:00Z',
      conclusion: 'failure',
    },
    {
      workflow: 'lint',
      runId: 10,
      url: 'https://example.test/runs/10',
      branch: 'feature/x',
      at: '2026-10-07T04:00:00Z',
      conclusion: 'timed_out',
    },
  ];
  d.projects[0]!.openPRs = Array.from({ length: 6 }, (_, i) => ({
    number: 100 + i,
    title: `PR <b>${i}</b>`,
    url: i === 0 ? 'javascript:alert(1)' : `https://example.test/pull/${100 + i}`,
    author: actor,
    at: '2026-10-05T06:00:00Z',
    labels: [],
    attention: ['review_requested' as const],
  }));
  d.projects.push({
    ...d.projects[0]!,
    id: 'example/idle',
    name: 'idle<x>',
    health: 'quiet',
    ciFailures: [],
    openPRs: [],
  });
  d.owner = 'own<er>';
  return d;
}

describe('email layout', () => {
  it('puts the headline in a hidden preheader right after <body>', () => {
    const html = renderEmailHtml(digest());
    expect(html).toMatch(
      /<body[^>]*><div class="ovn-preheader" style="display:none[^"]*">Two changes shipped\./,
    );
  });

  it('uses a 600px bulletproof table shell and contains no scripts', () => {
    const html = renderEmailHtml(digest());
    expect(html).toContain('max-width:600px');
    expect(html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('hard-codes Halyard light values inline and ships a dark-mode style block', () => {
    const html = renderEmailHtml(digest());
    expect(html).toContain('background-color:#f3f0e8');
    expect(html).toContain('color:#181a16');
    expect(html).not.toContain('var(--');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toMatch(
      /@media \(prefers-color-scheme: dark\)\{[^}]*\.ovn-bg\{background-color:#0b0d0c !important\}/,
    );
    expect(html).toContain('[data-ogsc] .ovn-fg{color:#ece7da !important}');
    expect(html).toContain('[data-ogsb] .ovn-bg{background-color:#0b0d0c !important}');
    expect(html).toContain("Georgia,'Times New Roman',serif");
    expect(html).toContain('Menlo,Consolas');
    expect(html).toContain('<link href="https://fonts.googleapis.com/css2?');
  });

  it('escapes every user string in needs-you rows, quiet line and footer', () => {
    const html = renderEmailHtml(roughDigest(), { siteUrl: 'https://example.test' });
    expect(html).toContain('ci &lt;main&gt;');
    expect(html).toContain('PR &lt;b&gt;1&lt;/b&gt;');
    expect(html).toContain('idle&lt;x&gt;');
    expect(html).toContain('own&lt;er&gt;');
    expect(html).not.toMatch(/<(b|x|main|er)>/);
  });

  it('validates every link: unsafe item URLs render as text, safe ones as https hrefs', () => {
    const html = renderEmailHtml(roughDigest(), { siteUrl: 'https://example.test' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.test/runs/9"');
    expect(html).toContain('href="https://example.test/pull/101"');
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^https:\/\//);
    const d = digest();
    d.projects[0]!.url = 'data:text/html,bad';
    expect(renderEmailHtml(d)).not.toContain('data:text');
  });

  it('renders a rough night: danger rule, needs-you capped at 5 with +N more, reasons in words', () => {
    const html = renderEmailHtml(roughDigest(), { siteUrl: 'https://example.test' });
    expect(html).toContain('class="ovn-danger-bg"');
    expect(html).toContain('Needs you');
    expect(html).toContain('CI failed on main');
    expect(html).toContain('Review requested');
    expect(html).toContain('+3 more');
    expect(html).toMatch(/>CI timed out<\/p>[\s\S]*?app · feature\/x · 2h/);
    expect(html).toContain('■&nbsp;red');
    expect(html).toMatch(/No activity: <span[^>]*>idle&lt;x&gt;<\/span>\./);
    expect(html).toContain('View full digest');
  });

  it('renders a quiet night calmly with no needs-you section', () => {
    const d = digest();
    d.headline = 'A quiet night.';
    d.warnings = [];
    d.projects[0]!.health = 'quiet';
    d.totals = { ...d.totals, projectsActive: 0, mergedPRs: 0, commits: 0, agentContributions: 0 };
    const html = renderEmailHtml(d);
    expect(html).toContain('No merges, commits, releases or deploys in the window.');
    expect(html).toMatch(/No activity: <span[^>]*>app<\/span>\./);
    expect(html).not.toContain('The night in numbers');
    expect(html).not.toContain('Needs you');
    expect(html).not.toContain('class="ovn-danger-bg"');
    expect(html).not.toContain('Warnings');
  });

  it('labels the summarizer in the colophon', () => {
    expect(renderEmailHtml(digest())).toContain('summaries: deterministic');
    expect(renderEmailHtml(digest())).toContain('Plain summaries tonight: the model was unavailable.');
    const d = digest();
    d.summarizer = { kind: 'llm', model: 'claude-sonnet-5-5' };
    expect(renderEmailHtml(d)).toContain('summaries: model (claude-sonnet-5-5)');
    expect(renderEmailHtml(d)).not.toContain('Plain summaries');
  });

  it('shows the warnings notice and the agents vs you split', () => {
    const html = renderEmailHtml(digest());
    expect(html).toContain('One source was unavailable, so totals exclude it.');
    expect(html).toMatch(/Agents&nbsp;<b[^>]*>1<\/b>/);
    expect(html).toMatch(/You&nbsp;<b[^>]*>1<\/b>/);
  });

  it('stays under the 60 KB budget for a realistic digest', () => {
    const html = renderEmailHtml(syntheticDigest('2026-10-07'), { siteUrl: 'https://example.test' });
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(60_000);
  });
});

describe('markdown and plain text structure', () => {
  it('adds a dateline, health tally, needs-you links and a quiet line to Markdown', () => {
    const md = renderMarkdown(roughDigest());
    expect(md).toContain('Wednesday, 7 October 2026');
    expect(md).toContain('■ 1 red · ○ 1 quiet');
    expect(md).toContain('## Needs you');
    expect(md).toContain('[View run](<https://example.test/runs/9>)');
    expect(md).not.toContain('javascript:');
    expect(md).toContain('- +3 more');
    expect(md).toContain('**CI timed out on feature/x**');
    expect(md).toContain('**No activity:** idle\\<x\\>');
    expect(md).not.toContain('## idle');
    expect(md).toContain('*summaries: deterministic*');
  });

  it('lists needs-you rows and collapses quiet projects in plain text', () => {
    const text = renderPlainText(roughDigest());
    expect(text).toContain('Needs you\n• CI failed on main · app · ci <main>');
    expect(text).toContain('No activity: idle<x>');
    expect(text).not.toContain('idle<x> — quiet');
  });
});

describe('email palette drift', () => {
  it('hard-coded email colours match the synced Halyard tokens (light and dark)', async () => {
    const { HALYARD_TOKENS_CSS } = await import('../src/render/halyard.generated.js');
    const { EMAIL_LIGHT, EMAIL_DARK } = await import('../src/render/text.js');
    const block = (sel: RegExp) => {
      const m = sel.exec(HALYARD_TOKENS_CSS);
      if (!m) throw new Error(`no token block ${sel}`);
      const body = HALYARD_TOKENS_CSS.slice(m.index, HALYARD_TOKENS_CSS.indexOf('}', m.index));
      return (name: string) =>
        new RegExp(`--fl-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1]?.toLowerCase();
    };
    const dark = block(/:root\[data-theme='dark'\] \{/);
    const light = block(/:root\[data-theme='light'\] \{/);
    const map = {
      bg: 'bg',
      surface: 'surface-1',
      surface3: 'surface-3',
      fg: 'fg',
      muted: 'fg-muted',
      subtle: 'fg-subtle',
      accent: 'accent',
      danger: 'danger',
      warn: 'warn',
      success: 'success',
      agents: 'series-2',
    } as const;
    for (const [k, token] of Object.entries(map)) {
      expect([k, EMAIL_LIGHT[k as keyof typeof EMAIL_LIGHT]]).toEqual([k, light(token)]);
      expect([k, EMAIL_DARK[k as keyof typeof EMAIL_DARK]]).toEqual([k, dark(token)]);
    }
  });
});
