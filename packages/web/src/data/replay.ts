import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';

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
  return {
    snapshot: history.frames[Math.max(0, frameEnd - 1)] ?? null,
    events: history.events.slice(Math.max(0, eventEnd - 300), eventEnd),
  };
}

export function eventsCrossed(history: HistoryResponse, from: number, to: number): FleetEvent[] {
  if (to <= from) return [];
  const start = upperBound(history.events, from, (event) => event.ts);
  const end = upperBound(history.events, to, (event) => event.ts);
  return history.events.slice(start, end);
}
