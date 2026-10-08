import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon, Kbd } from './Icon';
import { pushRecent, rankPalette, type PaletteItem } from './palette';
import { useModal } from './modal';

const RECENT_KEY = 'fleet.paletteRecent';

function readRecent(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: readonly string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Recents stay in memory for this session when storage is unavailable.
  }
}

/** Touch-first devices get entities first and no keyboard hints. */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

export function CommandPalette({ items, onClose }: { items: readonly PaletteItem[]; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, overlay);
  const [recent] = useState(readRecent);
  const [touch] = useState(coarsePointer);
  const results = useMemo(
    () => rankPalette(items, query, 40, { recent, touch }),
    [items, query, recent, touch],
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    saveRecent(pushRecent(recent, item.id));
    onClose();
    item.run();
  };
  let lastGroup = '';
  return (
    <div
      ref={overlay}
      className="overlay overlay-top"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialog} className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Jump to…"
            aria-label="Jump to a session, project or command"
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(results[active]);
              }
            }}
          />
          <span className="palette-hint">
            <Kbd>Esc</Kbd>
          </span>
          <button type="button" className="icon-button palette-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <ul ref={list} id={`${id}-list`} role="listbox" className="palette-list" aria-label="Results">
          {results.map((item, index) => {
            const header = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && (
                  <div className="palette-group micro" aria-hidden="true">
                    {item.group}
                  </div>
                )}
                <div
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className="palette-item"
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(item)}
                >
                  <Icon name={item.icon} />
                  <span className="palette-label">{item.label}</span>
                  {item.meta && <span className="palette-meta">{item.meta}</span>}
                  {item.shortcut && (
                    <span className="palette-keys">
                      {item.shortcut.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!results.length && (
          <p className="palette-empty">
            No match for <q>{query}</q>. Try a project name, a branch, or a command like <q>replay</q>.
          </p>
        )}
      </div>
    </div>
  );
}
