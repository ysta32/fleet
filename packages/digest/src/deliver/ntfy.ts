import type { DeliveryResult, Digest, FetchLike, OvernightConfig, Secrets } from '../types.js';
import { archiveUrl, renderPlainText } from '../render/text.js';

export async function deliverNtfy(
  d: Digest,
  config: OvernightConfig,
  secrets: Secrets,
  fetch: FetchLike,
): Promise<DeliveryResult> {
  const result = (ok: boolean, detail: string): DeliveryResult => ({ channel: 'ntfy', ok, detail });
  try {
    const { server, topic } = config.deliver.ntfy;
    if (!server?.trim()) return result(false, 'missing deliver.ntfy.server');
    if (!topic?.trim()) return result(false, 'missing deliver.ntfy.topic');
    const headers: Record<string, string> = {
      Title: `Overnight ${d.id}`,
      Tags: 'sunrise',
      Priority: d.projects.some((project) => project.health === 'red') ? '4' : '3',
      Markdown: 'yes',
    };
    const archiveLink = archiveUrl(d, config.siteUrl);
    if (archiveLink) headers.Click = archiveLink;
    if (secrets.ntfyToken) headers.Authorization = `Bearer ${secrets.ntfyToken}`;
    const response = await fetch(`${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers,
      body: renderPlainText(d, 3500),
    });
    if (!response.ok) {
      let body = await response.text();
      for (const secret of Object.values(secrets)) if (secret) body = body.split(secret).join('[redacted]');
      return result(false, `HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    return result(true, 'notification sent');
  } catch {
    return result(false, 'ntfy delivery failed: request or response error');
  }
}
