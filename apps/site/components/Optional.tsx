// Sections that exist only when their packages resolve at build time (see scripts/prebuild.mjs).
import { digestCss, digestHtml, hasSpend, SpendSiteSection } from '@/lib/optional.generated';

export function DigestSection() {
  if (!digestHtml) return null;
  return (
    <section className="section grain" aria-labelledby="digest-title">
      <div className="wrap split">
        <div className="sticky-col">
          <div className="label-row">
            <span className="label">02 · Overnight digest</span>
            <span className="rule" />
          </div>
          <h2 id="digest-title" className="h2" style={{ marginTop: 'var(--fl-space-5)' }}>
            Wake up to <em>what shipped.</em>
          </h2>
          <p className="lead" style={{ marginTop: 'var(--fl-space-5)' }}>
            One page each morning: merged PRs, deploys, CI failures and what needs you first, across every repo.
            Rendered at build time by the real digest renderer from its synthetic demo fixture.
          </p>
        </div>
        <figure className="digest-frame">
          {digestCss ? <style dangerouslySetInnerHTML={{ __html: digestCss }} /> : null}
          <div
            className="digest-scroll"
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

export function SpendSection() {
  if (!hasSpend || !SpendSiteSection) return null;
  const Spend = SpendSiteSection;
  return (
    // SpendSiteSection brings its own vertical rhythm and container; only the page gutter is added here.
    <section className="grain" aria-label="Spend">
      <div className="wrap">
        <Spend />
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
