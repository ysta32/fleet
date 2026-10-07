import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { SpendBucket, SpendDimension, SpendSummary } from '@fleet/shared';

export type BurnTint = 'idle' | 'cool' | 'warm' | 'hot';

/** Identical thresholds to @fleet/shared burnTint (USD/hour). */
export function burnTint(usdPerHour: number): BurnTint {
  if (!(usdPerHour > 0)) return 'idle';
  if (usdPerHour < 2) return 'cool';
  if (usdPerHour < 10) return 'warm';
  return 'hot';
}

const TINT_COLOR: Record<BurnTint, string> = {
  idle: '#8a8f98',
  cool: '#3fb950',
  warm: '#d29922',
  hot: '#f85149',
};

const DIMS: SpendDimension[] = ['repo', 'model', 'session', 'army', 'task', 'source', 'day'];

const money = (n: number): string => `$${n.toFixed(2)}`;

const card: CSSProperties = {
  background: 'var(--card, #16181d)',
  border: '1px solid var(--border, #2a2d34)',
  borderRadius: 10,
  padding: 14,
  color: 'var(--fg, #e6e6e6)',
};
const muted: CSSProperties = { color: 'var(--muted, #9aa0a6)', fontSize: 12 };

function Kpi({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div style={{ ...card, flex: '1 1 180px' }}>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
      {children}
    </div>
  );
}

function Sparkline({ daily }: { daily: SpendBucket[] }) {
  const w = 600;
  const h = 70;
  const max = Math.max(1, ...daily.map((d) => d.costUsd));
  const step = daily.length > 1 ? w / (daily.length - 1) : w;
  const points = daily
    .map((d, i) => `${(i * step).toFixed(1)},${(h - (d.costUsd / max) * (h - 6) - 3).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label="Daily spend, last 31 days"
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="var(--accent, #58a6ff)" strokeWidth={2} />
    </svg>
  );
}

function Breakdown({ summary }: { summary: SpendSummary }) {
  const [dim, setDim] = useState<SpendDimension>('repo');
  const rows = (summary.breakdown[dim] ?? []).slice(0, 8);
  const max = Math.max(0.0001, ...rows.map((r) => r.costUsd));
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Where did my tokens go</div>
      <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {DIMS.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === dim}
            onClick={() => setDim(d)}
            style={{
              cursor: 'pointer',
              padding: '3px 10px',
              borderRadius: 999,
              border: '1px solid var(--border, #2a2d34)',
              background: d === dim ? 'var(--accent, #58a6ff)' : 'transparent',
              color: d === dim ? '#0b0d10' : 'var(--fg, #e6e6e6)',
            }}
          >
            {d}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div style={muted}>No data for this view yet.</div>
      ) : (
        rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
            <div style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.key}
            </div>
            <div style={{ flex: 1, background: 'var(--track, #23262d)', borderRadius: 4, height: 10 }}>
              <div
                style={{
                  width: `${(r.costUsd / max) * 100}%`,
                  height: 10,
                  borderRadius: 4,
                  background: 'var(--accent, #58a6ff)',
                }}
              />
            </div>
            <div style={{ width: 80, textAlign: 'right' }}>{money(r.costUsd)}</div>
          </div>
        ))
      )}
    </div>
  );
}

export function SpendTab({ summary }: { summary: SpendSummary | null }) {
  if (!summary) {
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontWeight: 600 }}>No spend data yet</div>
        <div style={muted}>Loading spend summary... run npx fleet-spend to collect local usage.</div>
      </div>
    );
  }
  const budget = summary.budget.monthlyUsd;
  const pct = budget ? Math.min(100, (summary.forecastMonthEndUsd / budget) * 100) : 0;
  const over = budget !== null && summary.forecastMonthEndUsd > budget;
  const tint = burnTint(summary.burnUsdPerHour);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'var(--font, system-ui, sans-serif)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Month to date" value={money(summary.monthToDateUsd)} />
        <Kpi label="Today" value={money(summary.todayUsd)} />
        <Kpi label="Forecast month end" value={money(summary.forecastMonthEndUsd)}>
          {budget !== null ? (
            <>
              <div
                style={{
                  background: 'var(--track, #23262d)',
                  borderRadius: 4,
                  height: 8,
                  margin: '6px 0 2px',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: 8,
                    borderRadius: 4,
                    background: over ? TINT_COLOR.hot : TINT_COLOR.cool,
                  }}
                />
              </div>
              <div style={muted}>of {money(budget)} budget</div>
            </>
          ) : (
            <div style={muted}>no budget set</div>
          )}
        </Kpi>
        <Kpi label="Burn rate" value={`${money(summary.burnUsdPerHour)}/h`}>
          <span
            data-tint={tint}
            style={{
              background: TINT_COLOR[tint],
              color: '#0b0d10',
              borderRadius: 999,
              padding: '1px 8px',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {tint}
          </span>
        </Kpi>
      </div>

      {summary.alerts.length > 0 && (
        <div style={card}>
          {summary.alerts.map((a) => (
            <div
              key={a.id}
              style={{ color: a.level === 'over' ? TINT_COLOR.hot : TINT_COLOR.warm, margin: '2px 0' }}
            >
              <strong>{a.title}</strong> <span style={muted}>{a.body}</span>
            </div>
          ))}
        </div>
      )}

      <Breakdown summary={summary} />

      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Last 31 days</div>
        <Sparkline daily={summary.daily} />
      </div>

      {summary.tips.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Savings tips</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {summary.tips.map((t) => (
              <li key={t.id}>
                {t.title}{' '}
                <span style={muted}>
                  save ~{money(t.estMonthlySavingsUsd)}/mo. {t.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sources</div>
        {summary.sources.map((s) => (
          <div key={s.source} style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 110 }}>{s.source}</span>
            <span
              style={{
                color:
                  s.status === 'ok'
                    ? TINT_COLOR.cool
                    : s.status === 'error'
                      ? TINT_COLOR.hot
                      : TINT_COLOR.idle,
              }}
            >
              {s.status}
            </span>
            <span style={muted}>
              {s.records} records{s.note ? ` - ${s.note}` : ''}
            </span>
          </div>
        ))}
      </div>

      {summary.unpricedModels.length > 0 && (
        <div style={{ ...muted, color: TINT_COLOR.warm }}>
          Unpriced models (counted as $0): {summary.unpricedModels.join(', ')}
        </div>
      )}
    </div>
  );
}
