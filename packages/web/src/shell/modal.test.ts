import { describe, expect, it } from 'vitest';
import { drawerInertTargets, wrapFocus } from './modal';

const a = { id: 'a' } as unknown as HTMLElement;
const b = { id: 'b' } as unknown as HTMLElement;
const c = { id: 'c' } as unknown as HTMLElement;

describe('dialog focus trap', () => {
  it('wraps Tab from the last item to the first and Shift+Tab from the first to the last', () => {
    expect(wrapFocus([a, b, c], c, false)).toBe(a);
    expect(wrapFocus([a, b, c], a, true)).toBe(c);
  });
  it('lets focus move normally between inner items', () => {
    expect(wrapFocus([a, b, c], a, false)).toBeNull();
    expect(wrapFocus([a, b, c], c, true)).toBeNull();
  });
  it('pulls focus back in when it escaped the dialog', () => {
    const outside = { id: 'x' } as unknown as Element;
    expect(wrapFocus([a, b, c], outside, false)).toBe(a);
    expect(wrapFocus([a, b, c], null, true)).toBe(c);
    expect(wrapFocus([], outside, false)).toBeNull();
  });
});

describe('drawer inert targets', () => {
  const el = (name: string, inert = false) =>
    ({ name, hasAttribute: (attr: string) => attr === 'inert' && inert }) as unknown as Element & {
      name: string;
    };
  const bar = el('bar');
  const inspector = el('inspector');
  const palette = el('palette', true);
  const drawer = el('drawer');
  const parent = { children: [bar, inspector, palette, drawer] };
  Object.assign(drawer, { parentElement: parent });
  const covers = (element: Element) => (element as unknown as { name: string }).name === 'inspector';
  const names = (list: Element[]) => list.map((element) => (element as unknown as { name: string }).name);

  it('inerts only what the drawer covers when it is not modal', () => {
    expect(names(drawerInertTargets(drawer, false, covers))).toEqual(['inspector']);
  });
  it('inerts every sibling when modal, leaving layers that are already inert alone', () => {
    expect(names(drawerInertTargets(drawer, true, covers))).toEqual(['bar', 'inspector']);
  });
});
