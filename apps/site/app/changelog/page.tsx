import { PageHead } from '@/components/PageHead';
import { readChangelog } from '@/lib/changelog';
import { fleetVersion } from '@/lib/repo';
import { REPO_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'changelog',
  'Changelog',
  'Every Fleet release, generated from CHANGELOG.md in the repository.',
);

/** Renders `code` spans from changelog markdown; everything else is plain text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p,
      )}
    </>
  );
}

export default function Changelog() {
  // An empty [Unreleased] stub has nothing to show; any section with entries is kept.
  const releases = readChangelog().filter((r) => r.intro.length > 0 || r.groups.length > 0);
  return (
    <>
      <PageHead
        label="Changelog"
        title={<>The logbook.</>}
        lead={
          <>
            Generated at build time from <a href={`${REPO_URL}/blob/main/CHANGELOG.md`}>CHANGELOG.md</a>.{' '}
            {releases.some((r) => r.date)
              ? `Newest first. Current release: v${fleetVersion()}.`
              : 'No release has been published yet.'}
          </>
        }
      />
      <div className="wrap page-body article" style={{ gap: 0 }}>
        {releases.length === 0 && <p className="lead">No entries yet.</p>}
        {releases.map((r) => (
          <article className="release" key={r.version} aria-labelledby={`v-${r.version}`}>
            <div className="release-meta">
              <h2 id={`v-${r.version}`} className="h3">
                {/^\d/.test(r.version) ? `v${r.version}` : r.version}
              </h2>
              <span className="label">{r.date ?? 'Not yet released'}</span>
            </div>
            <div style={{ display: 'grid', gap: 'var(--fl-space-4)' }}>
              {r.intro.map((p) => (
                <p key={p}>
                  <Inline text={p} />
                </p>
              ))}
              {r.groups.map((g) => (
                <section key={g.heading} style={{ gap: 'var(--fl-space-3)' }}>
                  <h3 className="label" style={{ marginTop: 0 }}>
                    {g.heading}
                  </h3>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it}>
                        <Inline text={it} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
