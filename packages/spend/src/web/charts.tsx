import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { SpendBucket, SpendDimension, SpendSummary } from '@fleet/shared';
import {
  compact,
  dayLabel,
  money,
  moneyWhole,
  monthShort,
  niceTicks,
  pct,
  sharePercents,
  tickLabel,
  totalTokens,
} from './format.js';
import type { MonthModel } from './format.js';
import { mixColor } from './styles.js';

const NS = 'non-scaling-stroke';

function edgeOf(i: number, n: number): 'start' | 'end' | undefined {
  if (i < n * 0.2) return 'start';
  if (i >= n * 0.8) return 'end';
  return undefined;
}

/** Arrow/Home/End navigation over n items; returns the next index or null if the key is not handled. */
function navKey(e: KeyboardEvent, cur: number | null, n: number, fallback: number): number | null {
  const c = cur ?? fallback;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(n - 1, cur === null ? fallback : c + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, cur === null ? fallback : c - 1);
    case 'Home':
      return 0;
    case 'End':
      return n - 1;
    default:
      return null;
  }
}

interface HoverChartProps {
  label: string;
  count: number;
  /** index focused first when the chart receives keyboard focus */
  start: number;
  tip: (i: number) => { title: string; rows: [string, string][]; y?: number };
  children: (active: number | null) => ReactNode;
  className?: string;
}

/**
 * Accessible hover/focus layer: one focusable group; arrows move a crosshair; the tooltip is referenced via
 * aria-describedby and mirrored to a polite live region for screen readers.
 */
function HoverChart({ label, count, start, tip, children, className }: HoverChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const tipId = `${id}-tip`;
  const cur = active !== null ? tip(active) : null;
  return (
    <div
      className={`fls-plot fls-chart-focus ${className ?? ''}`}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use arrow keys to read values.`}
      aria-describedby={cur ? tipId : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') return setActive(null);
        const n = navKey(e, active, count, start);
        if (n !== null) {
          e.preventDefault();
          setActive(n);
        }
      }}
      onBlur={() => setActive(null)}
      onMouseLeave={() => setActive(null)}
    >
      {children(active)}
      <div className="fls-hit">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} data-active={i === active} onMouseEnter={() => setActive(i)}>
            <span className="fls-cross" />
            {cur && i === active && (
              <div
                id={tipId}
                role="tooltip"
                className="fls-tip"
                data-edge={edgeOf(i, count)}
                style={cur.y !== undefined ? { top: `${cur.y}%` } : undefined}
              >
                <div className="fls-tip-title">{cur.title}</div>
                <dl>
                  {cur.rows.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{k}</dt>
                      <dd className="fls-num">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="fls-sr" aria-live="polite">
        {cur ? `${cur.title}: ${cur.rows.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}
      </div>
    </div>
  );
}

function YTicks({
  ticks,
  max,
  step,
  zeroLabel = true,
}: {
  ticks: number[];
  max: number;
  step: number;
  zeroLabel?: boolean;
}) {
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ticks.map((v) => (
          <line
            key={v}
            x1={0}
            x2={100}
            y1={100 - (v / max) * 100}
            y2={100 - (v / max) * 100}
            className={v === 0 ? 'fls-axis-line' : 'fls-grid-line'}
            vectorEffect={NS}
          />
        ))}
      </svg>
      {(zeroLabel ? ticks : ticks.slice(1)).map((v) => (
        <span
          key={v}
          className="fls-ytick fls-num"
          aria-hidden="true"
          style={{ top: `${100 - (v / max) * 100}%` }}
        >
          {tickLabel(v, step)}
        </span>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ hero: cumulative MTD vs budget */

export function HeroChart({ m }: { m: MonthModel }) {
  const top = Math.max(m.hi, m.budget ?? 0, m.forecast, 1) * 1.04;
  const { max, ticks, step } = niceTicks(top);
  const span = Math.max(1, m.days - 1);
  const X = (d: number) => ((Math.min(Math.max(d, 1), m.days) - 1) / span) * 100;
  const Y = (v: number) => 100 - (Math.max(0, v) / max) * 100;
  const mtd = m.cumulative[m.cumulative.length - 1] ?? 0;
  const actual = m.cumulative.map((v, i) => `${X(i + 1).toFixed(3)},${Y(v).toFixed(3)}`).join(' ');
  const area = `${X(1)},100 ${actual} ${X(m.today)},100`;
  const hasFuture = m.today < m.days;
  const band = `${X(m.today)},${Y(mtd)} ${X(m.days)},${Y(m.hi)} ${X(m.days)},${Y(m.lo)}`;
  const mon = monthShort(m.month);
  const projected = (d: number) => mtd + ((m.forecast - mtd) * (d - m.today)) / Math.max(1, m.days - m.today);
  const xTicks = [1, 8, 15, 22, m.days].filter((d, i, a) => d <= m.days && a.indexOf(d) === i);
  const crossLabel =
    m.crossDay !== null
      ? `${m.crossIsActual ? 'Passed' : 'Crosses'} ${moneyWhole(m.budget ?? 0)} budget ${m.crossIsActual ? '' : '~'}${mon} ${Math.ceil(m.crossDay)}`
      : '';
  const crossX = m.crossDay !== null ? X(m.crossDay) : 0;

  return (
    <figure className="fls-chart">
      <HoverChart
        label={`Cumulative spend, ${mon} 1 to ${mon} ${m.days}`}
        count={m.days}
        start={m.today - 1}
        tip={(i) => {
          const d = i + 1;
          if (d <= m.today) {
            const cum = m.cumulative[i] ?? 0;
            return {
              title: `${mon} ${d}${d === m.today ? ' (today)' : ''}`,
              rows: [
                ['Day', money(m.perDay[i] ?? 0)],
                ['Month to date', money(cum)],
              ],
              y: Y(cum),
            };
          }
          return {
            title: `${mon} ${d} (forecast)`,
            rows: [['Projected total', money(projected(d))]],
            y: Y(projected(d)),
          };
        }}
      >
        {(active) => (
          <>
            <YTicks ticks={ticks} max={max} step={step} />
            <svg className="fls-draw" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {hasFuture && <polygon points={band} className="fls-band" />}
              <polygon points={area} className="fls-area" />
              {m.budget !== null && (
                <line
                  x1={0}
                  x2={100}
                  y1={Y(m.budget)}
                  y2={Y(m.budget)}
                  className="fls-budget-line"
                  vectorEffect={NS}
                />
              )}
              {hasFuture && (
                <line
                  x1={X(m.today)}
                  x2={X(m.today)}
                  y1={0}
                  y2={100}
                  className="fls-today-line"
                  vectorEffect={NS}
                />
              )}
              <polyline points={actual} className="fls-line-actual" vectorEffect={NS} />
              {hasFuture && (
                <line
                  x1={X(m.today)}
                  y1={Y(mtd)}
                  x2={X(m.days)}
                  y2={Y(m.forecast)}
                  className="fls-line-forecast"
                  vectorEffect={NS}
                />
              )}
            </svg>
            {m.budget !== null && (
              <span className="fls-tag fls-tag-budget fls-num fls-late" style={{ top: `${Y(m.budget)}%` }}>
                Budget {moneyWhole(m.budget)}
              </span>
            )}
            {hasFuture && (
              <span
                className="fls-tag fls-tag-end fls-num fls-late"
                style={{ top: `${Y(m.forecast)}%` }}
                aria-hidden="true"
              >
                {moneyWhole(m.forecast)}
              </span>
            )}
            <span className="fls-marker fls-late" style={{ left: `${X(m.today)}%`, top: `${Y(mtd)}%` }} />
            {m.crossDay !== null && m.budget !== null && (
              <>
                <span
                  className="fls-marker fls-marker-cross fls-late"
                  style={{ left: `${crossX}%`, top: `${Y(m.budget)}%` }}
                />
                <span
                  className="fls-callout fls-num fls-late"
                  data-edge={crossX > 80 ? 'end' : crossX < 20 ? 'start' : undefined}
                  style={{ left: `${crossX}%`, top: `${Y(m.budget)}%` }}
                >
                  {crossLabel}
                </span>
              </>
            )}
            {active !== null && (
              <span
                className="fls-marker"
                style={{
                  left: `${X(active + 1)}%`,
                  top: `${Y(active < m.today ? (m.cumulative[active] ?? 0) : projected(active + 1))}%`,
                }}
              />
            )}
          </>
        )}
      </HoverChart>
      <div className="fls-xaxis fls-num" aria-hidden="true">
        {xTicks.map((d) => (
          <span key={d} style={{ left: `${X(d)}%` }}>
            {mon} {d}
          </span>
        ))}
      </div>
      <table className="fls-sr">
        <caption>Cumulative spend by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Spend</th>
            <th scope="col">Month to date</th>
          </tr>
        </thead>
        <tbody>
          {m.cumulative.map((v, i) => (
            <tr key={i}>
              <th scope="row">
                {mon} {i + 1}
              </th>
              <td>{money(m.perDay[i] ?? 0)}</td>
              <td>{money(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------------------------ daily bars, 31 days */

export function DailyBars({ daily, monthPrefix }: { daily: SpendBucket[]; monthPrefix: string }) {
  const peak = Math.max(0, ...daily.map((d) => d.costUsd));
  const { max, ticks, step } = niceTicks(peak * 1.05, 3);
  const n = daily.length;
  if (n === 0) return <p className="fls-empty">No daily usage in the last 31 days.</p>;
  const lastKey = daily[n - 1]!.key;
  // weekly ticks counted back from today, so today always has a label
  const xIdx: number[] = [];
  for (let i = n - 1; i >= 0; i -= 7) xIdx.unshift(i);
  const todayCost = daily[n - 1]!.costUsd;
  return (
    <figure className="fls-chart">
      <HoverChart
        className="fls-bars-wrap"
        label={`Daily spend, ${dayLabel(daily[0]!.key)} to ${dayLabel(lastKey)}`}
        count={n}
        start={n - 1}
        tip={(i) => {
          const b = daily[i]!;
          return {
            title: dayLabel(b.key) + (b.key === lastKey ? ' (today)' : ''),
            rows: [
              ['Spend', money(b.costUsd)],
              ['Tokens', compact(totalTokens(b))],
              ['Records', b.records.toLocaleString('en-US')],
            ],
            y: 100 - (b.costUsd / max) * 100,
          };
        }}
      >
        {(active) => (
          <>
            <YTicks ticks={ticks} max={max} step={step} zeroLabel={false} />
            <div className="fls-bars" aria-hidden="true">
              {daily.map((b, i) => (
                <div key={b.key} data-active={i === active}>
                  <span
                    className="fls-bar"
                    data-month={b.key.startsWith(monthPrefix) ? 'current' : 'previous'}
                    data-today={b.key === lastKey}
                    style={{ height: `${(b.costUsd / max) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <span
              className="fls-tag fls-tag-today fls-num"
              aria-hidden="true"
              style={{ top: `${100 - (todayCost / max) * 100}%` }}
            >
              Today {money(todayCost)}
            </span>
          </>
        )}
      </HoverChart>
      <div className="fls-xaxis fls-num" aria-hidden="true">
        {xIdx.map((i, k) => (
          <span
            key={i}
            data-alt={(xIdx.length - 1 - k) % 2 === 1 || undefined}
            style={{ left: `${((i + 0.5) / n) * 100}%` }}
          >
            {dayLabel(daily[i]!.key)}
          </span>
        ))}
      </div>
      <table className="fls-sr">
        <caption>Daily spend</caption>
        <tbody>
          {daily.map((b) => (
            <tr key={b.key}>
              <th scope="row">{dayLabel(b.key)}</th>
              <td>{money(b.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------------------------ ranked breakdown */

const DIMS: { id: SpendDimension; label: string }[] = [
  { id: 'source', label: 'Tool' },
  { id: 'model', label: 'Model' },
  { id: 'repo', label: 'Repo' },
  { id: 'branch', label: 'Branch' },
  { id: 'task', label: 'Task' },
  { id: 'session', label: 'Session' },
  { id: 'day', label: 'Day' },
  { id: 'army', label: 'Army' },
];

const TOOL_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  'anthropic-api': 'Anthropic API',
  'openai-api': 'OpenAI API',
};
export const toolName = (k: string): string => TOOL_NAMES[k] ?? k;

const TOP = 8;

export function Breakdown({ summary }: { summary: SpendSummary }) {
  const [dim, setDim] = useState<SpendDimension>('source');
  const id = useId();
  const all = summary.breakdown[dim] ?? [];
  const rows = all.slice(0, TOP);
  const rest = all.slice(TOP);
  const restCost = rest.reduce((a, b) => a + b.costUsd, 0);
  const max = Math.max(0.0001, ...rows.map((r) => r.costUsd));
  const denom = summary.monthToDateUsd > 0 ? summary.monthToDateUsd : all.reduce((a, b) => a + b.costUsd, 0);
  const label = (k: string) => (dim === 'source' ? toolName(k) : dim === 'day' ? dayLabel(k) : k);
  const idx = DIMS.findIndex((d) => d.id === dim);

  const onKey = (e: KeyboardEvent) => {
    const n = navKey(e, idx, DIMS.length, idx);
    if (n === null) return;
    e.preventDefault();
    setDim(DIMS[n]!.id);
    const btn = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]')[n];
    btn?.focus();
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <section className="fls-panel" aria-labelledby={`${id}-h`}>
      <div className="fls-panel-head">
        <h3 id={`${id}-h`} className="fls-panel-title">
          Where the money went
        </h3>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <div className="fls-seg" role="tablist" aria-label="Group spend by" onKeyDown={onKey}>
            {DIMS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                id={`${id}-t-${d.id}`}
                aria-selected={d.id === dim}
                aria-controls={`${id}-p`}
                tabIndex={d.id === dim ? 0 : -1}
                onClick={() => setDim(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="fls-seg-cue" aria-hidden="true">
            Scroll sideways for more groupings
          </p>
        </div>
      </div>
      <div role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t-${dim}`}>
        {rows.length === 0 ? (
          <p className="fls-empty">No {DIMS[idx]?.label.toLowerCase()} data this month.</p>
        ) : (
          <ol className="fls-rank">
            {rows.map((r) => (
              <li
                key={r.key}
                aria-label={`${label(r.key)}: ${money(r.costUsd)}, ${pct(r.costUsd / denom)} of month to date`}
              >
                <span className="fls-rank-label" title={label(r.key)}>
                  {label(r.key)}
                </span>
                <span className="fls-rank-value fls-num">{money(r.costUsd)}</span>
                <span className="fls-rank-share fls-num">{pct(r.costUsd / denom)}</span>
                <span className="fls-rank-track" aria-hidden="true">
                  <span style={{ width: `${(r.costUsd / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ol>
        )}
        {rest.length > 0 && (
          <p className="fls-rank-more">
            +{rest.length} more, <span className="fls-num">{money(restCost)}</span> combined
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ model mix: cost vs tokens */

export function ModelMix({ buckets, total }: { buckets: SpendBucket[]; total: number }) {
  const id = useId();
  const sorted = [...buckets].sort((a, b) => b.costUsd - a.costUsd);
  const head = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  const items = head.map((b) => ({ key: b.key, cost: b.costUsd, tokens: totalTokens(b) }));
  let otherCost = tail.reduce((a, b) => a + b.costUsd, 0);
  const otherTokens = tail.reduce((a, b) => a + totalTokens(b), 0);
  // one source total: whatever the per-model rows do not cover (capped lists, rounding) folds into Other
  const listed = items.reduce((a, b) => a + b.cost, 0) + otherCost;
  if (total - listed >= 0.01) otherCost += total - listed;
  if (otherCost >= 0.005 || otherTokens > 0)
    items.push({
      key: tail.length ? `Other (${tail.length})` : 'Other',
      cost: otherCost,
      tokens: otherTokens,
    });
  const costSum = Math.max(
    total,
    items.reduce((a, b) => a + b.cost, 0),
  );
  const tokSum = items.reduce((a, b) => a + b.tokens, 0);
  const costPct = sharePercents(items.map((it) => it.cost));
  const tokPct = sharePercents(items.map((it) => it.tokens));
  const color = (i: number) => mixColor(i);

  if (items.length === 0 || costSum <= 0) {
    return (
      <section className="fls-panel" aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`} className="fls-panel-title">
          Model mix
        </h3>
        <p className="fls-empty">No model usage this month.</p>
      </section>
    );
  }
  const top = items[0]!;
  const bar = (by: 'cost' | 'tokens') => {
    const sum = by === 'cost' ? costSum : tokSum;
    return (
      <div
        className="fls-mix-bar"
        role="img"
        aria-label={`Share of ${by}: ${items.map((it, i) => `${it.key} ${(by === 'cost' ? costPct : tokPct)[i]}%`).join(', ')}`}
      >
        {items.map((it, i) =>
          it[by] > 0 ? (
            <span key={it.key} style={{ flexGrow: it[by] / sum, flexBasis: 0, color: color(i) }} />
          ) : null,
        )}
      </div>
    );
  };
  return (
    <section className="fls-panel" aria-labelledby={`${id}-h`}>
      <div className="fls-panel-head">
        <h3 id={`${id}-h`} className="fls-panel-title">
          Model mix
        </h3>
        <p className="fls-panel-note">
          {top.key} is <span className="fls-num">{costPct[0]}%</span> of cost and{' '}
          <span className="fls-num">{tokPct[0]}%</span> of tokens
        </p>
      </div>
      <div className="fls-mix">
        <div className="fls-mix-row">
          <div className="fls-mix-head">
            <span>By cost</span>
            <span className="fls-num">{money(total > 0 ? total : costSum)}</span>
          </div>
          {bar('cost')}
        </div>
        <div className="fls-mix-row">
          <div className="fls-mix-head">
            <span>By tokens</span>
            <span className="fls-num">{compact(tokSum)}</span>
          </div>
          {bar('tokens')}
        </div>
        <table className="fls-mix-table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Cost</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.key}>
                <td title={it.key}>
                  <span className="fls-key fls-key-swatch" style={{ color: color(i) }} aria-hidden="true" />
                  {it.key}
                </td>
                <td className="fls-num">{costPct[i]}%</td>
                <td className="fls-num">{tokPct[i]}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
