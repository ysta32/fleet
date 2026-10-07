import { Suspense, useEffect, useState } from 'react';
import type { Selection } from './data/contract';
import type { DashboardTab } from './dashboard/Dashboard';
import { useFleet } from './data/useFleet';
import { Dashboard, FleetScene } from './shell/slots';
import { ReplayBar } from './shell/ReplayBar';
import './styles.css';

const tabs: DashboardTab[] = ['overview', 'sessions', 'armies', 'prs', 'alerts', 'overnight'];

export function App() {
  const view = useFleet();
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('fleet:history-error', failed);
    return () => window.removeEventListener('fleet:history-error', failed);
  }, []);
  const startOfDay = new Date(view.snapshot?.generatedAt ?? Date.now());
  startOfDay.setHours(0, 0, 0, 0);
  const cost =
    view.snapshot?.sessions
      .filter((session) => session.startedAt >= startOfDay.getTime())
      .reduce((total, session) => total + session.costUsd, 0) ?? 0;
  return (
    <div className="app-shell">
      <header className="top-bar">
        <a className="wordmark" href={window.location.search || './'} aria-label="Fleet home">
          <span aria-hidden="true">◈</span> FLEET
        </a>
        <span className={`mode-pill ${view.connected ? 'connected' : ''}`}>
          <i />
          {view.mode}
        </span>
        <div className="fleet-counts">
          <div>
            <strong>{view.snapshot?.projects.length ?? 0}</strong>
            <span>Projects</span>
          </div>
          <div>
            <strong>{view.snapshot?.agents.filter((agent) => agent.status === 'working').length ?? 0}</strong>
            <span>Active agents</span>
          </div>
          <div title="Estimated total for sessions started today">
            <strong>${cost.toFixed(2)}</strong>
            <span>Today · est.</span>
          </div>
        </div>
        <span className="connection-status" role="status">
          {view.connected ? 'Signal online' : 'Reconnecting…'}
        </span>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      <main className="mission-layout">
        <section className="scene" aria-label="Fleet visualization">
          <Suspense fallback={<p className="loading">Loading fleet…</p>}>
            <FleetScene view={view} selection={selection} onSelect={setSelection} />
          </Suspense>
        </section>
        <aside className="drawer" aria-label="Fleet dashboard">
          <nav className="drawer-tabs" aria-label="Dashboard sections">
            {tabs.map((name) => (
              <button
                key={name}
                className={tab === name ? 'selected' : ''}
                aria-pressed={tab === name}
                onClick={() => setTab(name)}
              >
                {name === 'prs' ? 'PRs' : name}
              </button>
            ))}
          </nav>
          <div className="drawer-content">
            <Suspense fallback={<p className="loading">Loading dashboard…</p>}>
              <Dashboard view={view} selection={selection} onSelect={setSelection} tab={tab} />
            </Suspense>
          </div>
        </aside>
      </main>
      <ReplayBar view={view} />
    </div>
  );
}
