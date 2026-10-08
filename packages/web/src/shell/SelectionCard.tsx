import type { ReactNode } from 'react';
import type { FleetEvent, FleetSnapshot } from '@fleet/shared';
import type { Selection } from '../data/contract';
import { clockTime, formatCost, formatCount, relativeTime, totalTokens } from '../dashboard/model';
import { Icon } from './Icon';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const TIMELINE_LIMIT = 12;

/**
 * Events that belong to the selection, newest first. A session owns its own events plus those of
 * its agents (lead and subagents); an agent owns events tagged with its id; a project owns every
 * event in it. Built only from the view's event log, so it follows the replay playhead too.
 */
export function selectionEvents(
  snapshot: FleetSnapshot,
  selection: NonNullable<Selection>,
  events: readonly FleetEvent[],
  limit = TIMELINE_LIMIT,
): FleetEvent[] {
  let owns: (event: FleetEvent) => boolean;
  if (selection.kind === 'session') {
    const agents = new Set(
      snapshot.agents.filter((agent) => agent.sessionId === selection.id).map((agent) => agent.id),
    );
    owns = (event) =>
      event.sessionId === selection.id || (event.agentId !== undefined && agents.has(event.agentId));
  } else if (selection.kind === 'agent') {
    owns = (event) => event.agentId === selection.id;
  } else {
    owns = (event) => event.projectId === selection.id;
  }
  return events
    .filter(owns)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

/**
 * Overlaid drawer for whatever is selected in the scene or the tables. It floats above the
 * harbour and the dashboard instead of sitting in the inspector flow, so lists never reflow.
 */
export function SelectionCard({
  snapshot,
  selection,
  events,
  now,
  onClose,
}: {
  snapshot: FleetSnapshot | null;
  selection: Selection;
  events: readonly FleetEvent[];
  now: number;
  onClose(): void;
}) {
  if (!snapshot || !selection) return null;
  const projectName = (id: string) => snapshot.projects.find((project) => project.id === id)?.name ?? id;
  let kind = '';
  let title = '';
  let rows: [string, ReactNode][] = [];
  if (selection.kind === 'session') {
    const session = snapshot.sessions.find((item) => item.id === selection.id);
    if (!session) return null;
    kind = 'Session';
    title = session.title ?? session.id;
    rows = [
      ['Project', projectName(session.projectId)],
      ['Model', <span className={`dashboard-chip model-tag model-${session.model}`}>{session.model}</span>],
      ['Status', <span className={`status status-${session.status}`}>{session.status}</span>],
      [
        'Last tool',
        session.lastTool
          ? `${session.lastTool.name}${session.lastTool.target ? ` · ${session.lastTool.target}` : ''}`
          : '—',
      ],
      ['Tokens', <span className="num">{formatCount(totalTokens(session.tokens))} tok</span>],
      ['Cost', <span className="num">{formatCost(session.costUsd)}</span>],
      ['Active', <span className="num">{relativeTime(session.lastActivity, now)}</span>],
    ];
  } else if (selection.kind === 'agent') {
    const agent = snapshot.agents.find((item) => item.id === selection.id);
    if (!agent) return null;
    kind = 'Agent';
    title = agent.label;
    rows = [
      ['Project', projectName(agent.projectId)],
      ['Role', agent.role],
      ['Model', <span className={`dashboard-chip model-tag model-${agent.model}`}>{agent.model}</span>],
      ['Status', <span className={`status status-${agent.status}`}>{agent.status}</span>],
      ['Tokens', <span className="num">{formatCount(totalTokens(agent.tokens))} tok</span>],
      ['Active', <span className="num">{relativeTime(agent.lastActivity, now)}</span>],
    ];
  } else {
    const project = snapshot.projects.find((item) => item.id === selection.id);
    if (!project) return null;
    const sessions = snapshot.sessions.filter((item) => item.projectId === project.id);
    const working = snapshot.agents.filter(
      (item) => item.projectId === project.id && item.status === 'working',
    );
    kind = 'Project';
    title = project.name;
    rows = [
      ['Branch', <span className="num">{project.branch ?? '—'}</span>],
      ['Sessions', <span className="num">{sessions.length}</span>],
      ['Working', <span className="num">{working.length} agents</span>],
      [
        'Cost',
        <span className="num">{formatCost(sessions.reduce((sum, item) => sum + item.costUsd, 0))}</span>,
      ],
      ['Army', project.orch ? project.orch.phase : 'none'],
    ];
  }
  const timeline = selectionEvents(snapshot, selection, events);
  return (
    <section className="selection-card drawer" aria-label={`Selected ${kind.toLowerCase()}`}>
      <header>
        <p className="micro">{kind}</p>
        <button type="button" className="icon-button" aria-label="Clear selection (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <h2 className="selection-title">{title}</h2>
      <div className="drawer-body">
        <dl className="kv-list">
          {rows.map(([label, value]) => (
            <Row key={label} label={label}>
              {value}
            </Row>
          ))}
        </dl>
        <h3 className="micro drawer-subhead">
          Timeline <span className="num">{timeline.length}</span>
        </h3>
        {timeline.length ? (
          <ol className="drawer-events" aria-label={`Recent events for this ${kind.toLowerCase()}`}>
            {timeline.map((event) => (
              <li key={event.id} className={`drawer-event severity-${event.severity}`}>
                <time
                  className="num"
                  dateTime={new Date(event.ts).toISOString()}
                  title={relativeTime(event.ts, now)}
                >
                  {clockTime(event.ts)}
                </time>
                <i className="sev" aria-label={event.severity} />
                <span className="drawer-event-label">{event.label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="drawer-empty">
            No events in the recent log yet. New tool calls appear here as they happen.
          </p>
        )}
      </div>
    </section>
  );
}
