import type { FleetEvent } from '@fleet/shared';

export interface TimelineGroup {
  /** stable key: the task id, or '' for events not tied to a task */
  key: string;
  /** task id as written ("t04"), or null for events not tied to a task */
  task: string | null;
  /** oldest first */
  events: FleetEvent[];
}

/** Sequence suffix of an event id (`${ts}-${seq}`); NaN when the id has another shape. */
function seqOf(id: string): number {
  const match = /-(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.NaN;
}

/** Chronological order: timestamp, then the id's sequence number, then the id itself (total and stable). */
export function compareEvents(a: FleetEvent, b: FleetEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  const sa = seqOf(a.id);
  const sb = seqOf(b.id);
  if (!Number.isNaN(sa) && !Number.isNaN(sb) && sa !== sb) return sa - sb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Drawer timeline: events grouped by task, each group oldest first, groups ordered by their first
 * event, so the list reads top to bottom in time. Events without a task form their own group.
 */
export function timelineGroups(events: readonly FleetEvent[]): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();
  for (const event of [...events].sort(compareEvents)) {
    const key = event.taskId ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { key, task: event.taskId ?? null, events: [] };
      groups.set(key, group);
    }
    group.events.push(event);
  }
  return [...groups.values()];
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Local wall-clock time with seconds, "HH:MM:SS", so events in the same minute stay distinct. */
export function eventClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Gap from the previous event, "+0s", "+42s", "+3m", "+2h"; floors, never negative. */
export function eventDelta(at: number, previous: number): string {
  const seconds = Math.max(0, Math.floor((at - previous) / 1000));
  if (seconds < 60) return `+${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `+${minutes}m`;
  return `+${Math.floor(minutes / 60)}h`;
}

export interface TimelineRow {
  event: FleetEvent;
  /** what the time column shows: the clock for a group's first event, else the gap ("+2s") */
  time: string;
  /** events in this row's same-second run, counting itself (1 when it stands alone); 0 on followers */
  run: number;
  /** happened within the same second as the row before, so it joins that row's run with no time */
  follows: boolean;
}

/**
 * One task group's rows, oldest first. Several events often land in the same second (an agent moves,
 * then calls a tool); rather than a column of "+0s", a run like that shows its time once, on its first
 * row, and the rest of the run follows it with no time of their own.
 */
export function timelineRows(events: readonly FleetEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let head: TimelineRow | undefined;
  events.forEach((event, index) => {
    const previous = index > 0 ? events[index - 1] : undefined;
    if (head && previous && Math.floor((event.ts - previous.ts) / 1000) <= 0) {
      head.run++;
      rows.push({ event, time: '', run: 0, follows: true });
      return;
    }
    head = {
      event,
      time: previous ? eventDelta(event.ts, previous.ts) : eventClock(event.ts),
      run: 1,
      follows: false,
    };
    rows.push(head);
  });
  return rows;
}
