import type { DeliveryResult, Digest, FetchLike, OvernightConfig, Secrets } from '../types.js';
import { archiveUrl } from '../render/text.js';

function richText(
  content: string,
  url?: string,
): Array<{ type: 'text'; text: { content: string; link?: { url: string } } }> {
  let text = content.slice(0, 2000);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return [{ type: 'text', text: { content: text, ...(url ? { link: { url } } : {}) } }];
}

function block(
  type: 'heading_2' | 'heading_3' | 'paragraph' | 'bulleted_list_item',
  content: string,
  url?: string,
): Record<string, unknown> {
  return { object: 'block', type, [type]: { rich_text: richText(content, url) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function deliverNotion(
  d: Digest,
  config: OvernightConfig,
  secrets: Secrets,
  fetch: FetchLike,
): Promise<DeliveryResult> {
  const result = (ok: boolean, detail: string): DeliveryResult => ({ channel: 'notion', ok, detail });
  const failure = async (response: Awaited<ReturnType<FetchLike>>): Promise<DeliveryResult> => {
    let body = await response.text();
    for (const secret of Object.values(secrets)) if (secret) body = body.split(secret).join('[redacted]');
    return result(false, `HTTP ${response.status}: ${body.slice(0, 200)}`);
  };
  try {
    if (!secrets.notionToken) return result(false, 'missing NOTION_TOKEN');
    const { databaseId, pageId } = config.deliver.notion;
    if (!databaseId?.trim() && !pageId?.trim())
      return result(false, 'missing deliver.notion.databaseId or deliver.notion.pageId');
    const headers = {
      Authorization: `Bearer ${secrets.notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
    const title = `${d.id} — Overnight`;
    let children = [block('heading_2', title), block('paragraph', d.headline)];
    for (const project of d.projects) {
      children.push(
        block('heading_3', project.name),
        block('paragraph', project.summary),
        ...project.highlights.map((highlight) => block('bulleted_list_item', highlight)),
      );
    }
    const archiveLink = archiveUrl(d, config.siteUrl);
    if (archiveLink) {
      children = children.slice(0, 99);
      children.push(block('paragraph', 'View full digest', archiveLink));
    }
    children = children.slice(0, 100);
    let url: string;
    let method: string;
    let body: Record<string, unknown>;
    if (databaseId?.trim()) {
      const database = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`, {
        method: 'GET',
        headers,
      });
      if (!database.ok) return await failure(database);
      const schema = await database.json();
      if (!isRecord(schema) || !isRecord(schema.properties))
        return result(false, 'invalid Notion database schema');
      const titleName =
        Object.entries(schema.properties).find(
          ([, value]) => isRecord(value) && value.type === 'title',
        )?.[0] ?? 'Name';
      const properties: Record<string, unknown> = { [titleName]: { title: richText(title) } };
      const date = schema.properties.Date;
      if (isRecord(date) && date.type === 'date') properties.Date = { date: { start: d.id } };
      url = 'https://api.notion.com/v1/pages';
      method = 'POST';
      body = { parent: { database_id: databaseId }, properties, children };
    } else {
      url = `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId!)}/children`;
      method = 'PATCH';
      body = { children };
    }
    const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
    if (!response.ok) return await failure(response);
    return result(true, databaseId?.trim() ? 'Notion page created' : 'Notion blocks appended');
  } catch {
    return result(false, 'Notion delivery failed: request or response error');
  }
}
