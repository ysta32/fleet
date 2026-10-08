import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
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
import { HALYARD_FONT_URL, HALYARD_TOKENS_CSS } from './halyard.generated.js';

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
  /** Earlier digests (any order; only the 13 days before this one are used) for the 14-night trend lines. */
  history?: Digest[];
  /** 1-based edition number (count of digests up to and including this one). 1 renders the first-run note. */
  edition?: number;
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
  /** Receives non-fatal problems (e.g. an unreadable historical digest skipped from trends). Default: console.warn. */
  warn?: (msg: string) => void;
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
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

function signed(n: number): string {
  return n > 0 ? `+${fmtInt(n)}` : n < 0 ? `−${fmtInt(-n)}` : '0';
}

/** Digest JSON is untrusted (embedders render it): coerce numbers before any interpolation. */
function finiteNum(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/** Untrusted number → finite integer (0 when missing or not a number). */
function int(x: unknown): number {
  const n = finiteNum(x);
  return n === undefined ? 0 : Math.round(n);
}

/** Untrusted string field → string (non-strings become ""), so string methods never throw. */
function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

/** Untrusted list field → array (history files on disk may be hand-edited or truncated). */
function list<T>(x: T[] | undefined): T[] {
  return Array.isArray(x) ? x : [];
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

const HEALTHS: ReadonlyArray<ProjectActivity['health']> = ['green', 'yellow', 'red', 'quiet'];
type Health = ProjectActivity['health'];

/** Untrusted health → known enum value; anything else is treated as 'quiet'. */
function healthOf(p: ProjectActivity): Health {
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

function num(n: number, cls = 'ovn-num'): string {
  return `<span class="${cls}">${escapeHtml(fmtInt(n))}</span>`;
}

// ---------------------------------------------------------------------------
// Icons (20px grid, 1.5 stroke, currentColor) and health shapes. Trusted constants only.
// ---------------------------------------------------------------------------

type IconName = 'pr' | 'commit' | 'release' | 'deploy' | 'ci' | 'star' | 'agent' | 'you' | 'health' | 'issue';

const ICONS: Record<IconName, string> = {
  pr: '<circle cx="5.5" cy="4.75" r="1.75"></circle><circle cx="5.5" cy="15.25" r="1.75"></circle><circle cx="14.5" cy="15.25" r="1.75"></circle><path d="M5.5 6.5v7M14.5 13.5V8.75a2.5 2.5 0 0 0-2.5-2.5H8.75M10.5 4.5 8.75 6.25 10.5 8"></path>',
  commit: '<circle cx="10" cy="10" r="2.75"></circle><path d="M2.75 10h4.5M12.75 10h4.5"></path>',
  release:
    '<path d="M3.25 3.25h6.1l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-4 4a1.5 1.5 0 0 1-2.1 0l-7.4-7.4Z"></path><circle cx="7" cy="7" r="1.1"></circle>',
  deploy:
    '<path d="M10 12.75V3.5M6.5 7 10 3.5 13.5 7M3.5 12.25v3a1.25 1.25 0 0 0 1.25 1.25h10.5a1.25 1.25 0 0 0 1.25-1.25v-3"></path>',
  ci: '<rect x="2.75" y="2.75" width="5.5" height="5.5" rx="1.25"></rect><rect x="11.75" y="11.75" width="5.5" height="5.5" rx="1.25"></rect><path d="M8.25 5.5h3a2.25 2.25 0 0 1 2.25 2.25v4"></path>',
  star: '<path d="m10 2.75 2.2 4.55 5.05.7-3.65 3.5.9 4.95L10 14.1l-4.5 2.35.9-4.95L2.75 8l5.05-.7Z"></path>',
  agent:
    '<path d="M9 3c.45 3.6 1.65 4.8 5.25 5.25C10.65 8.7 9.45 9.9 9 13.5c-.45-3.6-1.65-4.8-5.25-5.25C7.35 7.8 8.55 6.6 9 3Z"></path><path d="M15 12.5v4.5M12.75 14.75h4.5"></path>',
  you: '<circle cx="10" cy="6.75" r="3"></circle><path d="M4 16.75c.9-2.9 3.2-4.25 6-4.25s5.1 1.35 6 4.25"></path>',
  health: '<path d="M2.5 10.5h3.25l2-5 3.5 9 2-4h4.25"></path>',
  issue: '<circle cx="10" cy="10" r="7"></circle><circle cx="10" cy="10" r="1.25"></circle>',
};

function icon(name: IconName): string {
  return `<svg class="ovn-icon" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** Health is always shape + word (■ red, ▲ yellow, ● green, ○ quiet); colour only backs it up. */
const HEALTH_META: Record<Health, { word: string; tally: string; shape: string }> = {
  red: { word: 'Failing', tally: 'red', shape: '<rect x="1.5" y="1.5" width="9" height="9" rx="1"></rect>' },
  yellow: { word: 'Watch', tally: 'yellow', shape: '<path d="M6 1.25 11.2 10.5H.8Z"></path>' },
  green: { word: 'Healthy', tally: 'green', shape: '<circle cx="6" cy="6" r="4.75"></circle>' },
  quiet: { word: 'Quiet', tally: 'quiet', shape: '<circle cx="6" cy="6" r="4"></circle>' },
};

function shape(h: Health): string {
  return `<svg class="ovn-shape ovn-shape-${h}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">${HEALTH_META[h].shape}</svg>`;
}

function healthMark(h: Health): string {
  return `<span class="ovn-health ovn-health-${h}">${shape(h)}<span class="ovn-health-word">${HEALTH_META[h].word}</span></span>`;
}

// ---------------------------------------------------------------------------
// History + sparklines
// ---------------------------------------------------------------------------

const SPARK_DAYS = 14;
const DAY_MS = 86_400_000;

interface SparkPoint {
  /** Activity count, or null when no digest exists for that day. */
  v: number | null;
  red: boolean;
}

function lastDays(id: string, n: number): string[] | undefined {
  if (!ID_RE.test(id)) return undefined;
  const base = Date.parse(`${id}T12:00:00Z`);
  if (Number.isNaN(base)) return undefined;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(base - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

function activityOf(p: ProjectActivity): number {
  return (
    list(p.mergedPRs).length +
    list(p.commits).length +
    list(p.releases).length +
    list(p.deployments).length +
    list(p.issues).length
  );
}

function isProject(x: unknown): x is ProjectActivity {
  return typeof x === 'object' && x !== null;
}

interface HistoryCtx {
  days: string[];
  byDay: Map<string, Digest>;
}

function makeHistory(d: Digest, history: Digest[] | undefined): HistoryCtx | undefined {
  const days = lastDays(d.id, SPARK_DAYS);
  if (!days) return undefined;
  const byDay = new Map<string, Digest>();
  for (const h of list(history)) {
    if (typeof h !== 'object' || h === null || typeof h.id !== 'string' || !ID_RE.test(h.id)) continue;
    if (h.id >= d.id || !days.includes(h.id)) continue; // only earlier days in the window
    byDay.set(h.id, h);
  }
  byDay.set(d.id, d);
  return { days, byDay };
}

function overallSeries(h: HistoryCtx): SparkPoint[] {
  return h.days.map((k) => {
    const dg = h.byDay.get(k);
    if (!dg) return { v: null, red: false };
    const ps = list(dg.projects).filter(isProject);
    return {
      v: ps.reduce((s, p) => s + activityOf(p), 0),
      red: ps.some((p) => p.health === 'red'),
    };
  });
}

function projectSeries(h: HistoryCtx, id: string): SparkPoint[] {
  return h.days.map((k) => {
    const dg = h.byDay.get(k);
    if (!dg) return { v: null, red: false };
    const p = list(dg.projects)
      .filter(isProject)
      .find((x) => x.id === id);
    return p ? { v: activityOf(p), red: p.health === 'red' } : { v: 0, red: false };
  });
}

function sparkSummary(pts: SparkPoint[]): string {
  const known = pts.filter((p) => p.v !== null);
  const active = known.filter((p) => (p.v ?? 0) > 0).length;
  const reds = pts.filter((p) => p.red).length;
  let lastRed = -1;
  pts.forEach((p, i) => {
    if (p.red) lastRed = i;
  });
  const ago = lastRed < 0 ? '' : pts.length - 1 - lastRed;
  const lead =
    known.length === pts.length ? `${pts.length} nights` : `${known.length} of ${pts.length} nights`;
  const redText =
    reds === 0
      ? 'none red'
      : `${reds} red, last red ${ago === 0 ? 'tonight' : ago === 1 ? '1 night ago' : `${ago} nights ago`}`;
  return `${lead}: ${active} active, ${redText}`;
}

function r1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function sparkline(pts: SparkPoint[], w: number, h: number, variant: 'project' | 'overall'): string {
  const n = pts.length;
  const known = pts.map((p) => p.v).filter((v): v is number => v !== null);
  if (n === 0 || known.length === 0) return '';
  const pad = 3;
  const max = Math.max(1, ...known);
  const x = (i: number) => pad + (n === 1 ? 0 : (i * (w - 2 * pad)) / (n - 1));
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const base = h - pad;
  let line = '';
  let area = '';
  let dots = '';
  let seg: Array<[number, number]> = [];
  const flush = () => {
    const first = seg[0];
    const last = seg[seg.length - 1];
    if (first && last && seg.length > 1) {
      line += `M${seg.map(([a, b]) => `${r1(a)} ${r1(b)}`).join('L')}`;
      area += `M${r1(first[0])} ${r1(base)}L${seg.map(([a, b]) => `${r1(a)} ${r1(b)}`).join('L')}L${r1(last[0])} ${r1(base)}Z`;
    } else if (first) {
      dots += `<circle class="ovn-spark-dot" cx="${r1(first[0])}" cy="${r1(first[1])}" r="1.75"></circle>`;
    }
    seg = [];
  };
  let gaps = '';
  pts.forEach((p, i) => {
    if (p.v === null) {
      flush();
      gaps += `<circle class="ovn-spark-gap" cx="${r1(x(i))}" cy="${r1(base)}" r="1"></circle>`;
    } else seg.push([x(i), y(p.v)]);
  });
  flush();
  const reds = pts
    .map((p, i) =>
      p.red && p.v !== null
        ? `<rect class="ovn-spark-red" x="${r1(x(i) - 2.5)}" y="${r1(y(p.v) - 2.5)}" width="5" height="5" rx="0.75"></rect>`
        : '',
    )
    .join('');
  let endIdx = -1;
  pts.forEach((p, i) => {
    if (p.v !== null) endIdx = i;
  });
  const endPt = pts[endIdx];
  const end =
    endPt && endPt.v !== null && !endPt.red
      ? `<circle class="ovn-spark-end" cx="${r1(x(endIdx))}" cy="${r1(y(endPt.v))}" r="2.5"></circle>`
      : '';
  const label = sparkSummary(pts);
  return `<svg class="ovn-spark ovn-spark-${variant}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(label)}"><path class="ovn-spark-base" d="M${pad} ${r1(base)}H${w - pad}"></path>${variant === 'overall' && area ? `<path class="ovn-spark-area" d="${area}"></path>` : ''}${line ? `<path class="ovn-spark-line" d="${line}"></path>` : ''}${gaps}${dots}${reds}${end}</svg>`;
}

function sparkBlock(pts: SparkPoint[], variant: 'project' | 'overall'): string {
  const svg = variant === 'overall' ? sparkline(pts, 168, 40, 'overall') : sparkline(pts, 112, 24, 'project');
  if (!svg) return '';
  const known = pts.filter((p) => p.v !== null).length;
  const caption =
    variant === 'overall'
      ? `<span class="ovn-spark-cap"><span class="ovn-caps">${known === pts.length ? `${pts.length} nights` : `${known} of ${pts.length} nights`}</span><span class="ovn-spark-note">${escapeHtml(sparkSummary(pts).replace(/^[^:]*: /, ''))}</span></span>`
      : '';
  return `<span class="ovn-trend ovn-trend-${variant}">${svg}${caption}</span>`;
}

// ---------------------------------------------------------------------------
// Numbers + agents lane
// ---------------------------------------------------------------------------

function stat(label: string, value: string, sub = '', subTone: '' | 'red' | 'green' = ''): string {
  const subHtml = sub
    ? `<span class="ovn-stat-sub${subTone ? ` ovn-stat-sub-${subTone}` : ''}">${escapeHtml(sub)}</span>`
    : '';
  return `<div class="ovn-stat"><dt class="ovn-stat-label">${escapeHtml(label)}</dt><dd class="ovn-stat-value"><span class="ovn-num">${escapeHtml(value)}</span>${subHtml}</dd></div>`;
}

function renderNumbers(t: DigestTotals): string {
  const failed = int(t.deploymentsFailed);
  const opened = int(t.issuesOpened);
  const closed = int(t.issuesClosed);
  const stars = int(t.starsDelta);
  const rows = [
    stat('Merged', fmtInt(int(t.mergedPRs))),
    stat('Commits', fmtInt(int(t.commits))),
    stat('Releases', fmtInt(int(t.releases))),
    stat('Deploys', fmtInt(int(t.deployments)), failed > 0 ? `${fmtInt(failed)} failed` : '', 'red'),
    stat('CI failures', fmtInt(int(t.ciFailures))),
    stat('Issues', `+${fmtInt(opened)}`, `${fmtInt(closed)} closed`),
    stat('Stars', signed(stars)),
  ];
  return `<section class="ovn-numbers" aria-labelledby="ovn-numbers-h"><h2 class="ovn-label" id="ovn-numbers-h">The night in numbers</h2><dl class="ovn-stats">${rows.join('')}</dl></section>`;
}

interface Split {
  agents: number;
  you: number;
  agentLogins: Map<string, number>;
}

function splitOf(projects: ProjectActivity[]): Split {
  const s: Split = { agents: 0, you: 0, agentLogins: new Map() };
  for (const p of projects) {
    for (const item of [...list(p.mergedPRs), ...list(p.commits)]) {
      const a = (item as { author?: unknown }).author;
      const bot = typeof a === 'object' && a !== null && (a as { isBot?: unknown }).isBot === true;
      if (bot) {
        s.agents++;
        const login = str((a as { login?: unknown }).login) || 'agent';
        s.agentLogins.set(login, (s.agentLogins.get(login) ?? 0) + 1);
      } else s.you++;
    }
  }
  return s;
}

function splitBar(s: Split, cls = 'ovn-split'): string {
  const total = s.agents + s.you;
  if (total === 0) return '';
  const seg = (who: 'agent' | 'you', n: number) =>
    n > 0 ? `<span class="ovn-split-seg ovn-split-${who}" style="flex-grow:${n}"></span>` : '';
  return `<span class="${cls}" role="img" aria-label="${escapeHtml(`Agents ${s.agents}, you ${s.you}`)}">${seg('agent', s.agents)}${seg('you', s.you)}</span>`;
}

function renderAgents(active: ProjectActivity[]): string {
  const s = splitOf(active);
  const total = s.agents + s.you;
  if (total === 0) return '';
  const pct = Math.round((s.agents / total) * 100);
  const lede =
    s.agents === 0
      ? `You made all ${plural(total, 'change')} overnight.`
      : s.you === 0
        ? `Agents made all ${plural(total, 'change')} overnight.`
        : `Agents made ${fmtInt(s.agents)} of ${plural(total, 'change')}, ${pct}% of the night’s work.`;
  const top = [...s.agentLogins.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(
      ([login, n]) =>
        `<li class="ovn-agent-login"><span class="ovn-author">${escapeHtml(login)}</span> ${num(n)}</li>`,
    )
    .join('');
  const perProject = active
    .map((p) => ({ p, s: splitOf([p]) }))
    .filter((x) => x.s.agents + x.s.you > 0)
    .slice(0, 6)
    .map(
      (x) =>
        `<li class="ovn-lane-row"><span class="ovn-lane-name">${escapeHtml(x.p.name)}</span>${splitBar(x.s, 'ovn-split ovn-split-mini')}<span class="ovn-lane-counts">${num(x.s.agents, 'ovn-num ovn-num-agent')}<span class="ovn-lane-sep">/</span>${num(x.s.you)}</span></li>`,
    )
    .join('');
  return `<section class="ovn-agents" aria-labelledby="ovn-agents-h"><h2 class="ovn-label" id="ovn-agents-h">${icon('agent')}Agents vs you</h2><p class="ovn-agents-lede">${escapeHtml(lede)}</p>${splitBar(s)}<dl class="ovn-legend"><div class="ovn-legend-item"><dt class="ovn-legend-key ovn-legend-agent">Agents</dt><dd class="ovn-legend-val">${num(s.agents)}</dd></div><div class="ovn-legend-item"><dt class="ovn-legend-key ovn-legend-you">You</dt><dd class="ovn-legend-val">${num(s.you)}</dd></div></dl>${top ? `<ul class="ovn-agent-logins" aria-label="Most active agents">${top}</ul>` : ''}${perProject ? `<ul class="ovn-lane" aria-label="Agents and you, per project">${perProject}</ul>` : ''}</section>`;
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

const NEEDS_CAP = 5;

/** "3h ago" relative to the digest's generation time, in a <time> carrying the absolute instant. */
function ageTag(iso: string, d: Digest, t: TimeCtx): string {
  const at = parseDate(iso);
  const now = parseDate(d.generatedAt) ?? parseDate(d.window.until);
  if (!at || !now) return '';
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  const text =
    mins < 1
      ? 'just now'
      : mins < 60
        ? `${mins}m ago`
        : mins < 48 * 60
          ? `${Math.round(mins / 60)}h ago`
          : `${Math.round(mins / 1440)}d ago`;
  return `<time class="ovn-time ovn-age" datetime="${escapeHtml(iso)}" title="${escapeHtml(`${shortDay(at, t.tz)} ${clock(at, t.tz)} ${t.tz}`)}">${escapeHtml(text)}</time>`;
}

function needRow(
  kind: IconName,
  reasons: string,
  title: string,
  url: string,
  sub: string,
  action: string,
  age: string,
): string {
  return `<span class="ovn-need-kind">${icon(kind)}</span><div class="ovn-need-main"><span class="ovn-need-reasons">${reasons}</span>${link(url, title, 'ovn-need-title')}<span class="ovn-need-detail">${sub}</span></div><div class="ovn-need-side">${age}<a class="ovn-need-act" href="${safeUrl(url)}" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${escapeHtml(action)} →</a></div>`;
}

function needsItems(d: Digest, t: TimeCtx): NeedItem[] {
  const items: NeedItem[] = [];
  for (const p of d.projects) {
    const proj = `<span class="ovn-need-project">${escapeHtml(p.name)}</span>`;
    for (const f of p.ciFailures) {
      const msg = f.commitMessage ? ` · ${escapeHtml(f.commitMessage)}` : '';
      items.push({
        level: 'red',
        at: f.at,
        html: needRow(
          'ci',
          pill('CI', 'red'),
          `${f.workflow} ${str(f.conclusion).replace(/_/g, ' ')} on ${f.branch}`,
          f.url,
          `${proj}${msg}`,
          'View run',
          ageTag(f.at, d, t),
        ),
      });
    }
    for (const dep of p.deployments) {
      if (dep.target !== 'production' || dep.state !== 'ERROR') continue;
      const msg = dep.commitMessage ? ` · ${escapeHtml(dep.commitMessage)}` : '';
      items.push({
        level: 'red',
        at: dep.at,
        html: needRow(
          'deploy',
          pill('deploy', 'red'),
          `Production deploy failed${dep.branch ? ` (${dep.branch})` : ''}`,
          dep.url,
          `${proj}${msg}`,
          'Logs',
          ageTag(dep.at, d, t),
        ),
      });
    }
    for (const pr of p.openPRs) {
      const reasons = (Array.isArray(pr.attention) ? pr.attention : [])
        .filter(
          (r): r is keyof typeof ATTENTION_LABEL =>
            typeof r === 'string' && Object.hasOwn(ATTENTION_LABEL, r),
        )
        .map((r) => ATTENTION_LABEL[r]);
      const pills = `${pr.draft ? pill('draft') : ''}${reasons.map((r) => pill(r.text, r.variant)).join('')}`;
      const red = reasons.some((r) => r.variant === 'red');
      items.push({
        level: red ? 'red' : 'yellow',
        at: pr.at,
        html: needRow(
          'pr',
          pills || pill('open'),
          `#${pr.number} ${pr.title}`,
          pr.url,
          `${proj} · by ${authorTag(pr.author)}`,
          'Open PR',
          ageTag(pr.at, d, t),
        ),
      });
    }
  }
  // Red first, then most recent first.
  return items.sort((a, b) =>
    a.level !== b.level ? (a.level === 'red' ? -1 : 1) : (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
  );
}

function needLi(i: NeedItem): string {
  return `<li class="ovn-need ovn-need-${i.level}" data-ovn-row="">${i.html}</li>`;
}

function renderNeeds(items: NeedItem[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, NEEDS_CAP).map(needLi).join('');
  const rest = items.slice(NEEDS_CAP);
  const more = rest.length
    ? `<details class="ovn-more"><summary class="ovn-toggle">${escapeHtml(`+${rest.length} more`)}</summary><ul class="ovn-need-list">${rest.map(needLi).join('')}</ul></details>`
    : '';
  return `<section class="ovn-section ovn-needs" aria-labelledby="ovn-needs-h"><h2 class="ovn-label ovn-label-section" id="ovn-needs-h"><span class="ovn-label-no">01</span>Needs you <span class="ovn-count">${escapeHtml(fmtInt(items.length))}</span></h2><ul class="ovn-need-list">${shown}</ul>${more}</section>`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const LIST_CAP = 40;

function capped<T>(items: T[], render: (x: T) => string, noun: string): string {
  const shown = items.slice(0, LIST_CAP).map(render).join('');
  const more =
    items.length > LIST_CAP
      ? `<li class="ovn-row ovn-row-more">${escapeHtml(`+${items.length - LIST_CAP} more ${noun}`)}</li>`
      : '';
  return `${shown}${more}`;
}

function detailGroup(kind: IconName, title: string, count: number, rows: string): string {
  if (count === 0) return '';
  return `<div class="ovn-group"><h4 class="ovn-group-h">${icon(kind)}${escapeHtml(title)} <span class="ovn-count">${escapeHtml(fmtInt(count))}</span></h4><ul class="ovn-rows">${rows}</ul></div>`;
}

function prRow(pr: PullRequestItem, t: TimeCtx): string {
  const additions = finiteNum(pr.additions);
  const deletions = finiteNum(pr.deletions);
  const size =
    additions !== undefined || deletions !== undefined
      ? `<span class="ovn-diff"><span class="ovn-add">${escapeHtml(`+${additions ?? 0}`)}</span> <span class="ovn-del">${escapeHtml(`−${deletions ?? 0}`)}</span></span>`
      : '';
  const no = finiteNum(pr.number);
  return `<li class="ovn-row"><span class="ovn-ref">${escapeHtml(no === undefined ? '#' : `#${no}`)}</span>${link(pr.url, str(pr.title), 'ovn-row-title')}<span class="ovn-row-meta">${authorTag(pr.author)}${size}${timeTag(pr.at, t)}</span></li>`;
}

function releaseRow(r: ReleaseItem, t: TimeCtx): string {
  const label = r.name && r.name !== r.tag ? r.name : 'Release';
  return `<li class="ovn-row"><span class="ovn-ref">${escapeHtml(r.tag)}</span>${link(r.url, label, 'ovn-row-title')}<span class="ovn-row-meta">${r.prerelease ? pill('pre-release', 'yellow') : pill('release', 'blue')}${timeTag(r.at, t)}</span></li>`;
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
  return `<li class="ovn-row"><span class="ovn-ref">${escapeHtml(dep.target === 'production' ? 'prod' : 'preview')}</span>${link(dep.url, label, 'ovn-row-title')}<span class="ovn-row-meta">${pill(str(dep.state).toLowerCase(), variant)}${timeTag(dep.at, t)}</span></li>`;
}

function ciRow(f: CIFailureItem, t: TimeCtx): string {
  return `<li class="ovn-row"><span class="ovn-ref">${escapeHtml(f.branch)}</span>${link(f.url, f.workflow, 'ovn-row-title')}<span class="ovn-row-meta">${pill(str(f.conclusion).replace(/_/g, ' '), 'red')}${timeTag(f.at, t)}</span></li>`;
}

function issueRow(i: IssueItem, t: TimeCtx): string {
  const no = finiteNum(i.number);
  return `<li class="ovn-row"><span class="ovn-ref">${escapeHtml(no === undefined ? '#' : `#${no}`)}</span>${link(i.url, str(i.title), 'ovn-row-title')}<span class="ovn-row-meta">${pill(i.state, i.state === 'closed' ? 'green' : 'neutral')}${authorTag(i.author)}${timeTag(i.at, t)}</span></li>`;
}

function commitRow(c: CommitItem, t: TimeCtx): string {
  return `<li class="ovn-row"><a class="ovn-ref ovn-sha" href="${safeUrl(c.url)}" rel="noopener noreferrer">${escapeHtml(str(c.sha).slice(0, 7))}</a><span class="ovn-row-title">${escapeHtml(c.message)}</span><span class="ovn-row-meta">${authorTag(c.author)}${timeTag(c.at, t)}</span></li>`;
}

function projectCounts(p: ProjectActivity): string {
  const parts: string[] = [];
  if (p.mergedPRs.length) parts.push(plural(p.mergedPRs.length, 'merged PR'));
  if (p.commits.length) parts.push(plural(p.commits.length, 'commit'));
  if (p.releases.length) parts.push(plural(p.releases.length, 'release'));
  if (p.deployments.length) parts.push(plural(p.deployments.length, 'deploy'));
  if (p.ciFailures.length) parts.push(plural(p.ciFailures.length, 'CI failure'));
  if (p.issues.length) parts.push(plural(p.issues.length, 'issue'));
  return parts.join(' · ');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'site';
  }
}

function renderProject(
  p: ProjectActivity,
  i: number,
  t: TimeCtx,
  hist: HistoryCtx | undefined,
  partial: boolean,
): string {
  const h = healthOf(p);
  const stars = p.stats
    ? (() => {
        const total = finiteNum(p.stats.stars);
        const delta = int(p.stats.starsDelta);
        if (total === undefined) return '';
        return `<span class="ovn-meta-item" title="Stars">${icon('star')}${num(total)}${delta !== 0 ? ` <span class="${delta > 0 ? 'ovn-add' : 'ovn-del'}">${escapeHtml(signed(delta))}</span>` : ''}</span>`;
      })()
    : '';
  const siteHref = safeUrl(p.siteUrl);
  const site =
    p.siteUrl && siteHref !== '#'
      ? `<a class="ovn-meta-item ovn-site" href="${siteHref}" rel="noopener noreferrer">${escapeHtml(hostOf(str(p.siteUrl)))} ↗</a>`
      : p.siteUrl
        ? link(str(p.siteUrl), 'site ↗', 'ovn-meta-item ovn-site')
        : '';
  const counts = projectCounts(p);
  const split = splitOf([p]);
  const tally =
    split.agents + split.you > 0
      ? `<span class="ovn-meta-item ovn-tally-mini" title="${escapeHtml(`Agents ${split.agents}, you ${split.you}`)}">${splitBar(split, 'ovn-split ovn-split-mini')}<span class="ovn-num ovn-num-agent">${escapeHtml(`AGT ${split.agents}`)}</span><span class="ovn-num">${escapeHtml(`YOU ${split.you}`)}</span></span>`
      : '';
  const partialTag = partial ? `<span class="ovn-meta-item">${pill('partial data', 'yellow')}</span>` : '';
  const meta = [stars, site, tally, partialTag].filter(Boolean).join('');
  const desc = p.description ? `<p class="ovn-proj-desc">${escapeHtml(p.description)}</p>` : '';
  const summary = p.summary ? `<p class="ovn-proj-summary">${escapeHtml(p.summary)}</p>` : '';
  const highlights = p.highlights.length
    ? `<ul class="ovn-highlights">${p.highlights
        .slice(0, 5)
        .map((x) => `<li>${escapeHtml(x)}</li>`)
        .join('')}</ul>`
    : '';
  const groups = [
    detailGroup(
      'ci',
      'CI failures',
      p.ciFailures.length,
      capped(p.ciFailures, (x) => ciRow(x, t), 'failures'),
    ),
    detailGroup(
      'deploy',
      'Deployments',
      p.deployments.length,
      capped(p.deployments, (x) => deployRow(x, t), 'deployments'),
    ),
    detailGroup(
      'pr',
      'Merged pull requests',
      p.mergedPRs.length,
      capped(p.mergedPRs, (x) => prRow(x, t), 'PRs'),
    ),
    detailGroup(
      'release',
      'Releases',
      p.releases.length,
      capped(p.releases, (x) => releaseRow(x, t), 'releases'),
    ),
    detailGroup(
      'issue',
      'Issues',
      p.issues.length,
      capped(p.issues, (x) => issueRow(x, t), 'issues'),
    ),
    detailGroup(
      'commit',
      'Commits',
      p.commits.length,
      capped(p.commits, (x) => commitRow(x, t), 'commits'),
    ),
  ].join('');
  const details = groups
    ? `<details class="ovn-details"><summary class="ovn-toggle"><span class="ovn-toggle-label">All activity</span><span class="ovn-toggle-counts">${escapeHtml(counts)}</span></summary><div class="ovn-details-body">${groups}</div></details>`
    : '';
  const trend = hist ? sparkBlock(projectSeries(hist, p.id), 'project') : '';
  const no = String(i + 1).padStart(2, '0');
  return `<article class="ovn-proj ovn-proj-${h}" tabindex="-1" data-ovn-row="" aria-labelledby="ovn-p-${i}"><span class="ovn-proj-no" aria-hidden="true">${no}</span><div class="ovn-proj-body"><header class="ovn-proj-head"><h3 class="ovn-proj-name" id="ovn-p-${i}">${link(p.url, p.name, 'ovn-proj-link')}</h3>${healthMark(h)}${trend}</header>${meta ? `<p class="ovn-proj-meta">${meta}</p>` : ''}${desc}${summary}${highlights}${details}</div></article>`;
}

function renderQuiet(quiet: ProjectActivity[]): string {
  if (quiet.length === 0) return '';
  const names = quiet
    .map((p) => link(p.url, p.name, 'ovn-quiet-link'))
    .join('<span class="ovn-sep">, </span>');
  return `<p class="ovn-quiet">${shape('quiet')}<span class="ovn-quiet-label">No activity (${quiet.length}):</span> ${names}</p>`;
}

function renderNotice(warnings: string[]): string {
  if (warnings.length === 0) return '';
  const head =
    warnings.length === 1
      ? '1 source was unavailable or degraded; totals exclude it.'
      : `${warnings.length} sources were unavailable or degraded; totals exclude them.`;
  return `<details class="ovn-notice"><summary class="ovn-toggle">${shape('yellow')}<span class="ovn-toggle-label">${escapeHtml(head)}</span></summary><ul class="ovn-notice-list">${warnings
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join('')}</ul></details>`;
}

function renderNav(nav: DigestNav | undefined): string {
  if (!nav || (!nav.prev && !nav.next && !nav.index)) return '';
  const prev = nav.prev
    ? `<a class="ovn-nav-link ovn-nav-prev" href="${safeHref(nav.prev)}" rel="prev">← Older</a>`
    : '<span class="ovn-nav-link ovn-nav-disabled" aria-disabled="true">← Older</span>';
  const index = nav.index
    ? `<a class="ovn-nav-link ovn-nav-index" href="${safeHref(nav.index)}">Archive</a>`
    : '';
  const next = nav.next
    ? `<a class="ovn-nav-link ovn-nav-next" href="${safeHref(nav.next)}" rel="next">Newer →</a>`
    : '<span class="ovn-nav-link ovn-nav-disabled" aria-disabled="true">Newer →</span>';
  return `<nav class="ovn-nav" aria-label="Editions">${prev}${index}${next}</nav>`;
}

function renderTally(projects: ProjectActivity[]): string {
  const counts: Record<Health, number> = { red: 0, yellow: 0, green: 0, quiet: 0 };
  for (const p of projects) counts[healthOf(p)]++;
  const items = (['red', 'yellow', 'green', 'quiet'] as const)
    .filter((h) => counts[h] > 0)
    .map(
      (h) =>
        `<li class="ovn-tally-item ovn-health-${h}">${shape(h)}<span class="ovn-num">${counts[h]}</span> ${HEALTH_META[h].tally}</li>`,
    )
    .join('');
  return items ? `<ul class="ovn-tally" aria-label="Project health">${items}</ul>` : '';
}

const KEYS_DIALOG = `<dialog class="ovn-keys" id="ovn-keys" aria-labelledby="ovn-keys-h"><h2 class="ovn-keys-title" id="ovn-keys-h">Keyboard</h2><dl class="ovn-keys-list"><div class="ovn-keys-row"><dt class="ovn-keys-k"><kbd class="ovn-kbd">j</kbd><kbd class="ovn-kbd">k</kbd></dt><dd class="ovn-keys-d">Next / previous row</dd></div><div class="ovn-keys-row"><dt class="ovn-keys-k"><kbd class="ovn-kbd">←</kbd><kbd class="ovn-kbd">→</kbd></dt><dd class="ovn-keys-d">Older / newer edition</dd></div><div class="ovn-keys-row"><dt class="ovn-keys-k"><kbd class="ovn-kbd">g</kbd><kbd class="ovn-kbd">i</kbd></dt><dd class="ovn-keys-d">Archive index</dd></div><div class="ovn-keys-row"><dt class="ovn-keys-k"><kbd class="ovn-kbd">?</kbd></dt><dd class="ovn-keys-d">Show or hide this sheet</dd></div></dl><form class="ovn-keys-form" method="dialog"><button class="ovn-keys-close" type="submit">Close <kbd class="ovn-kbd">esc</kbd></button></form></dialog>`;

const KBD_HINTS = `<p class="ovn-hints" aria-hidden="true"><kbd class="ovn-kbd">j</kbd><kbd class="ovn-kbd">k</kbd> rows <kbd class="ovn-kbd">←</kbd><kbd class="ovn-kbd">→</kbd> editions <kbd class="ovn-kbd">?</kbd> shortcuts</p>`;

interface InnerOpts {
  timezone?: string;
  history?: Digest[];
  edition?: number;
  nav?: DigestNav;
  siteTitle?: string;
  page: boolean;
}

function renderDigestInner(d: Digest, o: InnerOpts): string {
  const t = makeTimeCtx(d, o.timezone);
  const active = d.projects.filter((p) => healthOf(p) !== 'quiet');
  const quiet = d.projects.filter((p) => healthOf(p) === 'quiet');
  const reds = active.filter((p) => healthOf(p) === 'red').length;
  const yellows = active.filter((p) => healthOf(p) === 'yellow').length;
  const needs = needsItems(d, t);
  const hist = makeHistory(d, o.history);
  const edition = finiteNum(o.edition);
  const firstRun = edition === 1;
  const fallback = d.summarizer?.kind !== 'llm';
  const win = windowLabel(d, t);
  const owner = str(d.owner);

  // Masthead
  const title = escapeHtml(o.siteTitle ?? 'Overnight');
  const editionMark =
    edition !== undefined && edition >= 1
      ? `<span class="ovn-edition">No. ${escapeHtml(String(Math.round(edition)).padStart(3, '0'))}</span>`
      : '';
  const dateText = longDate(d.id);
  const comma = dateText.indexOf(', ');
  const dateHtml =
    ID_RE.test(d.id) && comma > 0
      ? `<time class="ovn-date-time" datetime="${escapeHtml(d.id)}"><em class="ovn-weekday">${escapeHtml(dateText.slice(0, comma + 1))}</em> ${escapeHtml(dateText.slice(comma + 2))}</time>`
      : escapeHtml(dateText);
  const overall = hist ? sparkBlock(overallSeries(hist), 'overall') : '';
  const dateline = [
    owner ? `<span class="ovn-dateline-item">${escapeHtml(owner)}</span>` : '',
    win ? `<span class="ovn-dateline-item">${escapeHtml(win)}</span>` : '',
    `<span class="ovn-dateline-item">${escapeHtml(plural(d.projects.length, 'project'))}</span>`,
    fallback ? '<span class="ovn-dateline-item ovn-dateline-note">summaries: deterministic</span>' : '',
  ].join('');
  const mast = `<header class="ovn-mast"><div class="ovn-mast-bar"><span class="ovn-wordmark">${title}</span>${editionMark}${o.page ? renderNav(o.nav) : ''}</div><div class="ovn-mast-main"><h1 class="ovn-date">${dateHtml}</h1>${overall}</div><p class="ovn-dateline">${dateline}</p></header>`;

  const warnings = t.warning ? [...d.warnings, t.warning] : d.warnings;
  const notice = renderNotice(warnings);

  // Lead
  const state =
    active.length === 0
      ? 'quiet'
      : reds >= 2
        ? 'rough'
        : reds + yellows === 0 && needs.length === 0
          ? 'green'
          : 'mixed';
  let calm = '';
  if (state === 'quiet') {
    calm = `<p class="ovn-calm">${shape('quiet')}<span>No activity in this window. Nothing needs you this morning.</span></p>`;
  } else if (needs.length === 0) {
    calm = `<p class="ovn-calm ovn-calm-green">${shape('green')}<span>${state === 'green' ? 'Nothing needs you this morning. Everything that ran, passed.' : 'Nothing needs you this morning.'}</span></p>`;
  }
  const first = firstRun
    ? `<p class="ovn-first">This is the first edition. Tomorrow’s will compare against today.</p>`
    : '';
  const lead = `<section class="ovn-lead ovn-lead-${state}" aria-label="Headline"><p class="ovn-headline">${escapeHtml(d.headline)}</p>${state === 'quiet' ? '' : renderTally(d.projects)}${calm}${first}</section>`;

  const numbers = state === 'quiet' ? '' : renderNumbers(d.totals);
  const agents = state === 'quiet' ? '' : renderAgents(active);
  const rail =
    numbers || agents ? `<aside class="ovn-rail" aria-label="Totals">${numbers}${agents}</aside>` : '';

  const warnIds = new Set(
    warnings.map((w) => str(w).split(':')[0]?.trim() ?? '').filter((x) => x.length > 0),
  );
  const projects = active.length
    ? `<section class="ovn-section ovn-projects" aria-labelledby="ovn-projects-h"><h2 class="ovn-label ovn-label-section" id="ovn-projects-h"><span class="ovn-label-no">${needs.length ? '02' : '01'}</span>Projects <span class="ovn-count">${escapeHtml(fmtInt(active.length))}</span></h2><div class="ovn-proj-list">${active
        .map((p, i) => renderProject(p, i, t, hist, warnIds.has(str(p.id)) || warnIds.has(str(p.name))))
        .join('')}</div>${renderQuiet(quiet)}</section>`
    : `<section class="ovn-section ovn-projects ovn-projects-quiet">${renderQuiet(quiet)}</section>`;

  // Colophon
  const by =
    d.summarizer?.kind === 'llm'
      ? `Summarized by ${str(d.summarizer.model)}`
      : 'Summaries: deterministic. Written by rules, not a model.';
  const generated = parseDate(d.generatedAt);
  const genText = generated ? `${shortDay(generated, t.tz)} ${clock(generated, t.tz)} ${t.tz}` : '';
  const colo = [
    ['Edition', edition !== undefined && edition >= 1 ? `No. ${Math.round(edition)}` : ''],
    ['Window', win],
    ['Generated', genText],
    ['Summaries', by],
    [
      'Sources',
      warnings.length ? `${plural(warnings.length, 'warning')}, listed above` : 'All sources answered',
    ],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<div class="ovn-colo-item"><dt class="ovn-colo-k">${escapeHtml(k)}</dt><dd class="ovn-colo-v">${escapeHtml(v)}</dd></div>`,
    )
    .join('');
  const why = owner
    ? `<p class="ovn-colo-why">${escapeHtml(`Overnight for ${owner}. Times in ${t.tz}.`)}</p>`
    : '';
  const footer = `<footer class="ovn-colophon"><dl class="ovn-colo">${colo}</dl>${why}${o.page ? KBD_HINTS : ''}</footer>`;

  const keys = o.page ? KEYS_DIALOG : '';
  return `<div class="ovn-root"><div class="ovn-page ovn-page-${state}">${mast}${notice}<div class="ovn-body">${lead}${rail}${renderNeeds(needs)}${projects}</div>${footer}</div>${keys}</div>`;
}

// ---------------------------------------------------------------------------
// Progressive enhancement: keyboard (j/k rows, ←/→ editions, g i archive, ? sheet).
// Must stay free of "<" so it can never close the element early; tests pin size and content.
// ---------------------------------------------------------------------------

export const DIGEST_SCRIPT = `(()=>{const d=document,R=d.querySelector('.ovn-root');if(!R)return;R.setAttribute('data-ovn-js','');const S=d.getElementById('ovn-keys');let g=0;
const go=s=>{const a=R.querySelector(s);if(a&&a.href)location.href=a.href};
const rm=matchMedia('(prefers-reduced-motion: reduce)');
const mv=n=>{const r=[...R.querySelectorAll('[data-ovn-row]')].filter(e=>e.getClientRects().length);if(!r.length)return;const c=d.activeElement&&d.activeElement.closest('[data-ovn-row]');let i=r.indexOf(c);i=i==-1?(n>0?0:r.length-1):Math.max(0,Math.min(r.length-1,i+n));const e=r[i];if(e.tabIndex==-1&&!e.hasAttribute('tabindex'))e.tabIndex=-1;e.focus({preventScroll:true});e.scrollIntoView({block:'nearest',behavior:rm.matches?'auto':'smooth'})};
d.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey||e.defaultPrevented)return;const t=e.target;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;const k=e.key;
if(k=='?'&&S){S.open?S.close():S.showModal();e.preventDefault();return}
if(S&&S.open)return;
if(g){g=0;if(k=='i')go('a.ovn-nav-index');return}
if(k=='g'){g=1;setTimeout(()=>{g=0},1200);return}
if(k=='j'||k=='k'){mv(k=='j'?1:-1);e.preventDefault()}else if(k=='ArrowLeft')go('a[rel=prev]');else if(k=='ArrowRight')go('a[rel=next]')});
addEventListener('beforeprint',()=>R.querySelectorAll('details').forEach(x=>{x.open=true}))})();`;

// ---------------------------------------------------------------------------
// CSS. One mapping block (.ovn-root{--ovn-*: var(--fl-*)}), then components using only --ovn-* vars.
// Every selector starts at .ovn-root; layout responds to the container, not the viewport, so the
// fragment behaves inside a narrow Fleet panel exactly as the page does on a phone.
// ---------------------------------------------------------------------------

export const DIGEST_CSS = `
.ovn-root {
  --ovn-font-display: var(--fl-font-display);
  --ovn-font-sans: var(--fl-font-sans);
  --ovn-font-mono: var(--fl-font-mono);
  --ovn-text-2xs: var(--fl-text-2xs);
  --ovn-text-xs: var(--fl-text-xs);
  --ovn-text-sm: var(--fl-text-sm);
  --ovn-text-md: var(--fl-text-md);
  --ovn-text-lg: var(--fl-text-lg);
  --ovn-text-xl: var(--fl-text-xl);
  --ovn-text-2xl: var(--fl-text-2xl);
  --ovn-text-3xl: var(--fl-text-3xl);
  --ovn-text-4xl: var(--fl-text-4xl);
  --ovn-leading-tight: var(--fl-leading-tight);
  --ovn-leading: var(--fl-leading-normal);
  --ovn-tracking-caps: var(--fl-tracking-caps);
  --ovn-tracking-display: var(--fl-tracking-display, -0.02em);
  --ovn-bg: var(--fl-bg);
  --ovn-surface: var(--fl-surface-1);
  --ovn-surface-2: var(--fl-surface-2);
  --ovn-surface-3: var(--fl-surface-3);
  --ovn-line: var(--fl-border);
  --ovn-line-strong: var(--fl-border-strong);
  --ovn-fg: var(--fl-fg);
  --ovn-muted: var(--fl-fg-muted);
  --ovn-subtle: var(--fl-fg-subtle);
  --ovn-accent: var(--fl-accent);
  --ovn-accent-fg: var(--fl-accent-fg);
  --ovn-focus: var(--fl-focus);
  --ovn-red: var(--fl-danger);
  --ovn-yellow: var(--fl-warn);
  --ovn-green: var(--fl-success);
  --ovn-quiet: var(--fl-fg-subtle);
  --ovn-red-ink: color-mix(in srgb, var(--fl-danger) 72%, var(--fl-fg));
  --ovn-yellow-ink: color-mix(in srgb, var(--fl-warn) 70%, var(--fl-fg));
  --ovn-green-ink: color-mix(in srgb, var(--fl-success) 70%, var(--fl-fg));
  --ovn-agent: var(--fl-series-2);
  --ovn-you: var(--fl-series-6);
  --ovn-spark: var(--fl-series-1);
  --ovn-space-1: var(--fl-space-1);
  --ovn-space-2: var(--fl-space-2);
  --ovn-space-3: var(--fl-space-3);
  --ovn-space-4: var(--fl-space-4);
  --ovn-space-5: var(--fl-space-5);
  --ovn-space-6: var(--fl-space-6);
  --ovn-space-7: var(--fl-space-7);
  --ovn-space-8: var(--fl-space-8);
  --ovn-space-9: var(--fl-space-9);
  --ovn-space-10: var(--fl-space-10);
  --ovn-radius-xs: var(--fl-radius-xs);
  --ovn-radius-sm: var(--fl-radius-sm);
  --ovn-radius-md: var(--fl-radius-md);
  --ovn-radius-lg: var(--fl-radius-lg);
  --ovn-radius-pill: var(--fl-radius-pill);
  --ovn-elev-1: var(--fl-elev-1);
  --ovn-elev-3: var(--fl-elev-3);
  --ovn-ease: var(--fl-ease-out);
  --ovn-dur-fast: var(--fl-dur-fast);
  --ovn-dur-base: var(--fl-dur-base);
  --ovn-dur-slow: var(--fl-dur-slow);
  --ovn-grain: var(--fl-grain, url("data:image/svg+xml,%3Csvg xmlns='http://www%2Ew3%2Eorg/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"));
  --ovn-grain-size: var(--fl-grain-size, 180px);
  --ovn-grain-opacity: var(--fl-grain-opacity, 0.06);
  --ovn-glow: var(--fl-glow-accent, none);
  --ovn-dawn: color-mix(in srgb, var(--fl-accent) 13%, transparent);
}
.ovn-root {
  --ovn-gutter: var(--ovn-space-5);
  container: ovn / inline-size;
  background-color: var(--ovn-bg);
  position: relative;
  isolation: isolate;
  background-image: radial-gradient(ellipse 60% 420px at 50% -120px, var(--ovn-dawn), transparent 72%);
  background-repeat: no-repeat;
  color: var(--ovn-fg);
  font-family: var(--ovn-font-sans);
  font-size: var(--ovn-text-md);
  line-height: var(--ovn-leading);
  font-kerning: normal;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
.ovn-root::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: var(--ovn-grain); background-size: var(--ovn-grain-size); opacity: var(--ovn-grain-opacity); mix-blend-mode: overlay; }
.ovn-root *, .ovn-root *::before, .ovn-root *::after { box-sizing: border-box; }
.ovn-root p, .ovn-root h1, .ovn-root h2, .ovn-root h3, .ovn-root h4, .ovn-root ul, .ovn-root ol, .ovn-root dl, .ovn-root dd { margin: 0; }
.ovn-root ul, .ovn-root ol { padding: 0; list-style: none; }
.ovn-root a { color: inherit; text-decoration: none; transition: color var(--ovn-dur-fast) var(--ovn-ease), text-decoration-color var(--ovn-dur-fast) var(--ovn-ease); }
.ovn-root :focus-visible { outline: 2px solid var(--ovn-focus); outline-offset: 3px; border-radius: var(--ovn-radius-xs); }
.ovn-root .ovn-icon { flex: none; width: 1.25em; height: 1.25em; vertical-align: -0.25em; }
.ovn-root .ovn-shape { flex: none; width: 0.75rem; height: 0.75rem; }
.ovn-root .ovn-shape-red { fill: var(--ovn-red); }
.ovn-root .ovn-shape-yellow { fill: var(--ovn-yellow); }
.ovn-root .ovn-shape-green { fill: var(--ovn-green); }
.ovn-root .ovn-shape-quiet { fill: none; stroke: var(--ovn-quiet); stroke-width: 1.5; }
.ovn-root .ovn-num, .ovn-root .ovn-time, .ovn-root .ovn-ref, .ovn-root .ovn-diff, .ovn-root .ovn-count { font-family: var(--ovn-font-mono); font-variant-numeric: tabular-nums; }
.ovn-root .ovn-caps { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }

.ovn-root .ovn-page { max-width: 1240px; margin: 0 auto; padding: var(--ovn-space-5) var(--ovn-gutter) var(--ovn-space-9); }

.ovn-root .ovn-mast-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-3) var(--ovn-space-5); padding-bottom: var(--ovn-space-4); border-bottom: 1px solid var(--ovn-line); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-wordmark { font-family: var(--ovn-font-sans); font-weight: 700; font-size: var(--ovn-text-xs); letter-spacing: 0.14em; color: var(--ovn-fg); }
.ovn-root .ovn-edition { color: var(--ovn-muted); }
.ovn-root .ovn-edition::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: var(--ovn-space-3); vertical-align: 1px; background: var(--ovn-accent); border-radius: 1px; box-shadow: var(--ovn-glow); }
.ovn-root .ovn-nav { display: flex; gap: var(--ovn-space-2); margin-left: auto; }
.ovn-root .ovn-nav-link { display: inline-flex; align-items: center; min-height: 32px; padding: 0 var(--ovn-space-3); border-radius: var(--ovn-radius-sm); color: var(--ovn-muted); }
.ovn-root a.ovn-nav-link:hover { color: var(--ovn-fg); background: var(--ovn-surface-2); }
.ovn-root .ovn-nav-disabled { opacity: 0.45; }
.ovn-root .ovn-mast-main { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--ovn-space-5) var(--ovn-space-7); padding: var(--ovn-space-6) 0 var(--ovn-space-4); }
.ovn-root .ovn-date { font-family: var(--ovn-font-display); font-weight: 400; font-size: clamp(2rem, 5.4cqi, 2.875rem); line-height: 0.95; letter-spacing: var(--ovn-tracking-display); text-wrap: balance; }
.ovn-root .ovn-weekday { font-style: italic; color: var(--ovn-muted); }
.ovn-root .ovn-dateline { display: flex; flex-wrap: wrap; gap: var(--ovn-space-2) 0; padding: var(--ovn-space-3) 0; border-top: 3px solid var(--ovn-fg); box-shadow: inset 0 1px 0 var(--ovn-bg), inset 0 2px 0 var(--ovn-fg); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); border-bottom: 1px solid var(--ovn-line); }
.ovn-root .ovn-dateline-item { padding-right: var(--ovn-space-4); }
.ovn-root .ovn-dateline-note { color: var(--ovn-fg); }

.ovn-root .ovn-trend { display: inline-flex; align-items: center; gap: var(--ovn-space-4); }
.ovn-root .ovn-trend-overall { padding-bottom: var(--ovn-space-2); }
.ovn-root .ovn-spark { display: block; flex: none; overflow: visible; }
.ovn-root .ovn-spark-base { fill: none; stroke: var(--ovn-line-strong); stroke-width: 1; }
.ovn-root .ovn-spark-line { fill: none; stroke: var(--ovn-muted); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.ovn-root .ovn-spark-overall .ovn-spark-line { stroke: var(--ovn-spark); }
.ovn-root .ovn-spark-area { fill: var(--ovn-spark); opacity: 0.12; stroke: none; }
.ovn-root .ovn-spark-dot { fill: var(--ovn-muted); }
.ovn-root .ovn-spark-gap { fill: var(--ovn-subtle); }
.ovn-root .ovn-spark-red { fill: var(--ovn-red); stroke: var(--ovn-bg); stroke-width: 1; }
.ovn-root .ovn-spark-end { fill: var(--ovn-spark); stroke: var(--ovn-bg); stroke-width: 1.5; }
.ovn-root .ovn-spark-cap { display: flex; flex-direction: column; gap: var(--ovn-space-1); max-width: 11rem; }
.ovn-root .ovn-spark-note { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root .ovn-mast-main .ovn-trend-overall { flex-basis: 100%; flex-wrap: wrap; row-gap: var(--ovn-space-3); }
.ovn-root .ovn-mast-main .ovn-spark-cap { flex-direction: row; flex-wrap: wrap; align-items: baseline; column-gap: var(--ovn-space-4); max-width: none; }

.ovn-root .ovn-notice { margin-top: var(--ovn-space-5); padding: var(--ovn-space-3) var(--ovn-space-4); border: 1px solid color-mix(in srgb, var(--ovn-yellow) 45%, transparent); background: color-mix(in srgb, var(--ovn-yellow) 7%, transparent); border-radius: var(--ovn-radius-sm); font-size: var(--ovn-text-sm); }
.ovn-root .ovn-notice-list { margin-top: var(--ovn-space-3); padding-left: var(--ovn-space-6); list-style: square; font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); overflow-wrap: anywhere; }

.ovn-root .ovn-body { display: flex; flex-direction: column; gap: var(--ovn-space-8); padding-top: var(--ovn-space-7); }
.ovn-root .ovn-rail { display: contents; }
.ovn-root .ovn-lead { order: 1; }
.ovn-root .ovn-numbers { order: 2; }
.ovn-root .ovn-needs { order: 3; }
.ovn-root .ovn-agents { order: 4; }
.ovn-root .ovn-projects { order: 5; }

.ovn-root .ovn-lead { max-width: 52rem; }
.ovn-root .ovn-lead-rough { padding-top: var(--ovn-space-5); border-top: 3px solid var(--ovn-red); }
.ovn-root .ovn-headline { font-family: var(--ovn-font-display); font-weight: 400; font-size: clamp(1.875rem, 4.9cqi, 3.25rem); line-height: 1.04; letter-spacing: var(--ovn-tracking-display); text-wrap: balance; overflow-wrap: anywhere; }
.ovn-root .ovn-tally { display: flex; flex-wrap: wrap; gap: var(--ovn-space-2) var(--ovn-space-5); margin-top: var(--ovn-space-5); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-tally-item { display: inline-flex; align-items: center; gap: var(--ovn-space-3); }
.ovn-root .ovn-tally-item .ovn-num { color: var(--ovn-fg); }
.ovn-root .ovn-calm { display: flex; align-items: baseline; gap: var(--ovn-space-3); margin-top: var(--ovn-space-5); font-size: var(--ovn-text-md); color: var(--ovn-muted); }
.ovn-root .ovn-calm .ovn-shape { transform: translateY(1px); }
.ovn-root .ovn-first { margin-top: var(--ovn-space-4); font-family: var(--ovn-font-display); font-style: italic; font-size: var(--ovn-text-lg); color: var(--ovn-muted); }

.ovn-root .ovn-label { display: flex; align-items: center; gap: var(--ovn-space-3); margin-bottom: var(--ovn-space-5); font-family: var(--ovn-font-mono); font-weight: 500; font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-label .ovn-icon { width: 1rem; height: 1rem; }
.ovn-root .ovn-label-section { padding-bottom: var(--ovn-space-3); border-bottom: 1px solid var(--ovn-fg); color: var(--ovn-fg); }
.ovn-root .ovn-label-no { color: var(--ovn-muted); }
.ovn-root .ovn-count { margin-left: auto; color: var(--ovn-muted); letter-spacing: 0; }

.ovn-root .ovn-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); column-gap: var(--ovn-space-5); }
.ovn-root .ovn-stat { display: flex; flex-direction: column-reverse; justify-content: flex-end; gap: var(--ovn-space-1); padding: var(--ovn-space-4) 0; border-top: 1px solid var(--ovn-line); }
.ovn-root .ovn-stat-label { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-stat-value { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--ovn-space-3); }
.ovn-root .ovn-stat-value .ovn-num { font-size: var(--ovn-text-xl); font-weight: 500; letter-spacing: -0.03em; line-height: 1.15; }
.ovn-root .ovn-stat-sub { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root .ovn-stat-sub-red { color: var(--ovn-red-ink); }

.ovn-root .ovn-agents-lede { font-family: var(--ovn-font-display); font-size: var(--ovn-text-xl); line-height: 1.2; max-width: 22em; }
.ovn-root .ovn-split { display: flex; gap: 2px; height: 10px; margin-top: var(--ovn-space-5); border-radius: var(--ovn-radius-xs); overflow: hidden; }
.ovn-root .ovn-split-seg { flex-basis: 0; min-width: 3px; }
.ovn-root .ovn-split-agent { background: var(--ovn-agent); }
.ovn-root .ovn-split-you { background: repeating-linear-gradient(-45deg, var(--ovn-you) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--ovn-you); }
.ovn-root .ovn-split-mini { width: 64px; height: 6px; margin: 0; flex: none; }
.ovn-root .ovn-legend { display: flex; gap: var(--ovn-space-6); margin-top: var(--ovn-space-4); }
.ovn-root .ovn-legend-item { display: flex; align-items: baseline; gap: var(--ovn-space-3); }
.ovn-root .ovn-legend-key { display: inline-flex; align-items: center; gap: var(--ovn-space-3); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-legend-key::before { content: ''; width: 10px; height: 10px; border-radius: 2px; }
.ovn-root .ovn-legend-agent::before { background: var(--ovn-agent); }
.ovn-root .ovn-legend-you::before { background: repeating-linear-gradient(-45deg, var(--ovn-you) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--ovn-you); }
.ovn-root .ovn-legend-val .ovn-num { font-size: var(--ovn-text-lg); }
.ovn-root .ovn-agent-logins { display: flex; flex-wrap: wrap; gap: var(--ovn-space-2) var(--ovn-space-5); margin-top: var(--ovn-space-4); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root .ovn-agent-login .ovn-num { color: var(--ovn-fg); }
.ovn-root .ovn-lane { margin-top: var(--ovn-space-5); border-top: 1px solid var(--ovn-line); }
.ovn-root .ovn-lane-row { display: grid; grid-template-columns: minmax(0, 1fr) 64px 4.5rem; align-items: center; gap: var(--ovn-space-4); padding: var(--ovn-space-3) 0; border-bottom: 1px solid var(--ovn-line); font-size: var(--ovn-text-sm); }
.ovn-root .ovn-lane-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ovn-root .ovn-lane-counts { text-align: right; font-size: var(--ovn-text-xs); color: var(--ovn-muted); white-space: nowrap; }
.ovn-root .ovn-lane-sep { margin: 0 var(--ovn-space-2); color: var(--ovn-subtle); }
.ovn-root .ovn-num-agent { color: var(--ovn-fg); }

.ovn-root .ovn-need-list { border-bottom: 1px solid var(--ovn-line); }
.ovn-root .ovn-need { position: relative; display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); gap: var(--ovn-space-2) var(--ovn-space-4); padding: var(--ovn-space-5) 0 var(--ovn-space-5) var(--ovn-space-4); border-top: 1px solid var(--ovn-line); }
.ovn-root .ovn-need:first-child { border-top: 0; }
.ovn-root .ovn-need::before { content: ''; position: absolute; left: 0; top: var(--ovn-space-5); bottom: var(--ovn-space-5); width: 2px; border-radius: 1px; background: var(--ovn-yellow); }
.ovn-root .ovn-need-red::before { background: var(--ovn-red); }
.ovn-root .ovn-need-kind { color: var(--ovn-muted); padding-top: 2px; }
.ovn-root .ovn-need-main { display: flex; flex-direction: column; gap: var(--ovn-space-2); min-width: 0; }
.ovn-root .ovn-need-reasons { display: flex; flex-wrap: wrap; gap: var(--ovn-space-2); }
.ovn-root .ovn-need-title { font-size: var(--ovn-text-lg); font-weight: 500; line-height: 1.3; letter-spacing: -0.005em; overflow-wrap: anywhere; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.ovn-root .ovn-need-title:hover { text-decoration-color: var(--ovn-accent); }
.ovn-root .ovn-need-detail { font-size: var(--ovn-text-sm); color: var(--ovn-muted); overflow-wrap: anywhere; }
.ovn-root .ovn-need-project { font-weight: 600; color: var(--ovn-fg); }
.ovn-root .ovn-need-side { grid-column: 2; display: flex; align-items: center; gap: var(--ovn-space-4); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root .ovn-need-act { display: inline-flex; align-items: center; min-height: 44px; font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); letter-spacing: 0.02em; color: var(--ovn-fg); }
.ovn-root .ovn-need-act:hover { color: var(--ovn-accent); }
.ovn-root .ovn-page-rough .ovn-needs .ovn-label-section { border-bottom-color: var(--ovn-red); }
.ovn-root .ovn-more { margin-top: var(--ovn-space-4); }

.ovn-root .ovn-pill { display: inline-flex; align-items: center; gap: var(--ovn-space-2); height: 1.375rem; padding: 0 var(--ovn-space-3); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1; white-space: nowrap; border-radius: var(--ovn-radius-xs); color: var(--ovn-fg); border: 1px solid var(--ovn-line-strong); }
.ovn-root .ovn-pill-red { border-color: color-mix(in srgb, var(--ovn-red) 55%, transparent); background: color-mix(in srgb, var(--ovn-red) 12%, transparent); color: var(--ovn-red-ink); }
.ovn-root .ovn-pill-yellow { border-color: color-mix(in srgb, var(--ovn-yellow) 55%, transparent); background: color-mix(in srgb, var(--ovn-yellow) 10%, transparent); color: var(--ovn-yellow-ink); }
.ovn-root .ovn-pill-green { border-color: color-mix(in srgb, var(--ovn-green) 50%, transparent); background: color-mix(in srgb, var(--ovn-green) 9%, transparent); color: var(--ovn-green-ink); }
.ovn-root .ovn-pill-blue { color: var(--ovn-muted); }
.ovn-root .ovn-pill-agent { height: 1.125rem; padding: 0 var(--ovn-space-2); border-color: color-mix(in srgb, var(--ovn-agent) 60%, transparent); color: var(--ovn-fg); font-size: 0.625rem; }

.ovn-root .ovn-proj-list { counter-reset: ovn-proj; }
.ovn-root .ovn-proj { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); padding: var(--ovn-space-6) 0 var(--ovn-space-7); border-bottom: 1px solid var(--ovn-line); outline: none; }
.ovn-root .ovn-proj:focus-visible { box-shadow: inset 2px 0 0 var(--ovn-accent); outline: 2px solid var(--ovn-focus); outline-offset: 4px; }
.ovn-root .ovn-proj-no { display: none; font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); padding-top: 0.6rem; }
.ovn-root .ovn-proj-body { min-width: 0; }
.ovn-root .ovn-proj-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-3) var(--ovn-space-5); }
.ovn-root .ovn-proj-name { font-family: var(--ovn-font-display); font-weight: 400; font-size: clamp(1.75rem, 3.6cqi, 2.25rem); line-height: 1; letter-spacing: var(--ovn-tracking-display); min-width: 0; overflow-wrap: anywhere; }
.ovn-root .ovn-proj-link { text-decoration: underline; text-decoration-color: transparent; text-decoration-thickness: 1px; text-underline-offset: 5px; }
.ovn-root .ovn-proj-link:hover { text-decoration-color: var(--ovn-accent); }
.ovn-root .ovn-health { display: inline-flex; align-items: center; gap: var(--ovn-space-3); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-fg); }
.ovn-root .ovn-health .ovn-shape { width: 0.625rem; height: 0.625rem; }
.ovn-root .ovn-proj-head .ovn-trend { margin-left: auto; }
.ovn-root .ovn-proj-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-2) var(--ovn-space-5); margin-top: var(--ovn-space-4); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root .ovn-meta-item { display: inline-flex; align-items: center; gap: var(--ovn-space-3); white-space: nowrap; }
.ovn-root .ovn-meta-item .ovn-icon { width: 0.875rem; height: 0.875rem; }
.ovn-root .ovn-site { text-decoration: underline; text-decoration-color: var(--ovn-line-strong); text-underline-offset: 3px; }
.ovn-root .ovn-site:hover { color: var(--ovn-fg); text-decoration-color: var(--ovn-accent); }
.ovn-root .ovn-tally-mini { gap: var(--ovn-space-3); }
.ovn-root .ovn-proj-desc { margin-top: var(--ovn-space-3); font-size: var(--ovn-text-sm); color: var(--ovn-muted); max-width: 72ch; }
.ovn-root .ovn-proj-summary { margin-top: var(--ovn-space-5); max-width: 36em; font-family: var(--ovn-font-display); font-size: clamp(1.25rem, 2.2cqi, 1.4375rem); line-height: 1.32; overflow-wrap: anywhere; }
.ovn-root .ovn-highlights { margin-top: var(--ovn-space-4); max-width: 68ch; font-size: var(--ovn-text-md); color: var(--ovn-muted); }
.ovn-root .ovn-highlights li { position: relative; padding: var(--ovn-space-2) 0 var(--ovn-space-2) var(--ovn-space-6); overflow-wrap: anywhere; }
.ovn-root .ovn-highlights li::before { content: ''; position: absolute; left: 2px; top: 0.95em; width: 10px; height: 1px; background: var(--ovn-muted); }

.ovn-root .ovn-details { margin-top: var(--ovn-space-5); }
.ovn-root .ovn-toggle { display: flex; align-items: center; gap: var(--ovn-space-4); min-height: 44px; cursor: pointer; list-style: none; user-select: none; font-size: var(--ovn-text-sm); color: var(--ovn-muted); border-radius: var(--ovn-radius-xs); }
.ovn-root .ovn-toggle::-webkit-details-marker { display: none; }
.ovn-root .ovn-toggle::before { content: ''; flex: none; width: 18px; height: 18px; border: 1px solid var(--ovn-line-strong); border-radius: var(--ovn-radius-xs); background: linear-gradient(currentColor, currentColor) center / 8px 1px no-repeat, linear-gradient(currentColor, currentColor) center / 1px 8px no-repeat; transition: background-size var(--ovn-dur-base) var(--ovn-ease), border-color var(--ovn-dur-fast) var(--ovn-ease); }
.ovn-root details[open] > .ovn-toggle::before { background-size: 8px 1px, 1px 0; }
.ovn-root .ovn-toggle:hover { color: var(--ovn-fg); }
.ovn-root .ovn-toggle:hover::before { border-color: var(--ovn-muted); }
.ovn-root .ovn-toggle-label { color: var(--ovn-fg); font-weight: 500; white-space: nowrap; }
.ovn-root .ovn-toggle-counts { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); }
.ovn-root .ovn-notice .ovn-toggle { min-height: 32px; }
.ovn-root .ovn-notice .ovn-toggle::before { display: none; }
.ovn-root .ovn-notice .ovn-toggle-label { font-weight: 400; white-space: normal; min-width: 0; }
.ovn-root .ovn-details-body { display: flex; flex-direction: column; gap: var(--ovn-space-6); padding: var(--ovn-space-4) 0 var(--ovn-space-2) calc(18px + var(--ovn-space-4)); }
.ovn-root .ovn-details[open] .ovn-details-body { animation: none; }
.ovn-root .ovn-group-h { display: flex; align-items: center; gap: var(--ovn-space-3); margin-bottom: var(--ovn-space-2); font-family: var(--ovn-font-mono); font-weight: 500; font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-group-h .ovn-icon { width: 0.875rem; height: 0.875rem; }
.ovn-root .ovn-group-h .ovn-count { margin-left: 0; }
.ovn-root .ovn-row { display: grid; grid-template-columns: 4.75rem minmax(0, 1fr); gap: var(--ovn-space-1) var(--ovn-space-4); align-items: baseline; padding: var(--ovn-space-3) 0; border-top: 1px solid var(--ovn-line); font-size: var(--ovn-text-sm); }
.ovn-root .ovn-ref { font-size: var(--ovn-text-xs); color: var(--ovn-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ovn-root a.ovn-sha { color: var(--ovn-fg); text-decoration: underline; text-decoration-color: var(--ovn-line-strong); text-underline-offset: 3px; }
.ovn-root .ovn-row-title { min-width: 0; overflow-wrap: anywhere; }
.ovn-root a.ovn-row-title:hover, .ovn-root a.ovn-sha:hover { text-decoration: underline; text-decoration-color: var(--ovn-accent); text-underline-offset: 3px; }
.ovn-root .ovn-row-meta { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-2) var(--ovn-space-4); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root .ovn-row-more { display: block; color: var(--ovn-muted); }
.ovn-root .ovn-author { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); overflow-wrap: anywhere; }
.ovn-root .ovn-time { font-size: var(--ovn-text-xs); color: var(--ovn-muted); white-space: nowrap; }
.ovn-root .ovn-diff { font-size: var(--ovn-text-xs); }
.ovn-root .ovn-add { color: var(--ovn-green-ink); }
.ovn-root .ovn-del { color: var(--ovn-red-ink); }

.ovn-root .ovn-quiet { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-2) var(--ovn-space-3); padding: var(--ovn-space-5) 0; font-size: var(--ovn-text-sm); color: var(--ovn-muted); border-bottom: 1px solid var(--ovn-line); }
.ovn-root .ovn-quiet-label { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; }
.ovn-root .ovn-quiet-link { text-decoration: underline; text-decoration-color: var(--ovn-line-strong); text-underline-offset: 3px; }
.ovn-root .ovn-quiet-link:hover { color: var(--ovn-fg); text-decoration-color: var(--ovn-accent); }
.ovn-root .ovn-sep { margin-left: calc(-1 * var(--ovn-space-3)); }
.ovn-root .ovn-projects-quiet .ovn-quiet { border-top: 1px solid var(--ovn-line); }

.ovn-root .ovn-colophon { margin-top: var(--ovn-space-9); padding-top: var(--ovn-space-5); border-top: 3px solid var(--ovn-fg); }
.ovn-root .ovn-colo { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: var(--ovn-space-5) var(--ovn-space-6); }
.ovn-root .ovn-colo-k { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-colo-v { margin-top: var(--ovn-space-2); font-size: var(--ovn-text-sm); overflow-wrap: anywhere; }
.ovn-root .ovn-colo-why { margin-top: var(--ovn-space-6); font-family: var(--ovn-font-display); font-style: italic; font-size: var(--ovn-text-lg); color: var(--ovn-muted); }
.ovn-root .ovn-hints { display: none; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-3); margin-top: var(--ovn-space-5); font-size: var(--ovn-text-xs); color: var(--ovn-muted); }
.ovn-root[data-ovn-js] .ovn-hints { display: flex; }
.ovn-root .ovn-kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5rem; height: 1.5rem; padding: 0 var(--ovn-space-2); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-fg); border: 1px solid var(--ovn-line-strong); border-bottom-width: 2px; border-radius: var(--ovn-radius-sm); background: var(--ovn-surface); }
.ovn-root .ovn-hints .ovn-kbd + .ovn-kbd { margin-left: calc(-1 * var(--ovn-space-2)); }

.ovn-root .ovn-keys { width: min(26rem, calc(100vw - 2rem)); padding: var(--ovn-space-6); color: var(--ovn-fg); background: var(--ovn-surface-2); border: 1px solid var(--ovn-line-strong); border-radius: var(--ovn-radius-lg); box-shadow: var(--ovn-elev-3); }
.ovn-root .ovn-keys::backdrop { background: color-mix(in srgb, var(--ovn-bg) 72%, transparent); backdrop-filter: blur(2px); }
.ovn-root .ovn-keys-title { font-family: var(--ovn-font-display); font-weight: 400; font-size: var(--ovn-text-xl); }
.ovn-root .ovn-keys-list { margin-top: var(--ovn-space-5); }
.ovn-root .ovn-keys-row { display: flex; align-items: center; justify-content: space-between; gap: var(--ovn-space-5); padding: var(--ovn-space-3) 0; border-top: 1px solid var(--ovn-line); }
.ovn-root .ovn-keys-k { display: flex; gap: var(--ovn-space-2); }
.ovn-root .ovn-keys-d { font-size: var(--ovn-text-sm); color: var(--ovn-muted); }
.ovn-root .ovn-keys-form { margin-top: var(--ovn-space-5); text-align: right; }
.ovn-root .ovn-keys-close { display: inline-flex; align-items: center; gap: var(--ovn-space-3); min-height: 36px; padding: 0 var(--ovn-space-4); font: inherit; font-size: var(--ovn-text-sm); color: var(--ovn-fg); background: transparent; border: 1px solid var(--ovn-line-strong); border-radius: var(--ovn-radius-sm); cursor: pointer; }
.ovn-root .ovn-keys-close:hover { background: var(--ovn-surface-3); }

.ovn-root .ovn-index-intro { margin-top: var(--ovn-space-4); font-family: var(--ovn-font-display); font-style: italic; font-size: var(--ovn-text-xl); color: var(--ovn-muted); max-width: 30em; }
.ovn-root .ovn-latest { display: block; padding: var(--ovn-space-6) 0; border-bottom: 1px solid var(--ovn-line); }
.ovn-root .ovn-latest-label { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-latest-title { display: block; margin-top: var(--ovn-space-3); font-family: var(--ovn-font-display); font-style: italic; font-size: var(--ovn-text-xl); color: var(--ovn-muted); }
.ovn-root .ovn-latest-headline { display: block; margin-top: var(--ovn-space-3); max-width: 30em; font-family: var(--ovn-font-display); font-size: clamp(1.75rem, 4.2cqi, 2.75rem); line-height: 1.08; text-wrap: balance; overflow-wrap: anywhere; }
.ovn-root a.ovn-latest:hover .ovn-latest-headline { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 6px; text-decoration-color: var(--ovn-accent); }
.ovn-root .ovn-latest-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ovn-space-4) var(--ovn-space-6); margin-top: var(--ovn-space-5); }
.ovn-root .ovn-latest .ovn-spark-cap { max-width: 22rem; }
.ovn-root .ovn-mini { font-family: var(--ovn-font-mono); font-size: var(--ovn-text-xs); color: var(--ovn-muted); font-variant-numeric: tabular-nums; }
.ovn-root .ovn-mini-bad { color: var(--ovn-red-ink); }
.ovn-root .ovn-month { margin-top: var(--ovn-space-8); }
.ovn-root .ovn-month-h { display: flex; align-items: baseline; gap: var(--ovn-space-4); padding-bottom: var(--ovn-space-3); border-bottom: 1px solid var(--ovn-fg); font-family: var(--ovn-font-display); font-weight: 400; font-style: italic; font-size: var(--ovn-text-xl); }
.ovn-root .ovn-month-h .ovn-count { font-style: normal; font-size: var(--ovn-text-xs); }
.ovn-root .ovn-archive-item { border-bottom: 1px solid var(--ovn-line); }
.ovn-root .ovn-archive-link { display: grid; grid-template-columns: 3.25rem 1rem minmax(0, 1fr); align-items: baseline; gap: var(--ovn-space-1) var(--ovn-space-4); padding: var(--ovn-space-4) var(--ovn-space-2); transition: background-color var(--ovn-dur-fast) var(--ovn-ease); }
.ovn-root a.ovn-archive-link:hover { background: var(--ovn-surface); }
.ovn-root .ovn-archive-day { display: flex; flex-direction: column; line-height: 1; }
.ovn-root .ovn-archive-dnum { font-family: var(--ovn-font-display); font-size: var(--ovn-text-xl); }
.ovn-root .ovn-archive-wd { margin-top: var(--ovn-space-2); font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); letter-spacing: var(--ovn-tracking-caps); text-transform: uppercase; color: var(--ovn-muted); }
.ovn-root .ovn-archive-mark { align-self: center; display: flex; }
.ovn-root .ovn-archive-text { display: flex; flex-direction: column; gap: var(--ovn-space-2); min-width: 0; }
.ovn-root .ovn-archive-headline { font-size: var(--ovn-text-md); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ovn-root .ovn-index-first { margin-top: var(--ovn-space-5); font-family: var(--ovn-font-display); font-style: italic; font-size: var(--ovn-text-lg); color: var(--ovn-muted); }
.ovn-root .ovn-empty { padding: var(--ovn-space-8) 0; font-family: var(--ovn-font-display); font-style: italic; font-size: var(--ovn-text-xl); color: var(--ovn-muted); }

@container ovn (min-width: 640px) {
  .ovn-root .ovn-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .ovn-root .ovn-lane-row { grid-template-columns: minmax(8rem, 14rem) minmax(0, 1fr) 4.5rem; }
  .ovn-root .ovn-lane-row .ovn-split-mini { width: 100%; }
  .ovn-root .ovn-dateline-item + .ovn-dateline-item { padding-left: var(--ovn-space-4); border-left: 1px solid var(--ovn-line); }
  .ovn-root .ovn-page { --ovn-gutter: var(--ovn-space-7); padding-top: var(--ovn-space-6); }
  .ovn-root .ovn-proj { grid-template-columns: 3rem minmax(0, 1fr); }
  .ovn-root .ovn-proj-no { display: block; }
  .ovn-root .ovn-need { grid-template-columns: 1.25rem minmax(0, 1fr) auto; padding-left: var(--ovn-space-5); }
  .ovn-root .ovn-need-side { grid-column: 3; flex-direction: column; align-items: flex-end; gap: 0; }
  .ovn-root .ovn-need-act { min-height: 32px; }
  .ovn-root .ovn-row { grid-template-columns: 4.75rem minmax(0, 1fr) auto; }
  .ovn-root .ovn-row-meta { grid-column: 3; justify-content: flex-end; }
  .ovn-root .ovn-archive-link { grid-template-columns: 3.5rem 1rem minmax(0, 1fr) auto; }
}
@container ovn (min-width: 1080px) {
  .ovn-root .ovn-archive-text { flex-direction: row; align-items: baseline; gap: var(--ovn-space-5); }
  .ovn-root .ovn-archive-headline { flex: 1; }
  .ovn-root .ovn-mast-main .ovn-trend-overall { flex-basis: auto; flex-wrap: nowrap; }
  .ovn-root .ovn-mast-main .ovn-spark-cap { flex-direction: column; max-width: 11rem; }
  .ovn-root .ovn-lane-row { grid-template-columns: minmax(0, 1fr) 64px 4.5rem; }
  .ovn-root .ovn-lane-row .ovn-split-mini { width: 64px; }
  .ovn-root .ovn-body { display: grid; grid-template-columns: minmax(0, 1fr) 19rem; column-gap: var(--ovn-space-10); row-gap: 0; align-items: start; }
  .ovn-root .ovn-body > * { grid-column: 1; margin-bottom: var(--ovn-space-8); }
  .ovn-root .ovn-rail { display: flex; flex-direction: column; gap: var(--ovn-space-8); grid-column: 2; grid-row: 1 / span 4; position: sticky; top: var(--ovn-space-6); padding-left: var(--ovn-space-7); border-left: 1px solid var(--ovn-line); }
  .ovn-root .ovn-stats { grid-template-columns: 1fr 1fr; }
  .ovn-root .ovn-agents-lede { font-size: var(--ovn-text-lg); }
}

@keyframes ovn-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  .ovn-root .ovn-mast, .ovn-root .ovn-lead, .ovn-root .ovn-numbers, .ovn-root .ovn-needs, .ovn-root .ovn-agents, .ovn-root .ovn-projects, .ovn-root .ovn-proj, .ovn-root .ovn-need, .ovn-root .ovn-latest, .ovn-root .ovn-month { animation: ovn-rise var(--ovn-dur-slow) var(--ovn-ease) both; }
  .ovn-root .ovn-lead { animation-delay: 60ms; }
  .ovn-root .ovn-numbers { animation-delay: 140ms; }
  .ovn-root .ovn-needs, .ovn-root .ovn-latest { animation-delay: 180ms; }
  .ovn-root .ovn-agents { animation-delay: 220ms; }
  .ovn-root .ovn-projects, .ovn-root .ovn-month { animation-delay: 260ms; }
  .ovn-root .ovn-need:nth-child(2), .ovn-root .ovn-proj:nth-child(2) { animation-delay: 300ms; }
  .ovn-root .ovn-need:nth-child(3), .ovn-root .ovn-proj:nth-child(3) { animation-delay: 340ms; }
  .ovn-root .ovn-need:nth-child(4), .ovn-root .ovn-proj:nth-child(4) { animation-delay: 380ms; }
  .ovn-root .ovn-need:nth-child(n + 5), .ovn-root .ovn-proj:nth-child(n + 5) { animation-delay: 420ms; }
}
@media (prefers-reduced-motion: reduce) {
  .ovn-root *, .ovn-root *::before, .ovn-root *::after { transition-duration: 0ms; animation: none; scroll-behavior: auto; }
}
@media print {
  .ovn-root *, .ovn-root *::before { animation: none; }
  .ovn-root { background-image: none; --ovn-bg: Canvas; --ovn-fg: CanvasText; --ovn-muted: CanvasText; --ovn-line: GrayText; --ovn-line-strong: GrayText; color-scheme: light; container-type: normal; }
  .ovn-root .ovn-nav, .ovn-root .ovn-hints, .ovn-root .ovn-keys, .ovn-root .ovn-need-act { display: none; }
  .ovn-root .ovn-mast-main .ovn-trend { display: none; }
  .ovn-root .ovn-proj, .ovn-root .ovn-need, .ovn-root .ovn-stat { break-inside: avoid; }
  .ovn-root .ovn-rail { display: contents; }
  .ovn-root .ovn-needs a[href].ovn-need-title::after { content: " (" attr(href) ")"; font-family: var(--ovn-font-mono); font-size: var(--ovn-text-2xs); font-weight: 400; overflow-wrap: anywhere; }
  .ovn-root details > :not(summary) { display: block; }
}
`.trim();

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Embeddable digest HTML: no <html>/<head>, all classes prefixed `ovn-`, style with DIGEST_CSS. */
export function renderDigestFragment(d: Digest, opts: FragmentOptions = {}): string {
  return renderDigestInner(d, {
    page: false,
    ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
    ...(opts.history ? { history: opts.history } : {}),
    ...(opts.edition !== undefined ? { edition: opts.edition } : {}),
  });
}

/**
 * Page shell only (never part of the fragment): metric-matched local fallbacks so the swap to the
 * Halyard web fonts does not shift layout, plus scrollbar + selection styling.
 */
const PAGE_CSS = `
@font-face { font-family: 'Instrument Serif Fallback'; src: local('Times New Roman'), local('TimesNewRomanPSMT'), local('Georgia'); size-adjust: 87%; ascent-override: 98%; descent-override: 26%; line-gap-override: 0%; }
@font-face { font-family: 'Schibsted Grotesk Fallback'; src: local('Helvetica Neue'), local('Helvetica'), local('Liberation Sans'); size-adjust: 101%; ascent-override: 96%; descent-override: 25%; line-gap-override: 0%; }
@font-face { font-family: 'IBM Plex Mono Fallback'; src: local('Courier New'), local('Menlo'); size-adjust: 100%; ascent-override: 102%; descent-override: 27%; line-gap-override: 0%; }
:root { --fl-font-display: 'Instrument Serif', 'Instrument Serif Fallback', 'Iowan Old Style', Georgia, serif; --fl-font-sans: 'Schibsted Grotesk', 'Schibsted Grotesk Fallback', ui-sans-serif, system-ui, -apple-system, sans-serif; --fl-font-mono: 'IBM Plex Mono', 'IBM Plex Mono Fallback', ui-monospace, 'SF Mono', Menlo, monospace; }
html { background: var(--fl-bg); scrollbar-color: var(--fl-border-strong) var(--fl-bg); scrollbar-gutter: stable; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--fl-bg); color: var(--fl-fg); }
body > .ovn-root { min-height: 100vh; }
::selection { background: var(--fl-accent); color: var(--fl-accent-fg); }
@media print { html, body { background: Canvas; } }
`.trim();

function page(title: string, description: string, body: string, baseHref?: string): string {
  const base = baseHref ? `\n<base href="${safeHref(baseHref)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="description" content="${escapeHtml(description)}">${base}
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${safeUrl(HALYARD_FONT_URL)}">
<style>${HALYARD_TOKENS_CSS}
${PAGE_CSS}
${DIGEST_CSS}</style>
</head>
<body>
${body}
<script>${DIGEST_SCRIPT}</script>
</body>
</html>
`;
}

export function renderDigestHtml(d: Digest, opts: DigestHtmlOptions): string {
  const title = `${opts.siteTitle} — ${longDate(d.id)}`;
  const inner = renderDigestInner(d, {
    page: true,
    siteTitle: opts.siteTitle,
    ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
    ...(opts.nav ? { nav: opts.nav } : {}),
    ...(opts.history ? { history: opts.history } : {}),
    ...(opts.edition !== undefined ? { edition: opts.edition } : {}),
  });
  return page(title, d.headline, inner, opts.baseHref);
}

type IndexEntryLike = DigestIndex['digests'][number];

function miniTotals(t: DigestTotals): string {
  const parts = [
    plural(int(t.mergedPRs), 'PR'),
    plural(int(t.commits), 'commit'),
    plural(int(t.releases), 'release'),
    plural(int(t.deployments), 'deploy'),
  ];
  const ci = int(t.ciFailures);
  const bad = ci > 0 ? ` <span class="ovn-mini-bad">${escapeHtml(plural(ci, 'CI failure'))}</span>` : '';
  return `<span class="ovn-mini">${escapeHtml(parts.join(' · '))}${bad}</span>`;
}

/** Worst state derivable from an index entry's totals alone (no per-project data in the index). */
/** Activity from index totals; issues count, so an issue-only night is not "No activity". */
function entryActivity(t: DigestTotals): number {
  return (
    int(t.mergedPRs) +
    int(t.commits) +
    int(t.releases) +
    int(t.deployments) +
    int(t.issuesOpened) +
    int(t.issuesClosed)
  );
}

function entryHealth(t: DigestTotals): { h: Health; label: string } {
  if (int(t.ciFailures) > 0 || int(t.deploymentsFailed) > 0) return { h: 'red', label: 'Failures overnight' };
  if (int(t.openPRsNeedingAttention) > 0) return { h: 'yellow', label: 'Items needed you' };
  return entryActivity(t) > 0
    ? { h: 'green', label: 'Activity, no failures' }
    : { h: 'quiet', label: 'No activity' };
}

function entrySeries(entries: IndexEntryLike[], endId: string): SparkPoint[] | undefined {
  const days = lastDays(endId, SPARK_DAYS);
  if (!days) return undefined;
  const byId = new Map(entries.map((e) => [e.id, e]));
  return days.map((k) => {
    const e = byId.get(k);
    if (!e || typeof e.totals !== 'object' || e.totals === null) return { v: null, red: false };
    const t = e.totals;
    return {
      v: entryActivity(t),
      red: entryHealth(t).h === 'red',
    };
  });
}

export function renderIndexHtml(index: DigestIndex, opts: IndexHtmlOptions): string {
  const entries = [...index.digests].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const latestEntry = opts.latest ? entries.find((e) => e.id === opts.latest?.id) : entries[0];
  const latestId = opts.latest?.id ?? latestEntry?.id;
  const latestHeadline = opts.latest?.headline ?? latestEntry?.headline ?? '';
  const latestHref = latestEntry?.path ?? (latestId ? `digests/${latestId}.html` : undefined);
  const latestTotals = opts.latest?.totals ?? latestEntry?.totals;
  const series = latestId ? entrySeries(entries, latestId) : undefined;
  const trend = series ? sparkBlock(series, 'overall') : '';
  const latestCard =
    latestId && latestHref
      ? `<a class="ovn-latest" href="${safeHref(latestHref)}" data-ovn-row=""><span class="ovn-latest-label">Latest edition</span><span class="ovn-latest-title">${escapeHtml(longDate(latestId))}</span><span class="ovn-latest-headline">${escapeHtml(latestHeadline)}</span></a><div class="ovn-latest-meta">${latestTotals ? miniTotals(latestTotals) : ''}${trend}</div>`
      : '';
  const owner = str(index.owner);
  const mast = `<header class="ovn-mast"><div class="ovn-mast-bar"><span class="ovn-wordmark">${escapeHtml(opts.siteTitle)}</span><span class="ovn-edition">${escapeHtml(plural(entries.length, 'edition'))}</span></div><div class="ovn-mast-main"><h1 class="ovn-date"><em class="ovn-weekday">Back</em> issues</h1></div><p class="ovn-dateline">${owner ? `<span class="ovn-dateline-item">${escapeHtml(owner)}</span>` : ''}<span class="ovn-dateline-item">One edition each morning</span></p></header>`;

  const months: Array<{ label: string; items: typeof entries }> = [];
  for (const e of entries) {
    const label = monthLabel(e.id);
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(e);
    else months.push({ label, items: [e] });
  }
  const row = (e: IndexEntryLike) => {
    const valid = ID_RE.test(e.id);
    const dnum = valid ? String(Number(e.id.slice(8, 10))) : '';
    const wd = valid ? (shortDate(e.id).split(' ')[0] ?? '') : str(e.id);
    const eh =
      typeof e.totals === 'object' && e.totals !== null
        ? entryHealth(e.totals)
        : { h: 'quiet' as const, label: 'No activity' };
    return `<li class="ovn-archive-item"><a class="ovn-archive-link" href="${safeHref(e.path)}" data-ovn-row=""><span class="ovn-archive-day"><span class="ovn-archive-dnum">${escapeHtml(dnum)}</span><span class="ovn-archive-wd">${escapeHtml(wd)}</span></span><span class="ovn-archive-mark" role="img" aria-label="${escapeHtml(eh.label)}" title="${escapeHtml(eh.label)}">${shape(eh.h)}</span><span class="ovn-archive-text"><span class="ovn-archive-headline">${escapeHtml(e.headline)}</span>${typeof e.totals === 'object' && e.totals !== null ? miniTotals(e.totals) : ''}</span></a></li>`;
  };
  const archive = months.length
    ? months
        .map(
          (m, i) =>
            `<section class="ovn-month" aria-labelledby="ovn-month-${i}"><h2 class="ovn-month-h" id="ovn-month-${i}">${escapeHtml(m.label)} <span class="ovn-count">${escapeHtml(fmtInt(m.items.length))}</span></h2><ul class="ovn-archive">${m.items.map(row).join('')}</ul></section>`,
        )
        .join('')
    : '<p class="ovn-empty">No editions yet. The first appears after the next morning run.</p>';
  const first =
    entries.length === 1
      ? '<p class="ovn-index-first">Earlier editions will appear here. Each morning adds one, and the trend fills in over fourteen nights.</p>'
      : '';
  const updated = parseDate(index.updatedAt);
  const { tz } = resolveTimeZone(opts.timezone);
  const footer = `<footer class="ovn-colophon"><dl class="ovn-colo"><div class="ovn-colo-item"><dt class="ovn-colo-k">Updated</dt><dd class="ovn-colo-v">${escapeHtml(updated ? `${shortDay(updated, tz)} ${clock(updated, tz)} ${tz}` : '—')}</dd></div><div class="ovn-colo-item"><dt class="ovn-colo-k">Editions</dt><dd class="ovn-colo-v">${escapeHtml(fmtInt(entries.length))}</dd></div></dl>${KBD_HINTS}</footer>`;
  const body = `<div class="ovn-root"><div class="ovn-page">${mast}${latestCard}${first}${archive}${footer}</div>${KEYS_DIALOG}</div>`;
  return page(opts.siteTitle, `${opts.siteTitle} — daily digest archive for ${owner}`, body);
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

/**
 * Structural check for stored history: enough shape that the renderer can read it without throwing
 * (window bounds, headline, numeric totals, project objects). Anything else is skipped as corrupt.
 */
function looksLikeDigest(x: unknown): x is Digest {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Partial<Record<keyof Digest, unknown>>;
  const win = d.window as Partial<Record<'since' | 'until', unknown>> | null | undefined;
  const totals = d.totals as Record<string, unknown> | null | undefined;
  return (
    d.schema === 'overnight.digest/v1' &&
    typeof d.id === 'string' &&
    typeof d.headline === 'string' &&
    typeof win === 'object' &&
    win !== null &&
    typeof win.since === 'string' &&
    typeof win.until === 'string' &&
    typeof totals === 'object' &&
    totals !== null &&
    !Array.isArray(totals) &&
    Object.values(totals).every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Array.isArray(d.projects) &&
    d.projects.every((p) => typeof p === 'object' && p !== null) &&
    (d.warnings === undefined || Array.isArray(d.warnings))
  );
}

/**
 * Loads earlier digests from `<out>/digests/<id>.json` for trend lines: only the days inside a
 * page's 14-night window, each file read at most once. History is decoration, so an unreadable or
 * invalid file is skipped with a warning instead of blocking the archive (the current digest and
 * the index stay strictly validated).
 */
async function historyLoader(
  digestsDir: string,
  current: Digest,
  warn: (msg: string) => void,
): Promise<(id: string) => Promise<Digest[]>> {
  const stored = new Set(
    (await readdir(digestsDir))
      .map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1])
      .filter((x): x is string => typeof x === 'string'),
  );
  const cache = new Map<string, Digest | undefined>([[current.id, current]]);
  return async (id: string) => {
    const out: Digest[] = [];
    const window = (lastDays(id, SPARK_DAYS) ?? []).filter((k) => k < id && stored.has(k));
    for (const pid of window) {
      if (!cache.has(pid)) {
        cache.set(pid, await readStoredDigest(digestsDir, pid, warn, 'skipped in trend lines'));
      }
      const hd = cache.get(pid);
      if (hd) out.push(hd);
    }
    return out;
  };
}

/**
 * A stored historical digest, or undefined when it is missing or unreadable. Unreadable files are
 * reported through `warn` so one corrupt old day never blocks publishing today's edition.
 */
async function readStoredDigest(
  digestsDir: string,
  id: string,
  warn: (msg: string) => void,
  consequence: string,
): Promise<Digest | undefined> {
  const path = join(digestsDir, `${id}.json`);
  try {
    const raw = await readJsonIfExists(path);
    if (raw === undefined) return undefined;
    if (looksLikeDigest(raw) && raw.id === id) return raw;
    warn(`overnight: ${path} is not a valid digest; ${consequence}`);
  } catch (e) {
    warn(`overnight: ${path} could not be read (${(e as Error).message}); ${consequence}`);
  }
  return undefined;
}

function editionOf(sorted: IndexEntry[], id: string): number {
  return sorted.filter((e) => e.id <= id).length;
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
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));
  const historyFor = await historyLoader(digestsDir, d, warn);
  await write(
    join(digestsDir, `${d.id}.html`),
    renderDigestHtml(d, {
      ...renderOpts,
      nav: navFor(sorted, d.id),
      history: await historyFor(d.id),
      edition: editionOf(sorted, d.id),
    }),
  );

  // Re-render direct neighbours so their prev/next links include this digest.
  const pos = sorted.findIndex((e) => e.id === d.id);
  for (const neighbour of [sorted[pos - 1], sorted[pos + 1]]) {
    if (!neighbour) continue;
    const nd = await readStoredDigest(digestsDir, neighbour.id, warn, 'kept its old page');
    if (nd === undefined) continue; // missing or unreadable stored JSON: nothing to re-render from
    let html: string;
    try {
      html = renderDigestHtml(nd, {
        ...renderOpts,
        nav: navFor(sorted, neighbour.id),
        history: await historyFor(neighbour.id),
        edition: editionOf(sorted, neighbour.id),
      });
    } catch (e) {
      // A neighbour is decoration for today's edition: never let an odd old file block publishing.
      warn(
        `overnight: ${join(digestsDir, `${neighbour.id}.json`)} could not be rendered (${(e as Error).message}); kept its old page`,
      );
      continue;
    }
    await write(join(digestsDir, `${neighbour.id}.html`), html);
  }

  // latest.json only ever moves forward (a backfill of an older day must not replace it).
  const isNewest = sorted[0]?.id === d.id;
  let latest: Digest | undefined = d;
  if (isNewest) {
    await write(join(outDir, 'latest.json'), JSON.stringify(d, null, 2) + '\n');
  } else {
    const newest = sorted[0];
    latest = newest
      ? await readStoredDigest(digestsDir, newest.id, warn, 'index shows no latest card')
      : undefined;
  }

  await write(indexPath, JSON.stringify(index, null, 2) + '\n');
  await write(
    join(outDir, 'index.html'),
    renderIndexHtml(index, { ...renderOpts, ...(latest ? { latest } : {}) }),
  );
  await write(join(outDir, 'styles.css'), DIGEST_CSS + '\n');
  return written;
}
