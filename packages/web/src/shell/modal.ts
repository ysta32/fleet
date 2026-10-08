import { useEffect } from 'react';
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
