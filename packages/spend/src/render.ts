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
type Span = { text: string; tone?: Tone; bold?: boolean };
type Line = Span & { spans?: Span[]; continuation?: number };

function rich(spans: Span[], continuation?: number): Line {
  return { text: spans.map((span) => span.text).join(''), spans, continuation };
}

function section(text: string): Line {
  return { text, bold: true };
}

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
    const indent = line.tone === 'accent' || !line.text ? 0 : Math.min(2, width(o) - 1);
    let rest = (line.spans ?? [line]).flatMap((span) =>
      Array.from(clean(span.text, o.unicode), (char) => ({ ...span, text: char })),
    );
    let padding = indent;
    do {
      const available = width(o) - padding;
      let count = 0;
      let end = 0;
      while (end < rest.length && count + cells(rest[end]!.text) <= available) {
        count += cells(rest[end]!.text);
        end++;
      }
      let part: Span[];
      if (end < rest.length) {
        let separator = end;
        while (separator > 0 && rest[separator]?.text !== ' ') separator--;
        if (separator > 0) {
          part = rest.slice(0, separator);
          rest = rest.slice(separator);
          while (rest[0]?.text === ' ') rest.shift();
        } else {
          part = [{ ...rest[0], text: fit(rest.map((span) => span.text).join(''), available, o) }];
          rest = [];
        }
      } else {
        part = rest;
        rest = [];
      }
      while (part[part.length - 1]?.text === ' ') part.pop();
      const groups: Span[] = [];
      for (const span of part) {
        const previous = groups[groups.length - 1];
        if (previous && previous.tone === span.tone && previous.bold === span.bold)
          previous.text += span.text;
        else groups.push({ ...span });
      }
      output.push(
        ' '.repeat(padding) +
          groups
            .map((span) => {
              const rgb = palette[span.tone ?? 'fg'];
              return o.color && span.text
                ? `\x1b[38;2;${rgb.join(';')}m${span.bold ? '\x1b[1m' : ''}${span.text}\x1b[0m`
                : span.text;
            })
            .join(''),
      );
      padding = Math.min(line.continuation ?? 4, Math.max(0, width(o) - 8));
    } while (rest.length);
  }
  return output.join('\n');
}

function money(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) return value < 0 ? '-<$0.01' : '<$0.01';
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function tokenCount(total: number): string {
  return total >= 1e6
    ? `${(total / 1e6).toFixed(1)}M`
    : total >= 1e3
      ? `${Math.round(total / 1e3)}K`
      : String(total);
}

function tokens(b: SpendBucket): string {
  return tokenCount(b.tokens.input + b.tokens.output + b.tokens.cacheWrite5m + b.tokens.cacheWrite1h);
}

function cashWidth(s: SpendSummary): number {
  return Math.max(
    6,
    ...[
      s.monthToDateUsd,
      s.todayUsd,
      s.forecastMonthEndUsd,
      s.burnUsdPerHour,
      s.budget.monthlyUsd ?? 0,
      ...Object.values(s.breakdown).flatMap((rows) => rows.map((row) => row.costUsd)),
    ].map((value) => money(value).length),
  );
}

function kpi(s: SpendSummary, label: string, value: number, suffix = '', tone: Tone = 'muted'): Line {
  return rich(
    [
      { text: `${label.padEnd(13)}  `, tone: 'muted' },
      { text: money(value).padStart(cashWidth(s)), bold: true },
      { text: suffix, tone },
    ],
    17,
  );
}

function header(s: SpendSummary, o: RenderOpts): Line {
  const month = new Date(s.monthStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dot = o.unicode ? ' · ' : ' | ';
  return { text: `Fleet Spend${dot}${month}${dot}prices ${s.priceTableVersion}`, tone: 'accent' };
}

function sourceLines(s: SpendSummary, o: RenderOpts): Line[] {
  return [
    {
      text: `Sources: ${s.sources.map((source) => `${source.status === 'ok' ? (o.unicode ? '✓' : 'ok') : o.unicode ? '✗' : 'x'} ${sources[source.source][0]}${source.status === 'ok' ? '' : ` (${source.status})`}`).join('  ')}`,
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
    return [
      { text: 'Budget         Set a budget: fleet-spend budget set <usd>', tone: 'muted', continuation: 17 },
    ];
  const over = s.monthToDateUsd > budget;
  const ratio = budget > 0 ? s.monthToDateUsd / budget : s.monthToDateUsd > 0 ? Infinity : 0;
  const forecastOver = s.forecastMonthEndUsd > budget;
  const tone: Tone = over ? 'danger' : ratio >= 0.75 || forecastOver ? 'warn' : 'muted';
  const dot = o.unicode ? ' · ' : ' / ';
  const status = [
    Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : 'over',
    over ? `over ${money(s.monthToDateUsd - budget)}` : `${money(budget - s.monthToDateUsd)} left`,
    ...(forecastOver ? ['forecast over'] : []),
  ].join(dot);
  const lines: Line[] = [kpi(s, 'Budget', budget, `  ${status}`, tone)];
  if (width(o) >= 60) {
    const size = Math.min(40, width(o) - 4);
    const scale = Math.max(budget, s.monthToDateUsd, s.forecastMonthEndUsd, 0.01);
    const position = (value: number): number =>
      Math.max(0, Math.min(size - 1, Math.round((value / scale) * (size - 1))));
    const budgetAt = position(budget);
    const forecastAt = position(s.forecastMonthEndUsd);
    const spentAt = position(s.monthToDateUsd);
    const spent = o.unicode ? '█' : '#';
    const tick = o.unicode ? '┊' : ':';
    const forecast = o.unicode ? '▼' : 'v';
    const track: Span[] = Array.from({ length: size }, (_, i) => ({
      text:
        i === budgetAt
          ? tick
          : i === forecastAt
            ? forecast
            : i <= spentAt && s.monthToDateUsd > 0
              ? i > budgetAt
                ? o.unicode
                  ? '▓'
                  : '!'
                : spent
              : o.unicode
                ? '░'
                : '.',
      tone: i > budgetAt && i <= spentAt && over ? 'danger' : 'subtle',
    }));
    if (forecastAt === budgetAt)
      lines.push({ text: `${' '.repeat(forecastAt + 1)}${forecast}`, tone: 'subtle' });
    lines.push(rich([{ text: '[' }, ...track, { text: ']' }]), {
      text: `${spent} spent ${money(s.monthToDateUsd)}  ${tick} budget ${money(budget)}  ${forecast} forecast ${money(s.forecastMonthEndUsd)}`,
      tone: 'subtle',
    });
  }
  return lines;
}

function ranked(s: SpendSummary, by: SpendDimension, limit: number, o: RenderOpts, cached = false): Line[] {
  const rows = [...s.breakdown[by]]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, Math.max(0, Math.floor(limit)));
  const wide = width(o) >= 100,
    bars = width(o) >= 60;
  const cash = cashWidth(s);
  const recordsWidth = Math.max(7, ...rows.map((row) => String(row.records).length));
  const labelWidth = Math.max(
    1,
    width(o) - 2 - cash - 9 - (bars ? 14 : 0) - (wide ? recordsWidth + 12 + (cached ? 10 : 0) : 0),
  );
  const label = (value: string): string => {
    const text = fit(value, labelWidth, o);
    return text + ' '.repeat(Math.max(0, labelWidth - length(text)));
  };
  const dimension = by[0]!.toUpperCase() + by.slice(1);
  const lines: Line[] = [
    section(`By ${by}`),
    {
      text: `${label(dimension)}  ${'Spend'.padStart(cash)}  Share${bars ? '  ' + ' '.repeat(12) : ''}${wide ? `  ${'Records'.padStart(recordsWidth)}  ${'Tokens'.padStart(8)}${cached ? `  ${'Cached'.padStart(8)}` : ''}` : ''}`,
      tone: 'muted',
    },
  ];
  for (const row of rows) {
    const share = s.monthToDateUsd > 0 ? row.costUsd / s.monthToDateUsd : 0;
    lines.push(
      rich([
        { text: `${label(row.key)}  ` },
        { text: money(row.costUsd).padStart(cash), bold: true },
        { text: `  ${(share * 100).toFixed(0).padStart(4)}%`, tone: 'muted' },
        {
          text: `${bars ? `  ${bar(share, 12, o)}` : ''}${wide ? `  ${String(row.records).padStart(recordsWidth)}  ${tokens(row).padStart(8)}${cached ? `  ${tokenCount(row.tokens.cacheRead).padStart(8)}` : ''}` : ''}`,
          tone: 'subtle',
        },
      ]),
    );
  }
  if (!rows.length) lines.push({ text: 'No usage for this dimension.', tone: 'subtle' });
  return lines;
}

function tipLines(s: SpendSummary, o: RenderOpts, details: boolean): Line[] {
  const tips = [...s.tips].sort((a, b) => b.estMonthlySavingsUsd - a.estMonthlySavingsUsd).slice(0, 3);
  const savingWidth = Math.max(0, ...tips.map((tip) => `${money(tip.estMonthlySavingsUsd)}/mo`.length));
  const titleWidth = Math.max(1, width(o) - 2 - 3 - 2 - savingWidth);
  return [
    section('Top savings'),
    ...tips.flatMap((tip, index) => {
      const saving = `${money(tip.estMonthlySavingsUsd)}/mo`;
      const title = fit(tip.title, titleWidth, o);
      const lines: Line[] = [
        rich([
          { text: `${index + 1}. `, tone: 'subtle' },
          { text: title + ' '.repeat(Math.max(0, titleWidth - length(title))) },
          { text: `  ${saving.padStart(savingWidth)}`, bold: true },
        ]),
      ];
      if (details) lines.push({ text: `  ${tip.detail}`, tone: 'muted' });
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
    kpi(s, 'Month to date', s.monthToDateUsd),
    kpi(s, 'Today', s.todayUsd),
    kpi(s, 'Forecast', s.forecastMonthEndUsd),
    kpi(
      s,
      'Burn',
      s.burnUsdPerHour,
      `/h  ${tint}`,
      tint === 'hot' ? 'danger' : tint === 'warm' ? 'warn' : tint === 'cool' ? 'info' : 'subtle',
    ),
    ...budgetLines(s, o),
  ];
  if (width(o) >= 60) {
    const values = Array.from({ length: 31 }, (_, i) => {
      const date = new Date(o.now);
      date.setDate(date.getDate() - 30 + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return s.daily.find((day) => day.key === key)?.costUsd ?? 0;
    });
    const peakValue = Math.max(...values);
    const peak = Math.max(peakValue, 0.01);
    const peakDate = new Date(o.now);
    peakDate.setDate(peakDate.getDate() - 30 + values.indexOf(peakValue));
    const dateLabel = peakDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const glyphs = o.unicode ? '▁▂▃▄▅▆▇█' : '_.-=+*#%';
    lines.push(
      { text: '' },
      section('31-day'),
      {
        text: `${values.map((value) => glyphs[Math.max(0, Math.min(7, Math.round((value / peak) * 7)))]).join('')}`,
        tone: 'subtle',
      },
      {
        text: `peak ${money(peakValue)} ${dateLabel}${o.unicode ? ' · ' : ' / '}avg ${money(values.reduce((sum, value) => sum + value, 0) / 31)}/day`,
        tone: 'muted',
      },
    );
  }
  lines.push(
    { text: '' },
    ...ranked(s, 'repo', 3, o),
    { text: '' },
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
        { text: '' },
        kpi(s, 'Total', s.monthToDateUsd),
        { text: '' },
        ...ranked(s, by, limit, o, true),
        { text: '' },
        ...sourceLines(s, o),
      ],
      o,
    )
  );
}

export function renderTips(s: SpendSummary, o: RenderOpts): string {
  return (
    empty(s, o) ??
    finish([header(s, o), { text: '' }, ...tipLines(s, o, true), { text: '' }, ...sourceLines(s, o)], o)
  );
}

export function renderBudget(s: SpendSummary, o: RenderOpts): string {
  const firstRun = empty(s, o);
  if (firstRun !== undefined) return firstRun;
  return finish(
    [
      header(s, o),
      { text: '' },
      kpi(s, 'Month to date', s.monthToDateUsd),
      kpi(s, 'Forecast', s.forecastMonthEndUsd),
      ...budgetLines(s, o),
    ],
    o,
  );
}

export function renderTsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => clean(cell, true)).join('\t')).join('\n');
}
