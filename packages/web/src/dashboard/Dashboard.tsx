import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ModelFamily, OrchTask } from '@fleet/shared';
import type { FleetView, Selection } from '../data/contract';
import {
  aggregateFleet,
  dagLayout,
  formatCost,
  formatCount,
  MODEL_FAMILIES,
  relativeTime,
  sortSessions,
  totalTokens,
} from './model';
import type { SessionSortKey } from './model';
import './dashboard.css';

export type DashboardTab = 'overview' | 'sessions' | 'armies' | 'prs' | 'alerts' | 'overnight';
export interface DashboardProps {
  view: FleetView;
  selection: Selection;
  onSelect(sel: Selection): void;
  tab: DashboardTab;
}
function ModelChip({ model, children }: { model: ModelFamily; children?: ReactNode }) {
  return (
    <span className={`dashboard-chip model-${model}`}>
      {model}
      {children}
    </span>
  );
}

function ExternalLink({ url, children }: { url?: string; children: ReactNode }) {
  if (!url || !/^https?:\/\//i.test(url)) return <span>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function TaskDag({ tasks }: { tasks: OrchTask[] }) {
  const layout = dagLayout(tasks);
  const nodes = new Map(layout.nodes.map((node) => [node.task.id, node]));
  if (!tasks.length) return <p className="dashboard-empty">No tasks yet.</p>;
  return (
    <>
      <div className="dashboard-dag" tabIndex={0} aria-label="Scrollable task dependency graph">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Task dependencies, from left to right"
        >
          {layout.edges.map((edge) => {
            const from = nodes.get(edge.from)!;
            const to = nodes.get(edge.to)!;
            return (
              <path
                key={`${edge.from}:${edge.to}`}
                className="dashboard-edge"
                d={`M ${from.x + 170} ${from.y + 26} C ${from.x + 190} ${from.y + 26}, ${to.x - 20} ${to.y + 26}, ${to.x} ${to.y + 26}`}
              />
            );
          })}
          {layout.nodes.map((node) => (
            <g
              key={node.task.id}
              className={`dashboard-node task-${node.task.state}`}
              transform={`translate(${node.x},${node.y})`}
            >
              <title>{`${node.task.id}: ${node.task.slug} — ${node.task.state}${node.unresolved ? ' (cyclic dependency or downstream of a cycle)' : ''}`}</title>
              <rect width="170" height="52" rx="8" />
              <text x="10" y="21">
                {node.task.id} ·{' '}
                {node.task.slug.length > 15 ? `${node.task.slug.slice(0, 14)}…` : node.task.slug}
              </text>
              <text x="10" y="40" className="dashboard-node-state">
                {node.task.state}
                {node.unresolved ? ' · unresolved' : ''}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {layout.nodes.some((node) => node.unresolved) && (
        <p className="dashboard-warning">Some tasks have cyclic dependencies or depend on a cycle.</p>
      )}
      {layout.missingDependencies.length > 0 && (
        <p className="dashboard-warning">
          Missing dependencies:{' '}
          {layout.missingDependencies.map((item) => `${item.task} → ${item.dependency}`).join(', ')}
        </p>
      )}
    </>
  );
}

const columns: { key: SessionSortKey; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'title', label: 'Title' },
  { key: 'model', label: 'Model' },
  { key: 'status', label: 'Status' },
  { key: 'lastTool', label: 'Last tool' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'cost', label: 'Cost' },
  { key: 'lastActivity', label: 'Last activity' },
];

export default function Dashboard({ view, selection, onSelect, tab }: DashboardProps) {
  const [clock, setClock] = useState(() => Date.now());
  const [sort, setSort] = useState<{ key: SessionSortKey; direction: 'asc' | 'desc' }>({
    key: 'lastActivity',
    direction: 'desc',
  });
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  if (tab === 'overnight') return <div data-slot="overnight" />;
  const snapshot = view.snapshot;
  if (!snapshot)
    return (
      <section className="dashboard">
        <p role="status">Waiting for fleet data…</p>
      </section>
    );
  const now = view.mode === 'replay' ? view.replay.at : view.mode === 'demo' ? snapshot.generatedAt : clock;
  const names = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const projectName = (id: string) => names.get(id) ?? id;
  const selected = (kind: NonNullable<Selection>['kind'], id: string) =>
    selection?.kind === kind && selection.id === id;
  const projectButton = (id: string) => (
    <button
      type="button"
      className="dashboard-link"
      aria-pressed={selected('project', id)}
      onClick={() => onSelect({ kind: 'project', id })}
    >
      {projectName(id)}
    </button>
  );
  const totals = aggregateFleet(snapshot, now);
  const armies = snapshot.projects.filter((project) => project.orch);
  const alerts = snapshot.alerts.filter((alert) => !alert.cleared).sort((a, b) => b.at - a.at);
  const blocked = armies.filter(
    (project) =>
      project.orch!.phase === 'blocked' ||
      project.orch!.blocked.length > 0 ||
      project.orch!.tasks.some((task) => task.state === 'blocked'),
  );
  return (
    <section className="dashboard" aria-label={`${tab === 'prs' ? 'PRs & Deploys' : tab} dashboard`}>
      {tab === 'overview' && (
        <>
          <h2>Overview</h2>
          <div className="dashboard-stats">
            <article className="dashboard-card">
              <h3>Cost today</h3>
              <strong>{formatCost(totals.costToday)}</strong>
              <small>Sessions started today · local time</small>
            </article>
            <article className="dashboard-card">
              <h3>Total cost</h3>
              <strong>{formatCost(totals.costTotal)}</strong>
              <small>Sessions in this snapshot</small>
            </article>
            <article className="dashboard-card">
              <h3>Total tokens</h3>
              <strong>{formatCount(totalTokens(totals.tokens))}</strong>
              <small>
                Input {formatCount(totals.tokens.input)} · output {formatCount(totals.tokens.output)}
              </small>
              <small>
                Cache read {formatCount(totals.tokens.cacheRead)} · write{' '}
                {formatCount(totals.tokens.cacheWrite)}
              </small>
            </article>
          </div>
          <h3>Now working</h3>
          <div className="dashboard-grid">
            {totals.projects
              .filter((item) => item.working)
              .map(({ project, activeByModel, activeAgents }) => (
                <article className="dashboard-card" key={project.id}>
                  <h4>{projectButton(project.id)}</h4>
                  <p>
                    {activeAgents} active {activeAgents === 1 ? 'agent' : 'agents'}
                  </p>
                  <div className="dashboard-chips">
                    {MODEL_FAMILIES.filter((model) => activeByModel[model] > 0).map((model) => (
                      <ModelChip key={model} model={model}>
                        {' '}
                        · {activeByModel[model]}
                      </ModelChip>
                    ))}
                  </div>
                  {project.orch && <small>Army {project.orch.phase}</small>}
                </article>
              ))}
          </div>
          {!totals.projects.some((item) => item.working) && (
            <p className="dashboard-empty">No projects working right now.</p>
          )}
          <h3>Recent events</h3>
          <ol
            className="dashboard-list dashboard-ticker"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Recent events"
          >
            {[...view.events]
              .sort((a, b) => b.ts - a.ts)
              .slice(0, 30)
              .map((event) => (
                <li key={event.id} className={`severity-${event.severity}`}>
                  <span>
                    {projectButton(event.projectId)} · {event.label}
                  </span>
                  <time dateTime={new Date(event.ts).toISOString()}>{relativeTime(event.ts, now)}</time>
                </li>
              ))}
          </ol>
          {!view.events.length && <p className="dashboard-empty">No recent events.</p>}
        </>
      )}
      {tab === 'sessions' && (
        <>
          <h2>Sessions</h2>
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        sort.key === column.key
                          ? sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSort((previous) => ({
                            key: column.key,
                            direction:
                              previous.key === column.key && previous.direction === 'asc' ? 'desc' : 'asc',
                          }))
                        }
                      >
                        {column.label}
                        {sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortSessions(snapshot.sessions, names, sort.key, sort.direction).map((session) => (
                  <tr key={session.id} data-selected={selected('session', session.id)}>
                    <td data-label="Project">{projectButton(session.projectId)}</td>
                    <td data-label="Title">
                      <button
                        type="button"
                        className="dashboard-link"
                        aria-pressed={selected('session', session.id)}
                        onClick={() => onSelect({ kind: 'session', id: session.id })}
                      >
                        {session.title ?? session.id}
                      </button>
                    </td>
                    <td data-label="Model">
                      <ModelChip model={session.model} />
                    </td>
                    <td data-label="Status">{session.status}</td>
                    <td data-label="Last tool">
                      {session.lastTool
                        ? `${session.lastTool.name}${session.lastTool.target ? ` · ${session.lastTool.target}` : ''}`
                        : '—'}
                    </td>
                    <td data-label="Tokens" title={totalTokens(session.tokens).toLocaleString('en-US')}>
                      {formatCount(totalTokens(session.tokens))}
                    </td>
                    <td data-label="Cost">{formatCost(session.costUsd)}</td>
                    <td data-label="Last activity">
                      <time dateTime={new Date(session.lastActivity).toISOString()}>
                        {relativeTime(session.lastActivity, now)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!snapshot.sessions.length && <p className="dashboard-empty">No sessions yet.</p>}
        </>
      )}
      {tab === 'armies' && (
        <>
          <h2>Armies</h2>
          {armies.map((project) => {
            const run = project.orch!;
            const landed = run.tasks.filter((task) => task.state === 'landed').length;
            return (
              <article className="dashboard-card dashboard-army" key={project.id}>
                <div className="dashboard-card-heading">
                  <h3>{projectButton(project.id)}</h3>
                  <span className="dashboard-chip">{run.phase}</span>
                </div>
                <label className="dashboard-progress">
                  {landed} / {run.tasks.length} tasks landed
                  <progress value={landed} max={Math.max(1, run.tasks.length)} />
                </label>
                <TaskDag tasks={run.tasks} />
                <h4>Inflight</h4>
                <ul className="dashboard-list">
                  {run.inflight.map((entry, index) => (
                    <li key={`${entry.task}:${entry.role}:${index}`}>
                      <span>
                        {entry.task} · {entry.role} · {entry.agent}
                      </span>
                      <span>
                        {entry.worktree} · started {entry.started}
                      </span>
                    </li>
                  ))}
                </ul>
                {!run.inflight.length && <p className="dashboard-empty">No tasks inflight.</p>}
              </article>
            );
          })}
          {!armies.length && <p className="dashboard-empty">No orchestration projects.</p>}
        </>
      )}
      {tab === 'prs' && (
        <>
          <h2>PRs &amp; Deploys</h2>
          <h3>Pull requests</h3>
          <ul className="dashboard-list">
            {[...snapshot.prs]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((pr) => (
                <li key={`${pr.projectId}:${pr.number}`}>
                  <span>
                    {projectButton(pr.projectId)} ·{' '}
                    <ExternalLink url={pr.url}>
                      #{pr.number} {pr.title}
                    </ExternalLink>
                  </span>
                  <span>
                    {pr.state} <span className={`dashboard-chip ci-${pr.ci}`}>CI {pr.ci}</span>
                  </span>
                </li>
              ))}
          </ul>
          {!snapshot.prs.length && <p className="dashboard-empty">No pull requests.</p>}
          <h3>Releases</h3>
          <ul className="dashboard-list">
            {[...snapshot.releases]
              .sort((a, b) => b.publishedAt - a.publishedAt)
              .map((release) => (
                <li key={`${release.projectId}:${release.tag}`}>
                  <span>
                    {projectButton(release.projectId)} ·{' '}
                    <ExternalLink url={release.url}>
                      {release.tag} · {release.name}
                    </ExternalLink>
                  </span>
                  <time dateTime={new Date(release.publishedAt).toISOString()}>
                    {relativeTime(release.publishedAt, now)}
                  </time>
                </li>
              ))}
          </ul>
          {!snapshot.releases.length && <p className="dashboard-empty">No releases.</p>}
          <h3>Deploys</h3>
          <ul className="dashboard-list">
            {[...snapshot.deploys]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((deploy) => (
                <li key={`${deploy.projectId}:${deploy.id}`}>
                  <span>
                    {projectButton(deploy.projectId)} ·{' '}
                    <ExternalLink url={deploy.url}>{deploy.environment}</ExternalLink>
                  </span>
                  <span className={`dashboard-chip deploy-${deploy.state}`}>{deploy.state}</span>
                  <time dateTime={new Date(deploy.createdAt).toISOString()}>
                    {relativeTime(deploy.createdAt, now)}
                  </time>
                </li>
              ))}
          </ul>
          {!snapshot.deploys.length && <p className="dashboard-empty">No deploys.</p>}
        </>
      )}
      {tab === 'alerts' && (
        <>
          <h2>Alerts</h2>
          <h3>Blocked items</h3>
          {blocked.map((project) => (
            <article className="dashboard-card" key={project.id}>
              <h4>
                {projectButton(project.id)} · {project.orch!.phase}
              </h4>
              <ul>
                {project.orch!.blocked.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
                {project
                  .orch!.tasks.filter((task) => task.state === 'blocked')
                  .map((task) => (
                    <li key={task.id}>
                      {task.id} · {task.slug}
                    </li>
                  ))}
              </ul>
            </article>
          ))}
          {!blocked.length && <p className="dashboard-empty">No blocked items.</p>}
          <h3>Active alerts</h3>
          <ul className="dashboard-list">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <div>
                  {projectButton(alert.projectId)} · <strong>{alert.title}</strong>
                  <p>{alert.body}</p>
                  <small>{alert.kind}</small>
                </div>
                <time dateTime={new Date(alert.at).toISOString()}>{relativeTime(alert.at, now)}</time>
              </li>
            ))}
          </ul>
          {!alerts.length && <p className="dashboard-empty">No active alerts.</p>}
        </>
      )}
    </section>
  );
}
