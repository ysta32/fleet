import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon, Kbd } from './Icon';
import { KEYMAP } from './hotkeys';
import { useMediaQuery, useModal } from './modal';
import { PushToggle } from '../push/PushToggle';

export function HelpOverlay({ onClose, demo = false }: { onClose(): void; demo?: boolean }) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, overlay);
  // focus lands on the dialog itself, so no control shows a ring until the keyboard moves it
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);
  const phone = useMediaQuery('(max-width: 767px)');
  return (
    <div
      ref={overlay}
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        className="dialog help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
      >
        <header className="dialog-head">
          <h2 id="help-title" className="dialog-title">
            Keyboard
          </h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <HelpBody phone={phone} demo={demo} />
      </div>
    </div>
  );
}

function Shortcuts(): ReactNode {
  const groups = [...new Set(KEYMAP.map((entry) => entry.group))];
  return (
    <div className="help-groups">
      {groups.map((group) => (
        <section key={group}>
          <h3 className="micro">{group}</h3>
          <dl>
            {KEYMAP.filter((entry) => entry.group === group).map((entry) => (
              <div key={entry.label} className="help-row">
                <dt>{entry.label}</dt>
                <dd>
                  {entry.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/**
 * Phones rarely have a keyboard, so there the phone-alerts switch leads (in reading and tab order)
 * and the shortcuts follow; on a 375px screen the switch would otherwise sit below the fold. The
 * switch keeps one fixed slot, and the stateless shortcut list renders on either side of it, so
 * crossing the breakpoint never remounts or moves the switch (its focus and demo state survive).
 */
export function HelpBody({ phone, demo }: { phone: boolean; demo: boolean }) {
  return (
    <div className="help-body">
      {phone ? null : <Shortcuts />}
      <div className={`help-push${phone ? ' help-push-first' : ''}`}>
        <PushToggle demo={demo} />
      </div>
      {phone ? <Shortcuts /> : null}
    </div>
  );
}
