import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { ACTIONS_URL, CI_BADGE_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta('status', 'Status', 'Fleet runs on your machine, so there is no service to go down. Build status lives on GitHub Actions.');

export default function Status() {
  return (
    <>
      <PageHead
        label="Status"
        title={<>Nothing to go down.</>}
        lead="Fleet runs on your machine. There is no hosted service, so there is no uptime to report. The build is the thing to watch."
      />
      <div className="wrap page-body" style={{ display: 'grid', gap: 'var(--fl-space-6)', justifyItems: 'start' }}>
        <a href={ACTIONS_URL} className="panel" style={{ textDecoration: 'none', gap: 'var(--fl-space-4)' }}>
          <span className="label">Continuous integration</span>
          <img src={CI_BADGE_URL} alt="CI workflow status badge from GitHub Actions" height={20} width={110} />
          <span className="link-arrow">
            Open GitHub Actions <Icon name="external" />
          </span>
        </a>
        <p className="prose">
          Is your own collector healthy? Run <code>fleet status</code> or <code>fleet doctor</code> on your Mac.
        </p>
      </div>
    </>
  );
}
