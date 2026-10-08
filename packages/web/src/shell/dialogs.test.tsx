import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { HelpBody, HelpOverlay } from './HelpOverlay';
import { PhoneAlerts } from '../push/PhoneAlerts';

// M5: dialogs take focus on their container (tabindex=-1), so no control shows a ring on open
describe('dialog initial focus target', () => {
  for (const [name, html] of [
    ['help', () => renderToString(<HelpOverlay onClose={() => {}} demo />)],
    ['phone alerts', () => renderToString(<PhoneAlerts onClose={() => {}} demo />)],
  ] as const) {
    it(`${name}: the dialog container is programmatically focusable`, () => {
      const out = html();
      expect(out).toMatch(/<div[^>]*role="dialog"[^>]*tabindex="-1"/);
      // the close button is a normal tab stop, not the autofocus target
      expect(out).not.toMatch(/<button[^>]*autofocus/i);
    });
  }
});

// P2: on a phone the Help sheet leads with the phone-alerts switch, so it is in view without scrolling
describe('help sheet order', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const stubWidth = (phone: boolean) =>
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: phone && query === '(max-width: 767px)',
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  const order = () => {
    const out = renderToString(<HelpOverlay onClose={() => {}} demo />);
    return { push: out.indexOf('class="help-push'), keys: out.indexOf('class="help-groups"'), out };
  };
  it('puts phone alerts first on phones, in reading and tab order', () => {
    stubWidth(true);
    const { push, keys, out } = order();
    expect(push).toBeGreaterThan(-1);
    expect(push).toBeLessThan(keys);
    expect(out).toContain('help-push help-push-first');
  });
  it('keeps the shortcuts first on wider screens', () => {
    stubWidth(false);
    const { push, keys, out } = order();
    expect(keys).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(keys);
    expect(out).not.toContain('help-push-first');
  });
});

describe('help sheet across the phone breakpoint', () => {
  // React keeps a child mounted when it stays in the same slot with the same type: the switch must
  // not remount or move when the width crosses 767px, or it loses focus and its demo state.
  const slots = (phone: boolean): ReactNode[] => {
    const body = HelpBody({ phone, demo: true }) as ReactElement<{ children: ReactNode[] }>;
    return body.props.children;
  };
  const isPush = (node: ReactNode) =>
    isValidElement<{ className?: string }>(node) && /\bhelp-push\b/.test(node.props.className ?? '');
  it('keeps the phone-alerts switch in one fixed slot', () => {
    const phone = slots(true);
    const wide = slots(false);
    expect(phone).toHaveLength(wide.length);
    const at = phone.findIndex(isPush);
    expect(at).toBeGreaterThan(-1);
    expect(wide.findIndex(isPush)).toBe(at);
    const [a, b] = [phone[at], wide[at]] as ReactElement[];
    expect(a.type).toBe(b.type);
    expect(a.key).toBe(b.key);
    // the shortcuts sit after the switch on phones and before it on wider screens
    expect(phone.slice(0, at).every((node) => node === null)).toBe(true);
    expect(phone.slice(at + 1).some(isValidElement)).toBe(true);
    expect(wide.slice(0, at).some(isValidElement)).toBe(true);
    expect(wide.slice(at + 1).every((node) => node === null)).toBe(true);
  });
});
