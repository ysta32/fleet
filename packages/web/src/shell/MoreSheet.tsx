import { useEffect, useRef } from 'react';
import type { DashboardTab } from '../dashboard/Dashboard';
import { Icon } from './Icon';
import { useModal } from './modal';
import { PHONE_MORE } from './tabs';

/** Phone-only overflow for the bottom bar: the remaining sections plus phone alerts. */
export function MoreSheet({
  current,
  onGo,
  onPhoneAlerts,
  onClose,
}: {
  current: DashboardTab;
  onGo(tab: DashboardTab): void;
  onPhoneAlerts(): void;
  onClose(): void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useModal(dialog, overlay);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div
      ref={overlay}
      className="overlay overlay-sheet"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialog} className="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title">
        <header className="more-head">
          <h2 id="more-title" className="micro">
            More
          </h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <ul className="more-list">
          {PHONE_MORE.map((entry, index) => (
            <li key={entry.id}>
              <button
                ref={index === 0 ? first : undefined}
                type="button"
                className="more-item"
                aria-current={current === entry.id ? 'page' : undefined}
                onClick={() => {
                  onClose();
                  onGo(entry.id);
                }}
              >
                <Icon name={entry.icon} />
                {entry.id === 'prs' ? 'PRs & deploys' : entry.label}
              </button>
            </li>
          ))}
          <li className="more-sep">
            <button
              type="button"
              className="more-item"
              onClick={() => {
                onClose();
                onPhoneAlerts();
              }}
            >
              <Icon name="bell" />
              Phone alerts
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
