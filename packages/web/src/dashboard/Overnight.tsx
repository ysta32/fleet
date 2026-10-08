import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetView } from '../data/contract';
import { fetchHistory } from '../data/liveSource';
import {
  fetchDigest,
  getDemoDigest,
  getDemoDigestHistory,
  safeDigestUrl,
  summarizeDigest,
} from './overnight';
import type { OvernightDigest } from './overnight';

const panel: CSSProperties = {
  color: 'var(--fl-fg)',
  fontFamily: 'var(--fl-font-sans)',
  padding: 'var(--fl-space-6)',
  background: 'var(--fl-gradient-surface), var(--fl-surface-1)',
  border: 'var(--fl-hairline) solid var(--fl-border)',
  borderRadius: 'var(--fl-radius-lg)',
  lineHeight: 'var(--fl-leading-normal)',
  overflowWrap: 'anywhere',
};
const muted: CSSProperties = { color: 'var(--fl-fg-muted)', fontSize: 'var(--fl-text-sm)' };
const button: CSSProperties = {
  background: 'var(--fl-accent)',
  color: 'var(--fl-accent-fg)',
  border: 0,
  borderRadius: 'var(--fl-radius-sm)',
  padding: 'var(--fl-space-4) var(--fl-space-5)',
  font: 'inherit',
  cursor: 'pointer',
};
const healthLabels = { red: 'Needs attention', yellow: 'Worth a look', green: 'Healthy', quiet: 'Quiet' };
const healthColors = {
  red: 'var(--fl-danger)',
  yellow: 'var(--fl-warn)',
  green: 'var(--fl-success)',
  quiet: 'var(--fl-fg-muted)',
};

function ActivityLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeDigestUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--fl-fg)' }}>
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

export function Overnight({ view }: { view: FleetView }) {
  const demo = view.mode === 'demo' || view.snapshot?.demo === true;
  const [digest, setDigest] = useState<OvernightDigest | null | undefined>(() =>
    demo ? getDemoDigest() : undefined,
  );
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState(false);
  const replayRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setDigest(demo ? getDemoDigest() : undefined);
    setReplayError(false);
    setReplaying(false);
    if (!demo) {
      void fetchDigest(controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setDigest(result);
        },
        () => {
          if (!controller.signal.aborted) setError(true);
        },
      );
    }
    return () => {
      controller.abort();
      replayRequest.current?.abort();
    };
  }, [demo, attempt]);

  async function replay() {
    if (!digest || replaying) return;
    const controller = new AbortController();
    replayRequest.current?.abort();
    replayRequest.current = controller;
    setReplaying(true);
    setReplayError(false);
    try {
      const model = summarizeDigest(digest);
      if (demo) {
        view.replay.load(getDemoDigestHistory());
        view.replay.setPlaying(true);
      } else {
        const history = await fetchHistory(model.from, model.to, controller.signal);
        if (!controller.signal.aborted) {
          if (!history.frames?.length) throw new Error('No replay frames');
          view.replay.load(history);
          view.replay.setPlaying(true);
        }
      }
    } catch {
      if (!controller.signal.aborted) setReplayError(true);
    } finally {
      if (!controller.signal.aborted) setReplaying(false);
    }
  }

  const model = digest ? summarizeDigest(digest) : null;
  return (
    <section style={panel} aria-label="Since you left">
      <header>
        <p style={{ ...muted, fontFamily: 'var(--fl-font-mono)', margin: 0 }}>
          OVERNIGHT{demo ? ' / DEMO' : ''}
        </p>
        <h2
          style={{
            fontFamily: 'var(--fl-font-display)',
            fontSize: 'var(--fl-text-3xl)',
            fontWeight: 400,
            letterSpacing: 'var(--fl-tracking-display)',
            lineHeight: 'var(--fl-leading-tight)',
            margin: 'var(--fl-space-3) 0 var(--fl-space-5)',
          }}
        >
          Since you left
        </h2>
      </header>
      {error ? (
        <div role="alert">
          <h3>The digest is out of reach.</h3>
          <p style={muted}>We couldn’t load your overnight activity. Try again in a moment.</p>
          <button type="button" style={button} onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : digest === undefined ? (
        <div role="status" aria-label="Loading overnight digest" aria-busy="true">
          <p style={muted}>Gathering the night’s activity…</p>
          {[100, 75, 45].map((width) => (
            <div
              key={width}
              aria-hidden="true"
              style={{
                width: `${width}%`,
                height: 'var(--fl-space-6)',
                marginBlock: 'var(--fl-space-4)',
                background: 'var(--fl-skeleton)',
                borderRadius: 'var(--fl-radius-sm)',
              }}
            />
          ))}
        </div>
      ) : !model ? (
        <div style={{ paddingBlock: 'var(--fl-space-7)' }}>
          <h3
            style={{ fontFamily: 'var(--fl-font-display)', fontSize: 'var(--fl-text-2xl)', fontWeight: 400 }}
          >
            Your first morning starts here.
          </h3>
          <p style={muted}>
            No overnight digest yet. Once a digest is published, your merges, releases and projects needing
            attention will appear here.
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 'var(--fl-text-lg)', maxWidth: 'var(--fl-measure)' }}>{model.headline}</p>
          <p style={muted}>
            <time dateTime={model.window.since}>{new Date(model.from).toLocaleString()}</time> →{' '}
            <time dateTime={model.window.until}>{new Date(model.to).toLocaleString()}</time>
          </p>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))',
              gap: 'var(--fl-space-5)',
              marginBlock: 'var(--fl-space-7)',
            }}
          >
            {model.metrics.map((metric) => (
              <div
                key={metric.label}
                style={{
                  borderTop: 'var(--fl-hairline) solid var(--fl-border-strong)',
                  paddingTop: 'var(--fl-space-4)',
                }}
              >
                <dt style={muted}>{metric.label}</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--fl-font-mono)', fontSize: 'var(--fl-text-2xl)' }}>
                  {metric.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <button type="button" style={button} disabled={replaying} onClick={() => void replay()}>
            {replaying ? 'Loading replay…' : 'Replay the night'}
          </button>
          {replayError && (
            <p role="alert" style={{ color: 'var(--fl-danger)' }}>
              Replay is unavailable for this window. Try again in a moment.
            </p>
          )}
          <h3 style={{ marginTop: 'var(--fl-space-7)' }}>
            Across your projects <span style={muted}>· {model.needsAttention} need attention</span>
          </h3>
          {!model.projects.length && <p style={muted}>No project activity in this window.</p>}
          {model.projects.map((project) => (
            <article
              key={project.id}
              style={{
                borderTop: 'var(--fl-hairline) solid var(--fl-border)',
                paddingBlock: 'var(--fl-space-5)',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--fl-space-4)' }}
              >
                <h4 style={{ margin: 0, fontSize: 'var(--fl-text-lg)' }}>{project.name}</h4>
                <span
                  style={{
                    fontFamily: 'var(--fl-font-mono)',
                    fontSize: 'var(--fl-text-xs)',
                    color: healthColors[project.health],
                    border: 'var(--fl-hairline) solid var(--fl-border-strong)',
                    borderRadius: 'var(--fl-radius-pill)',
                    padding: 'var(--fl-space-1) var(--fl-space-3)',
                  }}
                >
                  {healthLabels[project.health]}
                </span>
              </div>
              <p style={muted}>{project.summary}</p>
              {project.mergedPRs.length > 0 && (
                <>
                  <h5>Merged pull requests</h5>
                  <ul>
                    {project.mergedPRs.map((pr) => (
                      <li key={pr.number}>
                        <ActivityLink url={pr.url}>
                          #{pr.number} · {pr.title}
                        </ActivityLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {project.releases.length > 0 && (
                <>
                  <h5>Releases</h5>
                  <ul>
                    {project.releases.map((release) => (
                      <li key={release.tag}>
                        <ActivityLink url={release.url}>
                          {release.tag} · {release.name}
                        </ActivityLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {project.ciFailures.length > 0 && (
                <>
                  <h5 style={{ color: 'var(--fl-danger)' }}>CI failures</h5>
                  <ul>
                    {project.ciFailures.map((run) => (
                      <li key={run.runId}>
                        <ActivityLink url={run.url}>
                          {run.workflow} · {run.branch}
                        </ActivityLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

export default Overnight;
