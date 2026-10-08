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

/** `subscribed` is always re-read from pushManager.getSubscription() after the attempt. */
export type PushResult = { ok: true; subscribed: boolean } | { ok: false; error: string; subscribed: boolean };

function failure(error: unknown, subscribed: boolean): PushResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong.', subscribed };
}

export async function enablePush(): Promise<PushResult> {
  let result: PushResult;
  try {
    result = await enable();
  } catch (error) {
    result = failure(error, false);
  }
  return { ...result, subscribed: await isSubscribed() };
}

async function enable(): Promise<PushResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return failure(new Error('Notifications are blocked for this site.'), false);
  const keyResponse = await fetch('/api/push/key', { credentials: 'same-origin' });
  if (!keyResponse.ok) return failure(new Error('Collector has no push key (HTTP ' + keyResponse.status + ').'), false);
  const { publicKey } = (await keyResponse.json()) as { publicKey?: unknown };
  if (typeof publicKey !== 'string' || !publicKey) return failure(new Error('Collector returned no push key.'), false);
  const reg = await navigator.serviceWorker.ready;
  let created: PushSubscription | null = null;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource,
    });
    created = sub;
  }
  try {
    const json = sub.toJSON();
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } }),
    });
    if (!response.ok) throw new Error('Collector rejected the subscription (HTTP ' + response.status + ').');
    return { ok: true, subscribed: true };
  } catch (error) {
    if (created) await created.unsubscribe().catch(() => false);
    return failure(error, false);
  }
}

export async function disablePush(): Promise<PushResult> {
  let result: PushResult;
  try {
    result = await disable();
  } catch (error) {
    result = failure(error, false);
  }
  return { ...result, subscribed: await isSubscribed() };
}

async function disable(): Promise<PushResult> {
  const sub = await currentSubscription();
  if (!sub) return { ok: true, subscribed: false };
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const response = await fetch('/api/push/subscribe', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error('Collector could not remove the subscription (HTTP ' + response.status + ').');
  return { ok: true, subscribed: false };
}
