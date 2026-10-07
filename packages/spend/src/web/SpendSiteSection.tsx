import { DEMO_SUMMARY } from './demo.js';
import { Icon } from './icons.js';
import { SpendStyles, SpendTab } from './SpendTab.js';

/**
 * Marketing section. Copy rules (D-10): the only billing fact stated is the June 1, 2026 switch; no multipliers,
 * no price-jump figures, no testimonials or user counts. The preview is clearly labeled as example data.
 */
export function SpendSiteSection() {
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
            fleet-spend adds up Claude Code, Codex, Cursor and Copilot in one total, splits it by repo,
            branch, task and model, and projects the month against your budget.
          </p>
          <p>
            <Icon name="lock" small /> It reads logs on your machine. No account, no upload.
          </p>
          <div className="fls-cmd">npx fleet-spend</div>
        </div>
      </div>
      <figure className="fls-frame">
        <figcaption className="fls-frame-label">
          <span className="fls-badge">Example data</span>
          <span className="fls-panel-note">Synthetic usage, for illustration only</span>
        </figcaption>
        <SpendTab summary={DEMO_SUMMARY} />
      </figure>
    </section>
  );
}
