/** Pure helpers for Web Push on the phone PWA. */

export function base64UrlToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(env: { navigator?: object; window?: object; Notification?: unknown }): boolean {
  return (
    !!env.navigator &&
    'serviceWorker' in env.navigator &&
    !!env.window &&
    'PushManager' in env.window &&
    typeof env.Notification !== 'undefined'
  );
}

/** Same-origin path only; anything absolute, protocol-relative or foreign falls back to "/". */
export function safeNotificationPath(raw: unknown, origin = 'https://fleet.invalid'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
