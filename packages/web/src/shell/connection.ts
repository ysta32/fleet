import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetView } from '../data/contract';

export type LinkState = 'ok' | 'connecting' | 'disconnected' | 'offline' | 'unauthorized';

function storedToken(): string | null {
  try {
    return window.localStorage.getItem('fleet.token');
  } catch {
    return null;
  }
}

/** Probes the collector over plain HTTP; the event stream cannot report status codes. */
export async function probeCollector(signal?: AbortSignal): Promise<'ok' | 'unauthorized' | 'down'> {
  const token = storedToken();
  const url = token ? `/api/snapshot?token=${encodeURIComponent(token)}` : '/api/snapshot';
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
    if (response.status === 401 || response.status === 403) return 'unauthorized';
    return response.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

/**
 * Connection health for the shell: banner, token gate, "last updated".
 * Grace period avoids flashing the offline banner during the first connect.
 */
export function useConnection(view: FleetView) {
  const live = view.mode === 'live';
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [graceOver, setGraceOver] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const everConnected = useRef(false);
  if (view.connected) everConnected.current = true;

  useEffect(() => {
    if (view.snapshot) setLastUpdate(Date.now());
  }, [view.snapshot]);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const timer = window.setTimeout(() => setGraceOver(true), 2500);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!live || view.connected || !graceOver) {
      if (view.connected) setUnauthorized(false);
      return;
    }
    const controller = new AbortController();
    void probeCollector(controller.signal).then((result) => {
      if (!controller.signal.aborted) setUnauthorized(result === 'unauthorized');
    });
    return () => controller.abort();
  }, [live, view.connected, graceOver]);

  const retry = useCallback(async () => {
    const result = await probeCollector();
    if (result === 'unauthorized') setUnauthorized(true);
    return result;
  }, []);

  let state: LinkState = 'ok';
  if (!online) state = 'offline';
  else if (live && unauthorized && !view.connected) state = 'unauthorized';
  else if (live && !view.connected)
    state = graceOver || everConnected.current ? 'disconnected' : 'connecting';
  return { state, lastUpdate, retry };
}
