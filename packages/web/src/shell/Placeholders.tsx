import type { FleetSceneProps } from '../viz/FleetScene';
import type { DashboardProps } from '../dashboard/Dashboard';

export function FleetScene({ view, selection, onSelect }: FleetSceneProps) {
  return (
    <div className="fleet-placeholder">
      <div className="orbit orbit-outer" aria-hidden="true" />
      <div className="orbit orbit-inner" aria-hidden="true" />
      <p className="eyebrow">Fleet telemetry</p>
      <h1>Your mission control.</h1>
      <p>{view.snapshot ? 'Select a project to inspect its activity.' : 'Waiting for the collector…'}</p>
      <div className="project-nodes">
        {view.snapshot?.projects.map((project) => (
          <button
            key={project.id}
            className="project-node"
            aria-pressed={selection?.kind === 'project' && selection.id === project.id}
            onClick={() => onSelect({ kind: 'project', id: project.id })}
          >
            <span className="node-light" />
            {project.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Dashboard({ view, selection, tab }: DashboardProps) {
  return (
    <div className="dashboard-placeholder">
      <p className="eyebrow">{tab}</p>
      <h2>{selection ? 'Selection locked' : 'Fleet overview'}</h2>
      <p>{selection?.id ?? 'Select a project or agent in the scene.'}</p>
      <div className="telemetry-summary">
        <span>Sessions</span>
        <strong>{view.snapshot?.sessions.length ?? 0}</strong>
      </div>
      <div className="telemetry-summary">
        <span>Open pull requests</span>
        <strong>{view.snapshot?.prs.filter((pr) => pr.state === 'open').length ?? 0}</strong>
      </div>
      <p className="eyebrow">Recent signals</p>
      <ul className="signal-list">
        {view.events
          .slice(-8)
          .reverse()
          .map((event) => (
            <li key={event.id}>
              <time>{new Date(event.ts).toLocaleTimeString()}</time>
              <span>{event.label}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
