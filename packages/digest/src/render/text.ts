import type { Digest } from '../types.js';

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 0) return '';
  let prefix = value.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}

export function archiveUrl(d: Digest, siteUrl?: string): string | undefined {
  if (!siteUrl) return undefined;
  try {
    const url = new URL(`${siteUrl.replace(/\/+$/, '')}/digests/${encodeURIComponent(d.id)}.html`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#!|~]/g, '\\$&');
}

function totals(d: Digest): string {
  return `${d.totals.projectsActive} active projects · ${d.totals.mergedPRs} PRs merged · ${d.totals.commits} commits · ${d.totals.releases} releases · ${d.totals.ciFailures} CI failures`;
}

export function renderMarkdown(d: Digest, opts: { siteUrl?: string } = {}): string {
  const lines = [`# Overnight — ${escapeMarkdown(d.id)}`, '', escapeMarkdown(d.headline), '', totals(d)];
  for (const project of d.projects) {
    lines.push(
      '',
      `## ${escapeMarkdown(project.name)} — ${project.health}`,
      '',
      escapeMarkdown(project.summary),
    );
    for (const highlight of project.highlights) lines.push(`- ${escapeMarkdown(highlight)}`);
  }
  if (d.warnings.length) {
    lines.push('', '## Warnings', ...d.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  }
  const url = archiveUrl(d, opts.siteUrl);
  if (url) lines.push('', `[View full digest](<${url}>)`);
  return `${lines.join('\n')}\n`;
}

export function renderPlainText(d: Digest, maxLen = 3500): string {
  const lines = [`Overnight — ${d.id}`, '', d.headline, '', totals(d)];
  for (const project of d.projects) {
    lines.push('', `${project.name} — ${project.health}`, project.summary);
    for (const highlight of project.highlights) lines.push(`• ${highlight}`);
  }
  if (d.warnings.length) lines.push('', 'Warnings', ...d.warnings.map((warning) => `• ${warning}`));
  const limit = Number.isNaN(maxLen) ? 3500 : Math.max(0, Math.floor(maxLen));
  return truncate(lines.join('\n'), limit);
}

export function renderEmailHtml(d: Digest, opts: { siteUrl?: string } = {}): string {
  const sections = d.projects.map(
    (project) =>
      `<section style="margin-top:24px"><h2 style="font-size:20px;margin:0 0 8px">${escapeHtml(project.name)} — ${escapeHtml(project.health)}</h2><p style="margin:0 0 8px;white-space:pre-line">${escapeHtml(project.summary)}</p><ul style="padding-left:24px">${project.highlights.map((highlight) => `<li>${escapeHtml(highlight)}</li>`).join('')}</ul></section>`,
  );
  const warnings = d.warnings.length
    ? `<h2 style="font-size:20px">Warnings</h2><ul>${d.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '';
  const url = archiveUrl(d, opts.siteUrl);
  const link = url ? `<p><a style="color:#2563eb" href="${escapeHtml(url)}">View full digest</a></p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overnight — ${escapeHtml(d.id)}</title></head><body style="margin:0;padding:24px;background:#f5f5f5;color:#171717;font-family:Arial,sans-serif;line-height:1.5"><main style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff"><h1 style="font-size:28px;margin-top:0">Overnight — ${escapeHtml(d.id)}</h1><p style="font-size:18px">${escapeHtml(d.headline)}</p><p style="color:#525252">${escapeHtml(totals(d))}</p>${sections.join('')}${warnings}${link}</main></body></html>`;
}
