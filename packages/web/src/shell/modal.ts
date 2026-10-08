import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Next focus target when Tab would leave the dialog; null when focus may move normally. */
export function wrapFocus(
  items: readonly HTMLElement[],
  active: Element | null,
  backwards: boolean,
): HTMLElement | null {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = active ? items.includes(active as HTMLElement) : false;
  if (!inside) return backwards ? last : first;
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return null;
}

/**
 * Modal behaviour for a dialog rendered inside the app root: Tab stays inside, every sibling
 * of the overlay is inert (no focus, no pointer, hidden from assistive tech), and focus returns
 * to whatever had it when the dialog closes.
 */
export function useModal(dialog: RefObject<HTMLElement>, overlay: RefObject<HTMLElement>) {
  useEffect(() => {
    const node = dialog.current;
    const layer = overlay.current;
    if (!node || !layer) return;
    const previous = document.activeElement as HTMLElement | null;
    const parent = layer.parentElement;
    const inerted: Element[] = [];
    if (parent)
      for (const child of Array.from(parent.children)) {
        if (child === layer || child.hasAttribute('inert')) continue;
        child.setAttribute('inert', '');
        inerted.push(child);
      }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute('inert') && element.getClientRects().length > 0,
      );
      const target = wrapFocus(items, document.activeElement, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      } else if (!items.length) event.preventDefault();
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      for (const element of inerted) element.removeAttribute('inert');
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [dialog, overlay]);
}

/** Live `matchMedia` result; false where matchMedia is unavailable (SSR, old test DOMs). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true,
  );
  useEffect(() => {
    const list = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Elements a drawer should make inert: every sibling when it is modal (phone sheet), otherwise
 * only the siblings it covers. Already-inert elements belong to another layer and are left alone.
 */
export function drawerInertTargets(
  drawer: Element,
  modal: boolean,
  covers: (element: Element) => boolean,
): Element[] {
  const parent = drawer.parentElement;
  if (!parent) return [];
  return Array.from(parent.children).filter(
    (child) => child !== drawer && !child.hasAttribute('inert') && (modal || covers(child)),
  );
}

/**
 * Focus behaviour for a drawer that floats over the layout: focus moves to `initial` when it
 * opens and returns to the invoking element when it closes; whatever it covers is inert; when
 * `modal` is true every sibling is inert and Tab is trapped inside.
 */
export function useDrawer(
  drawer: RefObject<HTMLElement>,
  initial: RefObject<HTMLElement>,
  modal: boolean,
  covers: (element: Element) => boolean,
) {
  // Declared first so its cleanup (un-inerting) runs before focus is restored below.
  useEffect(() => {
    const node = drawer.current;
    if (!node) return;
    const inerted = drawerInertTargets(node, modal, covers);
    for (const element of inerted) element.setAttribute('inert', '');
    const keydown = (event: KeyboardEvent) => {
      if (!modal || event.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.getClientRects().length > 0,
      );
      const target = wrapFocus(items, document.activeElement, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      } else if (!items.length) event.preventDefault();
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      for (const element of inerted) element.removeAttribute('inert');
    };
  }, [drawer, modal, covers]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    initial.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, [drawer, initial]);
}
