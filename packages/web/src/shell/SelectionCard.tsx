import type { ReactNode } from 'react';
import type { FleetSnapshot } from '@fleet/shared';
import type { Selection } from '../data/contract';
import { formatCost, formatCount, relativeTime, totalTokens } from '../dashboard/model';
import { Icon } from './Icon';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Docked inspector header for whatever is selected in the scene or the tables. */
export function SelectionCard({
  snapshot,
  selection,
  now,
  onClose,
}: {
  snapshot: FleetSnapshot | null;
  selection: Selection;
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
  return (
    <section className="selection-card" aria-label={`Selected ${kind.toLowerCase()}`}>
      <header>
        <p className="micro">{kind}</p>
        <button type="button" className="icon-button" aria-label="Clear selection (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <h2 className="selection-title">{title}</h2>
      <dl className="kv-list">
        {rows.map(([label, value]) => (
          <Row key={label} label={label}>
            {value}
          </Row>
        ))}
      </dl>
    </section>
  );
}
