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
      // Clean URL: the token lives in storage and the HttpOnly cookie, never in the address bar.
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.location.replace(url.toString());
    } else
      setError(
        result === 'rejected'
          ? 'That token was rejected. Run fleet token on the machine running Fleet and paste the token it prints.'
          : 'Collector unreachable, so the token could not be checked. Make sure Fleet is running and try again.',
      );
  };
  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
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
          The token is kept in this browser only and is never sent anywhere but this collector.
        </p>
      </form>
    </main>
  );
}

/**
 * Checks a token with a Bearer header (never in the address bar). On success, stores it for the
 * event stream and asks the collector for its HttpOnly session cookie so the shell itself loads.
 */
export async function unlock(token: string, fetcher: typeof fetch = fetch): Promise<'ok' | 'rejected' | 'unreachable'> {
  try {
    const check = await fetcher('/api/health', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (check.status === 401 || check.status === 403) return 'rejected';
    if (!check.ok) return 'unreachable';
    try {
      window.localStorage.setItem('fleet.token', token);
    } catch {
      // Storage disabled: the cookie below still authenticates this browser.
    }
    await fetcher(`/api/health?token=${encodeURIComponent(token)}`, { credentials: 'same-origin', cache: 'no-store' });
    return 'ok';
  } catch {
    return 'unreachable';
  }
}
