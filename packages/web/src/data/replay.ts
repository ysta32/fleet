import type { FleetEvent, FleetSnapshot, HistoryResponse, Severity } from '@fleet/shared';
import { incidents } from '../dashboard/model';

export function normalizeHistory(history: HistoryResponse): HistoryResponse {
  return {
    ...history,
    frames: [...history.frames].sort((a, b) => a.generatedAt - b.generatedAt),
    events: [...history.events].sort((a, b) => a.ts - b.ts),
  };
}

export function clampPlayhead(history: HistoryResponse, at: number): number {
  return Math.max(history.from, Math.min(history.to, at));
}

export function advancePlayhead(history: HistoryResponse, at: number, delta: number, speed: number): number {
  return clampPlayhead(history, at + Math.max(0, Math.min(delta, 100)) * speed);
}

function upperBound<T>(entries: T[], at: number, timestamp: (entry: T) => number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (timestamp(entries[mid]) <= at) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function reconstruct(
  history: HistoryResponse,
  at: number,
): {
  snapshot: FleetSnapshot | null;
  events: FleetEvent[];
} {
  const frameEnd = upperBound(history.frames, at, (frame) => frame.generatedAt);
  const eventEnd = upperBound(history.events, at, (event) => event.ts);
  const frame = history.frames[Math.max(0, frameEnd - 1)] ?? null;
  return {
    // before the first frame the earliest frame stands in; it must not leak alerts from after the playhead
    snapshot:
      frame && frame.generatedAt > at && frame.alerts.some((alert) => alert.at > at)
        ? { ...frame, alerts: frame.alerts.filter((alert) => alert.at <= at) }
        : frame,
    events: history.events.slice(Math.max(0, eventEnd - 300), eventEnd),
  };
}

export function eventsCrossed(history: HistoryResponse, from: number, to: number): FleetEvent[] {
  if (to <= from) return [];
  const start = upperBound(history.events, from, (event) => event.ts);
  const end = upperBound(history.events, to, (event) => event.ts);
  return history.events.slice(start, end);
}

/* ---------------- replay tape deck: timeline model ---------------- */

/** Event kinds that mean a person is needed (event-level moments; the notches read incidents). */
const NEEDS_KINDS: ReadonlySet<FleetEvent['kind']> = new Set(['session.waiting', 'blocked']);
/** Pure motion; drawn by the scene, too frequent to be a tick. */
const SILENT_KINDS: ReadonlySet<FleetEvent['kind']> = new Set(['agent.move']);
const SEVERITY_RANK: Record<Severity, number> = { info: 0, success: 1, warn: 2, error: 3 };

export interface TimelineBucket {
  /** events in the bucket (agent.move excluded) */
  count: number;
  /** most severe event in the bucket; null when empty */
  severity: Severity | null;
}

/** One needs-you episode: from the first waiting/blocked event until that session (or agent) moves on. */
export interface NeedsYouMoment {
  ts: number;
  /** when work resumed; `history.to` if it never did inside the window */
  end: number;
  projectId: string;
  /** still waiting at the end of the window */
  open: boolean;
}

/** A notch on the tape: one or more needs-you moments close enough to share a pixel column. */
export interface TimelineNotch {
  ts: number;
  projectId: string;
  projectName: string;
  /** longest wait among the merged moments, ms */
  waitedMs: number;
  open: boolean;
  /** merged moments */
  count: number;
}

export interface TimelineModel {
  from: number;
  to: number;
  buckets: TimelineBucket[];
  /** largest bucket count (>= 1) */
  max: number;
  notches: TimelineNotch[];
}

/**
 * Episode key for a needs-you event. A blocked event naming a task is that task's episode (the collector
 * emits task blocks with no session or agent); waits are keyed by session, else agent, else project.
 */
function episodeKey(event: FleetEvent): string {
  if (event.kind === 'blocked' && event.taskId) return `t:${event.projectId}/${event.taskId}`;
  if (event.sessionId) return `s:${event.sessionId}`;
  if (event.agentId) return `a:${event.agentId}`;
  return `p:${event.projectId}`;
}

/** Keys an ordinary event can close: its session, agent, project (id-less events) and unblocked task. */
function closingKeys(event: FleetEvent): string[] {
  const keys: string[] = [];
  if (event.sessionId) keys.push(`s:${event.sessionId}`);
  if (event.agentId) keys.push(`a:${event.agentId}`);
  keys.push(`p:${event.projectId}`);
  // a task's block ends only when that task's state leaves blocked
  if (event.kind === 'task.state' && event.taskId && event.data?.state !== 'blocked')
    keys.push(`t:${event.projectId}/${event.taskId}`);
  return keys;
}

interface OpenEpisode {
  moment: NeedsYouMoment;
  /** keys still holding this moment open (a wait and a block raised together share one moment) */
  holders: number;
}

/**
 * Needs-you episodes in a (normalized) history. A session wait opens on session.waiting and closes on
 * the next non-needs event from that session (else agent, else project). A task block opens on
 * `blocked` and closes only when that task's state moves off blocked. Repeats inside an open episode
 * extend it; a wait and a block raised in the same project at the same instant are one moment, which
 * ends when the last of them resolves.
 */
export function needsYouMoments(history: HistoryResponse): NeedsYouMoment[] {
  const out: NeedsYouMoment[] = [];
  const open = new Map<string, OpenEpisode>();
  let latest: { ts: number; projectId: string; episode: OpenEpisode } | null = null;
  const close = (key: string, ts: number) => {
    const episode = open.get(key);
    if (!episode) return;
    open.delete(key);
    episode.moment.end = ts;
    if (--episode.holders === 0) episode.moment.open = false;
  };
  for (const event of history.events) {
    if (event.ts < history.from || event.ts > history.to) continue;
    if (NEEDS_KINDS.has(event.kind)) {
      const key = episodeKey(event);
      if (open.has(key)) continue;
      let episode: OpenEpisode;
      if (
        latest &&
        latest.ts === event.ts &&
        latest.projectId === event.projectId &&
        latest.episode.holders > 0
      ) {
        episode = latest.episode;
        episode.holders++;
        episode.moment.end = history.to;
        episode.moment.open = true;
      } else {
        episode = {
          moment: { ts: event.ts, end: history.to, projectId: event.projectId, open: true },
          holders: 1,
        };
        out.push(episode.moment);
      }
      open.set(key, episode);
      latest = { ts: event.ts, projectId: event.projectId, episode };
      continue;
    }
    if (open.size === 0) continue;
    for (const key of closingKeys(event)) close(key, event.ts);
  }
  // a moment still held by any key is open at the window end
  for (const episode of open.values()) {
    episode.moment.end = history.to;
    episode.moment.open = true;
  }
  return out;
}

const NO_DISMISSALS: ReadonlySet<string> = new Set();

/** One incident's span on the tape, read from the history's frames with the dashboard's incidents(). */
export interface IncidentMoment extends NeedsYouMoment {
  /** the incident id (see `incidents`) */
  id: string;
  /** when its oldest signal fired; `ts` is when the history first shows it (<= one frame later) */
  since: number;
}

/**
 * Incidents over a (normalized) history: the same incidents() list the Overview, Alerts, nav badge and
 * stations read, evaluated on every frame. A moment starts at the first frame that lists the incident
 * (seeking there shows it), ends at the first later frame that no longer lists it, and is open when the
 * last frame at or before `to` still lists it. Incidents already open before `from` start at `from`.
 */
export function incidentMoments(
  history: HistoryResponse,
  dismissed: ReadonlySet<string> = NO_DISMISSALS,
): IncidentMoment[] {
  const out: IncidentMoment[] = [];
  const open = new Map<string, IncidentMoment>();
  for (const frame of history.frames) {
    if (frame.generatedAt > history.to) break;
    const listed = new Set<string>();
    for (const incident of incidents(frame, dismissed)) {
      listed.add(incident.id);
      if (open.has(incident.id)) continue;
      const moment: IncidentMoment = {
        id: incident.id,
        ts: frame.generatedAt,
        since: Math.min(incident.at, frame.generatedAt),
        end: history.to,
        projectId: incident.projectId,
        open: true,
      };
      open.set(incident.id, moment);
      out.push(moment);
    }
    for (const [id, moment] of open) {
      if (listed.has(id)) continue;
      moment.end = frame.generatedAt;
      moment.open = false;
      open.delete(id);
    }
  }
  return (
    out
      // a span that closed at or before the window start is not on this tape
      .filter((moment) => (moment.open || moment.end > history.from) && moment.ts <= history.to)
      .map((moment) => (moment.ts < history.from ? { ...moment, ts: history.from } : moment))
  );
}

/** Incident ids still open at the end of the history (what the dashboard lists at `to`). */
export function openIncidentIds(
  history: HistoryResponse,
  dismissed: ReadonlySet<string> = NO_DISMISSALS,
): string[] {
  return incidentMoments(history, dismissed)
    .filter((moment) => moment.open)
    .map((moment) => moment.id);
}

/**
 * Bucket a history into `columns` severity-coloured ticks and needs-you notches (one per incident from
 * `incidentMoments`, so the tape agrees with the Alerts list at every playhead). Notches closer than
 * 1/`notchSlots` of the window merge (the longest wait names the notch), so a busy stretch reads as a
 * comb rather than a solid bar and Shift-stepping always moves visibly. Deterministic: depends only on
 * the history.
 */
export function buildTimeline(
  history: HistoryResponse,
  columns = 120,
  notchSlots = 48,
  /** alerts the operator cleared: their incidents leave the tape as they leave the Alerts list */
  dismissed: ReadonlySet<string> = NO_DISMISSALS,
): TimelineModel {
  const span = history.to - history.from;
  const n = Math.max(1, Math.floor(columns));
  const buckets: TimelineBucket[] = Array.from({ length: n }, () => ({ count: 0, severity: null }));
  const column = (ts: number) => Math.min(n - 1, Math.max(0, Math.floor(((ts - history.from) / span) * n)));
  if (span > 0) {
    for (const event of history.events) {
      if (event.ts < history.from || event.ts > history.to || SILENT_KINDS.has(event.kind)) continue;
      const bucket = buckets[column(event.ts)]!;
      bucket.count++;
      if (bucket.severity === null || SEVERITY_RANK[event.severity] > SEVERITY_RANK[bucket.severity])
        bucket.severity = event.severity;
    }
  }
  const names = new Map<string, string>();
  for (const frame of history.frames)
    for (const project of frame.projects) names.set(project.id, project.name);
  const notches: TimelineNotch[] = [];
  const width = span > 0 ? span / Math.max(1, notchSlots) : Infinity;
  /** first moment of the current cluster: clusters never chain wider than one slot */
  let clusterStart = -Infinity;
  for (const moment of span > 0 ? incidentMoments(history, dismissed) : []) {
    const waitedMs = moment.end - moment.since;
    const last = notches.at(-1);
    if (last && moment.ts - clusterStart < width) {
      last.count++;
      if (waitedMs > last.waitedMs) {
        // the notch sits where the named wait began, so stepping never lands before it
        last.ts = moment.ts;
        last.waitedMs = waitedMs;
        last.projectId = moment.projectId;
        last.projectName = names.get(moment.projectId) ?? moment.projectId;
        last.open = moment.open;
      }
      continue;
    }
    clusterStart = moment.ts;
    notches.push({
      ts: moment.ts,
      projectId: moment.projectId,
      projectName: names.get(moment.projectId) ?? moment.projectId,
      waitedMs,
      open: moment.open,
      count: 1,
    });
  }
  return {
    from: history.from,
    to: history.to,
    buckets,
    max: Math.max(1, ...buckets.map((bucket) => bucket.count)),
    notches,
  };
}

/** The next notch strictly after (direction 1) or before (-1) the playhead, if any. */
export function stepNotch(
  notches: readonly TimelineNotch[],
  at: number,
  direction: 1 | -1,
): TimelineNotch | undefined {
  if (direction > 0) return notches.find((notch) => notch.ts > at);
  for (let index = notches.length - 1; index >= 0; index--)
    if (notches[index]!.ts < at) return notches[index];
  return undefined;
}

/** The notch nearest the playhead within `tolerance` ms (Shift-drag snapping). */
export function nearestNotch(
  notches: readonly TimelineNotch[],
  at: number,
  tolerance: number,
): TimelineNotch | undefined {
  let best: TimelineNotch | undefined;
  for (const notch of notches) {
    const distance = Math.abs(notch.ts - at);
    if (distance <= tolerance && (!best || distance < Math.abs(best.ts - at))) best = notch;
  }
  return best;
}

/** "40s", "12m", "2h 05m": how long a needs-you moment waited. */
export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Micro-toast copy for a notch: "helix-db waited 40m here". */
export function notchMessage(notch: TimelineNotch): string {
  const more = notch.count > 1 ? ` (+${notch.count - 1} more)` : '';
  const plus = notch.open ? '+' : '';
  return `${notch.projectName} waited ${formatWait(notch.waitedMs)}${plus} here${more}`;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** 24h wall clock "17:31" in the viewer's time zone. */
export function formatClock(at: number): string {
  return CLOCK.format(at);
}
