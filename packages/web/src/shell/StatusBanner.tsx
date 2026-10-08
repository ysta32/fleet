import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import type { LinkState } from './connection';
import { relativeTime } from '../dashboard/model';

export function StatusBanner({
  state,
  lastUpdate,
  onRetry,
}: {
  state: LinkState;
  lastUpdate: number | null;
  onRetry(): Promise<unknown>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  if (state !== 'disconnected' && state !== 'offline') return null;
  const since = lastUpdate ? `Last update ${relativeTime(lastUpdate, now)}.` : 'No data received yet.';
  const lead =
    state === 'offline'
      ? 'This device is offline. Showing the last state Fleet received.'
      : 'Collector unreachable. Fleet keeps retrying in the background.';
  return (
    <div className="status-banner" role="status">
      <Icon name="offline" />
      <p>
        <strong>{lead}</strong> <span className="status-banner-meta">{since}</span>
      </p>
      <button
        type="button"
        className="btn btn-quiet"
        aria-busy={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onRetry().finally(() => setBusy(false));
        }}
      >
        <Icon name="replay" />
        {busy ? 'Checking' : 'Retry now'}
      </button>
    </div>
  );
}
