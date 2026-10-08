import { useEffect, useRef } from 'react';

export interface HotkeyHandlers {
  palette(): void;
  help(): void;
  search(): void;
  escape(): void;
  go(key: string): boolean;
  scrub(direction: -1 | 1): void;
  playPause(): void;
  live(): void;
  theme(): void;
  undo(): boolean;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit'].includes(type);
}

/** Global keyboard map (DESIGN.md section 6). Single-key shortcuts never fire while typing. */
export function useHotkeys(handlers: HotkeyHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    let pendingG = 0;
    const down = (event: KeyboardEvent) => {
      const h = ref.current;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        h.palette();
        return;
      }
      if (event.key === 'Escape') {
        h.escape();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z' && !typing(event.target)) {
        if (h.undo()) event.preventDefault();
        return;
      }
      if (mod || event.altKey || typing(event.target) || event.defaultPrevented) return;
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        if (h.go(event.key.toLowerCase())) event.preventDefault();
        return;
      }
      switch (event.key) {
        case 'g':
          pendingG = Date.now();
          return;
        case '?':
          event.preventDefault();
          h.help();
          return;
        case '/':
          event.preventDefault();
          h.search();
          return;
        case '[':
          h.scrub(-1);
          return;
        case ']':
          h.scrub(1);
          return;
        case ' ':
          if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
          event.preventDefault();
          h.playPause();
          return;
        case 'l':
        case 'L':
          h.live();
          return;
        case 't':
          h.theme();
          return;
        case 'z':
          h.undo();
          return;
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
}

export const KEYMAP: { keys: string[]; label: string; group: string }[] = [
  { group: 'Anywhere', keys: ['⌘', 'K'], label: 'Command palette' },
  { group: 'Anywhere', keys: ['/'], label: 'Search sessions and projects' },
  { group: 'Anywhere', keys: ['?'], label: 'This cheat sheet' },
  { group: 'Anywhere', keys: ['T'], label: 'Toggle light and dark' },
  { group: 'Anywhere', keys: ['Z'], label: 'Undo the last action' },
  { group: 'Anywhere', keys: ['Esc'], label: 'Close the topmost layer' },
  { group: 'Go to', keys: ['G', 'O'], label: 'Overview' },
  { group: 'Go to', keys: ['G', 'S'], label: 'Sessions' },
  { group: 'Go to', keys: ['G', 'A'], label: 'Armies' },
  { group: 'Go to', keys: ['G', 'P'], label: 'PRs and deploys' },
  { group: 'Go to', keys: ['G', 'I'], label: 'Alerts inbox' },
  { group: 'Go to', keys: ['G', 'N'], label: 'Overnight' },
  { group: 'Go to', keys: ['G', 'C'], label: 'Spend' },
  { group: 'Replay', keys: ['Space'], label: 'Play or pause' },
  { group: 'Replay', keys: ['[', ']'], label: 'Scrub back or forward 2%' },
  { group: 'Replay', keys: ['L'], label: 'Back to live' },
];
