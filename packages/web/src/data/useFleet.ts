import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoFleet, FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';
import type { FleetView } from './contract';
import { createDemoSource } from './demoSource';
import { connectLive, fetchHistory } from './liveSource';
import { clampPlayhead, eventsCrossed, normalizeHistory, reconstruct } from './replay';

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
    if (!demo) return connectLive({ snapshot: setSnapshot, event: receive, connected: setConnected });
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
        const at = clampPlayhead(current.history, current.at + (now - previous) * current.speed);
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
      if (demo && source.current) {
        load(source.current.history(duration));
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      const to = Date.now();
      void fetchHistory(to - duration * 3_600_000, to, controller.signal)
        .then((history) => {
          if (!controller.signal.aborted) load(history);
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
  const current = playback ? reconstruct(playback.history, playback.at) : { snapshot, events };
  return {
    mode: playback ? 'replay' : demo ? 'demo' : 'live',
    connected,
    ...current,
    onEvent,
    startReplay,
    replay: {
      from: playback?.history.from ?? snapshot?.generatedAt ?? 0,
      to: playback?.history.to ?? snapshot?.generatedAt ?? 0,
      at: playback?.at ?? snapshot?.generatedAt ?? 0,
      playing: playback?.playing ?? false,
      speed: playback?.speed ?? 1,
      seek(at) {
        const p = playbackRef.current;
        if (p && Number.isFinite(at)) updatePlayback({ ...p, at: clampPlayhead(p.history, at) });
      },
      setPlaying(playing) {
        const p = playbackRef.current;
        if (p) updatePlayback({ ...p, playing: playing && p.at < p.history.to });
      },
      setSpeed(speed) {
        const p = playbackRef.current;
        if (p && [1, 4, 16, 60].includes(speed)) updatePlayback({ ...p, speed });
      },
      load,
      exit() {
        request.current?.abort();
        updatePlayback(null);
      },
    },
  };
}
