// Hero island: the real Fleet visualizer (packages/web/src/viz/FleetScene) driven by the
// synthetic generator from @fleet/shared. Bundled separately by scripts/prebuild.mjs with its own
// React 18 so react-three-fiber v8 never runs inside the Next.js App Router React build.
// It never touches the network: no /api, no live source, synthetic data only.
import { StrictMode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { _roots, type RenderCallback, type RootState } from '@react-three/fiber';
import { createDemoFleet } from '@fleet/shared';
import type { DemoFleet, FleetEvent, FleetSnapshot } from '@fleet/shared';
import FleetScene from '@fleet/web/src/viz/FleetScene';
import {
  cameraFitDistance,
  cameraFitPosition,
  damp,
  layoutRadius,
  stationPosition,
} from '@fleet/web/src/viz/layout';
import { openFleet } from '../lib/world.mjs';
import type { FleetView, ReplayControls, Selection } from '@fleet/web/src/data/contract';

export interface MountOptions {
  /** the site's world (lib/world.generated.json): seed and clock; wins over `seed` */
  world?: { seed: number; now: number };
  seed?: number;
  projects?: number;
  /** /demo: add the keyboard index of stations and agents next to the canvas */
  interactive?: boolean;
  /**
   * Home hero (and its posters): hold the camera on the waiting station, at one fixed heading, so the framing
   * never drifts. Ignored when `interactive`, where the visitor owns the camera.
   */
  frame?: boolean;
  /** called after the first rendered frame window, so the poster can fade out */
  onReady?: () => void;
}

const TICK_MS = 250;

function useDemoView(fleet: DemoFleet): FleetView {
  const [snapshot, setSnapshot] = useState<FleetSnapshot>(() => fleet.snapshot());
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [subscribers] = useState(() => new Set<(e: FleetEvent) => void>());

  useEffect(() => {
    let previous = performance.now();
    const timer = window.setInterval(() => {
      if (document.hidden) {
        previous = performance.now();
        return;
      }
      const now = performance.now();
      const next = fleet.tick(now - previous);
      previous = now;
      setSnapshot(fleet.snapshot());
      if (next.length) {
        setEvents((old) => [...old, ...next].slice(-300));
        for (const e of next) for (const cb of subscribers) cb(e);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [fleet, subscribers]);

  return useMemo<FleetView>(() => {
    const at = snapshot.generatedAt;
    const replay: ReplayControls = {
      from: at,
      to: at,
      at,
      playing: false,
      speed: 1,
      seek: () => undefined,
      setPlaying: () => undefined,
      setSpeed: () => undefined,
      load: () => undefined,
      exit: () => undefined,
    };
    return {
      mode: 'demo',
      connected: true,
      snapshot,
      events,
      onEvent(cb) {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
      replay,
      startReplay: () => undefined,
    };
  }, [snapshot, events, subscribers]);
}

/** FleetScene's orbit target height (CameraRig HOME.y): the camera looks at this height above the harbour floor. */
const LOOK_Y = 1.2;
/**
 * Hero heading, measured from the waiting station's own bearing off the harbour centre. 0 would put the camera
 * straight behind the station looking in, the rest of the harbour stacked above it; this turns it a quarter
 * so the other stations fan out up and to the right of it, where the hero has room (the copy is on the left).
 */
const FRAME_YAW = -0.55;
/**
 * Hero distance as a share of the fitted (whole-harbour) distance: close enough that the station reads. Fixed,
 * not per aspect: the vertical field of view is fixed, so a narrower canvas is a centred crop of a wider one and
 * the cover-cropped poster (rendered the same way) lines up with the live scene at the swap.
 */
const FRAME_DIST = 0.74;
/**
 * Phone-width canvases (the 375px hero and its 420px poster) come in closer, as a share of the same distance,
 * and look a little below the station so it sits above centre, clear of the copy that rises over the stage's foot.
 */
/** Same breakpoint as the hero <picture>'s square phone poster (FleetStage: max-width 720px), so the still and the
 * live camera always use the same framing. */
const NARROW_MAX_PX = 720;
const FRAME_DIST_NARROW = 0.5;
const LOOK_Y_NARROW = -0.6;

/** The station FleetScene marks "needs you" (blocked tasks + waiting agents), most first; null when none. */
function waitingStation(snap: FleetSnapshot): { index: number; count: number } | null {
  const ids = snap.projects.map((p) => p.id).sort();
  let best: { index: number; count: number } | null = null;
  for (const p of snap.projects) {
    const count =
      (p.orch?.tasks.filter((t) => t.state === 'blocked').length ?? 0) +
      snap.agents.filter((a) => a.projectId === p.id && a.status === 'waiting').length;
    const index = ids.indexOf(p.id);
    if (count > 0 && (!best || count > best.count || (count === best.count && index < best.index)))
      best = { index, count };
  }
  return best ? { index: best.index, count: ids.length } : null;
}

/**
 * The one "which station is the signal" rule for the hero: the camera aims at waitingStation(), and this marks that
 * station's tag data-signal="1" so the beacon (FleetStage) and the poster anchors (scripts/assets.mjs) follow the
 * same station. Tags carry no project id, so the marked tag is the needs-you tag whose anchor (the 0x0 tag root sits
 * on it) is nearest the station's projection: the anchor is on the station's own vertical axis, other stations are
 * far apart on screen. `ndc` is the projected station (null: nothing waiting, no tag marked).
 */
function markSignalTag(host: HTMLElement, ndc: THREE.Vector3 | null, canvas: HTMLCanvasElement): void {
  const tags = host.querySelectorAll<HTMLElement>('.fl-viz-tag[data-needs="1"], .fl-viz-tag[data-signal]');
  let pick: HTMLElement | null = null;
  if (ndc && tags.length) {
    const c = canvas.getBoundingClientRect();
    const px = c.left + (ndc.x * 0.5 + 0.5) * c.width;
    const py = c.top + (1 - (ndc.y * 0.5 + 0.5)) * c.height;
    let best = Infinity;
    for (const t of tags) {
      if (t.dataset.needs !== '1') continue;
      const r = t.getBoundingClientRect();
      const d = (r.left - px) ** 2 + 0.25 * (r.top - py) ** 2;
      if (d < best) {
        best = d;
        pick = t;
      }
    }
  }
  for (const t of tags) {
    if (t === pick) {
      if (t.dataset.signal !== '1') t.dataset.signal = '1';
    } else if (t.dataset.signal !== undefined) delete t.dataset.signal;
  }
}

interface FramingControls extends THREE.EventDispatcher<{ start: object }> {
  target: THREE.Vector3;
}

/**
 * Locks the hero camera on the waiting station. FleetScene's rig auto-rotates the harbour and dollies on its own
 * clock, so a fixed CSS frame lost the station within seconds. This drives the camera every frame, before the
 * rig and before the station tags project themselves (priority -0.5: after OrbitControls' update at -1, before
 * the default 0), so the canvas and its DOM labels always agree. The OrbitControls "start" event it emits each
 * frame is the rig's own "someone is steering" signal: it pauses auto-rotate, the refit dolly and the pull home.
 * Station positions are FleetScene's own layout functions over the same snapshot, so the aim is exact.
 * `onFramed` fires once the first framed frame is on screen, so the poster swaps to an already-framed scene.
 */
function useSignalFraming(
  host: HTMLElement,
  snapshot: FleetSnapshot | null,
  enabled: boolean,
  onFramed: () => void,
): void {
  const snap = useRef(snapshot);
  snap.current = snapshot;
  const framed = useRef(onFramed);
  framed.current = onFramed;
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    const target = new THREE.Vector3();
    const goal = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const sph = new THREE.Spherical();
    const at = { x: 0, y: 0, z: 0 };
    const station = new THREE.Vector3();
    const seen = new THREE.Vector3();
    let yaw = 0;
    let started = false;
    let reported = false;
    const step: RenderCallback = (state: RootState, delta: number) => {
      const s = snap.current;
      const controls = state.controls as unknown as FramingControls | null;
      if (!s || !controls) return;
      const n = Math.max(1, s.projects.length);
      const w = waitingStation(s);
      const narrow = state.size.width <= NARROW_MAX_PX;
      const lookY = narrow ? LOOK_Y_NARROW : LOOK_Y;
      let goalYaw = yaw;
      if (w) {
        stationPosition(w.index, w.count, at);
        station.set(at.x, at.y, at.z);
        goal.set(at.x, lookY, at.z);
        goalYaw = Math.atan2(at.x, at.z) + FRAME_YAW;
      } else goal.set(0, lookY, 0);
      const dt = Math.min(delta, 0.05);
      if (!started) {
        // the first frame is already framed: it matches the poster it replaces
        started = true;
        target.copy(goal);
        yaw = goalYaw;
      } else {
        // a new waiting station (or none): glide there, never cut
        const k = damp(1.4, dt);
        target.lerp(goal, k);
        const turn = Math.atan2(Math.sin(goalYaw - yaw), Math.cos(goalYaw - yaw));
        yaw += turn * k;
      }
      const r = layoutRadius(n);
      cameraFitPosition(r, at);
      offset.set(at.x, at.y - LOOK_Y, at.z);
      sph.setFromVector3(offset);
      sph.radius = cameraFitDistance(r) * (narrow ? FRAME_DIST_NARROW : FRAME_DIST);
      sph.theta = yaw;
      controls.dispatchEvent({ type: 'start' });
      controls.target.copy(target);
      state.camera.position.copy(target).add(offset.setFromSpherical(sph));
      state.camera.lookAt(target);
      state.camera.updateMatrixWorld();
      markSignalTag(host, w ? seen.copy(station).project(state.camera) : null, state.gl.domElement);
      if (!reported) {
        reported = true;
        // this frame renders framed; report after it has been presented
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => !cancelled && framed.current());
        });
      }
    };
    const ref = { current: step };
    const attach = () => {
      raf = 0;
      if (cancelled) return;
      const canvas = host.querySelector('canvas');
      const root = canvas ? _roots.get(canvas) : undefined;
      const state = root?.store.getState();
      if (!root || !state?.controls) {
        raf = requestAnimationFrame(attach);
        return;
      }
      unsubscribe = state.internal.subscribe(ref, -0.5, root.store);
    };
    raf = requestAnimationFrame(attach);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      unsubscribe?.();
    };
  }, [host, enabled]);
}

const STATUS_WORD: Record<string, string> = {
  working: 'working',
  idle: 'idle',
  waiting: 'needs you',
  done: 'done',
  failed: 'failed',
};

/**
 * Keyboard and screen-reader route into the scene: every station and agent as a button that drives the same
 * selection (camera focus and HUD details panel) as clicking a mesh. Esc clears the selection.
 */
function FleetIndex({
  snapshot,
  selection,
  onSelect,
}: {
  snapshot: FleetSnapshot;
  selection: Selection;
  onSelect(sel: Selection): void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const isSel = (kind: 'project' | 'agent', id: string) => selection?.kind === kind && selection.id === id;
  const select = (kind: 'project' | 'agent', id: string) => onSelect(isSel(kind, id) ? null : { kind, id });
  return (
    <nav
      className="fleet-index"
      aria-label="Fleet index"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selection) {
          e.stopPropagation();
          onSelect(null);
        }
      }}
    >
      <button
        type="button"
        className="fleet-index-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        Stations and agents{' '}
        <span className="num">
          {snapshot.projects.length}/{snapshot.agents.length}
        </span>
      </button>
      <ul id={listId} className="fleet-index-list" hidden={!open}>
        {snapshot.projects.map((p) => {
          const agents = snapshot.agents.filter((a) => a.projectId === p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className="fleet-index-station"
                aria-pressed={isSel('project', p.id)}
                onClick={() => select('project', p.id)}
              >
                {p.name} <span className="num">{agents.length}</span>
              </button>
              {agents.length > 0 && (
                <ul aria-label={`${p.name} agents`}>
                  {agents.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={isSel('agent', a.id)}
                        data-status={a.status}
                        onClick={() => select('agent', a.id)}
                      >
                        {a.label}{' '}
                        <span className="fleet-index-meta">
                          {a.model} · {STATUS_WORD[a.status] ?? a.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Island({
  host,
  world,
  seed,
  projects,
  interactive,
  frame,
  onReady,
}: MountOptions & { host: HTMLElement }) {
  const [fleet] = useState(() =>
    world ? openFleet(createDemoFleet, world) : createDemoFleet({ seed, projects }),
  );
  const view = useDemoView(fleet);
  const [selection, setSelection] = useState<Selection>(null);
  const framing = Boolean(frame && !interactive);
  useSignalFraming(host, view.snapshot, framing, () => onReady?.());
  useEffect(() => {
    // Framed: useSignalFraming reports once the first framed frame is up. Otherwise two frames after commit
    // the canvas has drawn at least once.
    if (framing) return;
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => onReady?.());
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [onReady, framing]);
  // A selected agent or station can leave the synthetic fleet; drop the selection rather than point at nothing.
  const snap = view.snapshot;
  useEffect(() => {
    if (!selection || !snap) return;
    const alive =
      selection.kind === 'project'
        ? snap.projects.some((p) => p.id === selection.id)
        : selection.kind === 'agent'
          ? snap.agents.some((a) => a.id === selection.id)
          : snap.sessions.some((x) => x.id === selection.id);
    if (!alive) setSelection(null);
  }, [selection, snap]);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <FleetScene view={view} selection={selection} onSelect={setSelection} />
      {interactive && snap ? (
        <FleetIndex snapshot={snap} selection={selection} onSelect={setSelection} />
      ) : null}
    </div>
  );
}

export function mount(el: HTMLElement, opts: MountOptions = {}): { unmount(): void } {
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <Island {...opts} host={el} />
    </StrictMode>,
  );
  return { unmount: () => root.unmount() };
}
