import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { HelpOverlay } from './HelpOverlay';
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
