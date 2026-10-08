import { useEffect, useState } from 'react';
import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import type { FleetMode } from './contract';
import { currentDemoFleet } from './demoSource';
import { fetchHistory } from './liveSource';

/** live mode: the tape shows the last hour */
export const LIVE_WINDOW_MS = 3_600_000;
/** how often the live tape reloads its hour of history */
const TAPE_REFRESH_MS = 30_000;

/**
 * The last hour of history for the live (non-replay) tape: the demo fleet's own history, or
 * /api/history from the collector, refreshed every 30s while live and the tab is visible. Null in replay, before the first
 * load, and after a failed fetch (the tape then falls back to the streamed events).
 */
export function useLiveTape(mode: FleetMode): HistoryResponse | null {
  const [tape, setTape] = useState<HistoryResponse | null>(null);
  useEffect(() => {
    if (mode === 'replay') {
      setTape(null);
      return;
    }
    let controller: AbortController | null = null;
    const load = () => {
      // a hidden tab does not poll; it reloads the moment it is shown again
      if (document.hidden) return;
      if (mode === 'demo') {
        setTape(currentDemoFleet().history(LIVE_WINDOW_MS / 3_600_000));
        return;
      }
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const to = Date.now();
      fetchHistory(to - LIVE_WINDOW_MS, to, current.signal).then(
        (history) => {
          if (!current.signal.aborted) setTape(history);
        },
        () => {
          // an unreachable collector already shows the offline banner; the tape uses streamed events
          if (!current.signal.aborted) setTape(null);
        },
      );
    };
    // after the commit's effects, so the demo fleet useFleet creates exists before the first read
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, TAPE_REFRESH_MS);
    const shown = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', shown);
      controller?.abort();
    };
  }, [mode]);
  return tape;
}

/**
 * The live tape's history: the loaded hour plus streamed events newer than it, ending at the live
 * snapshot (the last frame), so the open notch is the incident the dashboard lists right now.
 */
export function liveHistory(
  tape: HistoryResponse | null,
  snapshot: FleetSnapshot,
  events: readonly FleetEvent[],
): HistoryResponse {
  const to = snapshot.generatedAt;
  const from = to - LIVE_WINDOW_MS;
  const seen = new Set(tape?.events.map((event) => event.id));
  const streamed = events.filter((event) => !seen.has(event.id) && event.ts >= from && event.ts <= to);
  const frames = (tape?.frames ?? []).filter((frame) => frame.generatedAt < to);
  return {
    from,
    to,
    frames: [...frames, snapshot].sort((a, b) => a.generatedAt - b.generatedAt),
    events: [...(tape?.events.filter((event) => event.ts >= from && event.ts <= to) ?? []), ...streamed].sort(
      (a, b) => a.ts - b.ts,
    ),
  };
}
