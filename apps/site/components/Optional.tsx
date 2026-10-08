// Sections that exist only when their packages resolve at build time (see scripts/prebuild.mjs).
import { Icon } from '@/components/Icon';
import { SpendChart } from '@/components/SpendChart';
import { digestCss, digestHtml, spendBeat } from '@/lib/optional.generated';
import { REPO_URL } from '@/lib/site';

export function DigestSection() {
  if (!digestHtml) return null;
  return (
    <section className="section grain" aria-labelledby="digest-title">
      <div className="wrap split">
        <div className="sticky-col">
          <div className="label-row">
            <span className="label sec-n">Overnight digest</span>
            <span className="rule" />
          </div>
          <h2 id="digest-title" className="h2" style={{ marginTop: 'var(--fl-space-5)' }}>
            Wake up to <em>what shipped.</em>
          </h2>
          <p className="lead" style={{ marginTop: 'var(--fl-space-5)' }}>
            One page each morning: merged PRs, deploys, CI failures and what needs you first, across every
            repo. Rendered at build time by the real digest renderer from its synthetic demo fixture.
          </p>
          <dl className="keys digest-keys">
            <dt>
              <code>shipped</code>
            </dt>
            <dd>Merged PRs, commits and releases, grouped by project.</dd>
            <dt>
              <code>broke</code>
            </dt>
            <dd>CI failures and deployments that need a look.</dd>
            <dt>
              <code>agents</code>
            </dt>
            <dd>What each agent contributed overnight.</dd>
            <dt>
              <code>health</code>
            </dt>
            <dd>One light per project: red, yellow, green or quiet.</dd>
          </dl>
        </div>
        <figure className="digest-frame">
          {digestCss ? <style dangerouslySetInnerHTML={{ __html: digestCss }} /> : null}
          <div
            className="digest-scroll"
            data-fade=""
            tabIndex={0}
            role="region"
            aria-label="Example overnight digest (synthetic data)"
            dangerouslySetInnerHTML={{ __html: digestHtml }}
          />
          <figcaption className="digest-cap">Synthetic example: acme-dev is not a real account.</figcaption>
        </figure>
      </div>
    </section>
  );
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const usdWhole = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** One beat on spend: fleet-spend's own example month, its forecast and the budget line it crosses. */
export function SpendSection() {
  if (!spendBeat) return null;
  const s = spendBeat;
  const over = s.budgetUsd !== null && s.forecastMonthEndUsd > s.budgetUsd;
  return (
    <section className="section grain" aria-labelledby="spend-title">
      <div className="wrap split">
        <div className="sticky-col" data-reveal>
          <div className="label-row">
            <span className="label sec-n">Spend</span>
            <span className="rule" />
          </div>
          <h2 id="spend-title" className="h2" style={{ marginTop: 'var(--fl-space-5)' }}>
            Know where the month is going, <em>before the bill does.</em>
          </h2>
          <p className="lead" style={{ marginTop: 'var(--fl-space-5)' }}>
            fleet-spend reads the same local transcripts and forecasts month-end spend against your budget, by
            repo, model, session and army.
          </p>
          <div className="action-links" style={{ marginTop: 'var(--fl-space-6)' }}>
            <a className="link-arrow" href={`${REPO_URL}/tree/main/packages/spend`}>
              fleet-spend on GitHub <Icon name="external" />
            </a>
          </div>
        </div>
        <figure className="spend-beat" data-reveal style={{ ['--i' as string]: 1 }}>
          <div className="spend-figs">
            <div>
              <span className="label">Month to date</span>
              <span className="spend-n">{usd(s.monthToDateUsd)}</span>
            </div>
            <div>
              <span className="label">Forecast</span>
              <span className={over ? 'spend-n spend-n-hot' : 'spend-n'}>
                {usdWhole(s.forecastMonthEndUsd)}
              </span>
            </div>
            {s.budgetUsd !== null ? (
              <div>
                <span className="label">Budget</span>
                <span className="spend-n">{usdWhole(s.budgetUsd)}</span>
              </div>
            ) : null}
          </div>
          <SpendChart beat={s} />
          <figcaption className="caption mono">
            Example data from fleet-spend&apos;s built-in demo month. Not a real account.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function OptionalSections() {
  return (
    <>
      <DigestSection />
      <SpendSection />
    </>
  );
}
