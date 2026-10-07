import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { SpendSummary } from '@fleet/shared';
import { burnTint, DEMO_SUMMARY, SpendSiteSection, SpendTab } from './index.js';
import { monthModel, niceTicks, money } from './format.js';
import { SPEND_CSS } from './styles.js';

const FABRICATED = [/9x/i, /\$29\b/, /\$750\b/, /testimonial/i, /\b\d[\d,]*\+? (users|developers|teams)\b/i];
const HYPE = [/supercharge/i, /unlock/i, /revolutioni[sz]e/i];

function noClaims(html: string) {
  for (const re of [...FABRICATED, ...HYPE]) expect(html).not.toMatch(re);
}

describe('SpendTab states', () => {
  it('renders the dashboard for a summary', () => {
    const html = renderToString(<SpendTab summary={DEMO_SUMMARY} />);
    expect(html).toContain('fls-root');
    expect(html).toContain('Where the money went');
    expect(html).toContain('Model mix');
    expect(html).toContain('Daily spend, last 31 days');
    expect(html).toContain('Claude Code');
    expect(html).toContain(money(DEMO_SUMMARY.todayUsd));
    expect(html).toContain('Estimated');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('experimental-model-x');
    expect(html).toContain('<svg');
    // savings cards carry $ figures
    expect(html).toContain('$38.20');
    noClaims(html);
  });

  it('shows the partial-sources badge and banner when a source is missing', () => {
    const html = renderToString(<SpendTab summary={DEMO_SUMMARY} />).replace(/<!-- -->/g, '');
    expect(html).toContain('Partial, 3 of 4 sources');
    expect(html).toMatch(/Cursor not connected/);
  });

  it('omits the partial badge when every source is ok', () => {
    const s: SpendSummary = {
      ...DEMO_SUMMARY,
      sources: DEMO_SUMMARY.sources.filter((x) => x.status === 'ok'),
    };
    expect(renderToString(<SpendTab summary={s} />)).not.toContain('Partial,');
  });

  it('handles no budget', () => {
    const s: SpendSummary = { ...DEMO_SUMMARY, budget: { monthlyUsd: null, warnAt: [0.5, 0.8] } };
    const html = renderToString(<SpendTab summary={s} />);
    expect(html).toContain('No budget');
    expect(html).not.toContain('class="fls-budget-line"');
  });

  it('renders a skeleton while loading (undefined)', () => {
    const html = renderToString(<SpendTab summary={undefined} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="fls-skel"');
    expect(html).toContain('Loading spend summary');
  });

  it('renders first-run onboarding for null, listing every source', () => {
    const html = renderToString(<SpendTab summary={null} />);
    expect(html).toContain('No sources found yet');
    for (const name of ['Claude Code', 'Codex', 'Cursor', 'GitHub Copilot', 'Anthropic API', 'OpenAI API'])
      expect(html).toContain(name);
    expect(html).toContain('npx fleet-spend');
    noClaims(html);
  });

  it('renders the error prop as an alert, with or without data', () => {
    const only = renderToString(<SpendTab summary={undefined} error="Permission denied." />);
    expect(only).toContain('role="alert"');
    expect(only).toContain('Permission denied.');
    expect(only).not.toContain('class="fls-skel"');
    const withData = renderToString(<SpendTab summary={DEMO_SUMMARY} error="Codex failed." />);
    expect(withData).toContain('role="alert"');
    expect(withData).toContain('Where the money went');
  });

  it('handles an empty summary without throwing', () => {
    const s: SpendSummary = {
      ...DEMO_SUMMARY,
      monthToDateUsd: 0,
      todayUsd: 0,
      forecastMonthEndUsd: 0,
      daily: [],
      tips: [],
      alerts: [],
      breakdown: { repo: [], branch: [], session: [], army: [], task: [], day: [], model: [], source: [] },
    };
    const html = renderToString(<SpendTab summary={s} />);
    expect(html).toContain('No daily usage');
    expect(html).toContain('No model usage');
  });
});

describe('SpendSiteSection', () => {
  it('states only the verified billing fact and labels example data', () => {
    const html = renderToString(<SpendSiteSection />);
    expect(html).toContain('GitHub Copilot moved to usage-based billing on June 1, 2026');
    expect(html).toContain('Example data');
    expect(html).toContain('npx fleet-spend');
    expect(html).toContain('Where the money went');
    noClaims(html);
  });
});

describe('styles and helpers', () => {
  it('scopes every rule under .fls-root and uses Halyard tokens', () => {
    expect(SPEND_CSS).toContain('var(--fl-accent');
    expect(SPEND_CSS).toContain('var(--fl-font-mono');
    expect(SPEND_CSS).toContain('prefers-reduced-motion');
    expect(SPEND_CSS).not.toMatch(/\b(Inter|Roboto|Arial|Space Grotesk)\b/);
    // no hex color outside var() fallbacks
    const stripped = SPEND_CSS.replace(/var\(--fl-[\w-]+,[^()]*(\([^()]*\)[^()]*)*\)/g, '');
    expect(stripped).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('style text is not HTML-escaped (child selectors survive SSR)', () => {
    const html = renderToString(<SpendTab summary={undefined} />);
    expect(html).toContain('.fls-meter>span');
  });

  it('monthModel ends at MTD and finds the budget crossing', () => {
    const m = monthModel(DEMO_SUMMARY);
    expect(m.month).toBe(10);
    expect(m.days).toBe(31);
    expect(m.today).toBe(18);
    expect(m.cumulative.at(-1)).toBe(DEMO_SUMMARY.monthToDateUsd);
    expect(m.lo).toBeLessThanOrEqual(m.forecast);
    expect(m.hi).toBeGreaterThanOrEqual(m.forecast);
    expect(m.crossDay).not.toBeNull();
    expect(m.crossDay!).toBeGreaterThan(18);
  });

  it('niceTicks covers the max', () => {
    const { max, ticks } = niceTicks(712);
    expect(max).toBeGreaterThanOrEqual(712);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(max);
  });

  it('burnTint thresholds', () => {
    expect([0, 1, 5, 10].map(burnTint)).toEqual(['idle', 'cool', 'warm', 'hot']);
  });

  it('demo is deterministic, path-free, and internally consistent', () => {
    expect(JSON.stringify(DEMO_SUMMARY)).not.toMatch(/\/Users\/|\/home\//);
    expect(DEMO_SUMMARY.daily).toHaveLength(31);
    const oct = DEMO_SUMMARY.daily.filter((d) => d.key.startsWith('2026-10-'));
    const sum = Math.round(oct.reduce((a, b) => a + b.costUsd, 0) * 100) / 100;
    expect(sum).toBe(DEMO_SUMMARY.monthToDateUsd);
  });
});
