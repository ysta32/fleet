import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { InstallCommand } from '@/components/InstallCommand';
import { PageHead } from '@/components/PageHead';
import { INSTALL_CMD, REPO_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'pricing',
  'Pricing',
  'Fleet is free and open source under the MIT license. No tiers, no seats, no account.',
);

const POINTS = [
  [
    'Free, with no tiers',
    'There is no Pro plan, no seat count and no trial. Every feature is in the free download.',
  ],
  ['MIT licensed', 'Use it at work, change it, ship a fork. Keep the copyright notice and the license text.'],
  [
    'No account',
    'Fleet runs on your machine. There is nothing to sign up for and no server of ours to talk to.',
  ],
  [
    'Your model bill is separate',
    'Fleet estimates what your agents cost. It does not add to that cost or resell anything.',
  ],
  [
    'No warranty',
    'It is provided as is. If it breaks, open an issue; fixes are best effort by one developer.',
  ],
] as const;

export default function Pricing() {
  return (
    <>
      <PageHead
        label="Pricing"
        title={
          <>
            Free. MIT. <em>That is the whole page.</em>
          </>
        }
      />
      <div className="wrap page-body price">
        <div style={{ display: 'grid', gap: 'var(--fl-space-5)', alignContent: 'start' }}>
          <span className="price-figure">$0</span>
          <p className="lead">For one developer or a hundred. Today and after v1.</p>
          <InstallCommand cmd={INSTALL_CMD} />
          <div className="action-links">
            <a className="link-arrow" href={`${REPO_URL}/blob/main/LICENSE`}>
              Read the license <Icon name="external" />
            </a>
            <Link className="link-arrow" href="/terms">
              Terms in plain language <Icon name="chevron" />
            </Link>
          </div>
        </div>
        <ul className="ledger">
          {POINTS.map(([t, d], i) => (
            <li key={t}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{t}</strong>
                <span>{d}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
