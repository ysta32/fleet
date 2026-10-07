import { useId, useState } from 'react';
import { Icon, Mark } from './Icon';

/** Shown when the collector answers 401: this browser has no valid access token yet. */
export function TokenGate() {
  const [token, setToken] = useState('');
  const id = useId();
  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          const value = token.trim();
          if (!value) return;
          const url = new URL(window.location.href);
          url.searchParams.set('token', value);
          window.location.assign(url.toString());
        }}
      >
        <Mark className="gate-mark" />
        <h1 className="gate-title">This fleet is locked.</h1>
        <p className="gate-lead">
          The collector answered 401: this browser has no valid access token. On the machine running Fleet, run{' '}
          <code>fleet token</code> and open the link it prints, or paste the token here.
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
            onChange={(event) => setToken(event.target.value)}
            placeholder="fl_…"
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={!token.trim()}>
            <Icon name="chevron" />
            Open fleet
          </button>
        </div>
        <p className="gate-meta">The token is kept in this browser only and is never sent anywhere but this collector.</p>
      </form>
    </main>
  );
}
