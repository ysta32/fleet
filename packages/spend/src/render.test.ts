import { describe, expect, it } from 'vitest';
import type { SpendSummary } from './contracts.js';
import type { SpendBucket } from '@fleet/shared';
import {
  renderBudget,
  renderSummary,
  renderTips,
  renderTsv,
  renderWhere,
  type RenderOpts,
} from './render.js';

const now = new Date(2026, 9, 7, 12).getTime();
const opts: RenderOpts = { width: 80, color: false, unicode: true, now };
function bucket(key: string, costUsd: number): SpendBucket {
  return {
    key,
    costUsd,
    records: 12,
    tokens: { input: 12_000_000, output: 300_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  };
}
function summary(): SpendSummary {
  return {
    generatedAt: now,
    priceTableVersion: '2026-10-01',
    monthStart: new Date(2026, 9, 1).getTime(),
    monthToDateUsd: 212.4,
    todayUsd: 32.4,
    forecastMonthEndUsd: 268,
    burnUsdPerHour: 5.25,
    budget: { monthlyUsd: 180, warnAt: [0.5, 0.8] },
    breakdown: {
      repo: [bucket('acme/web', 148.1), bucket('acme/api', 64.3)],
      model: [bucket('claude-opus', 129.8), bucket('gpt-5-codex', 82.6)],
      branch: [],
      session: [],
      army: [],
      task: [],
      day: [],
      source: [],
    },
    daily: Array.from({ length: 7 }, (_, i) =>
      bucket(`2026-10-0${i + 1}`, [12, 24, 18, 61.2, 31.4, 33.4, 32.4][i]!),
    ),
    tips: [
      {
        id: 'switch',
        title: 'Use Sonnet for short edits',
        detail: 'Assumes the same tokens for 31 sessions.',
        estMonthlySavingsUsd: 38.2,
      },
      {
        id: 'cache',
        title: 'Reuse cached context',
        detail: 'Based on repeated input tokens.',
        estMonthlySavingsUsd: 17,
      },
      {
        id: 'batch',
        title: 'Batch small requests',
        detail: 'Assumes fewer repeated inputs.',
        estMonthlySavingsUsd: 8.8,
      },
    ],
    alerts: [],
    sources: [
      { source: 'claude-code', records: 24, status: 'ok' },
      { source: 'codex', records: 12, status: 'ok' },
      { source: 'cursor', records: 0, status: 'missing' },
    ],
    unpricedModels: [],
  };
}
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const renderers = [
  renderSummary,
  renderTips,
  renderBudget,
  (s: SpendSummary, o: RenderOpts) => renderWhere(s, 'repo', 10, o),
];

describe('terminal rendering', () => {
  it.each([40, 80, 120])('respects %i columns, with and without color', (width) => {
    const s = summary();
    s.breakdown.repo.push(bucket('a/very/long/repository/name/'.repeat(8), 1234.56));
    s.tips[0]!.detail = 'Long explanation '.repeat(30);
    for (const color of [true, false])
      for (const render of renderers) {
        const result = render(s, { ...opts, width, color });
        for (const line of stripAnsi(result).split('\n'))
          expect(Array.from(line).length).toBeLessThanOrEqual(width);
        if (!color) expect(result).not.toContain('\x1b');
        else expect(result).toContain('\x1b[38;2;');
      }
  });

  it('renders key labels, pricing date, textual tint and honest source status', () => {
    const result = renderSummary(summary(), opts);
    for (const label of [
      'Fleet Spend · October 2026 · prices 2026-10-01',
      'Month to date',
      'Today',
      'Forecast',
      'Budget left',
      'Burn $/h',
      '(warm)',
      'over by $32.40',
      'Last 31 days',
      'By repo',
      'By model',
      'Top savings',
      '$38.20/mo',
      '✓ Claude Code',
      '✗ Cursor (missing)',
      'Partial:',
    ])
      expect(result).toContain(label);
    expect(result.match(/Last 31 days\s+([▁▂▃▄▅▆▇█]+)/)?.[1]).toHaveLength(31);
    expect(result).toContain('| forecast marker');
  });

  it('uses ASCII fallback for every renderer, including user labels', () => {
    const s = summary();
    s.breakdown.repo[0]!.key = '組織/🚢';
    s.tips[0]!.title = 'Réduire → coût';
    for (const render of renderers)
      expect(render(s, { ...opts, unicode: false })).toMatch(/^[\x20-\x7e\n]*$/);
    const result = renderSummary(s, { ...opts, unicode: false });
    expect(result).toContain('ok Claude Code');
    expect(result).toContain('missing Cursor');
    expect(result).toContain('#');
  });

  it('drops bars and trends below 60 and tokens below 100 columns', () => {
    const small = renderSummary(summary(), { ...opts, width: 40 });
    expect(small).not.toMatch(/[█░▁▂▃▄▅▆▇]/);
    expect(small).not.toContain('Last 31 days');
    expect(renderWhere(summary(), 'model', 3, opts)).not.toContain('12.3M');
    expect(renderWhere(summary(), 'model', 3, { ...opts, width: 120 })).toContain('12.3M');
    const s = summary();
    s.breakdown.model[0]!.tokens = {
      input: 845_000,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    };
    expect(renderWhere(s, 'model', 3, { ...opts, width: 120 })).toContain('845K');
  });

  it('ranks rows and tips by cost, limits results, and preserves inputs', () => {
    const s = summary();
    s.breakdown.repo.reverse();
    s.tips.push({
      id: 'largest',
      title: 'Largest saving',
      detail: 'Synthetic assumption',
      estMonthlySavingsUsd: 100,
    });
    const before = structuredClone(s);
    const result = renderWhere(s, 'repo', 1, opts);
    expect(result).toContain('acme/web');
    expect(result).not.toContain('acme/api');
    const tips = renderTips(s, opts);
    expect(tips.indexOf('Largest saving')).toBeLessThan(tips.indexOf('Use Sonnet'));
    expect(tips).not.toContain('Batch small requests');
    expect(tips).toContain('Synthetic assumption');
    expect(s).toEqual(before);
    expect(renderSummary(s, opts)).toBe(renderSummary(s, opts));
  });

  it('formats tiny costs and thousands and aligns money in ranked rows', () => {
    const s = summary();
    s.breakdown.repo = [bucket('large', 1234.56), bucket('tiny', 0.001), bucket('zero', 0)];
    const result = renderWhere(s, 'repo', 3, opts);
    expect(result).toContain('$1,234.56');
    expect(result).toContain('<$0.01');
    expect(result).toContain('$0.00');
    const rows = result.split('\n').filter((line) => /^(large|tiny|zero)/.test(line));
    expect(new Set(rows.map((row) => row.indexOf('%'))).size).toBe(1);
  });

  it('handles unset, zero, under-budget and forecast-over budgets without invalid numbers', () => {
    const s = summary();
    s.budget.monthlyUsd = null;
    expect(renderBudget(s, opts)).toContain('fleet-spend budget set <usd>');
    s.budget.monthlyUsd = 0;
    expect(renderBudget(s, opts)).toContain('over by $212.40');
    expect(renderBudget(s, opts)).not.toMatch(/NaN|Infinity/);
    s.budget.monthlyUsd = 250;
    expect(renderBudget(s, opts)).toContain('forecast over budget');
    s.budget.monthlyUsd = 1000;
    expect(renderBudget(s, opts)).toContain('$787.60');
    expect(renderBudget(s, opts)).not.toContain('over budget');
  });

  it('shows setup instructions for all six sources when no records exist', () => {
    const s = summary();
    s.sources = [];
    for (const key of Object.keys(s.breakdown) as (keyof SpendSummary['breakdown'])[]) s.breakdown[key] = [];
    s.daily = [];
    s.monthToDateUsd = 0;
    for (const render of renderers) {
      const result = render(s, opts);
      for (const text of [
        'No usage yet',
        'Claude Code:',
        'Codex:',
        'Cursor:',
        'Copilot:',
        'Anthropic API:',
        'OpenAI API:',
        'paths.cursorExportPath',
        'paths.copilotExportPath',
        'apiIngest',
      ])
        expect(result).toContain(text);
      for (const width of [40, 80, 120]) {
        const compact = render(s, { ...opts, width, unicode: false });
        expect(compact).toMatch(/^[\x20-\x7e\n]*$/);
        for (const line of compact.split('\n')) expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('does not treat unpriced records as empty and reports unpriced models', () => {
    const s = summary();
    s.monthToDateUsd = 0;
    s.unpricedModels = ['unknown-model'];
    const result = renderSummary(s, opts);
    expect(result).not.toContain('No usage yet');
    expect(result).toContain('Unpriced models (counted as $0.00): unknown-model');
  });

  it('removes terminal controls from labels and keeps wide characters within cells', () => {
    const s = summary();
    s.breakdown.repo = [bucket('\x1b[31m組織/'.repeat(50), 12)];
    const result = renderWhere(s, 'repo', 1, { ...opts, width: 40 });
    expect(result).not.toContain('\x1b');
    for (const line of result.split('\n'))
      expect(
        Array.from(line).reduce((sum, char) => sum + (/[組織]/.test(char) ? 2 : 1), 0),
      ).toBeLessThanOrEqual(40);
  });

  it('produces stable TSV and neutralizes embedded delimiters and ANSI', () => {
    expect(
      renderTsv([
        ['repo', 'cost'],
        ['acme/web', '$12.34'],
      ]),
    ).toBe('repo\tcost\nacme/web\t$12.34');
    expect(renderTsv([['a\tb\nc\rd', '\x1b[31mred\x1b[0m']])).toBe('a b c d\tred');
    expect(renderTsv([])).toBe('');
  });
});
