import Link from 'next/link';
import { FleetStage } from '@/components/FleetStage';
import { Icon } from '@/components/Icon';
import { InstallCommand } from '@/components/InstallCommand';
import { CostMath, InboxPreview, PhonePreview, SessionsPreview, TerminalWall } from '@/components/Previews';
import { OptionalSections } from '@/components/Optional';
import { demoPreview } from '@/lib/demo';
import { readChangelog } from '@/lib/changelog';
import { fleetVersion, repoFacts } from '@/lib/repo';
import { INSTALL_CMD, REPO_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'home',
  'Fleet: mission control for Claude Code agents',
  'See every Claude Code agent you run as one live, local fleet. Know which one is waiting on you, what it cost, and what shipped overnight. Free and MIT.',
);

export default function Home() {
  const facts = repoFacts();
  const { totals } = demoPreview();
  const version = fleetVersion();
  const release = readChangelog().find((r) => r.version === version);
  return (
    <>
      {/* 1. Hook */}
      <section className="hero grain" aria-labelledby="hero-title">
        <div className="hero-stage">
          <FleetStage
            signal
            posterAlt="A night harbour of glowing vessels: a synthetic fleet of Claude Code agents grouped by project, one station raising an orange signal"
          />
        </div>
        <div className="hero-horizon" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="wrap hero-copy">
          <p className="label" data-keepout>
            Local mission control for Claude Code
          </p>
          <h1 id="hero-title" className="display display-xl" data-keepout>
            One of your agents is <em className="hero-sync">waiting on you.</em>
          </h1>
          <p className="lead" data-keepout>
            Fleet watches every Claude Code session on your Mac and raises one signal, here and on your phone,
            the moment an agent stops for you.
          </p>
          <div className="hero-actions" data-keepout="children">
            <InstallCommand cmd={INSTALL_CMD} />
            <Link className="link-arrow" href="/demo">
              Open the live demo <Icon name="chevron" />
            </Link>
          </div>
        </div>
        <div className="wrap hero-meta" data-keepout>
          <span className="label">
            <span className="live-dot" aria-hidden="true" />
            Real WebGL render · synthetic fleet
          </span>
          <span className="label">
            {String(totals.projects).padStart(2, '0')} projects · {String(totals.agents).padStart(2, '0')}{' '}
            agents · macOS
          </span>
        </div>
      </section>

      {/* 2. Problem */}
      <section className="section grain" aria-labelledby="problem-title">
        <div className="wrap split">
          <div className="sticky-col" data-reveal>
            <div className="label-row">
              <span className="label sec-n">The problem</span>
            </div>
            <h2 id="problem-title" className="h2" style={{ marginTop: 'var(--fl-space-5)' }}>
              Twelve terminals. One has been waiting <em>forty minutes</em>.
            </h2>
            <div className="prose" style={{ marginTop: 'var(--fl-space-6)' }}>
              <p>
                Parallel agents are fast until one of them asks a question. It does not ping you. It sits in a
                tab behind eleven others, burning your afternoon while the rest of the plan waits on it.
              </p>
              <p>
                <strong>Fleet watches the transcripts Claude Code already writes</strong>, on your machine,
                and tells you which agent needs you, for how long, and what it has cost so far.
              </p>
            </div>
          </div>
          <div data-reveal style={{ ['--i' as string]: 1 }}>
            <TerminalWall />
          </div>
        </div>
      </section>

      {/* 3. Product */}
      <section className="section fl-ink ink-band grain" aria-labelledby="product-title">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <div className="label-row">
              <span className="label sec-n">The product</span>
              <span className="rule" />
            </div>
            <h2 id="product-title" className="h2" style={{ maxWidth: '18ch' }}>
              One harbour. Every agent. One signal when it matters.
            </h2>
            <p className="lead">
              Sessions become vessels, projects become stations, and the one agent that needs you is the only
              thing in orange.
            </p>
          </div>
          <div className="bento">
            <article className="panel" data-reveal>
              <div className="panel-head">
                <span className="label">The live fleet</span>
                <h3 className="h3">Every session is a vessel, grouped by project and army.</h3>
                <p>
                  Vessels move while they work and pulse once when they stop for you. Click one to see its
                  last tool call.
                </p>
              </div>
              <div className="media media-fixed">
                <img
                  src="/poster/fleet-close-1280.webp"
                  alt="Close view of the Fleet 3D scene: vessels around project stations, one glowing orange"
                  loading="lazy"
                  decoding="async"
                  width={1280}
                  height={800}
                />
                <span className="media-tag label">Fleet 3D view · synthetic data</span>
              </div>
            </article>
            <article className="panel" data-reveal style={{ ['--i' as string]: 1 }}>
              <div className="panel-head">
                <span className="label">Needs you</span>
                <h3 className="h3">Ranked by how long they have waited.</h3>
              </div>
              <InboxPreview />
            </article>
            <article className="panel" data-reveal style={{ ['--i' as string]: 2 }}>
              <div className="panel-head">
                <span className="label">Sessions and spend</span>
                <h3 className="h3">Tokens and dollars per session, as they happen.</h3>
              </div>
              <SessionsPreview />
            </article>
          </div>
          <p className="caption" style={{ marginTop: 'var(--fl-space-5)' }}>
            Previews are rendered at build time from Fleet&apos;s deterministic demo generator. No real
            sessions appear on this site.
          </p>
        </div>
      </section>

      <OptionalSections />

      {/* 4. Proof */}
      <section className="section grain" aria-labelledby="proof-title">
        <div className="wrap">
          <div className="head-split">
            <div className="section-head" data-reveal>
              <div className="label-row">
                <span className="label sec-n">Proof</span>
                <span className="rule" />
              </div>
              <h2 id="proof-title" className="h2" style={{ maxWidth: '20ch' }}>
                No logos, no quotes. Read the code.
              </h2>
              <p className="lead">
                Fleet is new and built by one person. These numbers come from the repository at build time, so
                they cannot be inflated.
              </p>
            </div>
            {release ? <ReleaseCard version={version} date={release.date} groups={release.groups} /> : null}
          </div>
          <div className="facts" data-reveal>
            <div className="fact">
              <span className="fact-n">{facts.license}</span>
              <p>Licensed MIT. Free to use, fork and ship. There is no paid tier.</p>
            </div>
            <div className="fact">
              <span className="fact-n">{facts.testCases}</span>
              <p>Test cases across {facts.testFiles} files, run in CI on every push.</p>
            </div>
            <div className="fact">
              <span className="fact-n">127.0.0.1</span>
              <p>The default bind address. Transcripts never leave the machine.</p>
            </div>
            <div className="fact">
              <span className="fact-n">{facts.packages}</span>
              <p>Workspace packages: collector, shared contract, web app and the Halyard design system.</p>
            </div>
          </div>
          <div className="action-links" style={{ marginTop: 'var(--fl-space-7)' }}>
            <a className="link-arrow" href={REPO_URL}>
              Source on GitHub <Icon name="external" />
            </a>
            <Link className="link-arrow" href="/changelog">
              Changelog <Icon name="chevron" />
            </Link>
            <Link className="link-arrow" href="/status">
              CI status <Icon name="chevron" />
            </Link>
          </div>
        </div>
      </section>

      {/* 5. Depth */}
      <section className="section fl-ink ink-band grain" aria-labelledby="depth-title">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <div className="label-row">
              <span className="label sec-n">Under the hood</span>
              <span className="rule" />
            </div>
            <h2 id="depth-title" className="h2" style={{ maxWidth: '18ch' }}>
              Local first. Private by default. Honest about cost.
            </h2>
            <p className="lead">
              One read-only daemon, bound to your own machine. No account, no telemetry, nothing to sign up
              for.
            </p>
          </div>
          <div className="depth">
            <article className="panel" data-reveal>
              <div className="panel-head">
                <span className="label">Architecture</span>
                <h3 className="h3">One read-only daemon on your Mac.</h3>
              </div>
              <Architecture />
            </article>
            <article className="panel" data-reveal style={{ ['--i' as string]: 1 }}>
              <div className="panel-head">
                <span className="label">Privacy defaults</span>
                <h3 className="h3">Safe before you change a setting.</h3>
              </div>
              <dl className="keys">
                <dt>
                  <code>lan</code>
                </dt>
                <dd>false. Binds to 127.0.0.1 until you opt in.</dd>
                <dt>
                  <code>token</code>
                </dt>
                <dd>32 random bytes, generated on first run.</dd>
                <dt>
                  <code>shareContent</code>
                </dt>
                <dd>false. Remote clients get no status or handoff excerpts.</dd>
                <dt>
                  <code>github</code>
                </dt>
                <dd>
                  true. Read-only PR and CI status through your own gh, for repos active in the last 24h.
                </dd>
                <dt>
                  <code>config</code>
                </dt>
                <dd>Written with mode 0600 in ~/.config/fleet.</dd>
              </dl>
            </article>
            <article className="panel" data-reveal>
              <div className="panel-head">
                <span className="label">Phone</span>
                <h3 className="h3">Away from the desk, still on watch.</h3>
                <p>Push alerts through an ntfy topic you own. Open the dashboard over Tailscale.</p>
              </div>
              <PhonePreview />
            </article>
            <article className="panel" data-reveal style={{ ['--i' as string]: 1 }}>
              <div className="panel-head">
                <span className="label">Cost math</span>
                <h3 className="h3">The same arithmetic your invoice uses.</h3>
                <p>
                  Per-model rates, cache reads at a tenth of input, cache writes at 1.25×. Worked example with
                  illustrative token counts:
                </p>
              </div>
              <CostMath />
            </article>
          </div>
        </div>
      </section>

      {/* 6. Action */}
      <section className="action grain" aria-labelledby="action-title">
        <div className="wrap action-grid">
          <div className="label-row">
            <span className="label sec-n">Start</span>
            <span className="rule" />
          </div>
          <h2 id="action-title" className="display display-xl">
            Raise the signal <em>tonight.</em>
          </h2>
          <div className="action-body">
            <p className="lead">
              Node 20 and macOS. One command installs the collector and starts it at login.
            </p>
            <InstallCommand cmd={INSTALL_CMD} />
            <div className="action-links">
              <Link className="link-arrow" href="/docs">
                Read the docs <Icon name="chevron" />
              </Link>
              <a className="link-arrow" href={REPO_URL}>
                Star on GitHub <Icon name="external" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** The current release, read from CHANGELOG.md: tag, date and how many entries each heading carries. */
function ReleaseCard({
  version,
  date,
  groups,
}: {
  version: string;
  date: string | null;
  groups: { heading: string; items: string[] }[];
}) {
  return (
    <aside className="release-card" data-reveal aria-label={`Release v${version}`}>
      <div className="label-row">
        <span className="label">Latest release</span>
        <span className="rule" />
        <span className="label">{date ?? 'unreleased'}</span>
      </div>
      <span className="release-tag">v{version}</span>
      <ul className="release-counts">
        {groups.map((g) => (
          <li key={g.heading}>
            <span className="num">{String(g.items.length).padStart(2, '0')}</span>
            <span>{g.heading.toLowerCase()}</span>
          </li>
        ))}
      </ul>
      <Link className="link-arrow" href="/changelog">
        Read the release notes <Icon name="chevron" />
      </Link>
    </aside>
  );
}

function Architecture() {
  return (
    <div className="arch">
      <div className="arch-boundary">
        <span className="label">Your Mac</span>
        <div className="arch-row">
          <div className="arch-node">
            <strong>Claude Code</strong>
            <code>~/.claude/projects/*.jsonl</code>
          </div>
          <span className="arch-arrow" aria-hidden="true">
            <Icon name="chevron" />
          </span>
          <div className="arch-node arch-node-core">
            <strong>fleet collector</strong>
            <code>127.0.0.1:4747 · token</code>
          </div>
          <span className="arch-arrow" aria-hidden="true">
            <Icon name="chevron" />
          </span>
          <div className="arch-node">
            <strong>Browser</strong>
            <code>3D fleet · dashboard</code>
          </div>
        </div>
      </div>
      <div className="arch-row">
        <div className="arch-node">
          <strong>gh CLI</strong>
          <code>read-only PR and CI status</code>
        </div>
        <span aria-hidden="true" />
        <div className="arch-node">
          <strong>Your phone</strong>
          <code>Tailscale (opt-in LAN)</code>
        </div>
        <span aria-hidden="true" />
        <div className="arch-node">
          <strong>ntfy</strong>
          <code>your topic, opt-in</code>
        </div>
      </div>
    </div>
  );
}
