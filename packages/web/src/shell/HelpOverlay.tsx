import { useEffect, useRef } from 'react';
import { Icon, Kbd } from './Icon';
import { KEYMAP } from './hotkeys';
import { useModal } from './modal';
import { PushToggle } from '../push/PushToggle';

export function HelpOverlay({ onClose }: { onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, overlay);
  useEffect(() => {
    close.current?.focus();
  }, []);
  const groups = [...new Set(KEYMAP.map((entry) => entry.group))];
  return (
    <div
      ref={overlay}
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialog} className="dialog help" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="dialog-head">
          <h2 id="help-title" className="dialog-title">
            Keyboard
          </h2>
          <button ref={close} type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="help-body">
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
          <div className="help-push">
            <PushToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
