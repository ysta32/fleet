// Hero island: the real Fleet visualizer (packages/web/src/viz/FleetScene) driven by the
// synthetic generator from @fleet/shared. Bundled separately by scripts/prebuild.mjs with its own
// React 18 so react-three-fiber v8 never runs inside the Next.js App Router React build.
// It never touches the network: no /api, no live source, synthetic data only.
import { StrictMode, useEffect, useId, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDemoFleet } from '@fleet/shared';
import type { DemoFleet, FleetEvent, FleetSnapshot } from '@fleet/shared';
import FleetScene from '@fleet/web/src/viz/FleetScene';
import { advanceWorld } from '../lib/world.mjs';
import type { FleetView, ReplayControls, Selection } from '@fleet/web/src/data/contract';

export interface MountOptions {
  /** the site's world (lib/world.generated.json): seed, start clock and steps; wins over `seed` */
  world?: { seed: number; start: number; steps: number };
  seed?: number;
  projects?: number;
  /** /demo: add the keyboard index of stations and agents next to the canvas */
  interactive?: boolean;
  /** called after the first rendered frame window, so the poster can fade out */
  onReady?: () => void;
}

const TICK_MS = 250;

function useDemoView(fleet: DemoFleet): FleetView {
  const [snapshot, setSnapshot] = useState<FleetSnapshot>(() => fleet.snapshot());
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [subscribers] = useState(() => new Set<(e: FleetEvent) => void>());

  useEffect(() => {
    let previous = performance.now();
    const timer = window.setInterval(() => {
      if (document.hidden) {
        previous = performance.now();
        return;
      }
      const now = performance.now();
      const next = fleet.tick(now - previous);
      previous = now;
      setSnapshot(fleet.snapshot());
      if (next.length) {
        setEvents((old) => [...old, ...next].slice(-300));
        for (const e of next) for (const cb of subscribers) cb(e);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [fleet, subscribers]);

  return useMemo<FleetView>(() => {
    const at = snapshot.generatedAt;
    const replay: ReplayControls = {
      from: at,
      to: at,
      at,
      playing: false,
      speed: 1,
      seek: () => undefined,
      setPlaying: () => undefined,
      setSpeed: () => undefined,
      load: () => undefined,
      exit: () => undefined,
    };
    return {
      mode: 'demo',
      connected: true,
      snapshot,
      events,
      onEvent(cb) {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
      replay,
      startReplay: () => undefined,
    };
  }, [snapshot, events, subscribers]);
}

const STATUS_WORD: Record<string, string> = {
  working: 'working',
  idle: 'idle',
  waiting: 'needs you',
  done: 'done',
  failed: 'failed',
};

/**
 * Keyboard and screen-reader route into the scene: every station and agent as a button that drives the same
 * selection (camera focus and HUD details panel) as clicking a mesh. Esc clears the selection.
 */
function FleetIndex({
  snapshot,
  selection,
  onSelect,
}: {
  snapshot: FleetSnapshot;
  selection: Selection;
  onSelect(sel: Selection): void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const isSel = (kind: 'project' | 'agent', id: string) => selection?.kind === kind && selection.id === id;
  const select = (kind: 'project' | 'agent', id: string) => onSelect(isSel(kind, id) ? null : { kind, id });
  return (
    <nav
      className="fleet-index"
      aria-label="Fleet index"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selection) {
          e.stopPropagation();
          onSelect(null);
        }
      }}
    >
      <button
        type="button"
        className="fleet-index-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        Stations and agents{' '}
        <span className="num">
          {snapshot.projects.length}/{snapshot.agents.length}
        </span>
      </button>
      <ul id={listId} className="fleet-index-list" hidden={!open}>
        {snapshot.projects.map((p) => {
          const agents = snapshot.agents.filter((a) => a.projectId === p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className="fleet-index-station"
                aria-pressed={isSel('project', p.id)}
                onClick={() => select('project', p.id)}
              >
                {p.name} <span className="num">{agents.length}</span>
              </button>
              {agents.length > 0 && (
                <ul aria-label={`${p.name} agents`}>
                  {agents.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={isSel('agent', a.id)}
                        data-status={a.status}
                        onClick={() => select('agent', a.id)}
                      >
                        {a.label}{' '}
                        <span className="fleet-index-meta">
                          {a.model} · {STATUS_WORD[a.status] ?? a.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Island({ world, seed, projects, interactive, onReady }: MountOptions) {
  const [fleet] = useState(() =>
    world
      ? advanceWorld(createDemoFleet({ seed: world.seed, now: world.start, projects }), world.steps)
      : createDemoFleet({ seed, projects }),
  );
  const view = useDemoView(fleet);
  const [selection, setSelection] = useState<Selection>(null);
  useEffect(() => {
    // Two frames after commit the canvas has drawn at least once.
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => onReady?.());
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [onReady]);
  // A selected agent or station can leave the synthetic fleet; drop the selection rather than point at nothing.
  const snap = view.snapshot;
  useEffect(() => {
    if (!selection || !snap) return;
    const alive =
      selection.kind === 'project'
        ? snap.projects.some((p) => p.id === selection.id)
        : selection.kind === 'agent'
          ? snap.agents.some((a) => a.id === selection.id)
          : snap.sessions.some((x) => x.id === selection.id);
    if (!alive) setSelection(null);
  }, [selection, snap]);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <FleetScene view={view} selection={selection} onSelect={setSelection} />
      {interactive && snap ? (
        <FleetIndex snapshot={snap} selection={selection} onSelect={setSelection} />
      ) : null}
    </div>
  );
}

export function mount(el: HTMLElement, opts: MountOptions = {}): { unmount(): void } {
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <Island {...opts} />
    </StrictMode>,
  );
  return { unmount: () => root.unmount() };
}
