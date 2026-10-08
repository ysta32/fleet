import { describe, expect, it } from 'vitest';
import { wrapFocus } from './modal';

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
