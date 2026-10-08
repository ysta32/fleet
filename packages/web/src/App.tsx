import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Selection } from './data/contract';
import type { DashboardTab } from './dashboard/Dashboard';
import { PHONE_PRIMARY, TABS } from './shell/tabs';
import { formatCost, needsYou } from './dashboard/model';
import { useFleet } from './data/useFleet';
import { Dashboard, FleetScene } from './shell/slots';
import { ReplayBar, REPLAY_WINDOWS } from './shell/ReplayBar';
import { Icon, Kbd, Mark } from './shell/Icon';
import { ToastProvider, useToast } from './shell/toast';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { useHotkeys } from './shell/hotkeys';
import { CommandPalette } from './shell/CommandPalette';
import { HelpOverlay } from './shell/HelpOverlay';
import { StatusBanner } from './shell/StatusBanner';
import { TokenGate } from './shell/TokenGate';
import { Onboarding } from './shell/Onboarding';
import { SelectionCard } from './shell/SelectionCard';
import { MoreSheet } from './shell/MoreSheet';
import { PhoneAlerts } from './push/PhoneAlerts';
import { useConnection } from './shell/connection';
import { modeOf } from './shell/mode';
import { useShareUrl } from './shell/share';
import { useTheme } from './shell/theme';
import type { PaletteItem } from './shell/palette';
import './styles.css';

const DISMISSED_KEY = 'fleet.dismissedAlerts';

function readDismissed(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const view = useFleet();
  const toast = useToast();
  const theme = useTheme();
  const link = useConnection(view);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<'palette' | 'help' | 'push' | 'more' | null>(null);
  const [sheet, setSheet] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const search = useRef<HTMLInputElement>(null);
  const inspector = useRef<HTMLElement>(null);

  useEffect(() => {
    const failed = (event: Event) =>
      toast.push({
        tone: 'danger',
        message: `Replay unavailable. ${(event as CustomEvent<string>).detail}. Check that the collector is running, then try again.`,
      });
    window.addEventListener('fleet:history-error', failed);
    return () => window.removeEventListener('fleet:history-error', failed);
  }, [toast]);
  useEffect(() => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed].slice(-500)));
    } catch {
      // Dismissals stay in memory when storage is unavailable.
    }
  }, [dismissed]);

  const snapshot = view.snapshot;
  const now = view.mode === 'live' ? Date.now() : (snapshot?.generatedAt ?? Date.now());
  const urgent = useMemo(() => (snapshot ? needsYou(snapshot, dismissed) : []), [snapshot, dismissed]);
  const working = snapshot?.agents.filter((agent) => agent.status === 'working').length ?? 0;
  const startOfDay = new Date(snapshot?.generatedAt ?? Date.now());
  startOfDay.setHours(0, 0, 0, 0);
  const costToday =
    snapshot?.sessions
      .filter((session) => session.startedAt >= startOfDay.getTime())
      .reduce((total, session) => total + session.costUsd, 0) ?? 0;
  const firstRun = !!snapshot && snapshot.sessions.length === 0 && snapshot.projects.length === 0;

  const go = useCallback((next: DashboardTab) => {
    setTab(next);
    setSheet(true);
    inspector.current?.scrollTo({ top: 0 });
  }, []);
  const dismissAlerts = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      setDismissed((previous) => new Set([...previous, ...ids]));
      toast.push({
        message: ids.length === 1 ? 'Alert cleared.' : `${ids.length} alerts cleared.`,
        undo: () =>
          setDismissed((previous) => {
            const next = new Set(previous);
            ids.forEach((id) => next.delete(id));
            return next;
          }),
      });
    },
    [toast],
  );
  const startReplay = useCallback(
    (hours: number) => {
      view.startReplay(hours);
      toast.push({
        tone: 'info',
        message: `Replaying the last ${hours}h. Space plays, [ and ] scrub, L returns to live.`,
      });
    },
    [view, toast],
  );
  const shareUrl = useShareUrl(view.mode !== 'demo');
  const copyLink = useCallback(() => {
    if (!shareUrl) return;
    void navigator.clipboard
      ?.writeText(shareUrl)
      .then(() =>
        toast.push({
          message: 'Link copied. The other device also needs the token: run fleet token on this machine.',
        }),
      )
      .catch(() =>
        toast.push({
          tone: 'danger',
          message: `Clipboard blocked by the browser. Open ${shareUrl} on the other device.`,
        }),
      );
  }, [shareUrl, toast]);
  const linkHint = useCallback(() => {
    toast.push({
      message:
        'No network address to share: remote access is off or this machine is offline. Run fleet token on this machine to get a link.',
    });
  }, [toast]);

  useHotkeys({
    palette: () => setLayer((current) => (current === 'palette' ? null : 'palette')),
    help: () => setLayer((current) => (current === 'help' ? null : 'help')),
    search: () => {
      setLayer(null);
      search.current?.focus();
      search.current?.select();
    },
    escape: () => {
      if (layer) setLayer(null);
      else if (document.activeElement === search.current) {
        setQuery('');
        search.current?.blur();
      } else if (selection) setSelection(null);
      else setSheet(false);
    },
    go: (key) => {
      const target = TABS.find((entry) => entry.key === key) ?? (key === 'd' ? TABS[0] : undefined);
      if (!target) return false;
      go(target.id);
      return true;
    },
    scrub: (direction) => {
      if (view.mode !== 'replay') return;
      const { from, to, at } = view.replay;
      view.replay.seek(at + direction * Math.max(1000, (to - from) * 0.02));
    },
    playPause: () => {
      if (view.mode === 'replay') view.replay.setPlaying(!view.replay.playing);
    },
    live: () => {
      if (view.mode === 'replay') view.replay.exit();
    },
    theme: theme.toggle,
    undo: toast.undoLatest,
  });

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = TABS.map((entry) => ({
      id: `tab:${entry.id}`,
      group: 'Commands',
      label: `Go to ${entry.label === 'PRs' ? 'PRs' : entry.label.toLowerCase()}`,
      icon: entry.icon,
      shortcut: ['G', entry.key.toUpperCase()],
      run: () => go(entry.id),
    }));
    for (const entry of REPLAY_WINDOWS)
      items.push({
        id: `replay:${entry.hours}`,
        group: 'Commands',
        label: entry.hours === 12 ? 'Replay overnight' : `Replay the last ${entry.label}`,
        meta: entry.hours === 12 ? 'last 12h' : undefined,
        icon: 'replay',
        run: () => startReplay(entry.hours),
      });
    if (view.mode === 'replay')
      items.push({
        id: 'live',
        group: 'Commands',
        label: 'Back to live',
        icon: 'live',
        shortcut: ['L'],
        run: view.replay.exit,
      });
    items.push(
      {
        id: 'theme',
        group: 'Commands',
        label: 'Toggle light and dark',
        icon: theme.resolved === 'dark' ? 'sun' : 'moon',
        shortcut: ['T'],
        run: theme.toggle,
      },
      shareUrl
        ? {
            id: 'lan',
            group: 'Commands',
            label: 'Copy link for another device',
            icon: 'phone',
            run: copyLink,
          }
        : {
            id: 'lan',
            group: 'Commands',
            label: 'Open on another device',
            meta: 'run fleet token',
            icon: 'phone',
            run: linkHint,
          },
      {
        id: 'push',
        group: 'Commands',
        label: 'Phone alerts',
        meta: 'notify this device',
        icon: 'bell',
        run: () => setLayer('push'),
      },
      {
        id: 'help',
        group: 'Commands',
        label: 'Keyboard shortcuts',
        icon: 'command',
        shortcut: ['?'],
        run: () => setLayer('help'),
      },
    );
    if (snapshot) {
      const names = new Map(snapshot.projects.map((project) => [project.id, project.name]));
      for (const project of snapshot.projects)
        items.push({
          id: `project:${project.id}`,
          group: 'Projects',
          label: project.name,
          meta: project.branch,
          icon: 'project',
          run: () => setSelection({ kind: 'project', id: project.id }),
        });
      for (const session of snapshot.sessions)
        items.push({
          id: `session:${session.id}`,
          group: 'Sessions',
          label: session.title ?? session.id,
          meta: `${names.get(session.projectId) ?? session.projectId} · ${session.model}`,
          icon: 'session',
          run: () => setSelection({ kind: 'session', id: session.id }),
        });
      for (const agent of snapshot.agents)
        items.push({
          id: `agent:${agent.id}`,
          group: 'Agents',
          label: agent.label,
          meta: `${names.get(agent.projectId) ?? agent.projectId} · ${agent.status}`,
          icon: 'agent',
          run: () => setSelection({ kind: 'agent', id: agent.id }),
        });
    }
    return items;
  }, [
    snapshot,
    view.mode,
    view.replay.exit,
    theme.resolved,
    theme.toggle,
    go,
    startReplay,
    copyLink,
    shareUrl,
    linkHint,
  ]);

  if (link.state === 'unauthorized') return <TokenGate />;

  const pill = modeOf({
    mode: view.mode,
    connected: view.connected,
    link: link.state,
    synthetic: snapshot?.demo === true,
  });
  return (
    <div className={`app${sheet ? ' sheet-open' : ''}${firstRun ? ' first-run' : ''}`} data-mode={view.mode}>
      <a className="skip-link" href="#inspector">
        Skip to dashboard
      </a>
      <header className="command-bar">
        <a className="brand" href={window.location.search || './'} aria-label="Fleet home">
          <Mark className="brand-mark" />
          <span className="brand-name">fleet</span>
        </a>
        <span
          className={`mode mode-${pill.kind}${view.connected ? ' is-on' : ''}`}
          role="status"
          title={
            pill.kind === 'demo'
              ? 'Synthetic demo data'
              : pill.kind === 'offline'
                ? 'Not receiving updates'
                : view.connected
                  ? 'Receiving updates'
                  : 'Not connected'
          }
        >
          <i aria-hidden="true" />
          <span className="mode-label">{pill.label}</span>
        </span>
        <div className="search" role="search">
          <Icon name="search" />
          <input
            ref={search}
            type="search"
            aria-label="Search sessions, projects and PRs"
            placeholder="Search sessions, projects, PRs"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value && tab === 'overview') setTab('sessions');
            }}
          />
          {!query && <Kbd>/</Kbd>}
        </div>
        <dl className="vitals" aria-label="Fleet vitals">
          <div>
            <dt>Working</dt>
            <dd>
              {working}
              <span className="unit">{working === 1 ? 'agent' : 'agents'}</span>
            </dd>
          </div>
          <div title="Estimated spend for sessions started today, local time">
            <dt>Today</dt>
            <dd>{formatCost(costToday)}</dd>
          </div>
        </dl>
        <div className="bar-actions">
          <button
            type="button"
            className="btn btn-quiet palette-trigger"
            onClick={() => setLayer('palette')}
            aria-label="Command palette (Cmd K)"
          >
            <Icon name="command" />
            <span className="palette-trigger-label">Commands</span>
            <Kbd>⌘K</Kbd>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={theme.toggle}
            aria-label={`Switch to ${theme.resolved === 'dark' ? 'light' : 'dark'} theme (T)`}
            title="Toggle theme (T)"
          >
            <Icon name={theme.resolved === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button
            type="button"
            className="icon-button hide-phone"
            onClick={() => setLayer('help')}
            aria-label="Keyboard shortcuts (?)"
            title="Keyboard shortcuts (?)"
          >
            <span className="glyph" aria-hidden="true">
              ?
            </span>
          </button>
        </div>
      </header>

      <div className="banner-slot">
        <StatusBanner
          state={link.state}
          lastUpdate={link.lastUpdate}
          onRetry={async () => {
            const result = await link.retry();
            if (result === 'ok') window.location.reload();
            else if (result === 'down')
              toast.push({
                tone: 'danger',
                message:
                  'Still unreachable. Run fleet doctor on this machine to see why the collector is down.',
              });
          }}
        />
      </div>

      <nav className="rail" aria-label="Sections">
        {TABS.map((entry) => {
          const count = entry.id === 'alerts' ? urgent.length : 0;
          return (
            <button
              key={entry.id}
              type="button"
              className={`rail-item${PHONE_PRIMARY.includes(entry.id) ? '' : ' rail-secondary'}`}
              aria-current={tab === entry.id ? 'page' : undefined}
              onClick={() => go(entry.id)}
              title={`${entry.label} (G ${entry.key.toUpperCase()})`}
            >
              <Icon name={entry.icon} />
              <span className="rail-label">{entry.label}</span>
              {count > 0 && (
                <span className="rail-badge" aria-label={`${count} need you`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className={`rail-item rail-more${PHONE_PRIMARY.includes(tab) ? '' : ' is-current'}`}
          aria-haspopup="dialog"
          aria-expanded={layer === 'more'}
          onClick={() => setLayer('more')}
        >
          <span className="more-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="rail-label">
            More
            {!PHONE_PRIMARY.includes(tab) && (
              <span className="sr-only">, current: {TABS.find((entry) => entry.id === tab)?.label}</span>
            )}
          </span>
        </button>
      </nav>

      <main className="stage" aria-label="Fleet view">
        <div className="stage-backdrop" aria-hidden="true">
          <svg className="range-rings" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMax slice">
            <line x1="0" y1="372" x2="1000" y2="372" />
            {[140, 260, 380, 500, 620].map((r) => (
              <ellipse key={r} cx="500" cy="640" rx={r * 1.35} ry={r * 0.52} />
            ))}
          </svg>
        </div>
        <ErrorBoundary
          area="The 3D view"
          fallbackHint="The dashboard on the right still shows every session."
        >
          <Suspense fallback={null}>
            <div className="scene-slot">
              <FleetScene view={view} selection={selection} onSelect={setSelection} />
            </div>
          </Suspense>
        </ErrorBoundary>
        {firstRun && <Onboarding />}
        {snapshot && !firstRun && (
          <div className="stage-hud" aria-hidden="true">
            <span className="micro">Harbour</span>
            <span className="hud-meta">
              {snapshot.projects.length} {snapshot.projects.length === 1 ? 'project' : 'projects'} ·{' '}
              {snapshot.agents.length} {snapshot.agents.length === 1 ? 'vessel' : 'vessels'}
            </span>
          </div>
        )}
        <ReplayBar view={view} />
      </main>

      <aside className="inspector" id="inspector" ref={inspector} aria-label="Dashboard" tabIndex={-1}>
        <button
          type="button"
          className="sheet-handle"
          onClick={() => setSheet((open) => !open)}
          aria-expanded={sheet}
          aria-label={sheet ? 'Show the harbour' : 'Expand the dashboard'}
        >
          <i aria-hidden="true" />
        </button>
        <ErrorBoundary area="The dashboard" fallbackHint="The harbour view keeps updating.">
          <Suspense fallback={null}>
            <Dashboard
              view={view}
              selection={selection}
              onSelect={setSelection}
              tab={tab}
              query={query}
              dismissedAlerts={dismissed}
              onDismissAlerts={dismissAlerts}
              onGo={go}
            />
          </Suspense>
        </ErrorBoundary>
      </aside>

      <SelectionCard
        snapshot={snapshot}
        selection={selection}
        events={view.events}
        now={view.mode === 'replay' ? view.replay.at : now}
        onClose={() => setSelection(null)}
      />

      {layer === 'palette' && <CommandPalette items={paletteItems} onClose={() => setLayer(null)} />}
      {layer === 'help' && <HelpOverlay onClose={() => setLayer(null)} />}
      {layer === 'push' && <PhoneAlerts onClose={() => setLayer(null)} />}
      {layer === 'more' && (
        <MoreSheet
          current={tab}
          onGo={go}
          onPhoneAlerts={() => setLayer('push')}
          onClose={() => setLayer(null)}
        />
      )}
    </div>
  );
}
