import type { FleetEvent, FleetSnapshot, HistoryResponse, Severity } from '@fleet/shared';

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

/** Event kinds that mean a person is needed (the orange notches). */
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

function episodeKey(event: FleetEvent): string {
  if (event.sessionId) return `s:${event.sessionId}`;
  if (event.agentId) return `a:${event.agentId}`;
  return `p:${event.projectId}`;
}

/**
 * Needs-you episodes in a (normalized) history. An episode opens on session.waiting / blocked and
 * closes on the next event from the same session (else agent, else project) that is not itself a
 * needs-you event. Repeated waiting events inside an open episode extend it, they do not start a new one.
 */
export function needsYouMoments(history: HistoryResponse): NeedsYouMoment[] {
  const out: NeedsYouMoment[] = [];
  const open = new Map<string, NeedsYouMoment>();
  for (const event of history.events) {
    if (event.ts < history.from || event.ts > history.to) continue;
    if (NEEDS_KINDS.has(event.kind)) {
      const key = episodeKey(event);
      if (!open.has(key)) {
        const moment = { ts: event.ts, end: history.to, projectId: event.projectId, open: true };
        open.set(key, moment);
        out.push(moment);
      }
      continue;
    }
    if (open.size === 0) continue;
    for (const key of [
      event.sessionId ? `s:${event.sessionId}` : null,
      event.agentId ? `a:${event.agentId}` : null,
      `p:${event.projectId}`,
    ]) {
      const moment = key ? open.get(key) : undefined;
      if (!moment) continue;
      moment.end = event.ts;
      moment.open = false;
      open.delete(key!);
    }
  }
  return out;
}

/**
 * Bucket a history into `columns` severity-coloured ticks and needs-you notches. Notches closer than
 * 1/`notchSlots` of the window merge (the longest wait names the notch), so a busy stretch reads as a
 * comb rather than a solid bar and Shift-stepping always moves visibly. Deterministic: depends only on
 * the history.
 */
export function buildTimeline(history: HistoryResponse, columns = 120, notchSlots = 48): TimelineModel {
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
  for (const moment of span > 0 ? needsYouMoments(history) : []) {
    const waitedMs = moment.end - moment.ts;
    const last = notches.at(-1);
    if (last && moment.ts - last.ts < width) {
      last.count++;
      if (waitedMs > last.waitedMs) {
        last.waitedMs = waitedMs;
        last.projectId = moment.projectId;
        last.projectName = names.get(moment.projectId) ?? moment.projectId;
        last.open = moment.open;
      }
      continue;
    }
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
