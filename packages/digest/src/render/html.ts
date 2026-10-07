import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  CIFailureItem,
  CommitItem,
  DeploymentItem,
  Digest,
  DigestIndex,
  DigestTotals,
  IssueItem,
  ProjectActivity,
  PullRequestItem,
  ReleaseItem,
} from '../types.js';

// ---------------------------------------------------------------------------
// Public option types (all extra fields are optional, so the ARCHITECTURE signatures still hold)
// ---------------------------------------------------------------------------

export interface DigestNav {
  /** Href of the previous (older) digest page. */
  prev?: string;
  /** Href of the next (newer) digest page. */
  next?: string;
  /** Href of the archive index page. */
  index?: string;
}

export interface FragmentOptions {
  /** IANA timezone used to render clock times. Default "UTC". */
  timezone?: string;
}

export interface DigestHtmlOptions extends FragmentOptions {
  siteTitle: string;
  baseHref?: string;
  nav?: DigestNav;
}

export interface IndexHtmlOptions extends FragmentOptions {
  siteTitle: string;
  latest?: Digest;
}

export interface WriteArchiveOptions extends FragmentOptions {
  siteTitle: string;
}

// ---------------------------------------------------------------------------
// Escaping + URL safety
// ---------------------------------------------------------------------------

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape text for both element content and quoted attribute values. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

/** Absolute external URL: only http(s) survive, everything else becomes "#". Returns an escaped attribute value. */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string') return '#';
  const trimmed = u.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#';
    return escapeHtml(parsed.href);
  } catch {
    return '#';
  }
}

/** Internal href: relative paths allowed; any explicit scheme other than http(s) becomes "#". */
function safeHref(u: unknown): string {
  if (typeof u !== 'string' || u.length === 0) return '#';
  // Browsers ignore ASCII whitespace/control chars inside schemes ("java\tscript:"), so check a stripped copy.
  const stripped = u.replace(/[\u0000- \u007f]/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(stripped)) return safeUrl(u);
  if (stripped.startsWith('//')) return safeUrl(`https:${stripped}`);
  return escapeHtml(u);
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

interface TimeCtx {
  tz: string;
  /** YYYY-MM-DD of the digest; times on another day get a short date prefix. */
  dayKey: string;
  warning?: string;
}

function resolveTimeZone(tz: string | undefined): { tz: string; warning?: string } {
  const want = tz && tz.trim() ? tz.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: want });
    return { tz: want };
  } catch {
    return { tz: 'UTC', warning: `Unknown timezone "${want}"; times are shown in UTC.` };
  }
}

function makeTimeCtx(d: Digest, timezone: string | undefined): TimeCtx {
  const { tz, warning } = resolveTimeZone(timezone);
  return warning ? { tz, dayKey: d.id, warning } : { tz, dayKey: d.id };
}

function parseDate(iso: unknown): Date | undefined {
  // Only ISO-8601 timestamps: Date.parse is lenient and turns arbitrary text into bogus dates.
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : new Date(t);
}

function dayKeyIn(date: Date, tz: string): string {
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function clock(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function shortDay(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(date);
}

/** Absolute "HH:MM" in the digest timezone, prefixed with "6 Oct" when not on the digest day. */
function fmtTime(iso: string, t: TimeCtx): string {
  const date = parseDate(iso);
  if (!date) return '';
  const hm = clock(date, t.tz);
  return dayKeyIn(date, t.tz) === t.dayKey ? hm : `${shortDay(date, t.tz)} ${hm}`;
}

function timeTag(iso: string, t: TimeCtx): string {
  const text = fmtTime(iso, t);
  if (!text) return '';
  return `<time class="ovn-time" datetime="${escapeHtml(iso)}">${escapeHtml(text)}</time>`;
}

const ID_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "Wednesday, 7 October 2026" from a YYYY-MM-DD key (calendar date, timezone-independent). */
function longDate(id: string): string {
  if (!ID_RE.test(id)) return id;
  const date = new Date(`${id}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return id;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function shortDate(id: string): string {
  if (!ID_RE.test(id)) return id;
  const date = new Date(`${id}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return id;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function monthLabel(id: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(id);
  if (!m) return 'Other';
  const date = new Date(`${m[1]}-${m[2]}-15T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'Other';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(date);
}

function windowLabel(d: Digest, t: TimeCtx): string {
  const since = parseDate(d.window.since);
  const until = parseDate(d.window.until);
  if (!since || !until) return '';
  const fmt = (x: Date) => `${shortDay(x, t.tz)} ${clock(x, t.tz)}`;
  return `${fmt(since)} → ${fmt(until)} (${t.tz})`;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Digest JSON is untrusted (embedders render it): coerce numbers before any interpolation. */
function finiteNum(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/** Untrusted string field → string (non-strings become ""), so string methods never throw. */
function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

const HEALTHS: ReadonlyArray<ProjectActivity['health']> = ['green', 'yellow', 'red', 'quiet'];

/** Untrusted health → known enum value; anything else is treated as 'quiet'. */
function healthOf(p: ProjectActivity): ProjectActivity['health'] {
  return HEALTHS.includes(p.health) ? p.health : 'quiet';
}

function pill(
  text: string,
  variant: 'neutral' | 'red' | 'yellow' | 'green' | 'blue' | 'agent' = 'neutral',
): string {
  return `<span class="ovn-pill ovn-pill-${variant}">${escapeHtml(text)}</span>`;
}

function link(url: string, text: string, cls = 'ovn-link'): string {
  return `<a class="${cls}" href="${safeUrl(url)}" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

function authorTag(a: { login: string; isBot: boolean }): string {
  return `<span class="ovn-author">${escapeHtml(a.login)}</span>${a.isBot ? ' ' + pill('agent', 'agent') : ''}`;
}

function tile(label: string, value: string, variant: '' | 'red' | 'green' | 'agent' = '', sub = ''): string {
  const cls = variant ? ` ovn-tile-${variant}` : '';
  const subHtml = sub ? `<span class="ovn-tile-sub">${escapeHtml(sub)}</span>` : '';
  return `<div class="ovn-tile${cls}"><span class="ovn-tile-value">${escapeHtml(value)}</span><span class="ovn-tile-label">${escapeHtml(label)}</span>${subHtml}</div>`;
}

function statTiles(t: DigestTotals): string {
  const tiles = [
    tile('Merged PRs', String(t.mergedPRs)),
    tile('Commits', String(t.commits)),
    tile('Releases', String(t.releases)),
    tile(
      'Deploys',
      String(t.deployments),
      t.deploymentsFailed > 0 ? 'red' : '',
      t.deploymentsFailed > 0 ? `${t.deploymentsFailed} failed` : '',
    ),
    tile('CI failures', String(t.ciFailures), t.ciFailures > 0 ? 'red' : ''),
    tile('Stars', signed(t.starsDelta), t.starsDelta > 0 ? 'green' : ''),
    tile('Agent contributions', String(t.agentContributions), t.agentContributions > 0 ? 'agent' : ''),
  ];
  return `<div class="ovn-tiles">${tiles.join('')}</div>`;
}

function miniTotals(t: DigestTotals): string {
  const parts = [
    plural(t.mergedPRs, 'PR'),
    plural(t.commits, 'commit'),
    plural(t.releases, 'release'),
    plural(t.deployments, 'deploy'),
  ];
  const bad =
    t.ciFailures > 0
      ? ` <span class="ovn-mini-bad">${escapeHtml(plural(t.ciFailures, 'CI failure'))}</span>`
      : '';
  return `<span class="ovn-mini">${escapeHtml(parts.join(' · '))}${bad}</span>`;
}

// ---------------------------------------------------------------------------
// "Needs you"
// ---------------------------------------------------------------------------

const ATTENTION_LABEL: Record<
  NonNullable<PullRequestItem['attention']>[number],
  { text: string; variant: 'red' | 'yellow' | 'green' }
> = {
  ci_failing: { text: 'CI failing', variant: 'red' },
  conflicts: { text: 'conflicts', variant: 'red' },
  review_requested: { text: 'review requested', variant: 'yellow' },
  stale: { text: 'stale', variant: 'yellow' },
  approved_unmerged: { text: 'approved, not merged', variant: 'green' },
};

interface NeedItem {
  level: 'red' | 'yellow';
  at: string;
  html: string;
}

function needsItems(d: Digest, t: TimeCtx): NeedItem[] {
  const items: NeedItem[] = [];
  for (const p of d.projects) {
    const proj = `<span class="ovn-need-project">${escapeHtml(p.name)}</span>`;
    for (const f of p.ciFailures) {
      const msg = f.commitMessage
        ? `<span class="ovn-need-detail">${escapeHtml(f.commitMessage)}</span>`
        : '';
      items.push({
        level: 'red',
        at: f.at,
        html: `${proj}${link(f.url, `${f.workflow} ${str(f.conclusion).replace(/_/g, ' ')} on ${f.branch}`, 'ovn-need-title')}${pill('CI', 'red')}${msg}${timeTag(f.at, t)}`,
      });
    }
    for (const dep of p.deployments) {
      if (dep.target !== 'production' || dep.state !== 'ERROR') continue;
      const msg = dep.commitMessage
        ? `<span class="ovn-need-detail">${escapeHtml(dep.commitMessage)}</span>`
        : '';
      items.push({
        level: 'red',
        at: dep.at,
        html: `${proj}${link(dep.url, `Production deploy failed${dep.branch ? ` (${dep.branch})` : ''}`, 'ovn-need-title')}${pill('deploy', 'red')}${msg}${timeTag(dep.at, t)}`,
      });
    }
    for (const pr of p.openPRs) {
      const reasons = (Array.isArray(pr.attention) ? pr.attention : [])
        .filter(
          (r): r is keyof typeof ATTENTION_LABEL =>
            typeof r === 'string' && Object.hasOwn(ATTENTION_LABEL, r),
        )
        .map((r) => ATTENTION_LABEL[r]);
      const pills = reasons.map((r) => pill(r.text, r.variant)).join('');
      const red = reasons.some((r) => r.variant === 'red');
      items.push({
        level: red ? 'red' : 'yellow',
        at: pr.at,
        html: `${proj}${link(pr.url, `#${pr.number} ${pr.title}`, 'ovn-need-title')}${pr.draft ? pill('draft') : ''}${pills}<span class="ovn-need-detail">by ${authorTag(pr.author)}</span>${timeTag(pr.at, t)}`,
      });
    }
  }
  // Red first, then most recent first.
  return items.sort((a, b) =>
    a.level !== b.level ? (a.level === 'red' ? -1 : 1) : (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
  );
}

function renderNeeds(d: Digest, t: TimeCtx): string {
  const items = needsItems(d, t);
  if (items.length === 0) return '';
  const rows = items
    .map(
      (i) =>
        `<li class="ovn-need ovn-need-${i.level}"><span class="ovn-dot ovn-dot-${i.level}" aria-hidden="true"></span><div class="ovn-need-body">${i.html}</div></li>`,
    )
    .join('');
  return `<section class="ovn-section ovn-needs" aria-labelledby="ovn-needs-h"><h2 class="ovn-h2" id="ovn-needs-h">Needs you <span class="ovn-count">${items.length}</span></h2><ul class="ovn-need-list">${rows}</ul></section>`;
}

// ---------------------------------------------------------------------------
// Project cards
// ---------------------------------------------------------------------------

const HEALTH_LABEL: Record<ProjectActivity['health'], string> = {
  green: 'Healthy',
  yellow: 'Needs attention',
  red: 'Failing',
  quiet: 'Quiet',
};

const LIST_CAP = 40;

function capped<T>(items: T[], render: (x: T) => string, noun: string): string {
  const shown = items.slice(0, LIST_CAP).map(render).join('');
  const more =
    items.length > LIST_CAP
      ? `<li class="ovn-row ovn-more">${escapeHtml(`+${items.length - LIST_CAP} more ${noun}`)}</li>`
      : '';
  return `${shown}${more}`;
}

function detailGroup(title: string, count: number, rows: string): string {
  if (count === 0) return '';
  return `<div class="ovn-group"><h4 class="ovn-h4">${escapeHtml(title)} <span class="ovn-count">${count}</span></h4><ul class="ovn-rows">${rows}</ul></div>`;
}

function prRow(pr: PullRequestItem, t: TimeCtx): string {
  const additions = finiteNum(pr.additions);
  const deletions = finiteNum(pr.deletions);
  const size =
    additions !== undefined || deletions !== undefined
      ? `<span class="ovn-diff"><span class="ovn-add">${escapeHtml(`+${additions ?? 0}`)}</span> <span class="ovn-del">${escapeHtml(`−${deletions ?? 0}`)}</span></span>`
      : '';
  return `<li class="ovn-row">${link(pr.url, `#${pr.number} ${pr.title}`, 'ovn-row-title')}<span class="ovn-row-meta">${authorTag(pr.author)}${size}${timeTag(pr.at, t)}</span></li>`;
}

function releaseRow(r: ReleaseItem, t: TimeCtx): string {
  const label = r.name && r.name !== r.tag ? `${r.tag} — ${r.name}` : r.tag;
  return `<li class="ovn-row">${link(r.url, label, 'ovn-row-title')}<span class="ovn-row-meta">${r.prerelease ? pill('pre-release', 'yellow') : pill('release', 'blue')}${timeTag(r.at, t)}</span></li>`;
}

function deployRow(dep: DeploymentItem, t: TimeCtx): string {
  const variant =
    dep.state === 'READY'
      ? 'green'
      : dep.state === 'ERROR'
        ? 'red'
        : dep.state === 'CANCELED'
          ? 'neutral'
          : 'yellow';
  const label = dep.commitMessage || dep.branch || dep.id;
  return `<li class="ovn-row">${link(dep.url, label, 'ovn-row-title')}<span class="ovn-row-meta">${pill(str(dep.target))}${pill(str(dep.state).toLowerCase(), variant)}${timeTag(dep.at, t)}</span></li>`;
}

function ciRow(f: CIFailureItem, t: TimeCtx): string {
  return `<li class="ovn-row">${link(f.url, `${f.workflow} on ${f.branch}`, 'ovn-row-title')}<span class="ovn-row-meta">${pill(str(f.conclusion).replace(/_/g, ' '), 'red')}${timeTag(f.at, t)}</span></li>`;
}

function issueRow(i: IssueItem, t: TimeCtx): string {
  return `<li class="ovn-row">${link(i.url, `#${i.number} ${i.title}`, 'ovn-row-title')}<span class="ovn-row-meta">${pill(i.state, i.state === 'closed' ? 'green' : 'neutral')}${authorTag(i.author)}${timeTag(i.at, t)}</span></li>`;
}

function commitRow(c: CommitItem, t: TimeCtx): string {
  return `<li class="ovn-row"><a class="ovn-sha" href="${safeUrl(c.url)}" rel="noopener noreferrer">${escapeHtml(str(c.sha).slice(0, 7))}</a><span class="ovn-row-title">${escapeHtml(c.message)}</span><span class="ovn-row-meta">${authorTag(c.author)}${timeTag(c.at, t)}</span></li>`;
}

function projectCounts(p: ProjectActivity): string {
  const parts: string[] = [];
  if (p.mergedPRs.length) parts.push(plural(p.mergedPRs.length, 'merged PR'));
  if (p.commits.length) parts.push(plural(p.commits.length, 'commit'));
  if (p.releases.length) parts.push(plural(p.releases.length, 'release'));
  if (p.deployments.length) parts.push(plural(p.deployments.length, 'deploy'));
  const issues = p.issues.length;
  if (issues) parts.push(plural(issues, 'issue'));
  return parts.join(' · ');
}

function renderProject(p: ProjectActivity, t: TimeCtx): string {
  const site = p.siteUrl ? link(p.siteUrl, 'site ↗', 'ovn-site') : '';
  const stars = p.stats
    ? `<span class="ovn-stars" title="Stars">★ ${escapeHtml(String(p.stats.stars))}${p.stats.starsDelta !== 0 ? ` <span class="${p.stats.starsDelta > 0 ? 'ovn-add' : 'ovn-del'}">${escapeHtml(signed(p.stats.starsDelta))}</span>` : ''}</span>`
    : '';
  const desc = p.description ? `<p class="ovn-desc">${escapeHtml(p.description)}</p>` : '';
  const summary = p.summary ? `<p class="ovn-summary">${escapeHtml(p.summary)}</p>` : '';
  const highlights = p.highlights.length
    ? `<ul class="ovn-highlights">${p.highlights
        .slice(0, 5)
        .map((h) => `<li>${escapeHtml(h)}</li>`)
        .join('')}</ul>`
    : '';
  const groups = [
    detailGroup(
      'Merged pull requests',
      p.mergedPRs.length,
      capped(p.mergedPRs, (x) => prRow(x, t), 'PRs'),
    ),
    detailGroup(
      'Releases',
      p.releases.length,
      capped(p.releases, (x) => releaseRow(x, t), 'releases'),
    ),
    detailGroup(
      'Deployments',
      p.deployments.length,
      capped(p.deployments, (x) => deployRow(x, t), 'deployments'),
    ),
    detailGroup(
      'CI failures',
      p.ciFailures.length,
      capped(p.ciFailures, (x) => ciRow(x, t), 'failures'),
    ),
    detailGroup(
      'Issues',
      p.issues.length,
      capped(p.issues, (x) => issueRow(x, t), 'issues'),
    ),
    detailGroup(
      'Commits',
      p.commits.length,
      capped(p.commits, (x) => commitRow(x, t), 'commits'),
    ),
  ].join('');
  const counts = projectCounts(p);
  const details = groups
    ? `<details class="ovn-details"><summary class="ovn-summary-toggle">${escapeHtml(counts || 'Details')}</summary><div class="ovn-details-body">${groups}</div></details>`
    : '';
  const health = escapeHtml(healthOf(p));
  const healthLabel = escapeHtml(HEALTH_LABEL[healthOf(p)]);
  return `<article class="ovn-card ovn-card-${health}"><header class="ovn-card-head"><span class="ovn-dot ovn-dot-${health}" role="img" aria-label="${healthLabel}" title="${healthLabel}"></span><h3 class="ovn-h3">${link(p.url, p.name, 'ovn-project-link')}</h3><span class="ovn-card-aside">${stars}${site}</span></header>${desc}${summary}${highlights}${details}</article>`;
}

function renderQuiet(quiet: ProjectActivity[]): string {
  if (quiet.length === 0) return '';
  const names = quiet
    .map((p) => link(p.url, p.name, 'ovn-quiet-link'))
    .join('<span class="ovn-sep">, </span>');
  return `<p class="ovn-quiet"><span class="ovn-dot ovn-dot-quiet" aria-hidden="true"></span><span class="ovn-quiet-label">Quiet overnight (${quiet.length}):</span> ${names}</p>`;
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return `<details class="ovn-warnings"><summary class="ovn-summary-toggle">${escapeHtml(plural(warnings.length, 'warning'))}</summary><ul class="ovn-warning-list">${warnings
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join('')}</ul></details>`;
}

function renderNav(nav: DigestNav | undefined): string {
  if (!nav || (!nav.prev && !nav.next && !nav.index)) return '';
  const prev = nav.prev
    ? `<a class="ovn-nav-link ovn-nav-prev" href="${safeHref(nav.prev)}" rel="prev">← Older</a>`
    : '<span class="ovn-nav-link ovn-nav-disabled">← Older</span>';
  const index = nav.index
    ? `<a class="ovn-nav-link ovn-nav-index" href="${safeHref(nav.index)}">Archive</a>`
    : '';
  const next = nav.next
    ? `<a class="ovn-nav-link ovn-nav-next" href="${safeHref(nav.next)}" rel="next">Newer →</a>`
    : '<span class="ovn-nav-link ovn-nav-disabled">Newer →</span>';
  return `<nav class="ovn-nav" aria-label="Digest archive">${prev}${index}${next}</nav>`;
}

function renderDigestInner(d: Digest, timezone: string | undefined, nav?: DigestNav): string {
  const t = makeTimeCtx(d, timezone);
  const active = d.projects.filter((p) => healthOf(p) !== 'quiet');
  const quiet = d.projects.filter((p) => healthOf(p) === 'quiet');
  const win = windowLabel(d, t);
  const hero = `<header class="ovn-hero"><p class="ovn-eyebrow">${escapeHtml(d.owner)} · ${escapeHtml(plural(d.totals.projectsActive, 'active project'))}</p><h1 class="ovn-h1">${escapeHtml(longDate(d.id))}</h1><p class="ovn-headline">${escapeHtml(d.headline)}</p>${win ? `<p class="ovn-window">${escapeHtml(win)}</p>` : ''}${statTiles(d.totals)}</header>`;
  const projects = active.length
    ? `<section class="ovn-section" aria-labelledby="ovn-projects-h"><h2 class="ovn-h2" id="ovn-projects-h">Projects <span class="ovn-count">${active.length}</span></h2><div class="ovn-cards">${active.map((p) => renderProject(p, t)).join('')}</div>${renderQuiet(quiet)}</section>`
    : `<section class="ovn-section"><p class="ovn-empty">Nothing shipped in this window.</p>${renderQuiet(quiet)}</section>`;
  const warnings = renderWarnings(t.warning ? [...d.warnings, t.warning] : d.warnings);
  const by = d.summarizer.kind === 'llm' ? `summarised by ${d.summarizer.model}` : 'rule-based summary';
  const generated = parseDate(d.generatedAt);
  const genText = generated
    ? `Generated ${shortDay(generated, t.tz)} ${clock(generated, t.tz)} ${t.tz}`
    : 'Generated';
  const footer = `<footer class="ovn-footer">${warnings}<p>${escapeHtml(`${genText} · ${by} · times in ${t.tz}`)}</p></footer>`;
  return `<div class="ovn-root"><div class="ovn-container">${renderNav(nav)}${hero}${renderNeeds(d, t)}${projects}${footer}</div></div>`;
}

// ---------------------------------------------------------------------------
// CSS (everything scoped under .ovn-root)
// ---------------------------------------------------------------------------

export const DIGEST_CSS = `
.ovn-root {
  --ovn-bg: #f6f7f9;
  --ovn-surface: #ffffff;
  --ovn-surface-2: #f1f3f6;
  --ovn-border: #e3e6eb;
  --ovn-text: #11141a;
  --ovn-muted: #5d6573;
  --ovn-faint: #8a92a0;
  --ovn-accent: #4f46e5;
  --ovn-accent-soft: rgba(79, 70, 229, 0.1);
  --ovn-red: #dc2626;
  --ovn-red-soft: rgba(220, 38, 38, 0.1);
  --ovn-yellow: #d97706;
  --ovn-yellow-soft: rgba(217, 119, 6, 0.12);
  --ovn-green: #16a34a;
  --ovn-green-soft: rgba(22, 163, 74, 0.11);
  --ovn-blue: #2563eb;
  --ovn-blue-soft: rgba(37, 99, 235, 0.1);
  --ovn-agent: #7c3aed;
  --ovn-agent-soft: rgba(124, 58, 237, 0.1);
  --ovn-quiet: #a3aab5;
  --ovn-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 16px rgba(16, 24, 40, 0.05);
  --ovn-radius: 14px;
  --ovn-font: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --ovn-mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--ovn-bg);
  color: var(--ovn-text);
  font-family: var(--ovn-font);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'cv11', 'ss01';
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  .ovn-root {
    --ovn-bg: #0c0e12;
    --ovn-surface: #14171d;
    --ovn-surface-2: #1b1f27;
    --ovn-border: #262b35;
    --ovn-text: #e8eaee;
    --ovn-muted: #9aa3b2;
    --ovn-faint: #6b7483;
    --ovn-accent: #8b85ff;
    --ovn-accent-soft: rgba(139, 133, 255, 0.14);
    --ovn-red: #f87171;
    --ovn-red-soft: rgba(248, 113, 113, 0.14);
    --ovn-yellow: #fbbf24;
    --ovn-yellow-soft: rgba(251, 191, 36, 0.13);
    --ovn-green: #4ade80;
    --ovn-green-soft: rgba(74, 222, 128, 0.12);
    --ovn-blue: #60a5fa;
    --ovn-blue-soft: rgba(96, 165, 250, 0.13);
    --ovn-agent: #c4b5fd;
    --ovn-agent-soft: rgba(196, 181, 253, 0.13);
    --ovn-quiet: #5b6372;
    --ovn-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.25);
  }
}
.ovn-root *, .ovn-root *::before, .ovn-root *::after { box-sizing: border-box; }
.ovn-root .ovn-container { max-width: 880px; margin: 0 auto; padding: 40px 24px 64px; }
.ovn-root a { color: inherit; text-decoration: none; }
.ovn-root a:hover { color: var(--ovn-accent); }
.ovn-root a:focus-visible, .ovn-root summary:focus-visible { outline: 2px solid var(--ovn-accent); outline-offset: 2px; border-radius: 4px; }
.ovn-root .ovn-nav { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 24px; font-size: 14px; }
.ovn-root .ovn-nav-link { color: var(--ovn-muted); padding: 6px 12px; border: 1px solid var(--ovn-border); border-radius: 999px; background: var(--ovn-surface); }
.ovn-root a.ovn-nav-link:hover { color: var(--ovn-accent); border-color: var(--ovn-accent); }
.ovn-root .ovn-nav-disabled { opacity: 0.4; }
.ovn-root .ovn-hero {
  position: relative; overflow: hidden; padding: 32px; margin-bottom: 32px;
  background: radial-gradient(120% 140% at 100% 0%, var(--ovn-accent-soft), transparent 55%), var(--ovn-surface);
  border: 1px solid var(--ovn-border); border-radius: calc(var(--ovn-radius) + 6px); box-shadow: var(--ovn-shadow);
}
.ovn-root .ovn-eyebrow { margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ovn-accent); }
.ovn-root .ovn-h1 { margin: 0; font-size: 36px; line-height: 1.15; font-weight: 700; letter-spacing: -0.025em; }
.ovn-root .ovn-headline { margin: 12px 0 4px; font-size: 18px; line-height: 1.5; color: var(--ovn-text); max-width: 680px; }
.ovn-root .ovn-window { margin: 0 0 24px; font-size: 13px; color: var(--ovn-faint); }
.ovn-root .ovn-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; margin-top: 20px; }
.ovn-root .ovn-tile { display: flex; flex-direction: column; gap: 2px; padding: 14px; background: var(--ovn-surface-2); border: 1px solid var(--ovn-border); border-radius: 12px; min-width: 0; }
.ovn-root .ovn-tile-value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.2; }
.ovn-root .ovn-tile-label { font-size: 12px; color: var(--ovn-muted); line-height: 1.3; }
.ovn-root .ovn-tile-sub { font-size: 11px; font-weight: 600; color: var(--ovn-red); }
.ovn-root .ovn-tile-red { background: var(--ovn-red-soft); border-color: transparent; }
.ovn-root .ovn-tile-red .ovn-tile-value { color: var(--ovn-red); }
.ovn-root .ovn-tile-green .ovn-tile-value { color: var(--ovn-green); }
.ovn-root .ovn-tile-agent .ovn-tile-value { color: var(--ovn-agent); }
.ovn-root .ovn-section { margin: 0 0 36px; }
.ovn-root .ovn-h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-h3 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; min-width: 0; overflow-wrap: anywhere; }
.ovn-root .ovn-h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ovn-faint); }
.ovn-root .ovn-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0; border-radius: 999px; background: var(--ovn-surface-2); color: var(--ovn-muted); border: 1px solid var(--ovn-border); }
.ovn-root .ovn-needs .ovn-h2 { color: var(--ovn-red); }
.ovn-root .ovn-need-list { list-style: none; margin: 0; padding: 0; background: var(--ovn-surface); border: 1px solid var(--ovn-border); border-radius: var(--ovn-radius); box-shadow: var(--ovn-shadow); overflow: hidden; }
.ovn-root .ovn-need { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-top: 1px solid var(--ovn-border); }
.ovn-root .ovn-need:first-child { border-top: 0; }
.ovn-root .ovn-need-red { box-shadow: inset 3px 0 0 var(--ovn-red); }
.ovn-root .ovn-need-yellow { box-shadow: inset 3px 0 0 var(--ovn-yellow); }
.ovn-root .ovn-need > .ovn-dot { margin-top: 7px; }
.ovn-root .ovn-need-body { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; flex: 1; }
.ovn-root .ovn-need-project { font-size: 12px; font-weight: 600; color: var(--ovn-muted); padding: 1px 8px; border-radius: 6px; background: var(--ovn-surface-2); }
.ovn-root .ovn-need-title { font-weight: 550; overflow-wrap: anywhere; }
.ovn-root .ovn-need-detail { flex-basis: 100%; font-size: 13px; color: var(--ovn-muted); overflow-wrap: anywhere; }
.ovn-root .ovn-need-body > .ovn-time { margin-left: auto; }
.ovn-root .ovn-dot { flex: none; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--ovn-quiet); }
.ovn-root .ovn-dot-red { background: var(--ovn-red); box-shadow: 0 0 0 4px var(--ovn-red-soft); }
.ovn-root .ovn-dot-yellow { background: var(--ovn-yellow); box-shadow: 0 0 0 4px var(--ovn-yellow-soft); }
.ovn-root .ovn-dot-green { background: var(--ovn-green); box-shadow: 0 0 0 4px var(--ovn-green-soft); }
.ovn-root .ovn-dot-quiet { background: var(--ovn-quiet); }
.ovn-root .ovn-pill { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; border-radius: 999px; background: var(--ovn-surface-2); color: var(--ovn-muted); border: 1px solid var(--ovn-border); }
.ovn-root .ovn-pill-red { background: var(--ovn-red-soft); color: var(--ovn-red); border-color: transparent; }
.ovn-root .ovn-pill-yellow { background: var(--ovn-yellow-soft); color: var(--ovn-yellow); border-color: transparent; }
.ovn-root .ovn-pill-green { background: var(--ovn-green-soft); color: var(--ovn-green); border-color: transparent; }
.ovn-root .ovn-pill-blue { background: var(--ovn-blue-soft); color: var(--ovn-blue); border-color: transparent; }
.ovn-root .ovn-pill-agent { background: var(--ovn-agent-soft); color: var(--ovn-agent); border-color: transparent; text-transform: lowercase; letter-spacing: 0.02em; }
.ovn-root .ovn-cards { display: flex; flex-direction: column; gap: 14px; }
.ovn-root .ovn-card { padding: 20px 22px; background: var(--ovn-surface); border: 1px solid var(--ovn-border); border-radius: var(--ovn-radius); box-shadow: var(--ovn-shadow); }
.ovn-root .ovn-card-red { border-color: color-mix(in srgb, var(--ovn-red) 35%, var(--ovn-border)); }
.ovn-root .ovn-card-head { display: flex; align-items: center; gap: 12px; }
.ovn-root .ovn-card-aside { display: flex; align-items: center; gap: 10px; margin-left: auto; flex: none; font-size: 13px; color: var(--ovn-muted); }
.ovn-root .ovn-site { color: var(--ovn-accent); font-weight: 500; }
.ovn-root .ovn-stars { font-variant-numeric: tabular-nums; }
.ovn-root .ovn-desc { margin: 4px 0 0 22px; font-size: 13px; color: var(--ovn-faint); }
.ovn-root .ovn-summary { margin: 10px 0 0; color: var(--ovn-text); }
.ovn-root .ovn-highlights { margin: 10px 0 0; padding-left: 20px; color: var(--ovn-muted); }
.ovn-root .ovn-highlights li { margin: 3px 0; }
.ovn-root .ovn-highlights li::marker { color: var(--ovn-accent); }
.ovn-root .ovn-details { margin-top: 14px; border-top: 1px solid var(--ovn-border); padding-top: 10px; }
.ovn-root .ovn-summary-toggle { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--ovn-muted); user-select: none; }
.ovn-root .ovn-summary-toggle::-webkit-details-marker { display: none; }
.ovn-root .ovn-summary-toggle::before { content: ''; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 0.15s ease; }
.ovn-root details[open] > .ovn-summary-toggle::before { transform: rotate(45deg); }
.ovn-root .ovn-summary-toggle:hover { color: var(--ovn-text); }
.ovn-root .ovn-details-body { display: flex; flex-direction: column; gap: 16px; margin-top: 14px; }
.ovn-root .ovn-rows { list-style: none; margin: 0; padding: 0; }
.ovn-root .ovn-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 7px 0; border-top: 1px dashed var(--ovn-border); font-size: 14px; }
.ovn-root .ovn-row:first-child { border-top: 0; }
.ovn-root .ovn-row-title { flex: 1 1 260px; min-width: 0; overflow-wrap: anywhere; }
.ovn-root .ovn-row-meta { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; font-size: 12px; color: var(--ovn-muted); }
.ovn-root .ovn-more { color: var(--ovn-faint); font-size: 13px; }
.ovn-root .ovn-sha { flex: none; font-family: var(--ovn-mono); font-size: 12px; color: var(--ovn-accent); padding: 1px 6px; border-radius: 6px; background: var(--ovn-accent-soft); }
.ovn-root .ovn-author { font-weight: 500; color: var(--ovn-muted); }
.ovn-root .ovn-time { font-size: 12px; color: var(--ovn-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ovn-root .ovn-diff { font-family: var(--ovn-mono); font-size: 11px; }
.ovn-root .ovn-add { color: var(--ovn-green); }
.ovn-root .ovn-del { color: var(--ovn-red); }
.ovn-root .ovn-quiet { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 14px 0 0; padding: 12px 16px; font-size: 13px; color: var(--ovn-muted); border: 1px dashed var(--ovn-border); border-radius: var(--ovn-radius); }
.ovn-root .ovn-quiet-label { font-weight: 500; }
.ovn-root .ovn-quiet-link { color: var(--ovn-muted); text-decoration: underline; text-decoration-color: var(--ovn-border); text-underline-offset: 3px; }
.ovn-root .ovn-sep { margin-left: -6px; }
.ovn-root .ovn-empty { padding: 32px; text-align: center; color: var(--ovn-muted); background: var(--ovn-surface); border: 1px dashed var(--ovn-border); border-radius: var(--ovn-radius); }
.ovn-root .ovn-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--ovn-border); font-size: 12px; color: var(--ovn-faint); }
.ovn-root .ovn-footer p { margin: 8px 0 0; }
.ovn-root .ovn-warnings .ovn-summary-toggle { color: var(--ovn-yellow); font-size: 12px; }
.ovn-root .ovn-warning-list { margin: 8px 0 0; padding-left: 18px; color: var(--ovn-muted); }
.ovn-root .ovn-index-hero .ovn-h1 { font-size: 30px; }
.ovn-root .ovn-latest { display: block; margin-top: 20px; padding: 16px 18px; border-radius: 12px; background: var(--ovn-surface-2); border: 1px solid var(--ovn-border); }
.ovn-root a.ovn-latest:hover { border-color: var(--ovn-accent); color: inherit; }
.ovn-root .ovn-latest-label { display: block; font-size: 12px; font-weight: 600; color: var(--ovn-accent); text-transform: uppercase; letter-spacing: 0.06em; }
.ovn-root .ovn-latest-title { display: block; margin-top: 4px; font-size: 17px; font-weight: 600; }
.ovn-root .ovn-latest-headline { display: block; margin-top: 4px; color: var(--ovn-muted); }
.ovn-root .ovn-month { margin: 0 0 28px; }
.ovn-root .ovn-archive { list-style: none; margin: 0; padding: 0; background: var(--ovn-surface); border: 1px solid var(--ovn-border); border-radius: var(--ovn-radius); box-shadow: var(--ovn-shadow); overflow: hidden; }
.ovn-root .ovn-archive-item { border-top: 1px solid var(--ovn-border); }
.ovn-root .ovn-archive-item:first-child { border-top: 0; }
.ovn-root .ovn-archive-link { display: grid; grid-template-columns: 110px 1fr; gap: 4px 16px; padding: 14px 18px; }
.ovn-root a.ovn-archive-link:hover { background: var(--ovn-surface-2); color: inherit; }
.ovn-root .ovn-archive-date { font-weight: 600; font-variant-numeric: tabular-nums; }
.ovn-root .ovn-archive-headline { min-width: 0; overflow-wrap: anywhere; }
.ovn-root .ovn-mini { grid-column: 2; font-size: 12px; color: var(--ovn-faint); }
.ovn-root .ovn-mini-bad { color: var(--ovn-red); font-weight: 600; }
@media (max-width: 600px) {
  .ovn-root .ovn-container { padding: 20px 16px 48px; }
  .ovn-root .ovn-hero { padding: 22px 18px; border-radius: var(--ovn-radius); }
  .ovn-root .ovn-h1 { font-size: 27px; }
  .ovn-root .ovn-headline { font-size: 16px; }
  .ovn-root .ovn-tile { padding: 12px; }
  .ovn-root .ovn-tile-value { font-size: 20px; }
  .ovn-root .ovn-card { padding: 16px; }
  .ovn-root .ovn-card-head { flex-wrap: wrap; }
  .ovn-root .ovn-card-aside { margin-left: 22px; width: 100%; }
  .ovn-root .ovn-desc { margin-left: 0; }
  .ovn-root .ovn-row-meta { margin-left: 0; }
  .ovn-root .ovn-archive-link { grid-template-columns: 1fr; }
  .ovn-root .ovn-mini { grid-column: 1; }
}
`.trim();

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Embeddable digest HTML: no <html>/<head>, all classes prefixed `ovn-`, style with DIGEST_CSS. */
export function renderDigestFragment(d: Digest, opts: FragmentOptions = {}): string {
  return renderDigestInner(d, opts.timezone);
}

const PAGE_CSS = `html,body{margin:0;padding:0}body{background:#f6f7f9}@media (prefers-color-scheme: dark){body{background:#0c0e12}}body>.ovn-root{min-height:100vh}`;

function page(title: string, description: string, body: string, baseHref?: string): string {
  const base = baseHref ? `\n<base href="${safeHref(baseHref)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${escapeHtml(description)}">${base}
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap">
<style>${PAGE_CSS}
${DIGEST_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderDigestHtml(d: Digest, opts: DigestHtmlOptions): string {
  const title = `${opts.siteTitle} — ${longDate(d.id)}`;
  return page(title, d.headline, renderDigestInner(d, opts.timezone, opts.nav), opts.baseHref);
}

export function renderIndexHtml(index: DigestIndex, opts: IndexHtmlOptions): string {
  const entries = [...index.digests].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const latestEntry = opts.latest ? entries.find((e) => e.id === opts.latest?.id) : entries[0];
  const latestId = opts.latest?.id ?? latestEntry?.id;
  const latestHeadline = opts.latest?.headline ?? latestEntry?.headline ?? '';
  const latestHref = latestEntry?.path ?? (latestId ? `digests/${latestId}.html` : undefined);
  const latestTotals = opts.latest?.totals ?? latestEntry?.totals;
  const latestCard =
    latestId && latestHref
      ? `<a class="ovn-latest" href="${safeHref(latestHref)}"><span class="ovn-latest-label">Latest digest</span><span class="ovn-latest-title">${escapeHtml(longDate(latestId))}</span><span class="ovn-latest-headline">${escapeHtml(latestHeadline)}</span></a>${latestTotals ? statTiles(latestTotals) : ''}`
      : '';
  const hero = `<header class="ovn-hero ovn-index-hero"><p class="ovn-eyebrow">${escapeHtml(index.owner)} · ${escapeHtml(plural(entries.length, 'digest'))}</p><h1 class="ovn-h1">${escapeHtml(opts.siteTitle)}</h1>${latestCard}</header>`;

  const months: Array<{ label: string; items: typeof entries }> = [];
  for (const e of entries) {
    const label = monthLabel(e.id);
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(e);
    else months.push({ label, items: [e] });
  }
  const archive = months.length
    ? months
        .map(
          (m, i) =>
            `<section class="ovn-month" aria-labelledby="ovn-month-${i}"><h2 class="ovn-h2" id="ovn-month-${i}">${escapeHtml(m.label)} <span class="ovn-count">${m.items.length}</span></h2><ul class="ovn-archive">${m.items
              .map(
                (e) =>
                  `<li class="ovn-archive-item"><a class="ovn-archive-link" href="${safeHref(e.path)}"><span class="ovn-archive-date">${escapeHtml(shortDate(e.id))}</span><span class="ovn-archive-headline">${escapeHtml(e.headline)}</span>${miniTotals(e.totals)}</a></li>`,
              )
              .join('')}</ul></section>`,
        )
        .join('')
    : '<p class="ovn-empty">No digests yet.</p>';
  const updated = parseDate(index.updatedAt);
  const { tz } = resolveTimeZone(opts.timezone);
  const footer = `<footer class="ovn-footer"><p>${escapeHtml(updated ? `Updated ${shortDay(updated, tz)} ${clock(updated, tz)} ${tz}` : 'Updated')}</p></footer>`;
  const body = `<div class="ovn-root"><div class="ovn-container">${hero}${archive}${footer}</div></div>`;
  return page(opts.siteTitle, `${opts.siteTitle} — daily digest archive for ${index.owner}`, body);
}

// ---------------------------------------------------------------------------
// Archive writer
// ---------------------------------------------------------------------------

type IndexEntry = DigestIndex['digests'][number];

function isErrno(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === code;
}

async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if (isErrno(e, 'ENOENT')) return undefined;
    throw e;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    throw new Error(
      `overnight: ${path} is not valid JSON (${(e as Error).message}); refusing to overwrite it`,
    );
  }
}

function validateIndex(raw: unknown, path: string): DigestIndex {
  const bad = (why: string): never => {
    throw new Error(
      `overnight: ${path} is not a valid overnight.index/v1 file (${why}); refusing to overwrite it`,
    );
  };
  if (typeof raw !== 'object' || raw === null) return bad('not an object');
  const r = raw as Partial<DigestIndex>;
  if (r.schema !== 'overnight.index/v1') return bad(`schema is ${JSON.stringify(r.schema)}`);
  if (!Array.isArray(r.digests)) return bad('digests is not an array');
  for (const e of r.digests) {
    if (typeof e !== 'object' || e === null || typeof e.id !== 'string' || !ID_RE.test(e.id)) {
      return bad(`invalid entry id ${JSON.stringify((e as { id?: unknown } | null)?.id)}`);
    }
    if (
      typeof e.headline !== 'string' ||
      typeof e.path !== 'string' ||
      typeof e.totals !== 'object' ||
      !e.totals
    ) {
      return bad(`entry ${e.id} is missing headline/path/totals`);
    }
  }
  return r as DigestIndex;
}

/** Write via temp file + rename so readers (e.g. the Fleet daemon serving latest.json) never see partial files. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

function navFor(sorted: IndexEntry[], id: string): DigestNav {
  const i = sorted.findIndex((e) => e.id === id);
  const newer = i > 0 ? sorted[i - 1] : undefined;
  const older = i >= 0 ? sorted[i + 1] : undefined;
  const nav: DigestNav = { index: '../index.html' };
  if (older) nav.prev = `${older.id}.html`;
  if (newer) nav.next = `${newer.id}.html`;
  return nav;
}

function looksLikeDigest(x: unknown): x is Digest {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as Digest).schema === 'overnight.digest/v1' &&
    typeof (x as Digest).id === 'string' &&
    Array.isArray((x as Digest).projects)
  );
}

export async function writeArchive(d: Digest, outDir: string, opts: WriteArchiveOptions): Promise<string[]> {
  if (!ID_RE.test(d.id))
    throw new Error(`overnight: invalid digest id ${JSON.stringify(d.id)} (expected YYYY-MM-DD)`);
  const digestsDir = join(outDir, 'digests');
  await mkdir(digestsDir, { recursive: true });
  const written: string[] = [];
  const write = async (path: string, content: string) => {
    await atomicWrite(path, content);
    written.push(path);
  };

  // Upsert index entry.
  const indexPath = join(outDir, 'index.json');
  const existingRaw = await readJsonIfExists(indexPath);
  const existing = existingRaw === undefined ? undefined : validateIndex(existingRaw, indexPath);
  const entry: IndexEntry = {
    id: d.id,
    headline: d.headline,
    window: d.window,
    totals: d.totals,
    path: `digests/${d.id}.html`,
  };
  const others = (existing?.digests ?? []).filter((e) => e.id !== d.id);
  const sorted = [...others, entry].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const index: DigestIndex = {
    schema: 'overnight.index/v1',
    owner: d.owner,
    updatedAt: new Date().toISOString(),
    digests: sorted,
  };

  // The digest itself.
  await write(join(digestsDir, `${d.id}.json`), JSON.stringify(d, null, 2) + '\n');
  const renderOpts = { siteTitle: opts.siteTitle, ...(opts.timezone ? { timezone: opts.timezone } : {}) };
  await write(
    join(digestsDir, `${d.id}.html`),
    renderDigestHtml(d, { ...renderOpts, nav: navFor(sorted, d.id) }),
  );

  // Re-render direct neighbours so their prev/next links include this digest.
  const pos = sorted.findIndex((e) => e.id === d.id);
  for (const neighbour of [sorted[pos - 1], sorted[pos + 1]]) {
    if (!neighbour) continue;
    const nd = await readJsonIfExists(join(digestsDir, `${neighbour.id}.json`));
    if (nd === undefined) continue; // index entry without stored JSON: nothing to re-render from
    if (!looksLikeDigest(nd) || nd.id !== neighbour.id) {
      throw new Error(`overnight: ${join(digestsDir, `${neighbour.id}.json`)} is not a valid digest`);
    }
    await write(
      join(digestsDir, `${neighbour.id}.html`),
      renderDigestHtml(nd, { ...renderOpts, nav: navFor(sorted, neighbour.id) }),
    );
  }

  // latest.json only ever moves forward (a backfill of an older day must not replace it).
  const isNewest = sorted[0]?.id === d.id;
  let latest: Digest | undefined = d;
  if (isNewest) {
    await write(join(outDir, 'latest.json'), JSON.stringify(d, null, 2) + '\n');
  } else {
    const newest = sorted[0];
    const nd = newest ? await readJsonIfExists(join(digestsDir, `${newest.id}.json`)) : undefined;
    latest = looksLikeDigest(nd) ? nd : undefined;
  }

  await write(indexPath, JSON.stringify(index, null, 2) + '\n');
  await write(
    join(outDir, 'index.html'),
    renderIndexHtml(index, { ...renderOpts, ...(latest ? { latest } : {}) }),
  );
  await write(join(outDir, 'styles.css'), DIGEST_CSS + '\n');
  return written;
}
