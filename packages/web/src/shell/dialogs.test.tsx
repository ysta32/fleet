import { describe, expect, it } from 'vitest';
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
