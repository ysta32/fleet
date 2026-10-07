// Hero island: the real Fleet visualizer (packages/web/src/viz/FleetScene) driven by the
// synthetic generator from @fleet/shared. Bundled separately by scripts/prebuild.mjs with its own
// React 18 so react-three-fiber v8 never runs inside the Next.js App Router React build.
// It never touches the network: no /api, no live source, synthetic data only.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDemoFleet } from '@fleet/shared';
import type { DemoFleet, FleetEvent, FleetSnapshot } from '@fleet/shared';
import { FleetSceneStandalone } from '@fleet/web/src/viz/FleetScene';
import type { FleetView, ReplayControls } from '@fleet/web/src/data/contract';

export interface MountOptions {
  seed?: number;
  projects?: number;
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

function Island({ seed, projects, onReady }: MountOptions) {
  const [fleet] = useState(() => createDemoFleet({ seed, projects }));
  const view = useDemoView(fleet);
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
  return <FleetSceneStandalone view={view} />;
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
