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

export function reconstruct(
  history: HistoryResponse,
  at: number,
): {
  snapshot: FleetSnapshot | null;
  events: FleetEvent[];
} {
  let snapshot: FleetSnapshot | null = null;
  for (const frame of history.frames) {
    if (frame.generatedAt <= at && (!snapshot || frame.generatedAt >= snapshot.generatedAt)) {
      snapshot = frame;
    }
  }
  return {
    snapshot,
    events: history.events
      .filter((event) => event.ts <= at)
      .sort((a, b) => a.ts - b.ts)
      .slice(-300),
  };
}

export function eventsCrossed(history: HistoryResponse, from: number, to: number): FleetEvent[] {
  if (to <= from) return [];
  return history.events.filter((event) => event.ts > from && event.ts <= to).sort((a, b) => a.ts - b.ts);
}
