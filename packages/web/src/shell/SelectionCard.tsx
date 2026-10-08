import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { FleetEvent, FleetSnapshot } from '@fleet/shared';
import type { Selection } from '../data/contract';
import { formatCost, formatCount, relativeTime, timeTitle, totalTokens } from '../dashboard/model';
import { timelineGroups, timelineRows } from './timeline';
import { Icon } from './Icon';
import { useDrawer, useMediaQuery } from './modal';

/** The drawer shares the inspector's grid cell, so the inspector is what it covers. */
const coversInspector = (element: Element) => element.classList.contains('inspector');

/**
 * Dialog shell for the drawer. Stays mounted while the selection changes, so focus moves in once
 * on open and returns to the invoking element on close. Modal (focus trapped, everything else
 * inert) on phones where it is a sheet; elsewhere only the covered inspector is inert.
 */
function Drawer({
  kind,
  title,
  onClose,
  children,
}: {
  kind: string;
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const id = useId();
  const node = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const modal = useMediaQuery('(max-width: 767px)');
  useDrawer(node, heading, modal, coversInspector);
  return (
    <section
      ref={node}
      className="selection-card drawer"
      data-fl-overlay
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-kind`}
    >
      <header>
        <p id={`${id}-kind`} className="micro">
          {kind}
        </p>
        <button type="button" className="icon-button" aria-label="Close details (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <h2 ref={heading} id={`${id}-title`} className="selection-title" tabIndex={-1}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const TIMELINE_LIMIT = 12;

/** True when the drawer can show this selection (its entity exists in the snapshot). */
export function selectionShown(snapshot: FleetSnapshot | null, selection: Selection): boolean {
  if (!snapshot || !selection) return false;
  const list =
    selection.kind === 'session'
      ? snapshot.sessions
      : selection.kind === 'agent'
        ? snapshot.agents
        : snapshot.projects;
  return list.some((item) => item.id === selection.id);
}

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
    // a lead agent shares its session's id; session events without an agent tag are the lead's own
    const lead = snapshot.agents.some(
      (agent) => agent.id === selection.id && agent.sessionId === selection.id,
    );
    owns = (event) =>
      event.agentId === selection.id ||
      (lead && event.agentId === undefined && event.sessionId === selection.id);
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
  const groups = new Set(timeline.map((event) => event.taskId ?? '')).size;
  return (
    <Drawer kind={kind} title={title} onClose={onClose}>
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
          <ol
            className="drawer-events"
            aria-label={`Recent events for this ${kind.toLowerCase()}, oldest first`}
          >
            {timelineGroups(timeline).map((group) => (
              <li key={group.key} className="drawer-group">
                {(group.task !== null || groups > 1) && (
                  <h4 className="micro drawer-group-head num">{group.task ?? 'Other activity'}</h4>
                )}
                <ol className="drawer-group-events">
                  {timelineRows(group.events).map(({ event, time, run, follows }, index, rows) => (
                    <li
                      key={event.id}
                      className={`drawer-event severity-${event.severity}${follows ? ' drawer-event-follows' : ''}${rows[index + 1]?.follows ? ' drawer-event-joined' : ''}`}
                    >
                      <time
                        className={`num${index > 0 ? ' drawer-event-delta' : ''}`}
                        dateTime={new Date(event.ts).toISOString()}
                        title={
                          run > 1
                            ? `${timeTitle(event.ts, now)} · ${run} events in the same second`
                            : timeTitle(event.ts, now)
                        }
                      >
                        {follows ? <span className="sr-only">same second</span> : time}
                      </time>
                      <i className="sev" aria-label={event.severity} />
                      <span className="drawer-event-label">{event.label}</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        ) : (
          <p className="drawer-empty">
            No events in the recent log yet. New tool calls appear here as they happen.
          </p>
        )}
      </div>
    </Drawer>
  );
}
