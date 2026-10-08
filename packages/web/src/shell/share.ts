import { useEffect, useState } from 'react';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates the collector's `shareUrl` (GET /api/health, loopback callers only). Returns a clean
 * http(s) URL other devices can open, or null. Any token parameter is stripped defensively.
 */
export function parseShareUrl(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { shareUrl?: unknown }).shareUrl;
  if (typeof raw !== 'string' || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || LOOPBACK_HOSTS.has(url.hostname)) return null;
  url.searchParams.delete('token');
  url.hash = '';
  return url.toString();
}

/** Asks the collector for a LAN/Tailscale URL; null when there is none or it is unreachable. */
export async function fetchShareUrl(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetcher('/api/health', { credentials: 'same-origin', cache: 'no-store', signal });
    if (!res.ok) return null;
    return parseShareUrl(await res.json());
  } catch {
    return null;
  }
}

export function useShareUrl(enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    const controller = new AbortController();
    void fetchShareUrl(fetch, controller.signal).then((next) => {
      if (!controller.signal.aborted) setUrl(next);
    });
    return () => controller.abort();
  }, [enabled]);
  return url;
}
