import type { FleetView } from '../data/contract';
import { Icon } from './Icon';

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const REPLAY_WINDOWS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 12, label: 'Overnight' },
];

export function ReplayBar({ view }: { view: FleetView }) {
  const { replay } = view;
  const active = view.mode === 'replay';
  const span = replay.to - replay.from;
  const buckets = new Array<number>(96).fill(0);
  if (span > 0) {
    for (const event of view.events) {
      const index = Math.floor(((event.ts - replay.from) / span) * buckets.length);
      if (index >= 0 && index <= buckets.length) buckets[Math.min(index, buckets.length - 1)]++;
    }
  }
  const highest = Math.max(1, ...buckets);
  const progress = active && span > 0 ? (replay.at - replay.from) / span : 1;
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
        <div className="event-density" aria-hidden="true" style={{ ['--progress' as string]: progress }}>
          {buckets.map((count, index) => (
            <i
              key={index}
              data-past={index / buckets.length <= progress}
              style={{ transform: `scaleY(${count ? 0.2 + (count / highest) * 0.8 : 0.08})` }}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label="Replay playhead"
          min={replay.from}
          max={Math.max(replay.from + 1, replay.to)}
          value={replay.at}
          step={1}
          disabled={!active || span <= 0}
          onChange={(event) => replay.seek(Number(event.target.value))}
        />
        <div className="timeline-labels">
          <time>{active ? clock(replay.from) : 'Timeline'}</time>
          <time className={active ? 'playhead-time' : ''}>{active ? clock(replay.at) : 'Now'}</time>
        </div>
      </div>
      <div className="replay-actions">
        {active ? (
          <button type="button" className="btn btn-quiet" onClick={replay.exit} title="Back to live (L)">
            <Icon name="live" />
            Back to live
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
