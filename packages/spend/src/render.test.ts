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
      'Budget',
      'Burn',
      '/h  warm',
      'over $32.40',
      '31-day',
      'By repo',
      'By model',
      'Top savings',
      '$38.20/mo',
      '✓ Claude Code',
      '✗ Cursor (missing)',
      'Partial:',
    ])
      expect(result).toContain(label);
    expect(result.match(/31-day\s+([▁▂▃▄▅▆▇█]+)/)?.[1]).toHaveLength(31);
    expect(result).toContain('▼ forecast $268.00');
    expect(result).toContain('peak $61.20 Oct 4 · avg $6.85/day');
  });

  it('uses ASCII fallback for every renderer, including user labels', () => {
    const s = summary();
    s.breakdown.repo[0]!.key = '組織/🚢';
    s.tips[0]!.title = 'Réduire → coût';
    for (const render of renderers)
      expect(render(s, { ...opts, unicode: false })).toMatch(/^[\x20-\x7e\n]*$/);
    const result = renderSummary(s, { ...opts, unicode: false });
    expect(result).toContain('ok Claude Code');
    expect(result).toContain('x Cursor (missing)');
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
    const rows = result.split('\n').filter((line) => /^  (large|tiny|zero)/.test(line));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.indexOf('%'))).size).toBe(1);
  });

  it('handles unset, zero, under-budget and forecast-over budgets without invalid numbers', () => {
    const s = summary();
    s.budget.monthlyUsd = null;
    expect(renderBudget(s, opts)).toContain('fleet-spend budget set <usd>');
    s.budget.monthlyUsd = 0;
    expect(renderBudget(s, opts)).toContain('over $212.40');
    expect(renderBudget(s, opts)).not.toMatch(/NaN|Infinity/);
    s.budget.monthlyUsd = 250;
    expect(renderBudget(s, opts)).toContain('forecast over');
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

  it.each([true, false])(
    'marks the budget and forecast and distinguishes overspend (unicode=%s)',
    (unicode) => {
      const s = summary();
      const result = renderBudget(s, { ...opts, unicode });
      const track = result.split('\n').find((line) => line.trimStart().startsWith('['))!;
      expect(track).toContain(unicode ? '┊' : ':');
      expect(track).toContain(unicode ? '▼' : 'v');
      expect(track).toContain(unicode ? '▓' : '!');
      expect(track.indexOf(unicode ? '▓' : '!')).toBeGreaterThan(track.indexOf(unicode ? '┊' : ':'));
      const colored = renderBudget(s, { ...opts, unicode, color: true });
      expect(colored).toMatch(unicode ? /\x1b\[38;2;255;89;100m▓/ : /\x1b\[38;2;255;89;100m!/);
      s.budget.monthlyUsd = 1000;
      const under = renderBudget(s, { ...opts, unicode });
      expect(under.split('\n').find((line) => line.trimStart().startsWith('['))).not.toContain(
        unicode ? '▓' : '!',
      );
    },
  );

  it.each([true, false])('fills exactly 0, 20 or 40 budget cells (unicode=%s)', (unicode) => {
    const s = summary();
    s.budget.monthlyUsd = 1000;
    s.forecastMonthEndUsd = 1000;
    const spent = unicode ? '█' : '#';
    const empty = unicode ? '░' : '.';
    const tick = unicode ? '┊' : ':';
    for (const [amount, filled] of [
      [0, 0],
      [500, 20],
      [1000, 40],
    ] as const) {
      s.monthToDateUsd = amount;
      const track = renderBudget(s, { ...opts, unicode })
        .split('\n')
        .find((line) => line.trimStart().startsWith('['))!
        .trim();
      expect(track).toBe(
        `[${spent.repeat(Math.min(filled, 39))}${empty.repeat(Math.max(39 - filled, 0))}${tick}]`,
      );
      const cells = Array.from(track.slice(1, -1));
      expect(cells).toHaveLength(40);
      expect(cells.filter((cell) => cell === spent).length + (filled === 40 ? 1 : 0)).toBe(filled);
    }
  });

  it.each([true, false])('preserves coincident budget and forecast markers (unicode=%s)', (unicode) => {
    const s = summary();
    s.forecastMonthEndUsd = s.budget.monthlyUsd!;
    const lines = renderBudget(s, { ...opts, unicode }).split('\n');
    const trackIndex = lines.findIndex((line) => line.trimStart().startsWith('['));
    const track = lines[trackIndex]!;
    expect(track).toContain(unicode ? '┊' : ':');
    expect(lines[trackIndex - 1]!.trim()).toBe(unicode ? '▼' : 'v');
    expect(lines[trackIndex - 1]!.indexOf(unicode ? '▼' : 'v')).toBe(track.indexOf(unicode ? '┊' : ':'));
  });

  it.each([40, 60, 80, 120])('wraps only between words and indents details at %i columns', (width) => {
    const s = summary();
    const words =
      'Distinctive explanation preserves complete words while wrapping across terminal columns without splitting anything'.split(
        ' ',
      );
    s.tips[0]!.detail = words.join(' ');
    const result = renderTips(s, { ...opts, width });
    const lines = result.split('\n');
    const first = lines.findIndex((line) => line.includes('Distinctive'));
    const detail: string[] = [];
    for (let i = first; i < lines.length && lines[i]!.startsWith('    '); i++) detail.push(lines[i]!);
    expect(detail.map((line) => line.trim()).join(' ')).toBe(words.join(' '));
    for (const line of detail) {
      expect(line.length).toBeLessThanOrEqual(width);
      expect(words).toContain(line.trim().split(' ').at(-1));
    }
    for (const render of renderers) {
      const output = render(s, { ...opts, width });
      expect(output).not.toMatch(/foreca\n\s*st|miss\n\s*ing|expla\n\s*nation/);
      for (const line of output.split('\n')) expect(line.length).toBeLessThanOrEqual(width);
    }
    s.tips[0]!.detail = 'indivisible'.repeat(30);
    const truncated = renderTips(s, { ...opts, width });
    expect(truncated).toContain('…');
    expect(truncated).not.toContain(s.tips[0]!.detail);
  });

  it('aligns all KPI decimals and shares the ranked cash width', () => {
    const s = summary();
    s.breakdown.repo[0]!.costUsd = 12345.67;
    const result = renderSummary(s, opts);
    const rows = result
      .split('\n')
      .filter((line) => /^  (Month to date|Today|Forecast|Burn|Budget)\s/.test(line));
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((line) => line.indexOf('.'))).size).toBe(1);
    for (const line of rows) expect(line.indexOf('.')).toBe(17 + '$12,345.67'.length - 3);
    expect(result).not.toContain('Burn $/h');
  });

  it.each([40, 60, 80, 120])('aligns savings to one column at %i columns', (width) => {
    const s = summary();
    s.tips[0]!.estMonthlySavingsUsd = 1234.5;
    const rows = renderTips(s, { ...opts, width })
      .split('\n')
      .filter((line) => /^  [123]\. /.test(line));
    expect(rows).toHaveLength(3);
    expect(rows.every((line) => line.endsWith('/mo'))).toBe(true);
    expect(new Set(rows.map((line) => line.length))).toEqual(new Set([width]));
    expect(new Set(rows.map((line) => line.indexOf('/mo'))).size).toBe(1);
  });

  it('labels aligned wide columns and counts input, output and cache writes as Tokens', () => {
    const s = summary();
    s.breakdown.model = [bucket('test-model', 12)];
    s.breakdown.model[0]!.tokens = {
      input: 100,
      output: 200,
      cacheWrite5m: 300,
      cacheWrite1h: 400,
      cacheRead: 99000,
    };
    const result = renderWhere(s, 'model', 3, { ...opts, width: 120 });
    const header = result.split('\n').find((line) => /^  Model\s/.test(line))!;
    const row = result.split('\n').find((line) => /^  test-model\s/.test(line))!;
    expect(header).toMatch(/Model\s+Spend\s+Share\s+Records\s+Tokens\s+Cached/);
    expect(row).toMatch(/12\s+1K\s+99K$/);
    for (const [label, value] of [
      ['Spend', '$12.00'],
      ['Share', '6%'],
      ['Records', '12'],
      ['Tokens', '1K'],
      ['Cached', '99K'],
    ]) {
      expect(header.lastIndexOf(label!) + label!.length).toBe(row.lastIndexOf(value!) + value!.length);
    }
    expect(renderSummary(s, { ...opts, width: 120 })).not.toContain('Cached');
    expect(renderWhere(s, 'model', 3, opts)).not.toContain('Cached');
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
