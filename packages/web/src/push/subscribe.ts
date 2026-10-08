import { base64UrlToUint8Array } from './logic';

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function isSubscribed(): Promise<boolean> {
  try {
    return (await currentSubscription()) !== null;
  } catch {
    return false;
  }
}

export type PushResult = { ok: true } | { ok: false; error: string };

function failure(error: unknown): PushResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' };
}

export async function enablePush(): Promise<PushResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, error: 'Notifications are blocked for this site.' };
    const keyResponse = await fetch('/api/push/key', { credentials: 'same-origin' });
    if (!keyResponse.ok) return { ok: false, error: 'Collector has no push key (HTTP ' + keyResponse.status + ').' };
    const { publicKey } = (await keyResponse.json()) as { publicKey?: unknown };
    if (typeof publicKey !== 'string' || !publicKey) return { ok: false, error: 'Collector returned no push key.' };
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource,
      }));
    const json = sub.toJSON();
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } }),
    });
    if (!response.ok) {
      await sub.unsubscribe().catch(() => false);
      return { ok: false, error: 'Collector rejected the subscription (HTTP ' + response.status + ').' };
    }
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function disablePush(): Promise<PushResult> {
  try {
    const sub = await currentSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
