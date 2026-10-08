/**
 * FROZEN web-internal contract (task 11 implements useFleet; 12/13/14/18 consume).
 */
import type { FleetEvent, FleetSnapshot, HistoryResponse } from '@fleet/shared';

export type FleetMode = 'live' | 'demo' | 'replay';

export interface ReplayControls {
  /** available window, epoch ms */
  from: number;
  to: number;
  /** current playhead, epoch ms */
  at: number;
  playing: boolean;
  /** 1, 4, 16, 60 */
  speed: number;
  seek(at: number): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  /** the loaded history while replaying (timeline ticks and notches); null/absent when live */
  history?: HistoryResponse | null;
  /** load an arbitrary history (e.g. the overnight window) and enter replay mode */
  load(h: HistoryResponse): void;
  exit(): void;
}

export interface FleetView {
  mode: FleetMode;
  connected: boolean;
  /** current state (live, demo, or reconstructed at the replay playhead) */
  snapshot: FleetSnapshot | null;
  /** most recent events, newest last, max 300; in replay mode events up to the playhead */
  events: FleetEvent[];
  /** subscribe to events as they happen (live/demo/replay playback) for animations; returns unsubscribe */
  onEvent(cb: (e: FleetEvent) => void): () => void;
  replay: ReplayControls;
  /** enter replay of the last N hours (fetches /api/history or demo history) */
  startReplay(hours: number): void;
}

/** Selection shared between visualizer and side panels. */
export type Selection =
  { kind: 'project'; id: string } | { kind: 'agent'; id: string } | { kind: 'session'; id: string } | null;
