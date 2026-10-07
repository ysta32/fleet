import { useState } from 'react';
import type { Selection } from '../data/contract';
import { isVizDevRequested, useVizDevView } from './devView';
import FleetScene from './FleetScene';

export { isVizDevRequested };

/**
 * DEV ONLY: full-viewport visualizer driven by synthetic data (shared createDemoFleet when exported,
 * else the local devView generator). Renders nothing unless the URL has `?vizdev=1`.
 * Note: FleetScene itself also swaps in the synthetic view under `?vizdev=1`, so screenshots of the
 * real app shell work without wiring this component. Both share one page-level synthetic fleet, so
 * `window.__vizdev.fire` always drives the fleet on screen.
 */
export function VizDevHarness() {
  const view = useVizDevView();
  const [selection, setSelection] = useState<Selection>(null);
  if (!view) return null;
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <FleetScene view={view} selection={selection} onSelect={setSelection} />
    </div>
  );
}
