import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Selection } from '../data/contract';
import { createDevFleet, type DevFleet } from './devView';
import FleetScene from './FleetScene';

/** True when the page was opened with `?vizdev=1` (dev-only visualizer harness). */
export function isVizDevRequested(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): boolean {
  const v = new URLSearchParams(search).get('vizdev');
  return v !== null && v !== '0' && v !== 'false';
}

/**
 * DEV ONLY: full-viewport visualizer driven by the synthetic devView generator.
 * The app shell decides when to render this (e.g. when isVizDevRequested()).
 */
export function VizDevHarness({ seed, projects }: { seed?: number; projects?: number }) {
  const [fleet] = useState<DevFleet>(() => createDevFleet({ seed, projects }));
  useEffect(() => {
    fleet.start();
    return () => fleet.stop();
  }, [fleet]);
  const view = useSyncExternalStore(fleet.subscribe, fleet.view);
  const [selection, setSelection] = useState<Selection>(null);
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <FleetScene view={view} selection={selection} onSelect={setSelection} />
    </div>
  );
}
