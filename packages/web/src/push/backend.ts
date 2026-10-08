import { disablePush, enablePush, isSubscribed, type PushResult } from './subscribe';

/** What the phone-alerts switch drives: real Web Push, or a demo stand-in. */
export interface PushBackend {
  /** false: show the switch even where Web Push is unsupported (demo needs no browser support) */
  needsSupport: boolean;
  isSubscribed(): Promise<boolean>;
  enable(): Promise<PushResult>;
  disable(): Promise<PushResult>;
}

const real: PushBackend = { needsSupport: true, isSubscribed, enable: enablePush, disable: disablePush };

/**
 * Demo alerts are simulated: the switch flips local state only. It never asks for notification
 * permission, never touches the service worker's push subscription and never calls the collector.
 */
export function demoPushBackend(): PushBackend {
  let subscribed = false;
  return {
    needsSupport: false,
    isSubscribed: async () => subscribed,
    enable: async () => {
      subscribed = true;
      return { ok: true, subscribed };
    },
    disable: async () => {
      subscribed = false;
      return { ok: true, subscribed };
    },
  };
}

export function pushBackend(demo: boolean): PushBackend {
  return demo ? demoPushBackend() : real;
}
