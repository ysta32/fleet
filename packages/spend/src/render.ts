import type { SpendSummary, SpendSource } from './contracts.js';
import { burnTint, type SpendBucket, type SpendDimension } from '@fleet/shared';

export interface RenderOpts {
  width: number;
  color: boolean;
  unicode: boolean;
  now: number;
}

const palette = {
  fg: [236, 231, 218],
  muted: [167, 165, 150],
  subtle: [111, 112, 105],
  accent: [255, 106, 43],
  success: [155, 229, 100],
  warn: [245, 184, 61],
  danger: [255, 89, 100],
  info: [127, 209, 217],
} as const;
type Tone = keyof typeof palette;
type Line = { text: string; tone?: Tone };

const sources: Record<SpendSource, [string, string]> = {
  'claude-code': ['Claude Code', 'Run Claude Code to create local session logs.'],
  codex: ['Codex', 'Run Codex to create local session logs.'],
  cursor: ['Cursor', 'Use Cursor locally or configure paths.cursorExportPath with a usage CSV.'],
  copilot: ['Copilot', 'Configure paths.copilotExportPath with a usage CSV.'],
  'anthropic-api': ['Anthropic API', 'Enable apiIngest and set ANTHROPIC_ADMIN_KEY.'],
  'openai-api': ['OpenAI API', 'Enable apiIngest and set OPENAI_ADMIN_KEY.'],
};

function width(o: RenderOpts): number {
  return Number.isFinite(o.width) ? Math.max(1, Math.floor(o.width)) : 80;
}

function clean(value: string, unicode: boolean): string {
  const safe = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  return unicode ? safe : safe.replace(/[^\x20-\x7e]/g, '?');
}

function cells(char: string): number {
  if (/\p{Mark}/u.test(char)) return 0;
  const n = char.codePointAt(0)!;
  return n >= 0x1100 &&
    (n <= 0x115f ||
      n === 0x2329 ||
      n === 0x232a ||
      (n >= 0x2e80 && n <= 0xa4cf) ||
      (n >= 0xac00 && n <= 0xd7a3) ||
      (n >= 0xf900 && n <= 0xfaff) ||
      (n >= 0xfe10 && n <= 0xfe6f) ||
      (n >= 0xff01 && n <= 0xff60) ||
      (n >= 0xffe0 && n <= 0xffe6) ||
      n >= 0x1f000)
    ? 2
    : 1;
}

function length(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + cells(char), 0);
}

function fit(text: string, size: number, o: RenderOpts): string {
  const value = clean(text, o.unicode);
  if (length(value) <= size) return value;
  if (size <= 0) return '';
  const marker = o.unicode ? '…' : '~';
  const chars = Array.from(value);
  let left = '',
    right = '';
  const half = Math.ceil((size - 1) / 2);
  while (chars.length && length(left) + cells(chars[0]!) <= half) left += chars.shift();
  while (chars.length && length(right) + cells(chars[chars.length - 1]!) <= size - 1 - length(left))
    right = chars.pop()! + right;
  return left + marker + right;
}

function finish(lines: Line[], o: RenderOpts): string {
  const output: string[] = [];
  for (const line of lines) {
    let rest = clean(line.text, o.unicode);
    do {
      let part = '',
        count = 0;
      for (const char of rest) {
        if (count + cells(char) > width(o)) break;
        part += char;
        count += cells(char);
      }
      if (!part && rest) {
        part = '?';
        rest = rest.slice(Array.from(rest)[0]!.length);
      } else rest = rest.slice(part.length);
      const rgb = palette[line.tone ?? 'fg'];
      output.push(o.color && part ? `\x1b[38;2;${rgb.join(';')}m${part}\x1b[0m` : part);
    } while (rest);
  }
  return output.join('\n');
}

function money(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) return value < 0 ? '-<$0.01' : '<$0.01';
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function tokens(b: SpendBucket): string {
  const total = Object.values(b.tokens).reduce((sum, n) => sum + n, 0);
  return total >= 1e6
    ? `${(total / 1e6).toFixed(1)}M`
    : total >= 1e3
      ? `${Math.round(total / 1e3)}K`
      : String(total);
}

function header(s: SpendSummary, o: RenderOpts): Line {
  const month = new Date(s.monthStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dot = o.unicode ? ' · ' : ' | ';
  return { text: `Fleet Spend${dot}${month}${dot}prices ${s.priceTableVersion}`, tone: 'accent' };
}

function sourceLines(s: SpendSummary, o: RenderOpts): Line[] {
  return [
    {
      text: `Sources: ${s.sources.map((source) => `${source.status === 'ok' ? (o.unicode ? '✓' : 'ok') : o.unicode ? '✗' : source.status} ${sources[source.source][0]}${source.status === 'ok' ? '' : ` (${source.status})`}`).join('  ')}`,
      tone: 'muted',
    },
    ...(s.sources.some((source) => source.status !== 'ok')
      ? [{ text: 'Partial: unavailable sources are excluded from totals.', tone: 'warn' as const }]
      : []),
    ...(s.unpricedModels.length
      ? [
          {
            text: `Unpriced models (counted as $0.00): ${s.unpricedModels.join(', ')}`,
            tone: 'warn' as const,
          },
        ]
      : []),
  ];
}

function empty(s: SpendSummary, o: RenderOpts): string | undefined {
  if (
    s.sources.some((source) => source.records > 0) ||
    Object.values(s.breakdown).some((rows) => rows.some((row) => row.records > 0)) ||
    s.daily.some((row) => row.records > 0)
  )
    return undefined;
  return finish(
    [
      header(s, o),
      { text: '' },
      { text: 'No usage yet. Connect a source to get started.' },
      ...Object.values(sources).map(([name, help]) => ({ text: `${name}: ${help}`, tone: 'muted' as const })),
      { text: 'Local logs are read on this machine.' },
      ...sourceLines(s, o),
    ],
    o,
  );
}

function bar(ratio: number, size: number, o: RenderOpts): string {
  const units = Math.round(Math.max(0, Math.min(1, ratio)) * size * 8);
  if (!o.unicode) return '#'.repeat(Math.round(units / 8)).padEnd(size, '.');
  return ('█'.repeat(Math.floor(units / 8)) + (' ▏▎▍▌▋▊▉'[units % 8] ?? '').trim()).padEnd(size, '░');
}

function budgetLines(s: SpendSummary, o: RenderOpts): Line[] {
  const budget = s.budget.monthlyUsd;
  if (budget === null)
    return [{ text: 'Budget left    Set a budget: fleet-spend budget set <usd>', tone: 'muted' }];
  const over = s.monthToDateUsd > budget;
  const ratio = budget > 0 ? s.monthToDateUsd / budget : s.monthToDateUsd > 0 ? Infinity : 0;
  const forecastOver = s.forecastMonthEndUsd > budget;
  const tone: Tone = over ? 'danger' : ratio >= 0.75 || forecastOver ? 'warn' : 'fg';
  const lines: Line[] = [
    {
      text: `Budget left    ${money(Math.max(0, budget - s.monthToDateUsd))}${over ? ` (over by ${money(s.monthToDateUsd - budget)})` : ''}`,
      tone,
    },
    {
      text: `Budget ${money(budget)} | ${Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : 'over'} used${forecastOver ? ' | forecast over budget' : ''}`,
      tone,
    },
  ];
  if (width(o) >= 60) {
    const size = Math.min(40, width(o) - 4);
    const scale = Math.max(budget, s.monthToDateUsd, s.forecastMonthEndUsd, 0.01);
    const track = Array.from(bar(s.monthToDateUsd / scale, size, o));
    track[Math.min(size - 1, Math.floor((s.forecastMonthEndUsd / scale) * (size - 1)))] = '|';
    lines.push(
      { text: `[${track.join('')}]`, tone },
      { text: '| forecast marker; fill = spent', tone: 'subtle' },
    );
  }
  return lines;
}

function ranked(s: SpendSummary, by: SpendDimension, limit: number, o: RenderOpts): Line[] {
  const rows = [...s.breakdown[by]]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, Math.max(0, Math.floor(limit)));
  const wide = width(o) >= 100,
    bars = width(o) >= 60;
  const cashWidth = Math.max(6, ...rows.map((row) => money(row.costUsd).length));
  const labelWidth = Math.max(1, width(o) - cashWidth - 9 - (bars ? 14 : 0) - (wide ? 18 : 0));
  const lines: Line[] = [
    { text: `By ${by}${wide ? ' (records / tokens)' : ''}  |  Spend / Share`, tone: 'muted' },
  ];
  for (const row of rows) {
    const label = fit(row.key, labelWidth, o);
    const share = s.monthToDateUsd > 0 ? row.costUsd / s.monthToDateUsd : 0;
    lines.push({
      text: `${label}${' '.repeat(Math.max(0, labelWidth - length(label)))}  ${money(row.costUsd).padStart(cashWidth)}  ${(share * 100).toFixed(0).padStart(3)}%${bars ? `  ${bar(share, 12, o)}` : ''}${wide ? `  ${String(row.records).padStart(6)}  ${tokens(row).padStart(8)}` : ''}`,
    });
  }
  if (!rows.length) lines.push({ text: 'No usage for this dimension.', tone: 'subtle' });
  return lines;
}

function tipLines(s: SpendSummary, o: RenderOpts, details: boolean): Line[] {
  const tips = [...s.tips].sort((a, b) => b.estMonthlySavingsUsd - a.estMonthlySavingsUsd).slice(0, 3);
  return [
    { text: 'Top savings', tone: 'muted' },
    ...tips.flatMap((tip) => {
      const saving = `${money(tip.estMonthlySavingsUsd)}/mo`;
      const title = fit(tip.title, Math.max(1, width(o) - saving.length - 2), o);
      const lines: Line[] = [
        { text: `${title}  ${saving}`, tone: tip.estMonthlySavingsUsd > 0 ? 'success' : 'fg' },
      ];
      if (details) lines.push({ text: tip.detail, tone: 'muted' });
      return lines;
    }),
    ...(!tips.length ? [{ text: 'No savings tips yet.', tone: 'subtle' as const }] : []),
  ];
}

export function renderSummary(s: SpendSummary, o: RenderOpts): string {
  const firstRun = empty(s, o);
  if (firstRun !== undefined) return firstRun;
  const tint = burnTint(s.burnUsdPerHour);
  const lines: Line[] = [
    header(s, o),
    { text: '' },
    { text: `Month to date  ${money(s.monthToDateUsd)}`, tone: 'accent' },
    { text: `Today          ${money(s.todayUsd)}` },
    { text: `Forecast       ${money(s.forecastMonthEndUsd)}` },
    {
      text: `Burn $/h       ${money(s.burnUsdPerHour)} (${tint})`,
      tone: tint === 'hot' ? 'danger' : tint === 'warm' ? 'warn' : tint === 'cool' ? 'info' : 'subtle',
    },
    ...budgetLines(s, o),
  ];
  if (width(o) >= 60) {
    const values = Array.from({ length: 31 }, (_, i) => {
      const date = new Date(o.now);
      date.setDate(date.getDate() - 30 + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return s.daily.find((day) => day.key === key)?.costUsd ?? 0;
    });
    const peak = Math.max(...values, 0.01);
    const glyphs = o.unicode ? '▁▂▃▄▅▆▇█' : '_.-=+*#%';
    lines.push({
      text: `Last 31 days   ${values.map((value) => glyphs[Math.max(0, Math.min(7, Math.round((value / peak) * 7)))]).join('')}`,
      tone: 'info',
    });
  }
  lines.push(
    { text: '' },
    ...ranked(s, 'repo', 3, o),
    ...ranked(s, 'model', 3, o),
    { text: '' },
    ...tipLines(s, o, false),
    { text: '' },
    ...sourceLines(s, o),
  );
  return finish(lines, o);
}

export function renderWhere(s: SpendSummary, by: SpendDimension, limit: number, o: RenderOpts): string {
  return (
    empty(s, o) ??
    finish(
      [
        header(s, o),
        { text: `Spend by ${by} | total ${money(s.monthToDateUsd)}` },
        ...ranked(s, by, limit, o),
        ...sourceLines(s, o),
      ],
      o,
    )
  );
}

export function renderTips(s: SpendSummary, o: RenderOpts): string {
  return empty(s, o) ?? finish([header(s, o), ...tipLines(s, o, true), ...sourceLines(s, o)], o);
}

export function renderBudget(s: SpendSummary, o: RenderOpts): string {
  const firstRun = empty(s, o);
  if (firstRun !== undefined) return firstRun;
  return finish(
    [
      header(s, o),
      { text: `Month to date  ${money(s.monthToDateUsd)}` },
      { text: `Forecast       ${money(s.forecastMonthEndUsd)}` },
      ...budgetLines(s, o),
    ],
    o,
  );
}

export function renderTsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => clean(cell, true)).join('\t')).join('\n');
}
