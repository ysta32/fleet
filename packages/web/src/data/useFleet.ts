import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoFleet, FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import type { FleetView, ReplayControls } from './contract';
import { createDemoSource } from './demoSource';
import { connectLive, fetchHistory } from './liveSource';
import { advancePlayhead, clampPlayhead, eventsCrossed, normalizeHistory, reconstruct } from './replay';

/** Replays also load this much before the window, so the log has context at the window start. */
const PREROLL_MS = 15 * 60_000;

/**
 * The replay window [to - durationMs, to] of a history loaded with pre-roll: frames and events before
 * the window stay (the playhead's snapshot and log read them), but the tape starts at the window.
 */
export function windowed(history: HistoryResponse, durationMs: number): HistoryResponse {
  return { ...history, from: Math.max(history.from, history.to - durationMs) };
}

interface Playback {
  history: HistoryResponse;
  at: number;
  playing: boolean;
  speed: number;
}

export function useFleet(): FleetView {
  const [demo] = useState(
    () =>
      new URLSearchParams(window.location.search).get('demo') === '1' ||
      import.meta.env.VITE_FLEET_DEMO === '1',
  );
  const source = useRef<DemoFleet | null>(null);
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const subscribers = useRef(new Set<(event: FleetEvent) => void>());
  const request = useRef<AbortController | null>(null);
  const updatePlayback = useCallback((next: Playback | null) => {
    playbackRef.current = next;
    setPlayback(next);
  }, []);
  const emit = useCallback((event: FleetEvent) => {
    for (const cb of subscribers.current) cb(event);
  }, []);
  const onEvent = useCallback((cb: (event: FleetEvent) => void) => {
    subscribers.current.add(cb);
    return () => {
      subscribers.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    const receive = (event: FleetEvent) => {
      setEvents((previous) => [...previous, event].slice(-300));
      if (!playbackRef.current) emit(event);
    };
    if (!demo) {
      let stopped = false;
      let disconnect: (() => void) | undefined;
      queueMicrotask(() => {
        if (!stopped) {
          disconnect = connectLive({ snapshot: setSnapshot, event: receive, connected: setConnected });
        }
      });
      return () => {
        stopped = true;
        disconnect?.();
      };
    }
    const fleet = createDemoSource();
    source.current = fleet;
    setSnapshot(fleet.snapshot());
    setConnected(true);
    let previous = performance.now();
    const timer = setInterval(() => {
      const current = performance.now();
      const nextEvents = fleet.tick(current - previous);
      previous = current;
      setSnapshot(fleet.snapshot());
      nextEvents.forEach(receive);
    }, 250);
    return () => {
      clearInterval(timer);
      source.current = null;
    };
  }, [demo, emit]);

  useEffect(() => {
    let previous = performance.now();
    let animation: number;
    const tick = (now: number) => {
      const current = playbackRef.current;
      if (current?.playing) {
        const at = advancePlayhead(current.history, current.at, now - previous, current.speed);
        updatePlayback({ ...current, at, playing: at < current.history.to });
        eventsCrossed(current.history, current.at, at).forEach(emit);
      }
      previous = now;
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [emit, updatePlayback]);
  useEffect(() => () => request.current?.abort(), []);

  const load = useCallback(
    (history: HistoryResponse) => {
      request.current?.abort();
      updatePlayback({ history: normalizeHistory(history), at: history.from, playing: false, speed: 1 });
    },
    [updatePlayback],
  );
  const startReplay = useCallback(
    (hours: number) => {
      if (!Number.isFinite(hours) || hours <= 0) return;
      const duration = Math.min(hours, 24);
      request.current?.abort();
      const durationMs = duration * 3_600_000;
      if (demo) {
        // the demo keeps 12h, so the overnight window has no pre-roll (its world starts there)
        if (source.current)
          load(windowed(source.current.history((durationMs + PREROLL_MS) / 3_600_000), durationMs));
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      const to = Date.now();
      void fetchHistory(to - durationMs - PREROLL_MS, to, controller.signal)
        .then((history) => {
          if (!controller.signal.aborted) load(windowed(history, durationMs));
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            window.dispatchEvent(
              new CustomEvent('fleet:history-error', {
                detail: error instanceof Error ? error.message : 'History unavailable',
              }),
            );
        });
    },
    [demo, load],
  );
  const seek = useCallback(
    (at: number) => {
      const p = playbackRef.current;
      if (p && Number.isFinite(at)) updatePlayback({ ...p, at: clampPlayhead(p.history, at) });
    },
    [updatePlayback],
  );
  const setPlaying = useCallback(
    (playing: boolean) => {
      const p = playbackRef.current;
      if (p) updatePlayback({ ...p, playing: playing && p.at < p.history.to });
    },
    [updatePlayback],
  );
  const setSpeed = useCallback(
    (speed: number) => {
      const p = playbackRef.current;
      if (p && [1, 4, 16, 60].includes(speed)) updatePlayback({ ...p, speed });
    },
    [updatePlayback],
  );
  const exit = useCallback(() => {
    request.current?.abort();
    updatePlayback(null);
  }, [updatePlayback]);
  const history = playback?.history;
  const at = playback?.at;
  const reconstructed = useMemo(
    () => (history && at !== undefined ? reconstruct(history, at) : null),
    [history, at],
  );
  const from = history?.from ?? snapshot?.generatedAt ?? 0;
  const to = history?.to ?? snapshot?.generatedAt ?? 0;
  const replayAt = at ?? snapshot?.generatedAt ?? 0;
  const playing = playback?.playing ?? false;
  const speed = playback?.speed ?? 1;
  const replay = useMemo<ReplayControls>(
    () => ({
      from,
      to,
      at: replayAt,
      playing,
      speed,
      history: history ?? null,
      seek,
      setPlaying,
      setSpeed,
      load,
      exit,
    }),
    [from, to, replayAt, playing, speed, history, seek, setPlaying, setSpeed, load, exit],
  );
  return {
    mode: playback ? 'replay' : demo ? 'demo' : 'live',
    connected,
    ...(reconstructed ?? { snapshot, events }),
    onEvent,
    startReplay,
    replay,
  };
}
