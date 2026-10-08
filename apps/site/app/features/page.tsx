import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { OptionalSections } from '@/components/Optional';
import { PageHead } from '@/components/PageHead';
import { CostMath, InboxPreview, PhonePreview, ReplayDeck, SessionsPreview } from '@/components/Previews';
import { pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'features',
  'Features',
  'The live 3D fleet, a needs-you inbox, per-session cost, GitHub status, replay and phone alerts. Everything Fleet does, shown with synthetic data.',
);

/** The page's sections in order: the hero index and each section's label read from this one list. */
const FEATURES = [
  { label: 'Live fleet', line: 'Every session as a vessel in one 3D harbour' },
  { label: 'Needs you', line: 'What is waiting on you, longest wait first' },
  { label: 'Sessions and cost', line: 'Tokens and dollars per session, priced per model' },
  { label: 'Phone and alerts', line: 'macOS and ntfy alerts, to a topic you own' },
  { label: 'GitHub and replay', line: 'PR and CI state, and a tape of the last hours' },
] as const;
const featureId = (label: string) => `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export default function Features() {
  return (
    <>
      <PageHead
        aside={
          <nav aria-label="On this page">
            <ol className="feature-index">
              {FEATURES.map((f, i) => (
                <li key={f.label}>
                  <a href={`#${featureId(f.label)}`}>
                    <span className="num">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <b>{f.label}</b>
                      <span>{f.line}</span>
                    </span>
                    <Icon name="chevron" />
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        }
        label="Features"
        title={
          <>
            Everything on one screen, <em>nothing</em> in the cloud.
          </>
        }
        lead="Each capability below is shown with Fleet's synthetic demo data. Nothing here comes from a real session."
      />
      <div className="page-body">
        <Feature
          label={FEATURES[0].label}
          title="A harbour you can read from across the room."
          body={[
            'Each Claude Code session is a vessel; subagents fly with their lead. Projects are stations, armies sit in formation, and tasks orbit as satellites.',
            'Vessels move while they work. When one stops for you it pulses once and keeps a steady glow. Click a vessel for its model, tokens and last tool call.',
          ]}
        >
          <div className="media" style={{ aspectRatio: '16 / 10' }}>
            <img
              src="/poster/fleet-close-1280.webp"
              alt="Fleet 3D view with project stations and agent vessels"
              loading="lazy"
              decoding="async"
              width={1280}
              height={800}
            />
            <span className="media-tag label">Real render · synthetic fleet</span>
          </div>
          <Link className="link-arrow" href="/demo">
            Try it full screen <Icon name="chevron" />
          </Link>
        </Feature>
        <Feature
          label={FEATURES[1].label}
          title="The agent that is waiting goes to the top."
          body={[
            'Waiting sessions, blocked armies, failed CI and failed deploys land in one list, oldest wait first.',
            'Every item names the project and how long it has waited, so you know where to look before you switch windows.',
          ]}
          flip
        >
          <div className="panel">
            <InboxPreview limit={4} />
          </div>
        </Feature>
        <Feature
          label={FEATURES[2].label}
          title="Tokens and dollars, per session, as they happen."
          body={[
            'Fleet reads token usage straight from the transcripts and prices it per model, including cache reads and writes.',
            'Estimates use public list prices. Your invoice is the source of truth; Fleet tells you where the money went.',
          ]}
        >
          <div className="panel">
            <SessionsPreview />
            <CostMath />
          </div>
        </Feature>
        <Feature
          label={FEATURES[3].label}
          title="Leave the desk without losing the thread."
          body={[
            'Alerts go to macOS notifications and, if you set a topic, to ntfy on your phone. You choose which kinds: army finished, army blocked, session waiting, CI failed, deploy failed.',
            'Turn on LAN mode and open the dashboard from your phone over Tailscale. Every request needs your token.',
          ]}
          flip
        >
          <PhonePreview />
        </Feature>
        <Feature
          label={FEATURES[4].label}
          title="Pull requests, CI and the last few hours, in place."
          body={[
            'With the gh CLI signed in, Fleet polls PR and CI state read-only and shows it next to the army that opened the PR.',
            'Replay scrubs back through recent history, so you can see what happened while you were away.',
          ]}
        >
          <ReplayDeck />
          <div className="panel">
            <dl className="keys">
              <dt>
                <code>gh</code>
              </dt>
              <dd>Read-only, polled every 60s by default</dd>
              <dt>
                <code>replay</code>
              </dt>
              <dd>Up to 24 hours, at 1×, 4×, 16× or 60×</dd>
              <dt>
                <code>.orch</code>
              </dt>
              <dd>Task phase, worktrees and blockers when a repo has one</dd>
            </dl>
          </div>
        </Feature>
      </div>
      <OptionalSections />
    </>
  );
}

function Feature({
  label,
  title,
  body,
  children,
  flip = false,
}: {
  label: string;
  title: string;
  body: string[];
  children: React.ReactNode;
  flip?: boolean;
}) {
  const id = featureId(label);
  return (
    <section className="section" aria-labelledby={id}>
      <div className={flip ? 'wrap split split-rev' : 'wrap split'}>
        <div className="sticky-col" data-reveal>
          <span className="label sec-n">{label}</span>
          <h2
            id={id}
            className="h2"
            style={{ marginTop: 'var(--fl-space-4)', fontSize: 'var(--fl-text-2xl)' }}
          >
            {title}
          </h2>
          <div className="prose" style={{ marginTop: 'var(--fl-space-5)' }}>
            {body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
        <div data-reveal style={{ display: 'grid', gap: 'var(--fl-space-5)', ['--i' as string]: 1 }}>
          {children}
        </div>
      </div>
    </section>
  );
}
