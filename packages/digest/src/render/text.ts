import type { Digest, ProjectActivity, ProjectHealth } from '../types.js';

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

/** Only absolute http(s) URLs survive; everything else (javascript:, data:, relative, garbage) is dropped. */
function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
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

// ---------------------------------------------------------------------------
// Shared derivations (dates, health, "needs you", agents vs you)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Wednesday, 7 October 2026" from the YYYY-MM-DD archive key; the raw id if it is not a date. */
function longDate(id: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!match) return id;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== id) return id;
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "6 Oct 06:00" (UTC); the raw value if unparseable. */
function shortStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const month = (MONTHS[date.getUTCMonth()] ?? '').slice(0, 3);
  return `${date.getUTCDate()} ${month} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function windowLabel(d: Digest): string {
  return `${shortStamp(d.window.since)} – ${shortStamp(d.window.until)} UTC`;
}

/** Relative age of `at` versus the digest generation time: "40m", "5h", "3d"; '' if unknown. */
function age(at: string, now: string): string {
  const diff = new Date(now).getTime() - new Date(at).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const HEALTH_ORDER: ProjectHealth[] = ['red', 'yellow', 'green', 'quiet'];
const HEALTH_GLYPH: Record<ProjectHealth, string> = { red: '■', yellow: '▲', green: '●', quiet: '○' };

function healthCounts(d: Digest): Array<{ health: ProjectHealth; count: number }> {
  return HEALTH_ORDER.map((health) => ({
    health,
    count: d.projects.filter((project) => project.health === health).length,
  })).filter((entry) => entry.count > 0);
}

function tallyText(d: Digest): string {
  return healthCounts(d)
    .map(({ health, count }) => `${HEALTH_GLYPH[health]} ${count} ${health}`)
    .join(' · ');
}

type Tone = 'danger' | 'warn';

interface NeedRow {
  tone: Tone;
  reason: string;
  project: string;
  title: string;
  url?: string;
  action: string;
  at: string;
  agent: boolean;
  /** Non-default branch the item happened on, shown in meta rather than the reason. */
  branch?: string;
}

const PR_REASONS: Array<{
  key: NonNullable<ProjectActivity['openPRs'][number]['attention']>[number];
  label: string;
  tone: Tone;
}> = [
  { key: 'ci_failing', label: 'CI failing', tone: 'danger' },
  { key: 'conflicts', label: 'Conflicts', tone: 'warn' },
  { key: 'review_requested', label: 'Review requested', tone: 'warn' },
  { key: 'approved_unmerged', label: 'Approved, not merged', tone: 'warn' },
  { key: 'stale', label: 'Stale', tone: 'warn' },
];

/** Everything the reader must act on, worst first (failed deploys, CI, then PRs), project order preserved. */
function needsYou(d: Digest): NeedRow[] {
  const danger: NeedRow[] = [];
  const warn: NeedRow[] = [];
  for (const project of d.projects) {
    for (const deploy of project.deployments) {
      if (deploy.state !== 'ERROR') continue;
      danger.push({
        tone: 'danger',
        reason: deploy.target === 'production' ? 'Deploy failed' : 'Preview failed',
        project: project.name,
        title: deploy.commitMessage ?? deploy.branch ?? deploy.project,
        url: safeUrl(deploy.url),
        action: 'Logs',
        at: deploy.at,
        agent: false,
      });
    }
    for (const run of project.ciFailures) {
      const verb =
        run.conclusion === 'timed_out'
          ? 'timed out'
          : run.conclusion === 'cancelled'
            ? 'cancelled'
            : 'failed';
      const onDefault = run.branch === (project.defaultBranch ?? 'main') || run.branch === 'master';
      const row: NeedRow = {
        tone: run.conclusion === 'cancelled' ? 'warn' : 'danger',
        reason: onDefault ? `CI ${verb} on ${run.branch}` : `CI ${verb}`,
        branch: onDefault ? undefined : run.branch,
        project: project.name,
        title: run.commitMessage ? `${run.workflow}: ${run.commitMessage}` : run.workflow,
        url: safeUrl(run.url),
        action: 'View run',
        at: run.at,
        agent: false,
      };
      (row.tone === 'danger' ? danger : warn).push(row);
    }
    for (const pr of project.openPRs) {
      const reason = PR_REASONS.find((candidate) => pr.attention?.includes(candidate.key));
      if (!reason) continue;
      const row: NeedRow = {
        tone: reason.tone,
        reason: reason.label,
        project: project.name,
        title: `#${pr.number} ${pr.title}`,
        url: safeUrl(pr.url),
        action: 'Open PR',
        at: pr.at,
        agent: pr.author.isBot,
      };
      (row.tone === 'danger' ? danger : warn).push(row);
    }
  }
  return [...danger, ...warn];
}

function needReason(row: NeedRow): string {
  return row.branch ? `${row.reason} on ${row.branch}` : row.reason;
}

function agentSplit(d: Digest): { agents: number; you: number } {
  const agents = Math.max(0, d.totals.agentContributions);
  return { agents, you: Math.max(0, d.totals.mergedPRs + d.totals.commits - agents) };
}

function isQuietNight(d: Digest): boolean {
  const t = d.totals;
  return (
    t.mergedPRs + t.commits + t.releases + t.deployments + t.ciFailures + t.issuesOpened + t.issuesClosed ===
    0
  );
}

function summarizerLabel(d: Digest): string {
  return d.summarizer.kind === 'llm'
    ? `summaries: model (${d.summarizer.model})`
    : 'summaries: deterministic';
}

function projectMeta(project: ProjectActivity): string {
  const parts: string[] = [];
  const count = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  count(project.mergedPRs.length, 'merged', 'merged');
  count(project.commits.length, 'commit', 'commits');
  count(project.releases.length, 'release', 'releases');
  count(project.deployments.length, 'deploy', 'deploys');
  count(project.ciFailures.length, 'CI failure', 'CI failures');
  count(project.issues.length, 'issue', 'issues');
  const agentItems =
    project.mergedPRs.filter((pr) => pr.author.isBot).length +
    project.commits.filter((commit) => commit.author.isBot).length;
  const humanItems = project.mergedPRs.length + project.commits.length - agentItems;
  if (agentItems + humanItems > 0) parts.push(`agents ${agentItems} / you ${humanItems}`);
  return parts.join(' · ');
}

function partialData(d: Digest, project: ProjectActivity): boolean {
  return d.warnings.some((warning) => warning.includes(project.id));
}

// ---------------------------------------------------------------------------
// Markdown (Notion, email text part) and plain text (ntfy)
// ---------------------------------------------------------------------------

export function renderMarkdown(d: Digest, opts: { siteUrl?: string } = {}): string {
  const lines = [
    `# Overnight — ${escapeMarkdown(d.id)}`,
    '',
    `*${escapeMarkdown(longDate(d.id))} · window ${escapeMarkdown(windowLabel(d))}*`,
    '',
    `> ${escapeMarkdown(d.headline)}`,
  ];
  const tally = tallyText(d);
  if (tally) lines.push('', tally);
  lines.push('', totals(d));
  const split = agentSplit(d);
  if (split.agents + split.you > 0) lines.push('', `Agents ${split.agents} · You ${split.you}`);

  const needs = needsYou(d);
  if (needs.length) {
    lines.push('', '## Needs you', '');
    for (const row of needs.slice(0, 5)) {
      const link = row.url ? ` — [${row.action}](<${row.url}>)` : '';
      lines.push(
        `- **${escapeMarkdown(needReason(row))}** · ${escapeMarkdown(row.project)} · ${escapeMarkdown(row.title)}${link}`,
      );
    }
    if (needs.length > 5) lines.push(`- +${needs.length - 5} more`);
  }

  const quiet = d.projects.filter((project) => project.health === 'quiet');
  for (const project of d.projects) {
    if (project.health === 'quiet') continue;
    lines.push('', `## ${escapeMarkdown(project.name)} — ${project.health}`, '');
    const meta = projectMeta(project);
    if (meta) lines.push(`*${escapeMarkdown(meta)}*`, '');
    lines.push(escapeMarkdown(project.summary));
    if (project.highlights.length) lines.push('');
    for (const highlight of project.highlights) lines.push(`- ${escapeMarkdown(highlight)}`);
  }
  if (quiet.length) {
    lines.push('', `**No activity:** ${quiet.map((project) => escapeMarkdown(project.name)).join(', ')}`);
  }
  if (d.warnings.length) {
    lines.push('', '## Warnings', '', ...d.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  }
  lines.push('', '---', '', `*${escapeMarkdown(summarizerLabel(d))}*`);
  const url = archiveUrl(d, opts.siteUrl);
  if (url) lines.push('', `[View full digest](<${url}>)`);
  return `${lines.join('\n')}\n`;
}

export function renderPlainText(d: Digest, maxLen = 3500): string {
  const lines = [`Overnight — ${d.id}`, '', d.headline, '', totals(d)];
  const needs = needsYou(d);
  if (needs.length) {
    lines.push('', 'Needs you');
    for (const row of needs.slice(0, 5)) lines.push(`• ${needReason(row)} · ${row.project} · ${row.title}`);
    if (needs.length > 5) lines.push(`• +${needs.length - 5} more`);
  }
  const quiet = d.projects.filter((project) => project.health === 'quiet');
  for (const project of d.projects) {
    if (project.health === 'quiet') continue;
    lines.push('', `${project.name} — ${project.health}`, project.summary);
    for (const highlight of project.highlights) lines.push(`• ${highlight}`);
  }
  if (quiet.length) lines.push('', `No activity: ${quiet.map((project) => project.name).join(', ')}`);
  if (d.warnings.length) lines.push('', 'Warnings', ...d.warnings.map((warning) => `• ${warning}`));
  const limit = Number.isNaN(maxLen) ? 3500 : Math.max(0, Math.floor(maxLen));
  return truncate(lines.join('\n'), limit);
}

// ---------------------------------------------------------------------------
// Email HTML (Halyard light values inline; dark via <style> media + Outlook [data-ogsc]/[data-ogsb])
// ---------------------------------------------------------------------------

/** Halyard FONT_URL (packages/ui/src/index.ts); Apple Mail honours it, others use the fallbacks. */
const EMAIL_FONT_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap';

const SERIF = `'Instrument Serif',Georgia,'Times New Roman',serif`;
const SANS = `'Schibsted Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const MONO = `'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace`;

/** Halyard light values (packages/ui/tokens.css), borders pre-blended onto surface-1. */
const L = {
  bg: '#f3f0e8',
  surface: '#fbf9f4',
  surface3: '#ece8dd',
  line: '#e4e3de',
  lineStrong: '#cdccc8',
  fg: '#181a16',
  muted: '#55574f',
  subtle: '#85877d',
  accent: '#e2511a',
  danger: '#d1283a',
  warn: '#a86d00',
  success: '#3d8a2a',
  agents: '#e2511a',
};

/** Halyard dark values, used only inside the dark-mode style block. */
const D = {
  bg: '#0b0d0c',
  surface: '#121514',
  surface3: '#20251f',
  line: '#252824',
  lineStrong: '#393a36',
  fg: '#ece7da',
  muted: '#a7a596',
  subtle: '#6f7069',
  accent: '#ff6a2b',
  danger: '#ff5964',
  warn: '#f5b83d',
  success: '#9be564',
  agents: '#ff6a2b',
};

const HEALTH_COLOR: Record<ProjectHealth, keyof typeof L> = {
  red: 'danger',
  yellow: 'warn',
  green: 'success',
  quiet: 'muted',
};

/** [class, css property, dark value]. Colour props go to [data-ogsc], backgrounds to [data-ogsb]. */
const DARK_RULES: Array<[string, string, string]> = [
  ['ovn-bg', 'background-color', D.bg],
  ['ovn-surface', 'background-color', D.surface],
  ['ovn-notice', 'background-color', D.surface3],
  ['ovn-fg', 'color', D.fg],
  ['ovn-muted', 'color', D.muted],
  ['ovn-subtle', 'color', D.subtle],
  ['ovn-accent', 'color', D.accent],
  ['ovn-danger', 'color', D.danger],
  ['ovn-warn', 'color', D.warn],
  ['ovn-success', 'color', D.success],
  ['ovn-agents', 'color', D.agents],
  ['ovn-line', 'border-color', D.line],
  ['ovn-rule', 'border-color', D.fg],
  ['ovn-notice', 'border-color', D.warn],
  ['ovn-danger-bg', 'background-color', D.danger],
  ['ovn-bar-agents', 'background-color', D.agents],
  ['ovn-bar-you', 'background-color', D.fg],
  ['ovn-btn', 'background-color', D.accent],
  ['ovn-btn', 'border-color', D.accent],
  ['ovn-btn-text', 'color', D.bg],
  ['ovn-link', 'text-decoration-color', D.accent],
];

function emailStyleBlock(): string {
  const dark = DARK_RULES.map(([cls, prop, value]) => `.${cls}{${prop}:${value} !important}`).join('');
  const outlook = DARK_RULES.map(
    ([cls, prop, value]) =>
      `[data-${prop.startsWith('background') ? 'ogsb' : 'ogsc'}] .${cls}{${prop}:${value} !important}`,
  ).join('');
  return [
    ':root{color-scheme:light dark;supported-color-schemes:light dark}',
    'body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}',
    'table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}',
    'a{text-decoration-thickness:1px;text-underline-offset:2px}',
    `@media (prefers-color-scheme: dark){${dark}}`,
    outlook,
    '@media (max-width:620px){',
    '.ovn-shell{padding:0 !important}',
    '.ovn-px{padding-left:20px !important;padding-right:20px !important}',
    '.ovn-date{font-size:42px !important}',
    '.ovn-weekday{font-size:20px !important}',
    '.ovn-headline{font-size:22px !important}',
    '.ovn-num{font-size:20px !important}',
    '.ovn-card{border-left:0 !important;border-right:0 !important}',
    '}',
  ].join('');
}

const esc = escapeHtml;

function sectionLabel(n: number, label: string): string {
  return `<tr><td class="ovn-px" style="padding:32px 40px 12px 40px"><p class="ovn-muted" style="margin:0;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${L.muted}"><span class="ovn-accent" style="color:${L.accent}">${pad(n)}</span>&nbsp;&nbsp;${esc(label)}</p></td></tr>`;
}

function link(url: string | undefined, text: string, style: string, cls = 'ovn-fg ovn-link'): string {
  if (!url) return `<span class="${cls}" style="${style}">${text}</span>`;
  return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener" style="${style}">${text}</a>`;
}

function healthMark(health: ProjectHealth): string {
  const key = HEALTH_COLOR[health];
  return `<span class="ovn-${key}" style="font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;color:${L[key]};white-space:nowrap">${HEALTH_GLYPH[health]}&nbsp;${health}</span>`;
}

function emailMasthead(d: Digest, rough: boolean): string {
  const date = longDate(d.id);
  const comma = date === d.id ? -1 : date.indexOf(', ');
  const weekday = comma > 0 ? date.slice(0, comma) : '';
  const dateRest = comma > 0 ? date.slice(comma + 2) : date;
  const tally = healthCounts(d)
    .map(({ health, count }) => {
      const key = HEALTH_COLOR[health];
      return `<span class="ovn-${key}" style="color:${L[key]};white-space:nowrap">${HEALTH_GLYPH[health]}&nbsp;${count}&nbsp;${health}</span>`;
    })
    .join('&nbsp;&nbsp; ');
  const notice = d.warnings.length
    ? `<tr><td class="ovn-px" style="padding:0 40px 8px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ovn-notice ovn-fg" style="padding:10px 14px;background-color:${L.surface3};border-left:3px solid ${L.warn};font-family:${SANS};font-size:14px;line-height:20px;color:${L.fg}"><span class="ovn-warn" style="color:${L.warn};font-weight:600">▲</span>&nbsp; ${d.warnings.length === 1 ? 'One source was' : `${d.warnings.length} sources were`} unavailable, so totals exclude ${d.warnings.length === 1 ? 'it' : 'them'}.</td></tr></table></td></tr>`
    : '';
  const roughRule = rough
    ? `<tr><td class="ovn-px" style="padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ovn-danger-bg" height="3" style="height:3px;line-height:3px;font-size:0;background-color:${L.danger}">&nbsp;</td></tr></table></td></tr>`
    : '';
  return [
    // wordmark + owner
    `<tr><td class="ovn-px" style="padding:32px 40px 0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td class="ovn-fg" style="font-family:${SERIF};font-size:22px;line-height:28px;font-style:italic;color:${L.fg}">Overnight<span class="ovn-accent" style="color:${L.accent};font-style:normal">.</span></td>`,
    `<td align="right" class="ovn-muted" style="font-family:${MONO};font-size:11px;line-height:28px;letter-spacing:0.08em;text-transform:uppercase;color:${L.muted}">${esc(d.owner)}</td>`,
    `</tr></table></td></tr>`,
    // date
    `<tr><td class="ovn-px" style="padding:36px 40px 0 40px">${weekday ? `<p class="ovn-muted ovn-weekday" style="margin:0 0 2px 0;font-family:${SERIF};font-style:italic;font-size:24px;line-height:1.1;letter-spacing:-0.01em;color:${L.muted}">${esc(weekday)}</p>` : ''}<h1 class="ovn-fg ovn-date" style="margin:0;font-family:${SERIF};font-weight:400;font-size:60px;line-height:1;letter-spacing:-0.02em;color:${L.fg}">${esc(dateRest)}</h1></td></tr>`,
    // dateline + double rule
    `<tr><td class="ovn-px" style="padding:12px 40px 0 40px"><p class="ovn-muted ovn-rule" style="margin:0;padding:0 0 14px 0;border-bottom:3px double ${L.fg};font-family:${MONO};font-size:11px;line-height:18px;letter-spacing:0.06em;text-transform:uppercase;color:${L.muted}">Window ${esc(windowLabel(d))}</p></td></tr>`,
    `<tr><td style="font-size:0;line-height:0;height:20px">&nbsp;</td></tr>`,
    notice,
    roughRule,
    // headline
    `<tr><td class="ovn-px" style="padding:${rough ? '16px' : '4px'} 40px 0 40px"><p class="ovn-fg ovn-headline" style="margin:0;font-family:${SERIF};font-weight:400;font-size:28px;line-height:1.2;letter-spacing:-0.01em;color:${L.fg}">${esc(d.headline)}</p></td></tr>`,
    tally
      ? `<tr><td class="ovn-px" style="padding:14px 40px 0 40px;font-family:${MONO};font-size:12px;line-height:18px;letter-spacing:0.02em">${tally}</td></tr>`
      : '',
  ].join('');
}

function emailNeedsYou(rows: NeedRow[], n: number, url: string | undefined, generatedAt: string): string {
  if (!rows.length) return '';
  const shown = rows.slice(0, 5).map((row, index) => {
    const key: keyof typeof L = row.tone;
    const when = age(row.at, generatedAt);
    const meta = [
      esc(row.project),
      row.branch ? esc(row.branch) : '',
      when ? esc(when) : '',
      row.agent ? 'AGT' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const action = row.url
      ? link(
          row.url,
          `${esc(row.action)}&nbsp;→`,
          `font-family:${MONO};font-size:12px;line-height:18px;color:${L.fg};text-decoration:underline;text-decoration-color:${L.accent};white-space:nowrap`,
        )
      : '';
    return `<tr><td class="ovn-line" style="padding:12px 0;border-top:1px solid ${index ? L.line : L.lineStrong}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="padding:0 12px 0 0"><p class="ovn-${key}" style="margin:0;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;color:${L[key]}">${esc(row.reason)}</p><p class="ovn-fg" style="margin:4px 0 0 0;font-family:${SANS};font-size:15px;line-height:22px;color:${L.fg};word-break:break-word">${esc(row.title)}</p><p class="ovn-muted" style="margin:2px 0 0 0;font-family:${MONO};font-size:11px;line-height:16px;color:${L.muted}">${meta}</p></td><td valign="top" align="right" width="88" style="width:88px;padding-top:18px">${action}</td></tr></table></td></tr>`;
  });
  const more =
    rows.length > 5
      ? `<tr><td class="ovn-line ovn-muted" style="padding:10px 0 0 0;border-top:1px solid ${L.line};font-family:${MONO};font-size:12px;line-height:18px;color:${L.muted}">${link(url, `+${rows.length - 5} more`, `color:${L.muted};text-decoration:underline`, 'ovn-muted')}</td></tr>`
      : '';
  return `${sectionLabel(n, 'Needs you')}<tr><td class="ovn-px" style="padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${shown.join('')}${more}</table></td></tr>`;
}

function statCell(value: string, label: string, tone?: keyof typeof L, note?: string): string {
  const key = tone ?? 'fg';
  const noteHtml = note
    ? `<p class="ovn-${key}" style="margin:2px 0 0 0;font-family:${MONO};font-size:10px;line-height:14px;letter-spacing:0.08em;text-transform:uppercase;color:${L[key]}">${esc(note)}</p>`
    : '';
  return `<td class="ovn-line" width="25%" valign="top" style="width:25%;padding:12px 8px 12px 0;border-top:1px solid ${L.line}"><p class="ovn-${key} ovn-num" style="margin:0;font-family:${MONO};font-size:24px;line-height:28px;font-weight:500;color:${L[key]};font-variant-numeric:tabular-nums">${esc(value)}</p><p class="ovn-muted" style="margin:4px 0 0 0;font-family:${MONO};font-size:10px;line-height:14px;letter-spacing:0.08em;text-transform:uppercase;color:${L.muted}">${esc(label)}</p>${noteHtml}</td>`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

function emailNumbers(d: Digest, n: number, needCount: number): string {
  const t = d.totals;
  const rowA = [
    statCell(String(t.mergedPRs), 'merged'),
    statCell(String(t.commits), t.commits === 1 ? 'commit' : 'commits'),
    statCell(String(t.releases), t.releases === 1 ? 'release' : 'releases'),
    statCell(
      String(t.deployments),
      'deploys',
      t.deploymentsFailed ? 'danger' : undefined,
      t.deploymentsFailed ? `${t.deploymentsFailed} failed` : undefined,
    ),
  ];
  const rowB = [
    statCell(String(t.ciFailures), 'CI failures', t.ciFailures ? 'danger' : undefined),
    statCell(`${t.issuesOpened}/${t.issuesClosed}`, 'issues open/closed'),
    statCell(signed(t.starsDelta), 'stars'),
    statCell(String(needCount), 'need you', needCount ? 'warn' : undefined),
  ];
  const split = agentSplit(d);
  const total = split.agents + split.you;
  let lane = '';
  if (total > 0) {
    const agentPct = Math.round((split.agents / total) * 100);
    const cells = [
      split.agents
        ? `<td class="ovn-bar-agents" width="${agentPct}%" height="6" style="width:${agentPct}%;height:6px;line-height:6px;font-size:0;background-color:${L.agents}">&nbsp;</td>`
        : '',
      split.agents && split.you
        ? `<td width="2" style="width:2px;font-size:0;line-height:0">&nbsp;</td>`
        : '',
      split.you
        ? `<td class="ovn-bar-you" height="6" style="height:6px;line-height:6px;font-size:0;background-color:${L.fg}">&nbsp;</td>`
        : '',
    ].join('');
    const share =
      split.agents === 0 ? 'All by you' : split.you === 0 ? 'All by agents' : `${agentPct}% by agents`;
    lane = `<tr><td class="ovn-px" style="padding:20px 40px 0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${MONO};font-size:12px;line-height:18px;letter-spacing:0.02em"><span class="ovn-agents" style="color:${L.agents}">■</span> <span class="ovn-fg" style="color:${L.fg}">Agents&nbsp;<b style="font-weight:600">${split.agents}</b></span>&nbsp;&nbsp;·&nbsp;&nbsp;<span class="ovn-fg" style="color:${L.fg}">■ You&nbsp;<b style="font-weight:600">${split.you}</b></span></td><td align="right" class="ovn-muted" style="font-family:${SANS};font-size:13px;line-height:18px;color:${L.muted}">${share}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px"><tr>${cells}</tr></table></td></tr>`;
  }
  return `${sectionLabel(n, 'The night in numbers')}<tr><td class="ovn-px" style="padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${rowA.join('')}</tr><tr>${rowB.join('')}</tr></table></td></tr>${lane}`;
}

function emailProject(d: Digest, project: ProjectActivity, first: boolean): string {
  const meta = projectMeta(project);
  const partial = partialData(d, project)
    ? `&nbsp;&nbsp;<span class="ovn-warn" style="font-family:${MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${L.warn};white-space:nowrap">▲ Partial data</span>`
    : '';
  const highlights = project.highlights
    .slice(0, 3)
    .map(
      (highlight) =>
        `<tr><td valign="top" width="18" class="ovn-subtle" style="width:18px;font-family:${MONO};font-size:13px;line-height:22px;color:${L.subtle}">–</td><td class="ovn-fg" style="font-family:${SANS};font-size:14px;line-height:22px;color:${L.fg}">${esc(highlight)}</td></tr>`,
    );
  const extra = project.highlights.length - 3;
  if (extra > 0)
    highlights.push(
      `<tr><td></td><td class="ovn-muted" style="font-family:${MONO};font-size:11px;line-height:20px;color:${L.muted}">+${extra} more in the full edition</td></tr>`,
    );
  return `<tr><td class="ovn-line" style="padding:20px 0;border-top:1px solid ${first ? L.lineStrong : L.line}"><p style="margin:0 0 6px 0">${healthMark(project.health)}${partial}</p>${link(
    safeUrl(project.url),
    esc(project.name),
    `font-family:${SERIF};font-size:24px;line-height:30px;color:${L.fg};text-decoration:none;word-break:break-word`,
    'ovn-fg',
  )}${meta ? `<p class="ovn-muted" style="margin:4px 0 0 0;font-family:${MONO};font-size:11px;line-height:16px;color:${L.muted}">${esc(meta)}</p>` : ''}<p class="ovn-fg" style="margin:10px 0 0 0;font-family:${SANS};font-size:15px;line-height:23px;color:${L.fg};white-space:pre-line">${esc(project.summary)}</p>${highlights.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${highlights.join('')}</table>` : ''}</td></tr>`;
}

export function renderEmailHtml(d: Digest, opts: { siteUrl?: string } = {}): string {
  const url = archiveUrl(d, opts.siteUrl);
  const needs = needsYou(d);
  const active = d.projects.filter((project) => project.health !== 'quiet');
  const quiet = d.projects.filter((project) => project.health === 'quiet');
  const rough = d.projects.some((project) => project.health === 'red');
  let n = 0;

  const sections: string[] = [];
  if (needs.length) sections.push(emailNeedsYou(needs, ++n, url, d.generatedAt));
  const quietNight = isQuietNight(d);
  if (!quietNight) sections.push(emailNumbers(d, ++n, needs.length));
  if (active.length) {
    sections.push(
      `${sectionLabel(++n, 'Projects')}<tr><td class="ovn-px" style="padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${active.map((project, index) => emailProject(d, project, index === 0)).join('')}</table></td></tr>`,
    );
  }
  if (quiet.length || quietNight) {
    const lead = quietNight
      ? `<p class="ovn-fg" style="margin:0 0 6px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${L.fg}">No merges, commits, releases or deploys in the window.</p>`
      : '';
    const names = quiet.length
      ? `<p class="ovn-muted" style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${L.muted}"><span style="font-family:${MONO}">○</span>&nbsp; No activity: ${quiet.map((project) => `<span style="white-space:nowrap">${esc(project.name)}</span>`).join(', ')}.</p>`
      : '';
    sections.push(
      `${sectionLabel(++n, 'Quiet')}<tr><td class="ovn-px" style="padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ovn-line" style="padding:12px 0 0 0;border-top:1px solid ${L.lineStrong}">${lead}${names}</td></tr></table></td></tr>`,
    );
  }

  const button = url
    ? `<tr><td class="ovn-px" style="padding:36px 40px 0 40px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="ovn-btn" style="border-radius:4px;background-color:${L.fg};border:1px solid ${L.fg}"><a class="ovn-btn-text" href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;line-height:18px;font-weight:600;color:${L.surface};text-decoration:none;border-radius:4px">View full digest&nbsp;→</a></td></tr></table></td></tr>`
    : '';
  const colophonLine = (text: string) =>
    `<p class="ovn-muted" style="margin:0 0 4px 0;font-family:${MONO};font-size:11px;line-height:17px;color:${L.muted}">${text}</p>`;
  const warnings = d.warnings.length
    ? `<p class="ovn-warn" style="margin:14px 0 4px 0;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${L.warn}">▲ Warnings</p>${d.warnings.map((warning) => colophonLine(`– ${esc(warning)}`)).join('')}`
    : '';
  const fallbackNote =
    d.summarizer.kind === 'fallback'
      ? `<p class="ovn-fg" style="margin:0 0 10px 0;font-family:${SANS};font-size:13px;line-height:19px;color:${L.fg}">Plain summaries tonight: the model was unavailable.</p>`
      : '';
  const footer = `<tr><td class="ovn-px" style="padding:36px 40px 36px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ovn-line" style="padding-top:16px;border-top:1px solid ${L.lineStrong}">${fallbackNote}${colophonLine(`Window ${esc(windowLabel(d))}`)}${colophonLine(`Generated ${esc(shortStamp(d.generatedAt))} UTC`)}${colophonLine(esc(summarizerLabel(d)))}${warnings}<p class="ovn-muted" style="margin:14px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${L.muted}">Sent because you configured Overnight for ${esc(d.owner)}.</p></td></tr></table></td></tr>`;

  const preheader = esc(truncate(d.headline, 90));
  const filler = '&#847;&zwnj;&nbsp;'.repeat(40);

  return [
    '<!doctype html>',
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting">',
    '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>Overnight — ${esc(d.id)}</title>`,
    `<!--[if !mso]><!--><link rel="preconnect" href="https://fonts.googleapis.com"><link href="${esc(EMAIL_FONT_URL)}" rel="stylesheet"><!--<![endif]-->`,
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->',
    `<style>${emailStyleBlock()}</style>`,
    '</head>',
    `<body class="ovn-bg" style="margin:0;padding:0;background-color:${L.bg};color:${L.fg}">`,
    `<div class="ovn-preheader" style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${L.bg}">${preheader}${filler}</div>`,
    `<table role="presentation" class="ovn-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.bg}" style="width:100%;background-color:${L.bg}"><tr><td class="ovn-shell" align="center" style="padding:32px 12px">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    `<table role="presentation" class="ovn-surface ovn-line ovn-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.surface}" style="width:100%;max-width:600px;margin:0 auto;background-color:${L.surface};border:1px solid ${L.line}">`,
    emailMasthead(d, rough),
    ...sections,
    button,
    footer,
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr></table>',
    '</body></html>',
  ].join('');
}
