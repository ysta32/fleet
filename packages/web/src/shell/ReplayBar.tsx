import type { FleetView } from '../data/contract';

export function ReplayBar({ view }: { view: FleetView }) {
  const { replay } = view;
  const active = view.mode === 'replay';
  const span = replay.to - replay.from;
  const buckets = new Array<number>(80).fill(0);
  if (span > 0) {
    for (const event of view.events) {
      const index = Math.floor(((event.ts - replay.from) / span) * buckets.length);
      if (index >= 0 && index <= buckets.length) buckets[Math.min(index, buckets.length - 1)]++;
    }
  }
  const highest = Math.max(1, ...buckets);
  return (
    <footer className="replay-bar">
      <div className="playback-actions">
        <button
          disabled={!active}
          onClick={() => replay.setPlaying(!replay.playing)}
          aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
        >
          {replay.playing ? 'Pause' : 'Play'}
        </button>
        <select
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
        <div className="event-density" aria-hidden="true">
          {buckets.map((count, index) => (
            <i key={index} style={{ height: `${count ? 15 + (count / highest) * 85 : 4}%` }} />
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
          <time>{active ? new Date(replay.from).toLocaleTimeString() : 'EVENT TIMELINE'}</time>
          <time>{active ? new Date(replay.at).toLocaleString() : 'NOW'}</time>
        </div>
      </div>
      <div className="replay-actions">
        <button onClick={() => view.startReplay(6)}>Replay last 6h</button>
        <button className={!active ? 'selected' : ''} onClick={replay.exit}>
          Live
        </button>
      </div>
    </footer>
  );
}
