import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { OptionalSections } from '@/components/Optional';
import { PageHead } from '@/components/PageHead';
import { CostMath, InboxPreview, PhonePreview, SessionsPreview } from '@/components/Previews';
import { pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'features',
  'Features',
  'The live 3D fleet, a needs-you inbox, per-session cost, GitHub status, replay and phone alerts. Everything Fleet does, shown with synthetic data.',
);

export default function Features() {
  return (
    <>
      <PageHead
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
          n="01"
          label="Live fleet"
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
          n="02"
          label="Needs you"
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
          n="03"
          label="Sessions and cost"
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
          n="04"
          label="Phone and alerts"
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
          n="05"
          label="GitHub and replay"
          title="Pull requests, CI and the last few hours, in place."
          body={[
            'With the gh CLI signed in, Fleet polls PR and CI state read-only and shows it next to the army that opened the PR.',
            'Replay scrubs back through recent history, so you can see what happened while you were away.',
          ]}
        >
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
  n,
  label,
  title,
  body,
  children,
  flip = false,
}: {
  n: string;
  label: string;
  title: string;
  body: string[];
  children: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <section className="section" aria-labelledby={`f-${n}`} style={{ paddingBlock: 'var(--fl-space-9)' }}>
      <div className={flip ? 'wrap split split-rev' : 'wrap split'}>
        <div className="sticky-col" data-reveal>
          <span className="label">
            {n} · {label}
          </span>
          <h2
            id={`f-${n}`}
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
