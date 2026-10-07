import Link from 'next/link';
import { DemoStage } from '@/components/DemoStage';
import { Icon } from '@/components/Icon';
import { pageMeta } from '@/lib/site';

export const metadata = pageMeta('demo', 'Live demo', 'The real Fleet 3D view, running in your browser on synthetic data. Drag to orbit, scroll to zoom, click a vessel.');

export default function Demo() {
  return (
    <section className="demo-stage fl-ink" aria-labelledby="demo-title">
      <h1 id="demo-title" className="sr-only">
        Fleet live demo
      </h1>
      <DemoStage />
      <div className="demo-bar">
        <span>
          <strong>Synthetic fleet.</strong>{' '}
          <span style={{ color: 'var(--fl-fg-muted)' }}>Drag to orbit, scroll to zoom, click a vessel for details.</span>
        </span>
        <Link className="link-arrow" href="/docs#install">
          Install Fleet <Icon name="chevron" />
        </Link>
      </div>
    </section>
  );
}
