import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FleetView } from '../data/contract';
import { liveHistory, useLiveTape } from '../data/liveTape';
import {
  buildTimeline,
  formatClock,
  nearestNotch,
  notchMessage,
  stepNotch,
  type TimelineModel,
  type TimelineNotch,
} from '../data/replay';
import { Icon } from './Icon';

export const REPLAY_WINDOWS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 12, label: 'Overnight' },
];

/** tick columns across the tape */
const COLUMNS = 120;
/** tape height in the svg's user units (the svg stretches to the css height) */
const TAPE_H = 20;
/** live mode: the tape is rebuilt at most this often (the demo snapshot changes 4 times a second) */
const LIVE_REBUILD_MS = 5_000;
/** Shift-drag snaps to a notch within this fraction of the window */
const SNAP_FRACTION = 0.025;
const TOAST_MS = 2400;

/** Severity-coloured event ticks; memoized by the caller so playback never re-renders them. */
function Ticks({ model }: { model: TimelineModel }) {
  const scale = Math.log1p(model.max);
  return (
    <svg
      className="tape-ticks"
      viewBox={`0 0 ${model.buckets.length} ${TAPE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {model.buckets.map((bucket, index) =>
        bucket.severity ? (
          <rect
            key={index}
            className={`tick tick-${bucket.severity}`}
            x={index + 0.18}
            width={0.64}
            y={TAPE_H - (0.3 + (0.7 * Math.log1p(bucket.count)) / scale) * TAPE_H}
            height={(0.3 + (0.7 * Math.log1p(bucket.count)) / scale) * TAPE_H}
          />
        ) : null,
      )}
    </svg>
  );
}

function Notches({ model }: { model: TimelineModel }) {
  const span = model.to - model.from;
  if (span <= 0) return null;
  return (
    <>
      {model.notches.map((notch) => (
        <i
          key={notch.ts}
          className="tape-notch"
          data-open={notch.open || undefined}
          style={{ left: `${((notch.ts - model.from) / span) * 100}%` }}
          title={notchMessage(notch)}
        />
      ))}
    </>
  );
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range';
}

export function ReplayBar({ view }: { view: FleetView }) {
  const { replay } = view;
  const active = view.mode === 'replay';
  const history = active ? (replay.history ?? null) : null;
  const tape = useLiveTape(view.mode);
  // live: the last hour (loaded history plus streamed events) with the same bars and notches as replay
  const live = useRef({ snapshot: view.snapshot, events: view.events });
  live.current = { snapshot: view.snapshot, events: view.events };
  const liveSnapshot = active ? null : view.snapshot;
  const liveKey = liveSnapshot ? Math.floor(liveSnapshot.generatedAt / LIVE_REBUILD_MS) : null;
  const model = useMemo<TimelineModel | null>(() => {
    if (history) return buildTimeline(history, COLUMNS);
    const { snapshot, events } = live.current;
    if (liveKey === null || !snapshot) return null;
    return buildTimeline(liveHistory(tape, snapshot, events), COLUMNS);
  }, [history, tape, liveKey]);
  const ticks = useMemo(() => (model ? <Ticks model={model} /> : null), [model]);
  const notches = useMemo(() => (model ? <Notches model={model} /> : null), [model]);

  const span = replay.to - replay.from;
  const progress = active && span > 0 ? Math.min(1, Math.max(0, (replay.at - replay.from) / span)) : 1;
  const notchList = active && model ? model.notches : null;
  const prev = notchList ? stepNotch(notchList, replay.at, -1) : undefined;
  const next = notchList ? stepNotch(notchList, replay.at, 1) : undefined;

  const [toast, setToast] = useState<{ text: string; left: number; key: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastSnapped = useRef<number | null>(null);
  const shift = useRef(false);
  const say = useCallback(
    (text: string, at: number) => {
      window.clearTimeout(toastTimer.current);
      const left = span > 0 ? Math.min(100, Math.max(0, ((at - replay.from) / span) * 100)) : 50;
      setToast((old) => ({ text, left, key: (old?.key ?? 0) + 1 }));
      toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
    },
    [span, replay.from],
  );
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const toastEl = useRef<HTMLDivElement>(null);
  // keep the micro-toast inside the viewport (it may be wider than a phone's short tape)
  useLayoutEffect(() => {
    const el = toastEl.current;
    if (!el) return;
    el.style.setProperty('--nudge', '0px');
    const rect = el.getBoundingClientRect();
    const edge = 8;
    const nudge =
      rect.left < edge
        ? edge - rect.left
        : rect.right > window.innerWidth - edge
          ? window.innerWidth - edge - rect.right
          : 0;
    if (nudge) el.style.setProperty('--nudge', `${Math.round(nudge)}px`);
  }, [toast]);
  useEffect(() => {
    if (!active) {
      setToast(null);
      lastSnapped.current = null;
    }
  }, [active]);

  const snapTo = useCallback(
    (notch: TimelineNotch) => {
      if (replay.playing) replay.setPlaying(false);
      replay.seek(notch.ts);
      lastSnapped.current = notch.ts;
      say(notchMessage(notch), notch.ts);
    },
    [replay, say],
  );
  const step = useCallback(
    (direction: 1 | -1) => {
      if (!notchList) return;
      const notch = stepNotch(notchList, replay.at, direction);
      if (notch) snapTo(notch);
      else
        say(
          direction > 0 ? 'No later needs-you moments' : 'No earlier needs-you moments',
          direction > 0 ? replay.to : replay.from,
        );
    },
    [notchList, replay.at, replay.to, replay.from, snapTo, say],
  );
  const stepRef = useRef(step);
  stepRef.current = step;

  // Shift [ / Shift ] (and Shift + arrows on the playhead) jump between needs-you notches
  useEffect(() => {
    if (!active) return;
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shift.current = true;
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (typing(event.target)) return;
      const back = event.code === 'BracketLeft' || event.key === 'ArrowLeft';
      const forward = event.code === 'BracketRight' || event.key === 'ArrowRight';
      if (!back && !forward) return;
      if (event.key.startsWith('Arrow') && !(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      stepRef.current(back ? -1 : 1);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shift.current = false;
    };
    const blur = () => (shift.current = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [active]);

  const scrub = (value: number) => {
    if (shift.current && notchList && span > 0) {
      const notch = nearestNotch(notchList, value, span * SNAP_FRACTION);
      if (notch) {
        replay.seek(notch.ts);
        if (lastSnapped.current !== notch.ts) {
          lastSnapped.current = notch.ts;
          say(notchMessage(notch), notch.ts);
        }
        return;
      }
    }
    lastSnapped.current = null;
    replay.seek(value);
  };

  const fromLabel = active ? formatClock(replay.from) : model ? formatClock(model.from) : 'Timeline';
  const toLabel = active ? formatClock(replay.to) : 'Now';
  return (
    <footer className={`replay-bar${active ? ' is-replay' : ''}`} aria-label="Timeline">
      <div className="replay-transport">
        <button
          type="button"
          className="icon-button"
          disabled={!active}
          onClick={() => replay.setPlaying(!replay.playing)}
          aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
          title={active ? 'Play or pause (Space)' : 'Start a replay to scrub the timeline'}
        >
          <Icon name={replay.playing ? 'pause' : 'play'} />
        </button>
        {active && (
          <>
            <button
              type="button"
              className="icon-button notch-step notch-prev"
              disabled={!prev}
              onClick={() => step(-1)}
              aria-label="Previous needs-you moment (Shift [)"
              title="Previous needs-you moment (Shift [)"
            >
              <Icon name="chevron" />
            </button>
            <button
              type="button"
              className="icon-button notch-step"
              disabled={!next}
              onClick={() => step(1)}
              aria-label="Next needs-you moment (Shift ])"
              title="Next needs-you moment (Shift ])"
            >
              <Icon name="chevron" />
            </button>
          </>
        )}
        <select
          className="speed"
          aria-label="Playback speed"
          value={replay.speed}
          disabled={!active}
          onChange={(event) => replay.setSpeed(Number(event.target.value))}
        >
          {[1, 4, 16, 60].map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </div>
      <div className="timeline">
        <div className="tape" style={{ ['--progress' as string]: progress }}>
          {ticks}
          {active && <div className="tape-future" aria-hidden="true" />}
          <div className="tape-notches" aria-hidden="true">
            {notches}
          </div>
          {active && (
            <time className="tape-playhead" aria-hidden="true">
              {formatClock(replay.at)}
            </time>
          )}
          {toast && (
            <div
              key={toast.key}
              ref={toastEl}
              className="tape-toast"
              role="status"
              style={{ ['--at' as string]: `${toast.left}%` }}
            >
              {toast.text}
            </div>
          )}
        </div>
        <input
          type="range"
          aria-label="Replay playhead"
          aria-valuetext={active ? formatClock(replay.at) : 'Live'}
          min={replay.from}
          max={Math.max(replay.from + 1, replay.to)}
          value={replay.at}
          step={1}
          disabled={!active || span <= 0}
          onPointerDown={(event) => (shift.current = event.shiftKey)}
          onPointerMove={(event) => {
            if (event.buttons) shift.current = event.shiftKey;
          }}
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <div className="timeline-labels">
          <time>{fromLabel}</time>
          <time>{toLabel}</time>
        </div>
      </div>
      <div className="replay-actions">
        {active ? (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={replay.exit}
            title="Back to live (L)"
            aria-label="Back to live"
          >
            <Icon name="live" />
            <span className="replay-live-label">Back to live</span>
          </button>
        ) : (
          <div className="segmented" role="group" aria-label="Replay the last">
            <span className="segmented-label micro">
              <Icon name="replay" />
              Replay
            </span>
            {REPLAY_WINDOWS.map((window) => (
              <button key={window.hours} type="button" onClick={() => view.startReplay(window.hours)}>
                {window.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
