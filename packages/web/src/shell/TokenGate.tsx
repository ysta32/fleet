import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon, Mark } from './Icon';

/** Shown when the collector answers 401: this browser has no valid access token yet. */
export function TokenGate() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const result = await unlock(value);
    setBusy(false);
    if (result === 'ok') {
      // Clean URL: the token lives only in the HttpOnly cookie, never in the address bar.
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.location.replace(`${url.pathname}${url.search}${url.hash}`);
    } else setError(UNLOCK_ERRORS[result]);
  };
  return (
    <main className="gate">
      <form className="gate-card" onSubmit={(event) => void submit(event)} noValidate>
        <Mark className="gate-mark" />
        <h1 className="gate-title">This fleet is locked.</h1>
        <p className="gate-lead">
          The collector answered 401: this browser has no valid access token. On the machine running Fleet,
          run <code>fleet token</code> and open the link it prints, or paste the token here.
        </p>
        <label className="field-label" htmlFor={id}>
          Access token
        </label>
        <div className="gate-row">
          <input
            id={id}
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setToken(event.target.value);
              setError(null);
            }}
            placeholder="fl_…"
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={!token.trim() || busy} aria-busy={busy}>
            <Icon name="chevron" />
            {busy ? 'Checking' : 'Open fleet'}
          </button>
        </div>
        {error && (
          <p id={`${id}-error`} className="gate-error" role="alert">
            <Icon name="x" />
            {error}
          </p>
        )}
        <p className="gate-meta">
          The token is exchanged for a session cookie in this browser and is never sent anywhere but this
          collector.
        </p>
      </form>
    </main>
  );
}

export type UnlockResult = 'ok' | 'rejected' | 'throttled' | 'unreachable';

/**
 * Exchanges the token for the collector's HttpOnly session cookie via POST /api/session with a
 * Bearer header, so the token never appears in any URL. The cookie then authenticates the shell,
 * the API and the event stream.
 */
export async function unlock(token: string, fetcher: typeof fetch = fetch): Promise<UnlockResult> {
  let res: Response;
  try {
    res = await fetcher('/api/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return 'unreachable';
  }
  if (res.ok) return 'ok';
  if (res.status === 401 || res.status === 403) return 'rejected';
  if (res.status === 429) return 'throttled';
  return 'unreachable';
}

const UNLOCK_ERRORS: Record<Exclude<UnlockResult, 'ok'>, string> = {
  rejected:
    'That token was rejected. Run fleet token on the machine running Fleet and paste the token it prints.',
  throttled: 'Too many attempts. Wait a minute, then try again.',
  unreachable:
    'Collector unreachable, so the token could not be checked. Make sure Fleet is running and try again.',
};
