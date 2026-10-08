import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { LostVessel } from '@/components/LostVessel';

export const metadata = { title: 'Off the chart', robots: { index: false } };

export default function NotFound() {
  return (
    <section className="wrap lost" aria-labelledby="lost-title">
      <LostVessel />
      <div className="lost-copy">
        <span className="label">404 · No such page</span>
        <h1 id="lost-title" className="display display-xl" style={{ maxWidth: '12ch' }}>
          Off the <em>chart.</em>
        </h1>
        <p className="lead">This page is not in the logbook. It may have moved, or the link has a typo.</p>
        <div className="action-links">
          <Link className="link-arrow" href="/">
            Back to the harbour <Icon name="chevron" />
          </Link>
          <Link className="link-arrow" href="/docs">
            Read the docs <Icon name="chevron" />
          </Link>
        </div>
      </div>
    </section>
  );
}
