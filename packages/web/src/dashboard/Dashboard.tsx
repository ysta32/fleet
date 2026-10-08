import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { IconName } from '@fleet/ui';
import type { ModelFamily, OrchTask } from '@fleet/shared';
import type { FleetView, Selection } from '../data/contract';
import { Icon } from '../shell/Icon';
import {
  aggregateFleet,
  clockTime,
  matches,
  needsYou,
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
  /** free-text filter from the command bar (sessions, PRs, events) */
  query?: string;
  /** alert ids the operator cleared locally */
  dismissedAlerts?: ReadonlySet<string>;
  onDismissAlerts?(ids: string[]): void;
  onGo?(tab: DashboardTab): void;
}
function ModelChip({ model, children }: { model: ModelFamily; children?: ReactNode }) {
  return (
    <span className={`dashboard-chip model-tag model-${model}`}>
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
  if (!tasks.length) return <p className="dashboard-empty">No tasks planned yet.</p>;
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
              <rect width="170" height="52" rx="6" />
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

const columns: { key: SessionSortKey; label: string; numeric?: boolean }[] = [
  { key: 'title', label: 'Session' },
  { key: 'project', label: 'Project' },
  { key: 'model', label: 'Model' },
  { key: 'status', label: 'Status' },
  { key: 'lastTool', label: 'Last tool' },
  { key: 'tokens', label: 'Tokens', numeric: true },
  { key: 'cost', label: 'Cost', numeric: true },
  { key: 'lastActivity', label: 'Last activity', numeric: true },
];

const STATUS_ICON: Record<string, IconName> = {
  active: 'live',
  working: 'live',
  waiting: 'waiting',
  idle: 'pause',
  ended: 'check',
  done: 'check',
  failed: 'x',
  blocked: 'blocked',
};

function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <Icon name={STATUS_ICON[value] ?? 'agent'} />
      {value}
    </span>
  );
}

function PanelHead({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <h2 className="panel-title">{title}</h2>
      {meta && <p className="panel-meta">{meta}</p>}
      {children}
    </header>
  );
}

function Empty({
  icon,
  title,
  children,
  quiet,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  /** a sub-block inside a busier panel: no serif headline (one serif moment per screen) */
  quiet?: boolean;
}) {
  return (
    <div className={`dashboard-empty empty${quiet ? ' empty-quiet' : ''}`}>
      <Icon name={icon} className="empty-icon" />
      <p className="empty-title">{title}</p>
      {children && <p className="empty-body">{children}</p>}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <section className="dashboard" aria-busy="true">
      <p role="status" className="sr-only">
        Waiting for fleet data…
      </p>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-block" />
      <div className="skeleton-kpis">
        <div className="skeleton skeleton-kpi" />
        <div className="skeleton skeleton-kpi" />
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="skeleton skeleton-row" style={{ animationDelay: `${index * 24}ms` }} />
      ))}
    </section>
  );
}

const TOKEN_PARTS = [
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
  { key: 'cacheRead', label: 'Cache read' },
  { key: 'cacheWrite', label: 'Cache write' },
] as const;

export default function Dashboard({
  view,
  selection,
  onSelect,
  tab,
  query = '',
  dismissedAlerts,
  onDismissAlerts,
  onGo,
}: DashboardProps) {
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
  if (!snapshot) return <DashboardSkeleton />;
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
  const dismissed = dismissedAlerts ?? new Set<string>();
  const totals = aggregateFleet(snapshot, now);
  const armies = snapshot.projects.filter((project) => project.orch);
  const alerts = snapshot.alerts
    .filter((alert) => !alert.cleared && !dismissed.has(alert.id))
    .sort((a, b) => b.at - a.at);
  const urgent = needsYou(snapshot, dismissed);
  const waiting = snapshot.sessions
    .filter((session) => session.status === 'waiting')
    .sort((a, b) => a.lastActivity - b.lastActivity);
  const blocked = armies.filter(
    (project) =>
      project.orch!.phase === 'blocked' ||
      project.orch!.blocked.length > 0 ||
      project.orch!.tasks.some((task) => task.state === 'blocked'),
  );
  const working = totals.projects.filter((item) => item.working);
  const workingAgents = snapshot.agents.filter((agent) => agent.status === 'working').length;
  const tokenTotal = totalTokens(totals.tokens);
  const events = [...view.events]
    .filter((event) => matches(query, event.label, projectName(event.projectId)))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);
  const lastAlert = snapshot.alerts.reduce((latest, alert) => Math.max(latest, alert.at), 0);
  const sessions = sortSessions(
    snapshot.sessions.filter((session) =>
      matches(
        query,
        session.title,
        session.id,
        projectName(session.projectId),
        session.model,
        session.status,
      ),
    ),
    names,
    sort.key,
    sort.direction,
  );
  const prs = [...snapshot.prs]
    .filter((pr) => matches(query, pr.title, projectName(pr.projectId), `#${pr.number}`, pr.headRef))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <section className="dashboard" aria-label={`${tab === 'prs' ? 'PRs & Deploys' : tab} dashboard`}>
      {tab === 'overview' && (
        <>
          <div className={`needs ${urgent.length ? 'needs-hot' : 'needs-calm'}`} aria-live="polite">
            <p className="micro">Needs you</p>
            {urgent.length ? (
              <>
                <h2 className="needs-title">
                  {urgent.length} {urgent.length === 1 ? 'item is' : 'items are'} waiting on you.
                </h2>
                <ul className="needs-list">
                  {urgent.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <Icon
                        name={
                          item.kind === 'waiting' ? 'waiting' : item.kind === 'blocked' ? 'blocked' : 'alert'
                        }
                      />
                      <span className="needs-text">
                        {projectButton(item.projectId)}
                        <span>{item.title}</span>
                      </span>
                      <time className="num" dateTime={new Date(item.at).toISOString()}>
                        {relativeTime(item.at, now)}
                      </time>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-primary" onClick={() => onGo?.('alerts')}>
                  Review oldest
                  <Icon name="chevron" />
                </button>
              </>
            ) : (
              <>
                <h2 className={`needs-title${snapshot.sessions.length ? '' : ' needs-title-quiet'}`}>
                  {snapshot.sessions.length ? 'Nothing needs you.' : 'Waiting for the first session.'}
                </h2>
                <p className="needs-body">
                  {workingAgents} {workingAgents === 1 ? 'agent' : 'agents'} working across {working.length}{' '}
                  {working.length === 1 ? 'project' : 'projects'}.{' '}
                  {lastAlert ? `Last alert ${relativeTime(lastAlert, now)}.` : 'No alerts recorded.'}
                </p>
              </>
            )}
          </div>

          <dl className="kpis">
            <div className="kpi kpi-hero">
              <dt className="micro">Spend today</dt>
              <dd className="numeral">{formatCost(totals.costToday)}</dd>
              <dd className="kpi-note">
                {formatCost(totals.costTotal)} across {snapshot.sessions.length}{' '}
                {snapshot.sessions.length === 1 ? 'session' : 'sessions'}
              </dd>
            </div>
            <div className="kpi">
              <dt className="micro">Tokens</dt>
              <dd className="numeral numeral-sm">
                {formatCount(tokenTotal)}
                <span className="unit">tok</span>
              </dd>
              <dd className={`token-bar${tokenTotal ? '' : ' is-empty'}`} aria-hidden="true">
                {TOKEN_PARTS.map((part) => (
                  <i
                    key={part.key}
                    className={`token-${part.key}`}
                    style={{ flexGrow: tokenTotal ? totals.tokens[part.key] / tokenTotal : 0 }}
                  />
                ))}
              </dd>
              <dd className="kpi-note sr-only">
                {TOKEN_PARTS.map((part) => `${part.label} ${formatCount(totals.tokens[part.key])}`).join(
                  ' · ',
                )}
              </dd>
            </div>
          </dl>
          <ul className="token-legend" aria-label="Token mix">
            {TOKEN_PARTS.map((part) => (
              <li key={part.key}>
                <i className={`token-${part.key}`} aria-hidden="true" />
                {part.label}
                <span className="num">{formatCount(totals.tokens[part.key])}</span>
              </li>
            ))}
          </ul>

          <section className="block">
            <h3 className="block-title">
              Now working <span className="num count">{working.length}</span>
            </h3>
            {working.length ? (
              <ul className="rows">
                {working.map(({ project, activeByModel, activeAgents }) => (
                  <li key={project.id} className="row" data-selected={selected('project', project.id)}>
                    <span className="row-main">{projectButton(project.id)}</span>
                    <span className="dashboard-chips">
                      {MODEL_FAMILIES.filter((model) => activeByModel[model] > 0).map((model) => (
                        <ModelChip key={model} model={model}>
                          <span className="num"> {activeByModel[model]}</span>
                        </ModelChip>
                      ))}
                    </span>
                    {project.orch && <span className="row-meta">army {project.orch.phase}</span>}
                    <span className="num row-num">
                      {activeAgents} <span className="unit">{activeAgents === 1 ? 'agent' : 'agents'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty quiet icon="pause" title="No projects working right now.">
                Agents appear here the moment a session starts a tool call.
              </Empty>
            )}
          </section>

          <section className="block">
            <h3 className="block-title">Log</h3>
            <ol
              className="dashboard-list dashboard-ticker log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Recent events"
            >
              {events.map((event) => (
                <li key={event.id} className={`log-row severity-${event.severity}`}>
                  <time
                    className="num"
                    dateTime={new Date(event.ts).toISOString()}
                    title={relativeTime(event.ts, now)}
                  >
                    {clockTime(event.ts)}
                  </time>
                  <i className="sev" aria-label={event.severity} />
                  <span className="log-text">
                    {projectButton(event.projectId)} <span className="log-label">{event.label}</span>
                  </span>
                </li>
              ))}
            </ol>
            {!events.length && (
              <Empty quiet icon="live" title={query ? `No events match “${query}”.` : 'No recent events.'}>
                {query
                  ? 'Clear the search with Esc.'
                  : 'Tool calls, merges and deploys stream in here as they happen.'}
              </Empty>
            )}
          </section>
        </>
      )}
      {tab === 'sessions' && (
        <>
          <PanelHead
            title="Sessions"
            meta={
              <>
                <span className="num">{sessions.length}</span>
                {query ? ` matching “${query}”` : ` of ${snapshot.sessions.length}`}
              </>
            }
          />
          {sessions.length > 0 && (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className={column.numeric ? 'numeric' : undefined}
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
                          {sort.key === column.key && (
                            <span className={`sort-caret ${sort.direction}`} aria-hidden="true">
                              <Icon name="chevron" />
                            </span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      data-selected={selected('session', session.id)}
                      className={`row-${session.status}`}
                    >
                      <td data-label="Title" className="cell-title">
                        <button
                          type="button"
                          className="dashboard-link"
                          aria-pressed={selected('session', session.id)}
                          onClick={() => onSelect({ kind: 'session', id: session.id })}
                        >
                          {session.title ?? session.id}
                        </button>
                      </td>
                      <td data-label="Project" className="cell-project">
                        {projectButton(session.projectId)}
                      </td>
                      <td data-label="Model" className="cell-model">
                        <ModelChip model={session.model} />
                      </td>
                      <td data-label="Status" className="cell-status">
                        <Status value={session.status} />
                      </td>
                      <td data-label="Last tool" className="cell-tool">
                        {session.lastTool
                          ? `${session.lastTool.name}${session.lastTool.target ? ` · ${session.lastTool.target}` : ''}`
                          : '—'}
                      </td>
                      <td
                        data-label="Tokens"
                        className="numeric cell-tokens"
                        title={totalTokens(session.tokens).toLocaleString('en-US')}
                      >
                        {formatCount(totalTokens(session.tokens))}
                      </td>
                      <td data-label="Cost" className="numeric cell-cost">
                        {formatCost(session.costUsd)}
                      </td>
                      <td data-label="Last activity" className="numeric cell-time">
                        <time dateTime={new Date(session.lastActivity).toISOString()}>
                          {relativeTime(session.lastActivity, now)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!snapshot.sessions.length && (
            <Empty icon="session" title="No sessions yet.">
              Start Claude Code in any repo and it appears here within 2 seconds.
            </Empty>
          )}
          {snapshot.sessions.length > 0 && !sessions.length && (
            <Empty icon="search" title={`No session matches “${query}”.`}>
              Search covers titles, projects, models and status. Esc clears it.
            </Empty>
          )}
        </>
      )}
      {tab === 'armies' && (
        <>
          <PanelHead
            title="Armies"
            meta={`${armies.length} orchestrated ${armies.length === 1 ? 'project' : 'projects'}`}
          />
          {armies.map((project) => {
            const run = project.orch!;
            const landed = run.tasks.filter((task) => task.state === 'landed').length;
            return (
              <article className="dashboard-army army" key={project.id}>
                <div className="dashboard-card-heading">
                  <h3>{projectButton(project.id)}</h3>
                  <Status value={run.phase} />
                </div>
                <label className="dashboard-progress">
                  <span>
                    <span className="num">
                      {landed} / {run.tasks.length}
                    </span>{' '}
                    tasks landed
                  </span>
                  <progress value={landed} max={Math.max(1, run.tasks.length)} />
                </label>
                <TaskDag tasks={run.tasks} />
                <h4 className="micro">Inflight</h4>
                <ul className="dashboard-list rows">
                  {run.inflight.map((entry, index) => (
                    <li key={`${entry.task}:${entry.role}:${index}`} className="row">
                      <span className="row-main">
                        <span className="num">{entry.task}</span> · {entry.role} · {entry.agent}
                      </span>
                      <span className="row-meta num">
                        {entry.worktree} · started {entry.started}
                      </span>
                    </li>
                  ))}
                </ul>
                {!run.inflight.length && <p className="dashboard-empty quiet">No tasks inflight.</p>}
              </article>
            );
          })}
          {!armies.length && (
            <Empty icon="army" title="No armies running.">
              An army appears when a repo has an orchestrator state folder. Its task graph, inflight agents
              and blockers show here.
            </Empty>
          )}
        </>
      )}
      {tab === 'prs' && (
        <>
          <PanelHead title="PRs & deploys" />
          <section className="block">
            <h3 className="block-title">
              Pull requests <span className="num count">{prs.length}</span>
            </h3>
            <ul className="dashboard-list rows">
              {prs.map((pr) => (
                <li key={`${pr.projectId}:${pr.number}`} className="row row-2">
                  <span className="row-main">
                    <ExternalLink url={pr.url}>
                      <span className="num">#{pr.number}</span> {pr.title}
                    </ExternalLink>
                  </span>
                  <span className={`dashboard-chip ci ci-${pr.ci}`}>
                    <Icon name={pr.ci === 'failure' ? 'x' : pr.ci === 'success' ? 'check' : 'ci'} />
                    CI {pr.ci}
                  </span>
                  <span className="row-meta">
                    {projectButton(pr.projectId)} · {pr.state}
                  </span>
                </li>
              ))}
            </ul>
            {!snapshot.prs.length && (
              <Empty quiet icon="merge" title="No pull requests.">
                Fleet reads PRs and CI with your GitHub token. Run fleet doctor to check it.
              </Empty>
            )}
          </section>
          <section className="block">
            <h3 className="block-title">Releases</h3>
            <ul className="dashboard-list rows">
              {[...snapshot.releases]
                .sort((a, b) => b.publishedAt - a.publishedAt)
                .map((release) => (
                  <li key={`${release.projectId}:${release.tag}`} className="row">
                    <span className="row-main">
                      <ExternalLink url={release.url}>
                        <span className="num">{release.tag}</span> · {release.name}
                      </ExternalLink>
                    </span>
                    <span className="row-meta">{projectButton(release.projectId)}</span>
                    <time className="num row-num" dateTime={new Date(release.publishedAt).toISOString()}>
                      {relativeTime(release.publishedAt, now)}
                    </time>
                  </li>
                ))}
            </ul>
            {!snapshot.releases.length && <p className="dashboard-empty quiet">No releases published yet.</p>}
          </section>
          <section className="block">
            <h3 className="block-title">Deploys</h3>
            <ul className="dashboard-list rows">
              {[...snapshot.deploys]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((deploy) => (
                  <li key={`${deploy.projectId}:${deploy.id}`} className="row">
                    <span className="row-main">
                      <ExternalLink url={deploy.url}>{deploy.environment}</ExternalLink>
                      <span className="row-meta"> · {projectButton(deploy.projectId)}</span>
                    </span>
                    <span className={`dashboard-chip deploy-${deploy.state}`}>{deploy.state}</span>
                    <time className="num row-num" dateTime={new Date(deploy.createdAt).toISOString()}>
                      {relativeTime(deploy.createdAt, now)}
                    </time>
                  </li>
                ))}
            </ul>
            {!snapshot.deploys.length && (
              <p className="dashboard-empty quiet">
                No deploys. Connect Vercel in the collector config to see them.
              </p>
            )}
          </section>
        </>
      )}
      {tab === 'alerts' && (
        <>
          <PanelHead title="Alerts" meta={`${urgent.length} waiting on you`}>
            {alerts.length > 1 && onDismissAlerts && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => onDismissAlerts(alerts.map((alert) => alert.id))}
              >
                <Icon name="check" />
                Clear all
              </button>
            )}
          </PanelHead>
          {blocked.length > 0 && (
            <section className="block">
              <h3 className="block-title">Blocked</h3>
              {blocked.map((project) => (
                <article className="blocked" key={project.id}>
                  <h4>
                    <Icon name="blocked" />
                    {projectButton(project.id)} <span className="row-meta">army {project.orch!.phase}</span>
                  </h4>
                  <ul>
                    {project.orch!.blocked.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                    {project
                      .orch!.tasks.filter((task) => task.state === 'blocked')
                      .map((task) => (
                        <li key={task.id}>
                          <span className="num">{task.id}</span> · {task.slug}
                        </li>
                      ))}
                  </ul>
                </article>
              ))}
            </section>
          )}
          {waiting.length > 0 && (
            <section className="block">
              <h3 className="block-title">
                Waiting on you <span className="num count">{waiting.length}</span>
              </h3>
              <ul className="dashboard-list rows">
                {waiting.map((session) => (
                  <li
                    key={session.id}
                    className="alert-row waiting-row"
                    data-selected={selected('session', session.id)}
                  >
                    <Icon name="waiting" />
                    <div className="alert-text">
                      <button
                        type="button"
                        className="dashboard-link"
                        aria-pressed={selected('session', session.id)}
                        onClick={() => onSelect({ kind: 'session', id: session.id })}
                      >
                        {session.title ?? session.id}
                      </button>
                      <small className="row-meta">
                        {projectButton(session.projectId)} · <span className="num">{session.model}</span> ·
                        waiting{' '}
                        <time dateTime={new Date(session.lastActivity).toISOString()}>
                          {relativeTime(session.lastActivity, now)}
                        </time>
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="block">
            <h3 className="block-title">
              Active <span className="num count">{alerts.length}</span>
            </h3>
            <ul className="dashboard-list rows">
              {alerts.map((alert) => (
                <li key={alert.id} className="alert-row">
                  <Icon name="alert" />
                  <div className="alert-text">
                    <strong>{alert.title}</strong>
                    <p>{alert.body}</p>
                    <small className="row-meta">
                      {projectButton(alert.projectId)} · <span className="num">{alert.kind}</span> ·{' '}
                      <time dateTime={new Date(alert.at).toISOString()}>{relativeTime(alert.at, now)}</time>
                    </small>
                  </div>
                  {onDismissAlerts && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => onDismissAlerts([alert.id])}
                    >
                      Clear
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!urgent.length && (
              <div className="needs needs-calm">
                <h2 className="needs-title">Nothing needs you.</h2>
                <p className="needs-body">
                  {lastAlert ? `Last alert ${relativeTime(lastAlert, now)}.` : 'No alerts recorded yet.'}{' '}
                  Blocked agents, failed CI and spend spikes land here first.
                </p>
              </div>
            )}
            {!alerts.length && urgent.length > 0 && (
              <p className="dashboard-empty quiet">No active alerts.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
