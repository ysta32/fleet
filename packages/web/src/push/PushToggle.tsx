import { useEffect, useId, useState } from 'react';
import { pushSupported } from './logic';
import { disablePush, enablePush, isSubscribed } from './subscribe';
import './push.css';

const HELP = 'Get a notification on this device when an agent is blocked or waiting on you.';

/**
 * Phone alerts as a self-contained section: heading, one line of help, then the switch. Pass
 * `titled={false}` when the surrounding dialog already carries the "Phone alerts" title.
 */
export function PushToggle({ titled = true }: { titled?: boolean }) {
  const id = useId();
  const supported = pushSupported({
    navigator: typeof navigator === 'undefined' ? undefined : navigator,
    window: typeof window === 'undefined' ? undefined : window,
    Notification: typeof Notification === 'undefined' ? undefined : Notification,
  });
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void isSubscribed().then((value) => live && setOn(value));
    return () => {
      live = false;
    };
  }, [supported]);

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
    const result = on ? await disablePush() : await enablePush();
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
