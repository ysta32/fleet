import type { DeliveryResult, Digest, FetchLike, OvernightConfig, Secrets } from '../types.js';
import { deliverEmail } from './email.js';
import { deliverNotion } from './notion.js';
import { deliverNtfy } from './ntfy.js';

export async function deliverAll(
  d: Digest,
  config: OvernightConfig,
  secrets: Secrets,
  fetch: FetchLike,
): Promise<DeliveryResult[]> {
  const channels = [
    ['notion', deliverNotion],
    ['email', deliverEmail],
    ['ntfy', deliverNtfy],
  ] as const;
  return Promise.all(
    channels
      .filter(([channel]) => config.deliver[channel].enabled)
      .map(async ([channel, deliver]): Promise<DeliveryResult> => {
        try {
          return await deliver(d, config, secrets, fetch);
        } catch {
          return { channel, ok: false, detail: `${channel} delivery failed unexpectedly` };
        }
      }),
  );
}
