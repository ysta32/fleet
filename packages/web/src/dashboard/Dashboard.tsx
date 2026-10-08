import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { IconName } from '@fleet/ui';
import type { ModelFamily, OrchTask } from '@fleet/shared';
import type { FleetView, Selection } from '../data/contract';
import { Icon } from '../shell/Icon';
import { Overnight } from './Overnight.jsx';
import { Spend } from './Spend';
import { DAG_NODE_H, DAG_NODE_W, dagEdgePaths, dagFit, dagFocusNode, dagVisibleHeight } from './dag';
import {
  aggregateFleet,
  clockTime,
  matches,
  needsYou,
  nowWorking,
  dagLayout,
  formatCost,
  formatCount,
  MODEL_FAMILIES,
  relativeTime,
  sortSessions,
  timeTitle,
  totalTokens,
} from './model';
import type { SessionSortKey } from './model';
import './dashboard.css';

export type DashboardTab = 'overview' | 'sessions' | 'armies' | 'prs' | 'alerts' | 'overnight' | 'spend';
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
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const focus = dagFocusNode(layout);
  const focusKey = focus ? `${focus.task.id}:${focus.task.state}` : '';
  const fit = dagFit(layout, viewport, focus);
  const [scrollLeft, setScrollLeft] = useState(0);
  const frame = useRef(0);
  const height = fit.scroll ? dagVisibleHeight(layout, fit.scale, scrollLeft, viewport) : fit.height;
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // track the scroller's width: the graph scales to fit it, or scrolls when that would be too small
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewport(Math.round(element.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tasks.length]);
  // bring the blocked (else running) task into view whenever it changes, snapped to column gaps
  useEffect(() => {
    const element = scroller.current;
    if (!element || !viewport) return;
    element.scrollTo({ left: fit.scrollLeft, behavior: 'auto' });
    setScrollLeft(element.scrollLeft);
    // keyed on the focus task, graph width and viewport only: a re-render with the same focus keeps the user's scroll
  }, [focusKey, layout.width, viewport]);
  if (!tasks.length) return <p className="dashboard-empty">No tasks planned yet.</p>;
  return (
    <>
      <div
        ref={scroller}
        className="dashboard-dag"
        data-scroll={fit.scroll ? '1' : '0'}
        // a scrolled graph is as tall as the rows in view, so a one-row stretch leaves no dead space
        style={viewport && fit.scroll ? { height } : undefined}
        onScroll={(event) => {
          const element = event.currentTarget;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setScrollLeft(element.scrollLeft));
        }}
        tabIndex={fit.scroll ? 0 : undefined}
        aria-label={fit.scroll ? 'Scrollable task dependency graph' : undefined}
      >
        <svg
          style={
            viewport
              ? { width: fit.width, height: fit.height }
              : { width: '100%', maxWidth: layout.width, height: 'auto' }
          }
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Task dependencies, from left to right"
        >
          {dagEdgePaths(layout).map((edge) => (
            <path key={`${edge.from}:${edge.to}`} className="dashboard-edge" d={edge.d} />
          ))}
          {layout.nodes.map((node) => (
            <g
              key={node.task.id}
              className={`dashboard-node task-${node.task.state}`}
              transform={`translate(${node.x},${node.y})`}
            >
              <title>{`${node.task.id}: ${node.task.slug} — ${node.task.state}${node.unresolved ? ' (cyclic dependency or downstream of a cycle)' : ''}`}</title>
              <rect width={DAG_NODE_W} height={DAG_NODE_H} rx="6" />
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

const CI_LABEL: Record<string, string> = {
  success: 'CI passed',
  failure: 'CI failed',
  pending: 'CI running',
  none: 'No CI',
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

type SessionSort = { key: SessionSortKey; direction: 'asc' | 'desc' };

/**
 * Sort control for the compact (card) layout, where the table header and its sort buttons are
 * hidden. Shown only by the narrow-width container query in dashboard.css.
 */
function CompactSort({ sort, onSort }: { sort: SessionSort; onSort: (sort: SessionSort) => void }) {
  const id = useId();
  const descending = sort.direction === 'desc';
  return (
    <div className="compact-sort">
      <label htmlFor={id}>Sort</label>
      <select
        id={id}
        value={sort.key}
        onChange={(event) => onSort({ key: event.target.value as SessionSortKey, direction: sort.direction })}
      >
        {columns.map((column) => (
          <option key={column.key} value={column.key}>
            {column.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={
          descending ? 'Sorted descending, switch to ascending' : 'Sorted ascending, switch to descending'
        }
        onClick={() => onSort({ key: sort.key, direction: descending ? 'asc' : 'desc' })}
      >
        <span className={`sort-caret ${sort.direction}`} aria-hidden="true">
          <Icon name="chevron" />
        </span>
        {descending ? 'Desc' : 'Asc'}
      </button>
    </div>
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
  if (tab === 'overnight') return <Overnight view={view} />;
  if (tab === 'spend') return <Spend demo={view.mode === 'demo' || view.snapshot?.demo === true} />;
  const snapshot = view.snapshot;
  if (!snapshot) return <DashboardSkeleton />;
  const now = view.mode === 'replay' ? view.replay.at : view.mode === 'demo' ? snapshot.generatedAt : clock;
  /** synthetic fleet: empty states explain the demo instead of pointing at setup commands */
  const demo = view.mode === 'demo' || snapshot.demo === true;
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
  const nowWork = nowWorking(snapshot, now);
  const working = nowWork.rows;
  const workingAgents = nowWork.agents;
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
                      <time
                        className="num"
                        dateTime={new Date(item.at).toISOString()}
                        title={timeTitle(item.at, now)}
                      >
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
                  {snapshot.sessions.length
                    ? `${workingAgents} ${workingAgents === 1 ? 'agent' : 'agents'} working across ${working.length} ${working.length === 1 ? 'project' : 'projects'}. `
                    : 'Blocked agents, failed CI and spend spikes surface here first. '}
                  {lastAlert ? `Last alert ${relativeTime(lastAlert, now)}.` : 'No alerts yet.'}
                </p>
              </>
            )}
          </div>

          {snapshot.sessions.length > 0 && (
            <dl className="kpis">
              <div className="kpi kpi-hero">
                <dt className="micro">Spend today</dt>
                <dd className="numeral">{formatCost(totals.costToday)}</dd>
                <dd
                  className="kpi-note"
                  title={
                    totals.spend.earlierUsd >= 0.005
                      ? 'Today counts sessions started since local midnight; earlier is sessions started before it'
                      : undefined
                  }
                >
                  {totals.spend.earlierUsd >= 0.005
                    ? `${formatCost(totals.costToday)} today across ${totals.spend.todaySessions} ${totals.spend.todaySessions === 1 ? 'session' : 'sessions'} · ${formatCost(totals.spend.earlierUsd)} earlier`
                    : `Across ${snapshot.sessions.length} ${snapshot.sessions.length === 1 ? 'session' : 'sessions'}`}
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
          )}
          {tokenTotal > 0 && (
            <ul className="token-legend" aria-label="Token mix">
              {TOKEN_PARTS.map((part) => (
                <li key={part.key}>
                  <i className={`token-${part.key}`} aria-hidden="true" />
                  {part.label}
                  <span className="num">{formatCount(totals.tokens[part.key])}</span>
                </li>
              ))}
            </ul>
          )}

          <section className="block">
            <h3 className="block-title">
              Now working{' '}
              <span className="num count">
                {nowWork.agents} {nowWork.agents === 1 ? 'agent' : 'agents'} · {nowWork.projects}{' '}
                {nowWork.projects === 1 ? 'project' : 'projects'}
              </span>
            </h3>
            {working.length ? (
              <ul className="rows">
                {working.map(({ project, activeByModel, activeAgents, reason }) => (
                  <li
                    key={project.id}
                    className="row row-working"
                    data-selected={selected('project', project.id)}
                  >
                    <span className="row-main">{projectButton(project.id)}</span>
                    <span className="num row-num">
                      {reason === 'agents' ? (
                        <>
                          {activeAgents}{' '}
                          <span className="unit">{activeAgents === 1 ? 'agent' : 'agents'}</span>
                        </>
                      ) : (
                        <span className="unit">
                          {reason === 'session' ? 'session active' : 'army running'}
                        </span>
                      )}
                    </span>
                    <span className="dashboard-chips">
                      {MODEL_FAMILIES.filter((model) => activeByModel[model] > 0).map((model) => (
                        <ModelChip key={model} model={model}>
                          <span className="num"> {activeByModel[model]}</span>
                        </ModelChip>
                      ))}
                      {project.orch && reason !== 'army' && (
                        <span className="row-meta">army {project.orch.phase}</span>
                      )}
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
                    title={timeTitle(event.ts, now)}
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
                  : demo
                    ? 'Synthetic tool calls, merges and deploys stream in here as the demo runs.'
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
          >
            {sessions.length > 0 && <CompactSort sort={sort} onSort={setSort} />}
          </PanelHead>
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
                        <time
                          dateTime={new Date(session.lastActivity).toISOString()}
                          title={timeTitle(session.lastActivity, now)}
                        >
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
            <Empty icon="session" title={demo ? 'The demo fleet is between sessions.' : 'No sessions yet.'}>
              {demo
                ? 'Synthetic sessions come and go as the demo runs. On your machine, a Claude Code session appears here within 2 seconds.'
                : 'Start Claude Code in any repo and it appears here within 2 seconds.'}
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
            <Empty icon="army" title={demo ? 'No armies in the demo right now.' : 'No armies running.'}>
              {demo
                ? 'Synthetic armies come and go as the demo runs. Each shows its task graph, inflight agents and blockers here.'
                : 'An army appears when a repo has an orchestrator state folder. Its task graph, inflight agents and blockers show here.'}
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
                  <span className={`ci ci-${pr.ci}`}>
                    <Icon name={pr.ci === 'failure' ? 'x' : pr.ci === 'success' ? 'check' : 'ci'} />
                    {CI_LABEL[pr.ci] ?? `CI ${pr.ci}`}
                  </span>
                  <span className="row-meta">
                    {projectButton(pr.projectId)} · {pr.state}
                  </span>
                </li>
              ))}
            </ul>
            {!snapshot.prs.length && (
              <Empty
                quiet
                icon="merge"
                title={demo ? 'No pull requests in the demo yet.' : 'No pull requests.'}
              >
                {demo
                  ? 'The demo fleet has nothing open right now. On your machine, Fleet reads PRs and CI with your GitHub token.'
                  : 'Fleet reads PRs and CI with your GitHub token. Run fleet doctor to check it.'}
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
                    <time
                      className="num row-num"
                      dateTime={new Date(release.publishedAt).toISOString()}
                      title={timeTitle(release.publishedAt, now)}
                    >
                      {relativeTime(release.publishedAt, now)}
                    </time>
                  </li>
                ))}
            </ul>
            {!snapshot.releases.length && (
              <p className="dashboard-empty quiet">
                {demo ? 'No releases in the demo yet.' : 'No releases published yet.'}
              </p>
            )}
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
                    <time
                      className="num row-num"
                      dateTime={new Date(deploy.createdAt).toISOString()}
                      title={timeTitle(deploy.createdAt, now)}
                    >
                      {relativeTime(deploy.createdAt, now)}
                    </time>
                  </li>
                ))}
            </ul>
            {!snapshot.deploys.length && (
              <p className="dashboard-empty quiet">
                {demo
                  ? 'No deploys in the demo yet.'
                  : 'No deploys. Connect Vercel in the collector config to see them.'}
              </p>
            )}
          </section>
        </>
      )}
      {tab === 'alerts' && (
        <>
          <PanelHead title="Alerts" meta={urgent.length ? `${urgent.length} waiting on you` : undefined}>
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
          <section className="block">
            {urgent.length > 0 && (
              <h3 className="block-title">
                Needs you <span className="num count">{urgent.length}</span>
              </h3>
            )}
            <ul className="dashboard-list rows">
              {urgent.map((incident) => (
                <li
                  key={incident.id}
                  className={`alert-row incident-row incident-${incident.kind}`}
                  data-selected={incident.sessionId ? selected('session', incident.sessionId) : undefined}
                >
                  <Icon
                    name={
                      incident.kind === 'waiting'
                        ? 'waiting'
                        : incident.kind === 'blocked'
                          ? 'blocked'
                          : 'alert'
                    }
                  />
                  <div className="alert-text">
                    <strong>{incident.title}</strong>
                    {incident.body && <p>{incident.body}</p>}
                    {(incident.reasons.length > 1 || incident.reasons.some((reason) => reason.text)) && (
                      <ul className="incident-reasons" aria-label="Reasons">
                        {incident.reasons.map((reason) => (
                          <li key={`${reason.label}:${reason.text ?? ''}`}>
                            {reason.label}
                            {reason.text ? <span className="row-meta"> · {reason.text}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <small className="row-meta">
                      {projectButton(incident.projectId)}
                      {incident.reasons.length === 1 &&
                        !incident.reasons[0]!.text &&
                        ` · ${incident.reasons[0]!.label}`}
                      {incident.sessionId && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="dashboard-link"
                            aria-pressed={selected('session', incident.sessionId)}
                            onClick={() => onSelect({ kind: 'session', id: incident.sessionId! })}
                          >
                            {incident.sessionTitle ?? incident.sessionId}
                          </button>
                        </>
                      )}
                      {' · '}
                      <time
                        dateTime={new Date(incident.at).toISOString()}
                        title={timeTitle(incident.at, now)}
                      >
                        {relativeTime(incident.at, now)}
                      </time>
                    </small>
                  </div>
                  {onDismissAlerts && incident.alertIds.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => onDismissAlerts(incident.alertIds)}
                    >
                      Clear
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!urgent.length && (
              <Empty quiet icon="check" title="Nothing needs you.">
                {lastAlert ? `Last alert ${relativeTime(lastAlert, now)}.` : 'No alerts recorded yet.'}{' '}
                Blocked agents, failed CI and spend spikes land here first.
              </Empty>
            )}
          </section>
        </>
      )}
    </section>
  );
}
