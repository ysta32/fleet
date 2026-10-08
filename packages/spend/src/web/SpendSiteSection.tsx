import { DEMO_SUMMARY } from './demo.js';
import { moneyWhole, monthModel, monthShort } from './format.js';
import { Icon } from './icons.js';
import { CopyCmd, SpendStyles, SpendTab } from './SpendTab.js';

/**
 * Marketing section. Narrative: hook, live preview (example data), three annotated features, closing command.
 * Copy rules (D-10): the only billing fact stated is the June 1, 2026 switch; no multipliers, no price-jump
 * figures, no testimonials or user counts. Every number shown comes from the labeled example data.
 */
export function SpendSiteSection() {
  const m = monthModel(DEMO_SUMMARY);
  const mon = monthShort(m.month);
  const topRepo = DEMO_SUMMARY.breakdown.repo[0];
  const repoShare = topRepo ? Math.round((topRepo.costUsd / DEMO_SUMMARY.monthToDateUsd) * 100) : 0;
  const tipSum = DEMO_SUMMARY.tips.reduce((a, b) => a + b.estMonthlySavingsUsd, 0);
  return (
    <section id="spend" className="fls-root fls-site" aria-labelledby="fls-site-h">
      <SpendStyles />
      <div className="fls-site-head">
        <div>
          <span className="fls-eyebrow">fleet-spend</span>
          <h2 id="fls-site-h">
            Know where your month is going, <em>before the bill does.</em>
          </h2>
        </div>
        <div className="fls-site-copy">
          <p>
            <strong>GitHub Copilot moved to usage-based billing on June 1, 2026.</strong> Every agent you run
            now has a meter.
          </p>
          <p>
            fleet-spend adds up Claude Code, Codex, Cursor and Copilot in one total and projects the month
            against your budget.
          </p>
          <p>
            <Icon name="lock" small /> It reads logs on your machine. No account, no upload.
          </p>
        </div>
      </div>

      <figure className="fls-frame">
        <figcaption className="fls-frame-label">
          <span className="fls-badge">Example data</span>
          <span className="fls-panel-note">Synthetic usage, for illustration only</span>
        </figcaption>
        <div className="fls-preview-clip">
          <SpendTab summary={DEMO_SUMMARY} />
        </div>
      </figure>

      <ol className="fls-callouts" aria-label="What it shows">
        <li className="fls-callout-card">
          <span className="fls-eyebrow">01 Forecast</span>
          <h3>See the month end before it arrives.</h3>
          <p>
            Projects month-end spend from your daily run rate, with a range, and marks the day you cross
            budget.
          </p>
          <span className="fls-stat">
            Example: {moneyWhole(m.forecast)} projected
            {m.crossDay !== null ? `, crosses budget ~${mon} ${Math.ceil(m.crossDay)}` : ''}
          </span>
        </li>
        <li className="fls-callout-card">
          <span className="fls-eyebrow">02 Split</span>
          <h3>Every dollar, by repo.</h3>
          <p>Group the month by tool, model, repo, branch, task, session or day, ranked by cost.</p>
          <span className="fls-stat">
            Example: {topRepo?.key} is {repoShare}% of the month
          </span>
        </li>
        <li className="fls-callout-card">
          <span className="fls-eyebrow">03 Savings</span>
          <h3>Specific changes, priced.</h3>
          <p>Each suggestion shows an estimated monthly saving and the assumption behind it.</p>
          <span className="fls-stat">Example: {moneyWhole(tipSum)}/mo across 3 suggestions</span>
        </li>
      </ol>

      <div className="fls-cta">
        <div>
          <h3>Run it on your own month.</h3>
          <p>Node 20 or later. Reads local logs; nothing leaves the machine.</p>
        </div>
        <CopyCmd />
      </div>
    </section>
  );
}
