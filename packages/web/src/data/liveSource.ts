import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';

function stripBootstrapToken(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  // The collector exchanges token links for a cookie when serving the shell.
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

stripBootstrapToken();

export function apiUrl(path: string): string {
  const url = new URL(path, window.location.origin);
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
      const url = new URL('/api/events', window.location.origin);
      source = new EventSource(`${url.pathname}${url.search}`);
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
  const response = await fetch(apiUrl(`/api/history?from=${from}&to=${to}`), {
    signal,
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`History unavailable (${response.status})`);
  return response.json() as Promise<HistoryResponse>;
}
