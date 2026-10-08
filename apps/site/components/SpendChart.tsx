// Cumulative month spend with its forecast and budget line. Lines are SVG stretched to the box
// (non-scaling strokes); labels are HTML placed by percentage, so they stay legible at any width.
import type { SpendBeat } from '@/lib/optional.generated';

const DAY = 86_400_000;

export function SpendChart({ beat }: { beat: SpendBeat }) {
  const start = new Date(beat.monthStart);
  const monthDays = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  let run = 0;
  const pts = beat.days.map((d) => {
    run += d.usd;
    const day = Math.round((Date.parse(`${d.key}T00:00:00Z`) - beat.monthStart) / DAY) + 1;
    return { day, total: run };
  });
  const last = pts[pts.length - 1];
  if (!last) return null;
  const top = Math.max(beat.forecastMonthEndUsd, beat.budgetUsd ?? 0) * 1.12;
  const x = (day: number) => (day / monthDays) * 100;
  const y = (usd: number) => 100 - (usd / top) * 100;
  const actual = `M0 100 ${pts.map((p) => `L${x(p.day).toFixed(2)} ${y(p.total).toFixed(2)}`).join(' ')}`;
  const area = `${actual} L${x(last.day).toFixed(2)} 100 Z`;
  const forecast = `M${x(last.day).toFixed(2)} ${y(last.total).toFixed(2)} L100 ${y(beat.forecastMonthEndUsd).toFixed(2)}`;
  // Linear forecast from today's total to month end: the day it reaches the budget, if it does.
  const budget = beat.budgetUsd;
  const slope = (beat.forecastMonthEndUsd - last.total) / Math.max(1, monthDays - last.day);
  const crossDay =
    budget !== null && last.total < budget && beat.forecastMonthEndUsd > budget && slope > 0
      ? last.day + (budget - last.total) / slope
      : null;
  const month = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return (
    <div className="spend-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="spend-area" d={area} />
        {budget !== null ? (
          <path
            className="spend-budget"
            d={`M0 ${y(budget).toFixed(2)} H100`}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path className="spend-forecast" d={forecast} vectorEffect="non-scaling-stroke" />
        <path className="spend-line" d={actual.replace('M0 100 L', 'M')} vectorEffect="non-scaling-stroke" />
        {crossDay !== null && budget !== null ? (
          <path
            className="spend-cross"
            d={`M${x(crossDay).toFixed(2)} ${y(budget).toFixed(2)} V100`}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <span
        className="spend-dot"
        style={{ left: `${x(last.day)}%`, top: `${y(last.total)}%` }}
        aria-hidden="true"
      />
      {budget !== null ? (
        <span className="spend-tag spend-tag-budget" style={{ top: `${y(budget)}%` }}>
          Budget
        </span>
      ) : null}
      {crossDay !== null ? (
        <span
          className="spend-tag spend-tag-cross"
          style={{ ['--x' as string]: `${x(crossDay)}%`, top: `${y(budget ?? 0)}%` }}
        >
          Crosses budget ~{month} {Math.ceil(crossDay)}
        </span>
      ) : null}
      <span
        className="spend-tag spend-tag-today"
        style={{ left: `${x(last.day)}%`, top: `${y(last.total)}%` }}
      >
        <span className="spend-tag-wide">Today · </span>
        {month} {last.day}
      </span>
      <p className="sr-only">
        {`Spend reached $${last.total.toFixed(2)} by ${month} ${last.day} and is forecast to reach $${beat.forecastMonthEndUsd.toFixed(0)} by month end${budget !== null ? ` against a $${budget} budget` : ''}.`}
      </p>
    </div>
  );
}
