import type { DeliveryResult, Digest, FetchLike, OvernightConfig, Secrets } from '../types.js';
import { renderEmailHtml, renderMarkdown } from '../render/text.js';

export async function deliverEmail(
  d: Digest,
  config: OvernightConfig,
  secrets: Secrets,
  fetch: FetchLike,
): Promise<DeliveryResult> {
  const result = (ok: boolean, detail: string): DeliveryResult => ({ channel: 'email', ok, detail });
  try {
    if (!secrets.resendApiKey) return result(false, 'missing RESEND_API_KEY');
    const { from, to } = config.deliver.email;
    if (!from?.trim()) return result(false, 'missing deliver.email.from');
    if (!to?.trim()) return result(false, 'missing deliver.email.to');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: `Overnight — ${d.id}: ${d.headline.slice(0, 80)}`,
        html: renderEmailHtml(d, { siteUrl: config.siteUrl }),
        text: renderMarkdown(d, { siteUrl: config.siteUrl }),
      }),
    });
    if (!response.ok) {
      let body = await response.text();
      for (const secret of Object.values(secrets)) if (secret) body = body.split(secret).join('[redacted]');
      return result(false, `HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    return result(true, 'email sent');
  } catch {
    return result(false, 'email delivery failed: request or response error');
  }
}
