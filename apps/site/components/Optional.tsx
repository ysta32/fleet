// Sections that exist only when their packages resolve at build time (see scripts/prebuild.mjs).
import { CodeBlock } from '@/components/CodeBlock';
import { Icon } from '@/components/Icon';
import { LocalizeTimes } from '@/components/LocalTime';
import { SpendChart } from '@/components/SpendChart';
import { digestCss, digestHtml, digestWindow, spendBeat } from '@/lib/optional.generated';
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
            repo. This one is rendered at build time by the real digest renderer from the demo fleet's last
            eight hours.
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
          <div className="digest-try">
            <p className="label">Try it without a token</p>
            <CodeBlock label="digest demo commands">
              <code>
                <span className="c"># from a clone of the repo: fourteen synthetic nights</span>
                {'\n'}npm run build -w @fleet/digest{'\n'}
                {'node packages/digest/dist/cli.js demo --out public --days 14'}
              </code>
            </CodeBlock>
            <p className="caption">
              Real runs read GitHub and Vercel with read-only tokens, and can deliver to Notion, email or
              ntfy.
            </p>
          </div>
        </div>
        <figure className="digest-frame">
          {digestCss ? <style dangerouslySetInnerHTML={{ __html: digestCss }} /> : null}
          <LocalizeTimes window={digestWindow ?? undefined}>
            <div
              className="digest-scroll"
              data-fade=""
              tabIndex={0}
              role="region"
              aria-label="Example overnight digest (synthetic data)"
              dangerouslySetInnerHTML={{ __html: digestHtml }}
            />
          </LocalizeTimes>
          <figcaption className="digest-cap">
            Synthetic: the same demo fleet as every preview on this site. Times in your time zone.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const usdWhole = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * One beat on spend: the demo world's month, its forecast and the budget. The verdict line is computed from
 * those numbers, so the copy stays true whether the forecast lands under the budget or passes it.
 */
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
          {s.budgetUsd !== null ? (
            <p className="spend-verdict">
              {over
                ? `On pace to pass the budget by ${usdWhole(s.forecastMonthEndUsd - s.budgetUsd)}. The chart marks the day it crosses.`
                : `On pace to finish ${usdWhole(s.budgetUsd - s.forecastMonthEndUsd)} under budget.`}
            </p>
          ) : null}
          <SpendChart beat={s} />
          <figcaption className="caption mono">
            The demo fleet&apos;s month, as the app&apos;s Spend tab shows it in demo mode. Not a real
            account.
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
