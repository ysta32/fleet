// Sections that exist only when their packages resolve at build time (see scripts/prebuild.mjs).
import { digestHtml, hasSpend, SpendSiteSection } from '@/lib/optional.generated';

export function DigestSection() {
  if (!digestHtml) return null;
  return (
    <section className="section grain" aria-labelledby="digest-title">
      <div className="wrap split">
        <div className="sticky-col">
          <div className="label-row">
            <span className="label">Overnight digest</span>
          </div>
          <h2 id="digest-title" className="h2" style={{ marginTop: 'var(--fl-space-5)' }}>
            Wake up to <em>what shipped.</em>
          </h2>
          <p className="lead" style={{ marginTop: 'var(--fl-space-5)' }}>
            One screen per morning: merged PRs, deploys, failures and spend, written as a logbook. Example data below.
          </p>
        </div>
        <div className="panel" dangerouslySetInnerHTML={{ __html: digestHtml }} />
      </div>
    </section>
  );
}

export function SpendSection() {
  if (!hasSpend || !SpendSiteSection) return null;
  const Spend = SpendSiteSection;
  return (
    <section className="section grain" aria-label="Spend">
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
