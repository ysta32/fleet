import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../shell/Icon';
import type { FleetView } from '../data/contract';
import { fetchHistory } from '../data/liveSource';
import {
  fetchDigest,
  getDemoDigest,
  getDemoDigestHistory,
  safeDigestUrl,
  formatWindow,
  summarizeDigest,
} from './overnight';
import type { OvernightDigest } from './overnight';

const LEAD_METRICS = new Set(['PRs merged', 'CI failures']);
const healthLabels = { red: 'Needs attention', yellow: 'Worth a look', green: 'Healthy', quiet: 'Quiet' };

function ActivityLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeDigestUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
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
  const lead = model?.metrics.filter((metric) => LEAD_METRICS.has(metric.label)) ?? [];
  const rest = model?.metrics.filter((metric) => !LEAD_METRICS.has(metric.label)) ?? [];
  return (
    <section className="dashboard overnight" aria-label="Since you left">
      <header className="panel-head">
        <h2 className="panel-title">Since you left</h2>
        {model && <p className="panel-meta num">{formatWindow(model.from, model.to)}</p>}
        {demo && <span className="tag">Synthetic</span>}
      </header>
      {error ? (
        <div className="empty" role="alert">
          <Icon name="offline" className="empty-icon" />
          <p className="empty-title">The digest is out of reach.</p>
          <p className="empty-body">
            Fleet could not load the overnight digest from the collector. Check that it is running, then try
            again.
          </p>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <Icon name="undo" />
            Try again
          </button>
        </div>
      ) : digest === undefined ? (
        <div
          className="overnight-loading"
          role="status"
          aria-label="Loading overnight digest"
          aria-busy="true"
        >
          {[100, 75, 45].map((width) => (
            <div
              key={width}
              aria-hidden="true"
              className="skeleton skeleton-row"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : !model ? (
        <div className="empty">
          <Icon name="moon" className="empty-icon" />
          <p className="empty-title">Your first morning starts here.</p>
          <p className="empty-body">
            No overnight digest yet. After the first night with a published digest, merges, releases and the
            projects that need you appear here.
          </p>
        </div>
      ) : (
        <>
          <p className="overnight-lead">{model.headline}</p>
          <dl className="overnight-metrics">
            {lead.map((metric) => (
              <div
                key={metric.label}
                className={`overnight-metric overnight-metric-lead${metric.label === 'CI failures' && metric.value > 0 ? ' is-bad' : ''}`}
              >
                <dt className="micro">{metric.label}</dt>
                <dd className="numeral">{metric.value.toLocaleString()}</dd>
              </div>
            ))}
            {rest.map((metric) => (
              <div key={metric.label} className="overnight-metric">
                <dt>{metric.label}</dt>
                <dd className="num">{metric.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <div className="overnight-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={replaying}
              onClick={() => void replay()}
            >
              <Icon name="replay" />
              {replaying ? 'Loading replay…' : 'Replay the night'}
            </button>
            {replayError && (
              <p role="alert" className="overnight-error">
                Replay is unavailable for this window. Try again in a moment.
              </p>
            )}
          </div>
          <section className="block">
            <h3 className="block-title">
              Projects <span className="num count">{model.projects.length}</span>
              {model.needsAttention > 0 && (
                <span className="block-note">{model.needsAttention} need attention</span>
              )}
            </h3>
            {!model.projects.length && (
              <p className="dashboard-empty quiet">No project activity in this window.</p>
            )}
            {model.projects.map((project) => (
              <article key={project.id} className={`overnight-project health-${project.health}`}>
                <header>
                  <h4>{project.name}</h4>
                  <span className="overnight-health">
                    <i aria-hidden="true" />
                    {healthLabels[project.health]}
                  </span>
                </header>
                <p className="overnight-summary">{project.summary}</p>
                {(project.mergedPRs.length > 0 ||
                  project.releases.length > 0 ||
                  project.ciFailures.length > 0) && (
                  <ul className="overnight-items">
                    {project.ciFailures.map((run) => (
                      <li key={`ci:${run.runId}`} className="is-bad">
                        <Icon name="x" />
                        <ActivityLink url={run.url}>
                          CI failed · {run.workflow} · <span className="num">{run.branch}</span>
                        </ActivityLink>
                      </li>
                    ))}
                    {project.mergedPRs.map((pr) => (
                      <li key={`pr:${pr.number}`}>
                        <Icon name="merge" />
                        <ActivityLink url={pr.url}>
                          <span className="num">#{pr.number}</span> {pr.title}
                        </ActivityLink>
                      </li>
                    ))}
                    {project.releases.map((release) => (
                      <li key={`rel:${release.tag}`}>
                        <Icon name="release" />
                        <ActivityLink url={release.url}>
                          <span className="num">{release.tag}</span> {release.name}
                        </ActivityLink>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}

export default Overnight;
