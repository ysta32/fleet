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
      'over by $32.40',
      'Daily, Oct 1–7',
      'By repo',
      'By model',
      'Top savings',
      '$38.20/mo',
      '2 of 3 sources · Cursor missing, excluded from totals',
    ])
      expect(result).toContain(label);
    expect(result.match(/Daily, Oct 1–7\s+([▁▂▃▄▅▆▇█]+)/)?.[1]).toHaveLength(14);
    expect(result).toContain('│ forecast $268.00');
    expect(result).toContain('peak $61.20 Oct 4 · avg $30.34/day');
  });

  it('uses ASCII fallback for every renderer, including user labels', () => {
    const s = summary();
    s.breakdown.repo[0]!.key = '組織/🚢';
    s.tips[0]!.title = 'Réduire → coût';
    for (const render of renderers)
      expect(render(s, { ...opts, unicode: false })).toMatch(/^[\x20-\x7e\n]*$/);
    const result = renderSummary(s, { ...opts, unicode: false });
    expect(result).toContain('2 of 3 sources | Cursor missing');
    expect(result).toContain('excluded from totals');
    expect(result).toContain('#');
  });

  it('drops bars and trends below 60 and tokens below 100 columns', () => {
    const small = renderSummary(summary(), { ...opts, width: 40 });
    expect(small).not.toMatch(/[█░▁▂▃▄▅▆▇]/);
    expect(small).not.toContain('Daily,');
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
    expect(tips.indexOf('$100.00/mo')).toBeLessThan(tips.indexOf('$38.20/mo'));
    expect(tips).not.toContain('$8.80/mo');
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
    expect(renderBudget(s, opts)).toContain('over by $212.40');
    expect(renderBudget(s, opts)).not.toMatch(/NaN|Infinity/);
    s.budget.monthlyUsd = 250;
    expect(renderBudget(s, opts)).toContain('over budget');
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
      const track = result.split('\n').find((line) => /^[█#░.┊:│|]+$/.test(line.trim()))!;
      expect(track).toContain(unicode ? '┊' : ':');
      expect(track).toContain(unicode ? '│' : '|');
      expect(result).not.toMatch(/^\s*▼\s*$/m);
      expect(result.split('\n').filter((line) => /^[█#░.┊:│|]+$/.test(line.trim()))).toHaveLength(1);
      expect(renderBudget(s, { ...opts, unicode, color: true })).toContain(
        `\x1b[38;2;245;184;61m${unicode ? '│' : '|'}`,
      );
      expect(track.slice(track.indexOf(unicode ? '┊' : ':') + 1)).toContain(unicode ? '█' : '#');
      const colored = renderBudget(s, { ...opts, unicode, color: true });
      expect(colored).toMatch(unicode ? /\x1b\[38;2;255;89;100m█/ : /\x1b\[38;2;255;89;100m#/);
      s.budget.monthlyUsd = 1000;
      const under = renderBudget(s, { ...opts, unicode, color: true });
      expect(under).not.toContain('\x1b[38;2;255;89;100m');
    },
  );

  it.each([true, false])('fills exactly 0, 20 or 40 budget cells (unicode=%s)', (unicode) => {
    const s = summary();
    s.budget.monthlyUsd = 1000;
    s.forecastMonthEndUsd = 1000;
    const spent = unicode ? '█' : '#';
    const empty = unicode ? '░' : '.';
    const tick = unicode ? '│' : '|';
    for (const [amount, filled] of [
      [0, 0],
      [500, 20],
      [1000, 40],
    ] as const) {
      s.monthToDateUsd = amount;
      const track = renderBudget(s, { ...opts, unicode })
        .split('\n')
        .find((line) => /^[█#░.┊:│|]+$/.test(line.trim()))!
        .trim();
      expect(track).toBe(
        `${spent.repeat(Math.min(filled, 39))}${empty.repeat(Math.max(39 - filled, 0))}${tick}`,
      );
      const cells = Array.from(track);
      expect(cells).toHaveLength(40);
      expect(cells.filter((cell) => cell === spent).length + (filled === 40 ? 1 : 0)).toBe(filled);
    }
  });

  it.each([true, false])('preserves coincident budget and forecast markers (unicode=%s)', (unicode) => {
    const s = summary();
    s.forecastMonthEndUsd = s.budget.monthlyUsd!;
    const lines = renderBudget(s, { ...opts, unicode }).split('\n');
    const trackIndex = lines.findIndex((line) => /^[█#░.┊:│|]+$/.test(line.trim()));
    const track = lines[trackIndex]!;
    expect(track).toContain(unicode ? '│' : '|');
    expect(track.trim()[Math.round((180 / 212.4) * 40)]).toBe(unicode ? '│' : '|');
    expect(lines[trackIndex + 1]).toContain(unicode ? 'budget ┊' : 'budget :');
    expect(lines[trackIndex + 1]).toContain(unicode ? '│ forecast' : '| forecast');
    expect(lines).not.toContain('▼');
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
    expect(rows).toHaveLength(3);
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
    const header = renderSummary(s, { ...opts, width })
      .split('\n')
      .find((line) => /^  By repo\s/.test(line))!;
    const spendEnd = header.indexOf('Spend') + 'Spend'.length;
    expect(rows[0]!.indexOf('/mo')).toBe(
      Math.min(width - 3, Math.max(spendEnd, 5 + s.tips[0]!.title.length + 3 + '$1,234.50'.length)),
    );
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
    const header = result.split('\n').find((line) => /^  By model\s/.test(line))!;
    const row = result.split('\n').find((line) => /^  test-model\s/.test(line))!;
    expect(header).toMatch(/By model\s+Spend\s+Share\s+Records\s+Tokens\s+Cached/);
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

  it('merges budget status into MTD and removes the separate budget row and legend', () => {
    const s = summary();
    s.monthToDateUsd = 212.34;
    const over = renderSummary(s, opts);
    expect(over).toContain('Month to date  $212.34  of $180.00 · 118% · over by $32.34');
    expect(over).toContain('Forecast       $268.00 · over budget');
    expect(over).not.toMatch(/spent \$|^  Budget\s|^  Burn\s|\[█/m);
    expect(over).toContain('budget ┊ crossed Oct 7 · │ forecast $268.00');
    s.monthToDateUsd = 112;
    s.daily = [bucket('2026-10-01', 112)];
    const under = renderSummary(s, opts);
    expect(under).toContain('Month to date  $112.00  of $180.00 · 62% · $68.00 left');
    expect(under).toContain('budget ┊ $180.00 · │ forecast $268.00');
    expect(renderBudget(s, opts)).toContain('/h  warm');
  });

  it('renders the compact footer for partial and healthy sources', () => {
    const s = summary();
    s.sources.push({ source: 'copilot', records: 1, status: 'ok' });
    expect(renderSummary(s, opts)).toContain('3 of 4 sources · Cursor missing, excluded from totals');
    s.sources[2]!.status = 'ok';
    expect(renderSummary(s, opts)).toContain('4 sources · all ok');
    expect(renderSummary(s, opts)).not.toContain('excluded from totals');
  });

  it('limits daily sparkline and crossing date to this month and averages over elapsed days', () => {
    const s = summary();
    s.daily = [bucket('2026-09-30', 1000), bucket('2026-10-09', 61.2), bucket('2026-10-21', 1000)];
    const result = renderSummary(s, { ...opts, now: new Date(2026, 9, 20, 12).getTime() });
    expect(result).toContain('Daily, Oct 1–20');
    expect(result).toContain('········█···········');
    expect(result).toContain('peak $61.20 Oct 9 · avg $10.62/day');
    expect(result).toContain('budget ┊ $180.00');
    expect(result).not.toContain('crossed');
  });

  it('uses accent only for MTD and spent fill and reserves bold for title and MTD', () => {
    const colored = renderSummary(summary(), { ...opts, color: true });
    const accents = [...colored.matchAll(/\x1b\[38;2;255;106;43m(?:\x1b\[1m)?([^\x1b]*)/g)].map(
      (match) => match[1],
    );
    expect(accents).toEqual(['$212.40', expect.stringMatching(/^█+$/)]);
    const bold = [...colored.matchAll(/\x1b\[1m([^\x1b]*)/g)].map((match) => match[1]);
    expect(bold).toEqual(['Fleet Spend', '$212.40']);
    expect(colored).toContain('\x1b[38;2;255;89;100mover by $32.40');
    expect(colored).toContain('\x1b[38;2;245;184;61mCursor missing');
    expect(colored).toMatch(/\x1b\[38;2;155;229;100m +\$38.20\/mo/);
    const repo = stripAnsi(colored)
      .split('\n')
      .find((line) => /^  acme\/web/.test(line))!;
    const tip = stripAnsi(colored)
      .split('\n')
      .find((line) => /^  1\. /.test(line))!;
    expect(tip.indexOf('/mo')).toBeGreaterThanOrEqual(repo.indexOf('$148.10') + '$148.10'.length);
  });

  it.each([false, true])(
    'preserves full tip titles and shares table columns at 80 columns (color=%s)',
    (color) => {
      const s = summary();
      s.tips[0]!.title = 'Use cheaper models for short code edits';
      s.breakdown.repo[0]!.key = 'organization/repository-with-long-name';
      const output = stripAnsi(renderSummary(s, { ...opts, color }));
      for (const tip of s.tips) expect(output).toContain(tip.title);
      const headers = output.split('\n').filter((line) => /^  By (repo|model)\s/.test(line));
      expect(headers).toHaveLength(2);
      for (const label of ['Spend', 'Share'])
        expect(headers[0]!.indexOf(label)).toBe(headers[1]!.indexOf(label));
      const rows = output.split('\n').filter((line) => /\$148.10|\$129.80/.test(line));
      expect(rows[0]!.indexOf('$')).toBe(rows[1]!.indexOf('$'));
      expect(rows[0]!.indexOf('%')).toBe(rows[1]!.indexOf('%'));
    },
  );

  it('wraps long titles with a hanging indent and only truncates at the end below 60 columns', () => {
    const s = summary();
    s.tips = [s.tips[0]!];
    s.tips[0]!.title =
      'Use cheaper models for short code edits and reuse cached context for repeated requests';
    const lines = renderSummary(s, opts).split('\n');
    const first = lines.findIndex((line) => /^  1\. /.test(line));
    const title = [
      lines[first]!.slice(5).split(/ {3,}/)[0]!,
      ...lines
        .slice(first + 1)
        .filter((line) => line.startsWith('     '))
        .map((line) => line.trim()),
    ];
    expect(title.join(' ')).toBe(s.tips[0]!.title);
    expect(lines[first + 1]).toMatch(/^ {5}\S/);
    const narrow = renderSummary(s, { ...opts, width: 40 })
      .split('\n')
      .find((line) => /^  1\. /.test(line))!;
    expect(narrow).toMatch(/Use cheaper.*… +\$38.20\/mo$/);
    expect(narrow).not.toContain('requests');
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
