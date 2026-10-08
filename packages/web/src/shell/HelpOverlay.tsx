import { useEffect, useRef } from 'react';
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
  const groups = [...new Set(KEYMAP.map((entry) => entry.group))];
  // Phones rarely have a keyboard, so there the phone-alerts switch leads (in reading and tab order)
  // and the shortcuts follow; on a 375px screen the switch would otherwise sit below the fold.
  const phone = useMediaQuery('(max-width: 767px)');
  const push = (
    <div className={`help-push${phone ? ' help-push-first' : ''}`}>
      <PushToggle demo={demo} />
    </div>
  );
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
        <div className="help-body">
          {phone && push}
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
          {!phone && push}
        </div>
      </div>
    </div>
  );
}
