import { useState } from 'react';
import { formatLocalTime, formatUtcTime } from '@fleet/shared';
import type { SpendSource, SpendSummary } from '@fleet/shared';
import { Breakdown, DailyBars, HeroChart, ModelMix, toolName } from './charts.js';
import { money, moneyWhole, monthModel, monthName, monthShort, stampLocal } from './format.js';
import { Icon } from './icons.js';
import type { IconName } from './icons.js';
import { SPEND_CSS } from './styles.js';

export type BurnTint = 'idle' | 'cool' | 'warm' | 'hot';

/** Identical thresholds to @fleet/shared burnTint (USD/hour). */
export function burnTint(usdPerHour: number): BurnTint {
  if (!(usdPerHour > 0)) return 'idle';
  if (usdPerHour < 2) return 'cool';
  if (usdPerHour < 10) return 'warm';
  return 'hot';
}

/** The scoped stylesheet, injected once per root. Idempotent across multiple roots (same content). */
export function SpendStyles() {
  // Raw text: React would HTML-escape child selectors (">") in a text child.
  return <style data-fls="" dangerouslySetInnerHTML={{ __html: SPEND_CSS }} />;
}

export interface SpendTabProps {
  /** undefined = loading; null = no sources found yet (first run) */
  summary: SpendSummary | null | undefined;
  /** plain, path-free error message from the loader */
  error?: string;
}

/* ------------------------------------------------------------------ states */

/** A command with a copy button; the button needs JS, the command text is selectable without it. */
export function CopyCmd({ cmd = 'npx fleet-spend' }: { cmd?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fls-cmd">
      <code>{cmd}</code>
      <button
        type="button"
        className="fls-copy"
        aria-label={`Copy ${cmd}`}
        onClick={() => {
          const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
          clip
            ?.writeText(cmd)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="fls-sr" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}

const CAUSES: [string, string][] = [
  ['Permission denied on a log folder', 'Grant read access to the folder, then run again.'],
  [
    'Unreadable settings file',
    'Check ~/.config/fleet/spend.json is valid JSON, or remove it to use defaults.',
  ],
  [
    'API ingest on without a key',
    'Export the admin key variable named in settings, or set apiIngest to false.',
  ],
];

function ErrorPanel({ message, sources }: { message: string; sources?: SpendSummary['sources'] }) {
  return (
    <section className="fls-panel fls-onboard" aria-labelledby="fls-err-h">
      <div className="fls-onboard-intro">
        <span className="fls-eyebrow fls-tone" data-tone="over">
          <span>Spend, error</span>
        </span>
        <h2 id="fls-err-h">Spend data could not load</h2>
        <p>fleet-spend stopped while reading usage. Fix the cause, then run it again.</p>
        <pre className="fls-errmsg" role="alert">
          {message}
        </pre>
        <CopyCmd />
      </div>
      {sources && sources.length > 0 ? (
        <div>
          <h3 className="fls-panel-title" style={{ marginBottom: 12 }}>
            Sources that loaded
          </h3>
          <ul className="fls-steps" aria-label="Sources">
            {sources.map((x) => (
              <li key={x.source}>
                <span
                  className="fls-dot"
                  data-status={x.status}
                  aria-hidden="true"
                  style={{ marginTop: 6 }}
                />
                <strong>{toolName(x.source)}</strong>
                <p className="fls-num">
                  {x.status === 'ok' ? 'Loaded' : x.status === 'missing' ? 'Not found' : 'Error'},{' '}
                  {x.records.toLocaleString('en-US')} records
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          <h3 className="fls-panel-title" style={{ marginBottom: 12 }}>
            Common causes
          </h3>
          <ul className="fls-steps">
            {CAUSES.map(([title, fix]) => (
              <li key={title}>
                <Icon name="alert" />
                <strong>{title}</strong>
                <p>{fix}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Skeleton() {
  const block = (h: number | string, w: number | string = '100%') => (
    <span className="fls-skel" style={{ display: 'block', height: h, width: w }} />
  );
  return (
    <div className="fls-stack" aria-busy="true" aria-live="polite">
      <span className="fls-sr">Loading spend summary</span>
      <div className="fls-hero" aria-hidden="true">
        {block(10, 180)}
        <div style={{ height: 16 }} />
        {block(72, 'min(360px, 80%)')}
        <div style={{ height: 16 }} />
        {block(18, 'min(420px, 90%)')}
        <div style={{ height: 32 }} />
        {block(220)}
      </div>
      <div className="fls-kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="fls-kpi" key={i}>
            {block(10, 90)}
            <div style={{ height: 8 }} />
            {block(26, '70%')}
            <div style={{ height: 4 }} />
            {block(10, '55%')}
          </div>
        ))}
      </div>
      <div className="fls-grid fls-grid-2" aria-hidden="true">
        <div className="fls-panel">
          {[90, 70, 52, 38, 24].map((w) => (
            <div key={w} style={{ padding: '8px 0' }}>
              {block(8, `${w}%`)}
            </div>
          ))}
        </div>
        <div className="fls-panel">{block(140)}</div>
      </div>
    </div>
  );
}

const SOURCE_HELP: { source: SpendSource; icon: IconName; how: string }[] = [
  {
    source: 'claude-code',
    icon: 'folder',
    how: 'Read from ~/.claude/projects. Run one Claude Code session, then scan again.',
  },
  {
    source: 'codex',
    icon: 'folder',
    how: 'Read from ~/.codex/sessions. Run one Codex session, then scan again.',
  },
  {
    source: 'cursor',
    icon: 'file',
    how: 'Read from Cursor app storage, or a usage CSV exported from the Cursor dashboard (set paths.cursorExportPath).',
  },
  {
    source: 'copilot',
    icon: 'file',
    how: 'Download the usage report from GitHub billing settings and set paths.copilotExportPath.',
  },
  {
    source: 'anthropic-api',
    icon: 'key',
    how: 'Opt in: set apiIngest to true and export ANTHROPIC_ADMIN_KEY in your shell.',
  },
  {
    source: 'openai-api',
    icon: 'key',
    how: 'Opt in: set apiIngest to true and export OPENAI_ADMIN_KEY in your shell.',
  },
];

function Onboarding() {
  return (
    <section className="fls-panel fls-onboard" aria-labelledby="fls-onboard-h">
      <div className="fls-onboard-intro">
        <span className="fls-eyebrow">Spend</span>
        <h2 id="fls-onboard-h">No sources found yet</h2>
        <p>
          fleet-spend looked in the usual places and found no usage logs. Connect at least one source below,
          then scan again.
        </p>
        <CopyCmd />
        <p className="fls-panel-note">
          Settings live in <code>~/.config/fleet/spend.json</code>. Logs are read on this machine and never
          uploaded.
        </p>
      </div>
      <ul className="fls-steps" aria-label="Sources">
        {SOURCE_HELP.map((s) => (
          <li key={s.source}>
            <Icon name={s.icon} />
            <strong>{toolName(s.source)}</strong>
            <p>{s.how}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ data view */

function Kpi({
  label,
  value,
  children,
  hero,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'fls-kpi fls-kpi-hero' : 'fls-kpi'}>
      <span className="fls-eyebrow">{label}</span>
      <span className="fls-kpi-value fls-num">{value}</span>
      {children}
    </div>
  );
}

function Dashboard({ s }: { s: SpendSummary }) {
  const m = monthModel(s);
  const mon = monthShort(m.month);
  const monthPrefix = `${m.year}-${String(m.month).padStart(2, '0')}-`;
  const budget = s.budget.monthlyUsd;
  const used = budget ? s.monthToDateUsd / budget : 0;
  const warnAt = Math.min(...(s.budget.warnAt.length ? s.budget.warnAt : [0.8]));
  // one severity for over budget (actual or forecast): danger. warn only for the early threshold.
  const meterState =
    used >= 1 || (budget !== null && m.forecast > budget) ? 'over' : used >= warnAt ? 'warn' : 'ok';
  const pace = m.today / m.days;
  const left = budget !== null ? budget - s.monthToDateUsd : 0;
  const tint = burnTint(s.burnUsdPerHour);
  const missing = s.sources.filter((x) => x.status !== 'ok');
  const okCount = s.sources.length - missing.length;
  const partial = missing.length > 0 && okCount > 0;
  const tips = [...s.tips].sort((a, b) => b.estMonthlySavingsUsd - a.estMonthlySavingsUsd);
  const tipSum = tips.reduce((a, b) => a + b.estMonthlySavingsUsd, 0);
  const forecastOver = budget !== null && m.forecast > budget;
  const [dollars, cents] = money(s.monthToDateUsd).split('.') as [string, string | undefined];

  return (
    <div className="fls-stack">
      <section className="fls-hero" aria-labelledby="fls-hero-h">
        <div className="fls-hero-top">
          <div>
            <h2 id="fls-hero-h" className="fls-eyebrow">
              Spend, {monthName(m.month)} {m.year}, month to date
            </h2>
            <span className="fls-hero-num">
              {dollars}
              {cents !== undefined && (
                <>
                  <span className="fls-hero-sep">.</span>
                  <span className="fls-cents">{cents}</span>
                </>
              )}
            </span>
            <p className="fls-hero-line">
              On pace for <span className="fls-num">{moneyWhole(m.forecast)}</span> by{' '}
              <span className="fls-num">
                {mon} {m.days}
              </span>
              {budget !== null ? (
                forecastOver ? (
                  <>
                    ,{' '}
                    <span className="fls-tone-over">
                      <span className="fls-num">{moneyWhole(m.forecast - budget)}</span> over
                    </span>{' '}
                    the <span className="fls-num">{moneyWhole(budget)}</span> budget.
                  </>
                ) : (
                  <>
                    , within the <span className="fls-num">{moneyWhole(budget)}</span> budget.
                  </>
                )
              ) : (
                '.'
              )}
            </p>
            <div className="fls-meta fls-hero-meta">
              <span className="fls-chip" data-tint={tint} title={`Burn rate: ${tint}`}>
                <span className="fls-dot" aria-hidden="true" />
                <span className="fls-chip-label">
                  Burn <span className="fls-num">{money(s.burnUsdPerHour)}/h</span>, {tint}
                </span>
              </span>
              {partial && (
                <a
                  className="fls-badge fls-badge-warn"
                  href="#fls-src-h"
                  title={`${missing.map((x) => toolName(x.source)).join(', ')} not connected; totals exclude ${missing.length === 1 ? 'it' : 'them'}.`}
                >
                  Partial, {okCount} of {s.sources.length} sources
                </a>
              )}
              <span className="fls-badge">Estimated</span>
              <span className="fls-chip" title={formatUtcTime(s.generatedAt)}>
                <Icon name="clock" small />
                <span className="fls-num">Updated {stampLocal(s.generatedAt)}</span>
              </span>
            </div>
          </div>
          <ul className="fls-legend" aria-label="Legend">
            <li style={{ color: 'var(--fl-accent, #ff6a2b)' }}>
              <span className="fls-key" />
              <span className="fls-muted">Actual</span>
            </li>
            <li style={{ color: 'var(--fl-accent, #ff6a2b)' }}>
              <span className="fls-key fls-key-dash" />
              <span className="fls-muted">Forecast</span>
            </li>
            <li>
              <span className="fls-key fls-key-band" />
              Likely range
            </li>
            {budget !== null && (
              <li style={{ color: 'var(--fl-fg-muted, #a7a596)' }}>
                <span className="fls-key fls-key-dash" />
                Budget
              </li>
            )}
          </ul>
        </div>
        <HeroChart m={m} />
      </section>

      <div className="fls-kpis">
        <Kpi label="Today" value={money(s.todayUsd)}>
          <span className="fls-kpi-sub">
            {mon} {m.today} · updated{' '}
            <time
              dateTime={Number.isFinite(s.generatedAt) ? new Date(s.generatedAt).toISOString() : undefined}
              title={formatUtcTime(s.generatedAt)}
            >
              {formatLocalTime(s.generatedAt)}
            </time>
          </span>
        </Kpi>
        <Kpi
          label="Budget left"
          value={budget === null ? <span className="fls-subtle">No budget</span> : money(left)}
        >
          {budget === null ? (
            <span className="fls-kpi-sub">
              Set one: <code>fleet-spend budget set 200</code>
            </span>
          ) : (
            <>
              <span className="fls-kpi-sub">
                <span className="fls-num">{Math.round(used * 100)}%</span> of{' '}
                <span className="fls-num">{money(budget)}</span> used
              </span>
              <span
                className="fls-meter"
                data-state={meterState}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={budget}
                aria-valuenow={Math.min(budget, Math.round(s.monthToDateUsd * 100) / 100)}
                aria-valuetext={`${money(s.monthToDateUsd)} of ${money(budget)} (${Math.round(used * 100)}%)`}
                aria-label="Budget used"
              >
                <span style={{ width: `${Math.min(100, used * 100)}%` }} />
                <i style={{ left: `${pace * 100}%` }} />
              </span>
              <span className="fls-meter-cap">
                Expected pace · {mon} {m.today}
              </span>
            </>
          )}
        </Kpi>
        <Kpi label="Forecast, month end" value={money(m.forecast)}>
          {forecastOver && budget !== null && (
            <span className="fls-kpi-sub fls-tone" data-tone="over">
              <span>
                <span className="fls-num">{moneyWhole(m.forecast - budget)}</span> over budget
              </span>
            </span>
          )}
          <span className="fls-kpi-sub">
            Range <span className="fls-num">{moneyWhole(m.lo)}</span> to{' '}
            <span className="fls-num">{moneyWhole(m.hi)}</span>, estimated
          </span>
        </Kpi>
        <Kpi
          label="Savings found"
          value={
            tips.length ? (
              <span>
                {money(tipSum)}
                <small className="fls-subtle" style={{ fontSize: '0.5em' }}>
                  /mo
                </small>
              </span>
            ) : (
              <span className="fls-subtle">None yet</span>
            )
          }
        >
          <span className="fls-kpi-sub fls-tone" data-tone={tips.length ? 'good' : undefined}>
            <span>
              {tips.length} {tips.length === 1 ? 'suggestion' : 'suggestions'}, estimated
            </span>
          </span>
        </Kpi>
      </div>

      <div className="fls-grid fls-grid-2">
        <Breakdown summary={s} />
        <ModelMix buckets={s.breakdown.model ?? []} total={s.monthToDateUsd} />
      </div>

      <section className="fls-panel" aria-labelledby="fls-daily-h">
        <div className="fls-panel-head">
          <h3 id="fls-daily-h" className="fls-panel-title">
            Daily spend, last 31 days
          </h3>
          <ul className="fls-legend" aria-label="Legend">
            <li style={{ color: 'var(--fl-accent, #ff6a2b)' }}>
              <span className="fls-key fls-key-swatch" />
              <span className="fls-muted">Today</span>
            </li>
            <li style={{ color: 'var(--fl-accent, #ff6a2b)' }}>
              <span className="fls-key fls-key-swatch" style={{ opacity: 0.35 }} />
              <span className="fls-muted">{monthName(m.month)}</span>
            </li>
            <li style={{ color: 'var(--fl-fg-subtle, #8a8b82)' }}>
              <span className="fls-key fls-key-swatch" />
              <span className="fls-muted">Earlier</span>
            </li>
          </ul>
        </div>
        <DailyBars daily={s.daily} monthPrefix={monthPrefix} />
      </section>

      {tips.length > 0 && (
        <section className="fls-panel" aria-labelledby="fls-tips-h">
          <div className="fls-panel-head">
            <h3 id="fls-tips-h" className="fls-panel-title">
              Savings
            </h3>
            <p className="fls-panel-note">Estimates from this month's usage at current prices.</p>
          </div>
          <ul className="fls-savings">
            {tips.map((tip) => (
              <li key={tip.id} className="fls-saving">
                <span className="fls-saving-amt fls-num">
                  {money(tip.estMonthlySavingsUsd)}
                  <small>/mo</small>
                </span>
                <h3>{tip.title}</h3>
                <p>{tip.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="fls-panel" aria-labelledby="fls-src-h">
        <div className="fls-panel-head">
          <h3 id="fls-src-h" className="fls-panel-title">
            Sources
          </h3>
          <p className="fls-panel-note">
            <Icon name="lock" small /> Read on this machine. Nothing is uploaded.
          </p>
        </div>
        <ul className="fls-sources">
          {s.sources.map((x) => (
            <li key={x.source} className="fls-source">
              <span className="fls-dot" data-status={x.status} aria-hidden="true" />
              <span>{toolName(x.source)}</span>
              <span className="fls-status" data-status={x.status}>
                {x.status === 'ok' ? 'Connected' : x.status === 'missing' ? 'Not found' : 'Error'}
              </span>
              <small className="fls-num">
                {x.records.toLocaleString('en-US')} records{x.note ? `, ${x.note}` : ''}
              </small>
            </li>
          ))}
        </ul>
      </section>

      <footer className="fls-footnote">
        <span>
          Costs are estimated from local logs at list prices (price table{' '}
          <span className="fls-num">{s.priceTableVersion}</span>).
        </span>
        {s.unpricedModels.length > 0 && (
          <span className="fls-tone-warn">Unpriced models, counted as $0: {s.unpricedModels.join(', ')}</span>
        )}
      </footer>
    </div>
  );
}

export function SpendTab({ summary, error }: SpendTabProps) {
  let body: React.ReactNode;
  if (summary) {
    body = (
      <div className="fls-stack">
        {error && <ErrorPanel message={error} sources={summary.sources} />}
        <Dashboard s={summary} />
      </div>
    );
  } else if (error) {
    body = <ErrorPanel message={error} />;
  } else if (summary === null) {
    body = <Onboarding />;
  } else {
    body = <Skeleton />;
  }
  return (
    <div className="fls-root">
      <SpendStyles />
      {body}
    </div>
  );
}
