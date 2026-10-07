import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';

export function apiUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  let token = new URLSearchParams(window.location.search).get('token');
  if (!token) {
    try {
      token = window.localStorage.getItem('fleet.token') ?? window.localStorage.getItem('token');
    } catch {
      // Storage can be disabled; URL authentication remains available.
    }
  }
  if (token) url.searchParams.set('token', token);
  return `${url.pathname}${url.search}`;
}

export function connectLive(handlers: {
  snapshot(snapshot: FleetSnapshot): void;
  event(event: FleetEvent): void;
  connected(connected: boolean): void;
}): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let attempt = 0;
  const reconnect = () => {
    clearTimeout(timer);
    source?.close();
    handlers.connected(false);
    if (!stopped) timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5)));
  };
  const connect = () => {
    if (stopped) return;
    try {
      source = new EventSource(apiUrl('/api/events'));
    } catch {
      reconnect();
      return;
    }
    source.onopen = () => {
      attempt = 0;
      handlers.connected(true);
    };
    source.onerror = reconnect;
    source.addEventListener('snapshot', (message) => {
      let snapshot: FleetSnapshot;
      try {
        snapshot = JSON.parse((message as MessageEvent<string>).data) as FleetSnapshot;
      } catch {
        reconnect();
        return;
      }
      handlers.snapshot(snapshot);
    });
    source.addEventListener('fleet', (message) => {
      let event: FleetEvent;
      try {
        event = JSON.parse((message as MessageEvent<string>).data) as FleetEvent;
      } catch {
        reconnect();
        return;
      }
      handlers.event(event);
    });
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}

export async function fetchHistory(from: number, to: number, signal: AbortSignal): Promise<HistoryResponse> {
  const response = await fetch(apiUrl(`/api/history?from=${from}&to=${to}`), { signal });
  if (!response.ok) throw new Error(`History unavailable (${response.status})`);
  return response.json() as Promise<HistoryResponse>;
}
