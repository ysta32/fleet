import { useEffect, useRef } from 'react';
import { Icon } from '../shell/Icon';
import { useModal } from '../shell/modal';
import { PushToggle } from './PushToggle';

/** Phone alerts on their own: reachable from the palette and the phone More sheet. */
export function PhoneAlerts({ onClose }: { onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, overlay);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <div
      ref={overlay}
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        className="dialog dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-alerts-title"
      >
        <header className="dialog-head">
          <h2 id="phone-alerts-title" className="dialog-title">
            Phone alerts
          </h2>
          <button ref={close} type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="help-push">
          <PushToggle titled={false} />
        </div>
      </div>
    </div>
  );
}
