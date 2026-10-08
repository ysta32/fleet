import { useEffect, useId, useMemo, useState } from 'react';
import { pushSupported } from './logic';
import { pushBackend } from './backend';
import './push.css';

const HELP = 'Get a notification on this device when an agent is blocked or waiting on you.';

/**
 * Phone alerts as a self-contained section: heading, one line of help, then the switch. Pass
 * `titled={false}` when the surrounding dialog already carries the "Phone alerts" title. With `demo`,
 * the switch is simulated: no permission prompt and no subscribe/unsubscribe calls.
 */
export function PushToggle({ titled = true, demo = false }: { titled?: boolean; demo?: boolean }) {
  const id = useId();
  // one backend per mode: demo state lives with this mount and never reaches the real subscription
  const api = useMemo(() => pushBackend(demo), [demo]);
  const browserSupported = pushSupported({
    navigator: typeof navigator === 'undefined' ? undefined : navigator,
    window: typeof window === 'undefined' ? undefined : window,
    Notification: typeof Notification === 'undefined' ? undefined : Notification,
  });
  const supported = !api.needsSupport || browserSupported;
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void api.isSubscribed().then((value) => live && setOn(value));
    return () => {
      live = false;
    };
  }, [supported, api]);

  const heading = titled && (
    <h3 id={`${id}-title`} className="micro push-title">
      Phone alerts
    </h3>
  );
  if (!supported) {
    return (
      <section
        className="push-section"
        aria-label={titled ? undefined : 'Phone alerts'}
        aria-labelledby={titled ? `${id}-title` : undefined}
      >
        {heading}
        <p className="push-help">{HELP}</p>
        <p className="push-note">
          On iPhone, add Fleet to the Home Screen first (iOS 16.4 or later), then open it from there to turn
          alerts on.
        </p>
      </section>
    );
  }

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const result = on ? await api.disable() : await api.enable();
    setOn(result.subscribed);
    if (!result.ok) setError(result.error);
    setBusy(false);
  };

  return (
    <section
      className="push-section push-toggle"
      aria-label={titled ? undefined : 'Phone alerts'}
      aria-labelledby={titled ? `${id}-title` : undefined}
    >
      {heading}
      <div className="push-row">
        <p id={`${id}-help`} className="push-help">
          {HELP}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-pressed={on}
          aria-label="Phone alerts"
          aria-describedby={`${id}-help`}
          aria-busy={busy}
          disabled={busy}
          className={`push-switch${on ? ' is-on' : ''}`}
          onClick={() => void toggle()}
        >
          <span className="push-knob" />
        </button>
      </div>
      {error && (
        <p className="push-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
