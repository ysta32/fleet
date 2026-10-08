import { describe, expect, it } from 'vitest';
import { base64UrlToUint8Array, pushSupported, safeNotificationPath } from './logic';

describe('base64UrlToUint8Array', () => {
  it('decodes url-safe base64 without padding', () => {
    expect(Array.from(base64UrlToUint8Array('-_8'))).toEqual([251, 255]);
    expect(Array.from(base64UrlToUint8Array('aGk'))).toEqual([104, 105]);
    expect(base64UrlToUint8Array('').length).toBe(0);
  });
});

describe('pushSupported', () => {
  it('needs serviceWorker, PushManager and Notification', () => {
    const ok = { navigator: { serviceWorker: {} }, window: { PushManager: {} }, Notification: class {} };
    expect(pushSupported(ok)).toBe(true);
    expect(pushSupported({ ...ok, navigator: {} })).toBe(false);
    expect(pushSupported({ ...ok, window: {} })).toBe(false);
    expect(pushSupported({ ...ok, Notification: undefined })).toBe(false);
    expect(pushSupported({})).toBe(false);
  });
});

describe('safeNotificationPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeNotificationPath('/?agent=a1#x')).toBe('/?agent=a1#x');
    expect(safeNotificationPath('/sessions/1')).toBe('/sessions/1');
  });
  it('rejects absolute, protocol-relative and non-string urls', () => {
    for (const bad of ['https://evil.test/', '//evil.test', '/\\evil.test', '/a/..//evil.test', 'javascript:alert(1)', 'x', '', null, 5])
      expect(safeNotificationPath(bad)).toBe('/');
  });
});
