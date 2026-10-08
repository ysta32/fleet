import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementRef,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, PerformanceMonitor, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { Agent, FleetSnapshot } from '@fleet/shared';
import { easing, ease } from '@fleet/ui';
import type { FleetView, Selection } from '../data/contract';
import { incidentsByProject } from '../dashboard/model';
import { Bots, type BotEntry } from './Bots';
import { useVizDevView } from './devView';
import { Effects } from './Effects';
import { Hud } from './Hud';
import {
  cameraFitPosition,
  cameraMaxDistance,
  focusDistance,
  clamp,
  damp,
  fitScaleForAspect,
  fogRange,
  layoutRadius,
  needsRefit,
} from './layout';
import { Station, type StationData } from './Station';
import { SceneStore, SceneStoreContext, useSceneStore } from './store';
import { TaskSatellites } from './TaskSatellites';
import { FONTS, VizThemeContext, useThemeName, useVizTheme, vizTheme, type VizTheme } from './theme';

export interface FleetSceneProps {
  view: FleetView;
  selection: Selection;
  onSelect(sel: Selection): void;
  /**
   * Show the in-scene detail card for the selection (default true). The app shell turns it off
   * while its own selection drawer is open, so one selection never has two detail surfaces.
   */
  detailCard?: boolean;
}

const MAX_BOTS = 240;
const LABEL_ALL_UP_TO = 12;
const LABEL_TOP = 6;
/** Halyard grain (same SVG noise as --fl-grain), inlined so the scene does not depend on tokens.css. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function useNarrow(): boolean {
  const q = '(max-width: 560px)';
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(q).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(q);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Advances the scene clocks; mounted first so every other frame callback sees fresh time. */
function SceneClock() {
  const store = useSceneStore();
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    store.t += d;
    if (!store.reduced) store.at += d;
  });
  return null;
}

const HARBOUR_FADE = 1.4;

function Floor({ radius, vt }: { radius: number; vt: VizTheme }) {
  const rings = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    out.push(new THREE.RingGeometry(0.88, 0.9, 96).rotateX(-Math.PI / 2));
    for (const k of [0.45, 1, 1.6])
      out.push(new THREE.RingGeometry(radius * k - 0.01, radius * k, 256).rotateX(-Math.PI / 2));
    return out;
  }, [radius]);
  const ticks = useMemo(() => {
    const pts: number[] = [];
    const r = radius * 1.6;
    // centre compass: the operator's mark the fleet circles
    const c = 0.9;
    pts.push(
      -c * 1.6,
      0,
      0,
      -c * 0.4,
      0,
      0,
      c * 0.4,
      0,
      0,
      c * 1.6,
      0,
      0,
      0,
      0,
      -c * 1.6,
      0,
      0,
      -c * 0.4,
      0,
      0,
      c * 0.4,
      0,
      0,
      c * 1.6,
    );
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const l = i % 15 === 0 ? 1.2 : i % 5 === 0 ? 0.6 : 0.3;
      pts.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * (r + l), 0, Math.sin(a) * (r + l));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [radius]);
  useEffect(
    () => () => {
      for (const r of rings) r.dispose();
      ticks.dispose();
    },
    [rings, ticks],
  );
  const k = vt.dark ? 1 : 2.6;
  // first load: the harbour (range rings, bezel ticks) fades up and settles before stations land
  const store = useSceneStore();
  const group = useRef<THREE.Group>(null);
  const mats = useRef<{ m: THREE.Material; o: number }[]>([]);
  const settled = useRef(false);
  useFrame(() => {
    if (settled.current) return;
    const g = group.current;
    if (!g) return;
    if (!mats.current.length)
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && m.transparent) mats.current.push({ m, o: m.opacity });
      });
    const u = store.reduced ? 1 : clamp(store.t / HARBOUR_FADE, 0, 1);
    const e = ease(easing.land, u);
    for (const { m, o } of mats.current) m.opacity = o * e;
    g.scale.setScalar(0.94 + 0.06 * e);
    if (u >= 1) settled.current = true;
  });
  useEffect(() => {
    mats.current = [];
    settled.current = false;
  }, [vt, radius]);
  return (
    <group ref={group}>
      <Grid
        position={[0, 0, 0]}
        args={[10, 10]}
        infiniteGrid
        cellSize={1}
        cellThickness={0.5}
        cellColor={vt.gridCell}
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor={vt.gridSection}
        fadeDistance={radius * 4}
        fadeStrength={1.8}
        followCamera={false}
      />
      {rings.map((g, i) => (
        <mesh key={i} geometry={g} position={[0, 0.005, 0]}>
          <meshBasicMaterial
            color={vt.fg}
            transparent
            opacity={(i === 0 ? 0.2 : i === 2 ? 0.09 : 0.05) * k}
            depthWrite={false}
          />
        </mesh>
      ))}
      <lineSegments geometry={ticks} position={[0, 0.005, 0]}>
        <lineBasicMaterial color={vt.fg} transparent opacity={0.14 * k} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

type ControlsImpl = ElementRef<typeof OrbitControls>;
const desired = new THREE.Vector3();
const delta = new THREE.Vector3();
const offset = new THREE.Vector3();
const HOME = new THREE.Vector3(0, 1.2, 0);
const UP = new THREE.Vector3(0, 1, 0);
const fitPos = new THREE.Vector3();
const fitTmp = { x: 0, y: 0, z: 0 };
/** camera reframe (first load is a slow cinematic dolly-in from further out) */
const REFIT_SECONDS = 3;
/** ease back to the fitted framing (deselect, replay start); keeps the current heading */
const HOME_SECONDS = 2.2;
const homeSph = new THREE.Spherical();
const homeRel = new THREE.Vector3();
/**
 * Replay dolly: the heading offset is a pure function of the playhead (DOLLY_SWING rad across the whole
 * window, measured from the window start), so a playhead always settles to the same offset whatever
 * path the scrub took. Dragging adds a transient push-in that settles back out.
 */
const DOLLY_SWING = 0.6;
const DOLLY_PUSH = 0.07;

function CameraRig({
  selection,
  radius,
  projectCount,
  replaying,
  replayAt,
  replayPlaying,
  replayFrom,
  replaySpan,
}: {
  selection: Selection;
  radius: number;
  projectCount: number;
  replaying: boolean;
  replayAt: number | null;
  replayPlaying: boolean;
  replayFrom: number;
  replaySpan: number;
}) {
  const store = useSceneStore();
  const controls = useRef<ControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const framed = radius * fitScaleForAspect(aspect);
  const lastInteract = useRef(-Infinity);
  const focusStart = useRef(-Infinity);
  /** layout radius the camera is framed for (null: never framed for real data) */
  const fitted = useRef<number | null>(null);
  /** a refit that is due but deferred while something is selected */
  const pending = useRef<number | null>(null);
  const refitStart = useRef(-Infinity);
  const homeStart = useRef(-Infinity);
  const selKey = selection ? `${selection.kind}:${selection.id}` : '';
  const prevSel = useRef(selKey);
  const wasReplaying = useRef(replaying);
  const lastAt = useRef<number | null>(null);
  /** heading offset (rad) currently applied for the playhead */
  const headingApplied = useRef(0);
  const scrubAt = useRef(-Infinity);
  const push = useRef(0);
  const pushApplied = useRef(1);
  const hasSelection = !!selection;

  useEffect(() => {
    focusStart.current = selKey ? store.t : -Infinity;
    // deselect: ease back out to the harbour instead of staying parked at the old focus
    if (prevSel.current && !selKey) {
      homeStart.current = store.t;
      lastInteract.current = -Infinity;
    }
    prevSel.current = selKey;
  }, [selKey, store]);

  // replay start: frame the whole harbour (a selection keeps its focus)
  useEffect(() => {
    if (replaying && !wasReplaying.current && !hasSelection) {
      homeStart.current = store.t;
      lastInteract.current = -Infinity;
    }
    if (!replaying) lastAt.current = null;
    wasReplaying.current = replaying;
  }, [replaying, hasSelection, store]);

  // a paused playhead moving is a scrub: it triggers the transient push-in
  useEffect(() => {
    if (replayAt === null) return;
    const previous = lastAt.current;
    lastAt.current = replayAt;
    if (previous === null || replayPlaying || replayAt === previous) return;
    scrubAt.current = store.t;
  }, [replayAt, replayPlaying, store]);
  const headingTarget =
    replaying && replayAt !== null && replaySpan > 0
      ? DOLLY_SWING * clamp((replayAt - replayFrom) / replaySpan, 0, 1)
      : 0;

  // reframe on the first non-empty snapshot and when the fleet grows/shrinks a lot
  useEffect(() => {
    if (needsRefit(fitted.current, framed, projectCount)) pending.current = framed;
    else pending.current = null;
  }, [framed, projectCount]);

  useFrame((_, dtRaw) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(dtRaw, 0.05);
    const userActive = performance.now() - lastInteract.current < 8000;
    c.autoRotate = !store.reduced && !selection && !userActive;
    c.autoRotateSpeed = 0.22;
    // a due refit starts only once nothing is selected; until then it stays pending
    if (pending.current !== null && !selection) {
      fitted.current = pending.current;
      pending.current = null;
      refitStart.current = store.t;
      cameraFitPosition(fitted.current, fitTmp);
      fitPos.set(fitTmp.x, fitTmp.y, fitTmp.z);
    }
    if (!selection && store.t - refitStart.current < REFIT_SECONDS) {
      const k = store.reduced ? 1 : damp(1.9, dt);
      camera.position.lerp(fitPos, k);
      c.target.lerp(HOME, k);
      if (store.reduced) refitStart.current = -Infinity;
      return;
    }
    if (!selection && store.t - homeStart.current < HOME_SECONDS) {
      const k = store.reduced ? 1 : damp(2.4, dt);
      cameraFitPosition(fitted.current ?? framed, fitTmp);
      homeRel.set(fitTmp.x - HOME.x, fitTmp.y - HOME.y, fitTmp.z - HOME.z);
      homeSph.setFromVector3(homeRel);
      c.target.lerp(HOME, k);
      offset.copy(camera.position).sub(c.target);
      homeSph.theta = Math.atan2(offset.x, offset.z);
      desired.setFromSpherical(homeSph).add(c.target);
      camera.position.lerp(desired, k);
      pushApplied.current = 1;
      push.current = 0;
      if (store.reduced) homeStart.current = -Infinity;
      return;
    }
    if (store.selectionPosition(selection, desired)) {
      const since = store.t - focusStart.current;
      const focusing = since < 1.8;
      const k = store.reduced ? 1 : damp(focusing ? 3.2 : 6, dt);
      delta.copy(desired).sub(c.target).multiplyScalar(k);
      c.target.add(delta);
      camera.position.add(delta);
      if (focusing) {
        const want = focusDistance(selection?.kind ?? 'session', fitted.current ?? framed);
        offset.copy(camera.position).sub(c.target);
        const len = offset.length();
        const next = store.reduced ? want : THREE.MathUtils.lerp(len, want, damp(2.4, dt));
        if (len > 1e-4) offset.multiplyScalar(next / len);
        camera.position.copy(c.target).add(offset);
      }
    } else {
      if (!userActive && !store.reduced) {
        delta.copy(HOME).sub(c.target).multiplyScalar(damp(0.5, dt));
        c.target.add(delta);
      }
      if (store.reduced || !replaying) push.current = 0;
      // replay dolly: ease the heading toward the playhead's offset; push in slightly while dragging
      offset.copy(camera.position).sub(c.target);
      const target = store.reduced ? 0 : headingTarget;
      const swing = (target - headingApplied.current) * (store.reduced ? 1 : damp(5, dt));
      headingApplied.current += swing;
      const want = store.t - scrubAt.current < 0.35 && replaying && !store.reduced ? 1 : 0;
      push.current += (want - push.current) * damp(want ? 6 : 2, dt);
      const factor = 1 - DOLLY_PUSH * push.current;
      if (Math.abs(swing) > 1e-6 || Math.abs(factor - pushApplied.current) > 1e-6) {
        offset.applyAxisAngle(UP, swing).multiplyScalar(factor / pushApplied.current);
        pushApplied.current = factor;
        camera.position.copy(c.target).add(offset);
      }
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={2.5}
      maxDistance={cameraMaxDistance(framed)}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.47}
      enablePan={!selection}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      onStart={() => {
        lastInteract.current = performance.now();
        refitStart.current = -Infinity;
        // the user takes the camera: stop easing home so the rig never fights the drag
        homeStart.current = -Infinity;
      }}
      onEnd={() => {
        lastInteract.current = performance.now();
      }}
    />
  );
}

function buildStations(snap: FleetSnapshot, store: SceneStore): StationData[] {
  const out: StationData[] = [];
  const agentsBy = new Map<string, Agent[]>();
  for (const a of snap.agents) {
    const l = agentsBy.get(a.projectId);
    if (l) l.push(a);
    else agentsBy.set(a.projectId, [a]);
  }
  const needsBy = incidentsByProject(snap);
  for (const p of snap.projects) {
    const l = store.layouts.get(p.id);
    if (!l) continue;
    const agents = agentsBy.get(p.id) ?? [];
    const tasks = p.orch?.tasks ?? [];
    const pr = snap.prs.filter((x) => x.projectId === p.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    out.push({
      id: p.id,
      name: p.name,
      orch: !!p.orch,
      phase: p.orch?.phase ?? null,
      scale: l.scale,
      x: l.pos.x,
      y: l.pos.y,
      z: l.pos.z,
      agents: agents.length,
      working: agents.filter((a) => a.status === 'working').length,
      taskCount: tasks.length,
      review: tasks.filter((t) => t.state === 'review').length,
      running: tasks.filter((t) => t.state === 'running').length,
      ci: pr?.ci ?? 'none',
      index: l.index,
      // the dashboard's incident list: the same count the Overview, Alerts and nav badge show
      needs: needsBy.get(p.id) ?? 0,
      labelled: true,
    });
  }
  // large fleets: tag only the busiest stations (needs-you and selection are always tagged)
  if (out.length > LABEL_ALL_UP_TO) {
    const rank = out
      .slice()
      .sort((a, b) => b.working + b.running - (a.working + a.running) || a.index - b.index);
    const top = new Set(rank.slice(0, LABEL_TOP).map((d) => d.id));
    for (const d of out) d.labelled = top.has(d.id);
  }
  return out;
}

function SceneContents({ view, selection, onSelect, detailCard = true }: FleetSceneProps) {
  const store = useSceneStore();
  const vt = useVizTheme();
  store.vt = vt;
  const snap = view.snapshot;
  const replayAt = view.mode === 'replay' ? view.replay.at : null;
  store.syncClock(
    view.mode,
    replayAt ?? snap?.generatedAt ?? -Infinity,
    view.mode !== 'replay' || view.replay.playing,
  );
  store.setSnapshot(snap);
  const stations = useMemo(() => (snap ? buildStations(snap, store) : []), [snap, store]);
  const radius = layoutRadius(store.projectCount);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const fogBase = fogRange(radius, aspect);
  const fog = { near: fogBase.near * vt.fogScale, far: fogBase.far * vt.fogScale };
  const narrow = useNarrow();

  useEffect(() => {
    const scratch = new THREE.Vector3();
    return view.onEvent((e) => store.handleEvent(e, scratch));
  }, [view, store]);

  const selectProject = useCallback((id: string) => onSelect({ kind: 'project', id }), [onSelect]);
  const selectAgent = useCallback((id: string) => onSelect({ kind: 'agent', id }), [onSelect]);
  const agents = useMemo<BotEntry[]>(() => {
    if (!snap) return [];
    const perProject = new Map<string, number>();
    return snap.agents.slice(0, MAX_BOTS).map((a) => {
      const order = perProject.get(a.projectId) ?? 0;
      perProject.set(a.projectId, order + 1);
      return { a, order };
    });
  }, [snap]);

  return (
    <>
      <SceneClock />
      <color attach="background" args={[vt.bg]} />
      <fog attach="fog" args={[vt.bg, fog.near, fog.far]} />
      <ambientLight intensity={vt.dark ? 0.25 : 0.9} color={vt.dark ? vt.fg : '#ffffff'} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={vt.dark ? 0.6 : 1.2}
        color={vt.dark ? vt.fg : '#ffffff'}
      />
      {vt.dark && (
        <Stars
          radius={160}
          depth={70}
          count={1200}
          factor={2}
          saturation={0}
          fade
          speed={store.reduced ? 0 : 0.2}
        />
      )}
      <Floor radius={radius} vt={vt} />
      {stations.map((d) => (
        <Station
          key={d.id}
          d={d}
          selected={selection?.kind === 'project' && selection.id === d.id}
          compact={narrow}
          onSelect={selectProject}
        />
      ))}
      {snap && <TaskSatellites snapshot={snap} onSelectProject={selectProject} />}
      <Bots
        entries={agents}
        max={MAX_BOTS}
        selectedId={
          selection && (selection.kind === 'agent' || selection.kind === 'session') ? selection.id : null
        }
        onSelect={selectAgent}
      />
      <Effects />
      <Hud
        selection={selection}
        snapshot={snap}
        replayAt={replayAt}
        card={detailCard}
        onClose={() => onSelect(null)}
      />
      <CameraRig
        selection={selection}
        radius={radius}
        projectCount={store.projectCount}
        replaying={view.mode === 'replay'}
        replayAt={replayAt}
        replayPlaying={view.mode === 'replay' && view.replay.playing}
        replayFrom={view.replay.from}
        replaySpan={view.replay.to - view.replay.from}
      />
    </>
  );
}

const overlayText = (vt: VizTheme): CSSProperties => ({
  position: 'absolute',
  fontFamily: FONTS.mono,
  fontSize: 10,
  letterSpacing: FONTS.trackingCaps,
  textTransform: 'uppercase',
  color: vt.fgSubtle,
  pointerEvents: 'none',
  userSelect: 'none',
});

function Legend({ vt }: { vt: VizTheme }) {
  const models = ['opus', 'sonnet', 'haiku', 'fable', 'astra'] as const;
  const narrow = useNarrow();
  if (narrow)
    return (
      <div
        data-fl-legend
        style={{ ...overlayText(vt), left: 12, bottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        {models.map((m) => (
          <span
            key={m}
            title={m}
            style={{ width: 6, height: 6, borderRadius: 6, background: vt.model[m], display: 'inline-block' }}
          />
        ))}
        <span style={{ color: vt.accent, marginLeft: 4 }}>● needs you</span>
      </div>
    );
  return (
    <div
      data-fl-legend
      style={{
        ...overlayText(vt),
        left: 16,
        bottom: 14,
        right: 16,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 24,
        rowGap: 6,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {models.map((m) => (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 6,
                background: vt.model[m],
                display: 'inline-block',
              }}
            />
            {m}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <span>◆ lead</span>
        <span>■ coder</span>
        <span>▲ critic</span>
        <span>● scout</span>
        <span>○ tester</span>
        <span style={{ color: vt.accent }}>● needs you</span>
      </div>
    </div>
  );
}

export default function FleetScene({ view: viewProp, selection, onSelect, detailCard }: FleetSceneProps) {
  // dev/screenshot harness: `?vizdev=1` swaps in synthetic data (never real transcripts)
  const devView = useVizDevView();
  const view = devView ?? viewProp;
  const [store] = useState(() => new SceneStore());
  const reduced = usePrefersReducedMotion();
  store.reduced = reduced;
  const vt = vizTheme(useThemeName());
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1),
  );
  // start further out; the rig dollies in to the fitted framing once data is present
  const [initialCamera] = useState(() => {
    const n = view.snapshot?.projects.length ?? 0;
    const p = cameraFitPosition(layoutRadius(Math.max(1, n)) * (reduced ? 1 : 1.45));
    return { position: [p.x, p.y, p.z] as [number, number, number], fov: 40, near: 0.1, far: 600 };
  });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 320,
        background: vt.bg,
        overflow: 'hidden',
        isolation: 'isolate',
      }}
    >
      <Canvas
        dpr={dpr}
        camera={initialCamera}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        onPointerMissed={() => onSelect(null)}
      >
        <VizThemeContext.Provider value={vt}>
          <SceneStoreContext.Provider value={store}>
            <PerformanceMonitor
              onIncline={() => setDpr((d) => Math.min(2, d + 0.5, window.devicePixelRatio || 1))}
              onDecline={() => setDpr((d) => Math.max(1, d - 0.5))}
              flipflops={3}
              onFallback={() => setDpr(1)}
            >
              <SceneContents view={view} selection={selection} onSelect={onSelect} detailCard={detailCard} />
              <EffectComposer multisampling={4} enableNormalPass={false}>
                <Bloom
                  mipmapBlur
                  luminanceThreshold={1}
                  luminanceSmoothing={0.2}
                  intensity={vt.bloom}
                  radius={0.6}
                />
                <Vignette darkness={vt.dark ? 0.5 : 0.12} offset={0.3} />
              </EffectComposer>
            </PerformanceMonitor>
          </SceneStoreContext.Provider>
        </VizThemeContext.Provider>
      </Canvas>
      <style>{`@media (min-width: 561px) { .fl-viz-tag[data-flip='1'] svg { transform: scaleX(-1); transform-origin: 0 100%; } .fl-viz-tag[data-flip='1'] .fl-viz-block { left: auto !important; right: 34px; text-align: right; } } @media (max-width: 560px) { .fl-viz-name { font-size: 11px !important; } .fl-viz-tag svg { display: none; } .fl-viz-block { left: 0 !important; bottom: 4px !important; transform: translateX(-50%); text-align: center; } .fl-viz-tag[data-needs='1'] .fl-viz-block { bottom: auto !important; top: 6px; } .fl-viz-sub[data-needs='0'] { display: none; } }`}</style>
      {/* depth: Halyard vignette + film grain (DOM, composited by the browser; no per-frame GPU cost) */}
      <div
        aria-hidden
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: vt.vignette }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: GRAIN,
          backgroundSize: '160px 160px',
          mixBlendMode: 'overlay',
          opacity: vt.grainOpacity,
        }}
      />
      {view.snapshot?.demo && (
        <div style={{ ...overlayText(vt), top: 14, right: 16, color: vt.fgMuted }}>synthetic data</div>
      )}
      {(view.snapshot?.projects.length ?? 0) > 0 && <Legend vt={vt} />}
      {!view.snapshot && (
        <div
          style={{
            ...overlayText(vt),
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: vt.fgMuted,
          }}
        >
          waiting for the collector
        </div>
      )}
    </div>
  );
}

/** Convenience wrapper (e.g. marketing site) that owns its own selection state. */
export function FleetSceneStandalone({ view, style }: { view: FleetView; style?: CSSProperties }) {
  const [selection, setSelection] = useState<Selection>(null);
  return (
    <div style={{ width: '100%', height: '100%', ...style }}>
      <FleetScene view={view} selection={selection} onSelect={setSelection} />
    </div>
  );
}
