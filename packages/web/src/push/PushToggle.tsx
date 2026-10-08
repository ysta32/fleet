import { useEffect, useState } from 'react';
import { pushSupported } from './logic';
import { disablePush, enablePush, isSubscribed } from './subscribe';
import './push.css';

export function PushToggle() {
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

  if (!supported) {
    return <p className="push-note">Alerts need the app installed to Home Screen on iOS 16.4+</p>;
  }

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const result = on ? await disablePush() : await enablePush();
    if (result.ok) setOn(!on);
    else setError(result.error);
    setBusy(false);
  };

  return (
    <div className="push-toggle">
      <div className="push-row">
        <span id="push-label">Phone alerts</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-pressed={on}
          aria-labelledby="push-label"
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
    </div>
  );
}
