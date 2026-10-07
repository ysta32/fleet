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
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import type { Agent, FleetSnapshot } from '@fleet/shared';
import type { FleetView, Selection } from '../data/contract';
import { Bot } from './Bots';
import { Effects } from './Effects';
import { Hud } from './Hud';
import { damp, layoutRadius } from './layout';
import { Station, type StationData } from './Station';
import { SceneStore, SceneStoreContext, useSceneStore } from './store';
import { TaskSatellites } from './TaskSatellites';
import { HALYARD, MODEL_COLORS, THEME } from './theme';

export interface FleetSceneProps {
  view: FleetView;
  selection: Selection;
  onSelect(sel: Selection): void;
}

const MAX_BOTS = 240;

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

function Floor({ radius }: { radius: number }) {
  const rings = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    for (const k of [0.45, 1, 1.6])
      out.push(new THREE.RingGeometry(radius * k - 0.012, radius * k, 256).rotateX(-Math.PI / 2));
    return out;
  }, [radius]);
  const ticks = useMemo(() => {
    const pts: number[] = [];
    const r = radius * 1.6;
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
  return (
    <group>
      <Grid
        position={[0, 0, 0]}
        args={[10, 10]}
        infiniteGrid
        cellSize={1}
        cellThickness={0.5}
        cellColor={THEME.gridCell}
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor={THEME.gridSection}
        fadeDistance={radius * 4.5}
        fadeStrength={1.6}
        followCamera={false}
      />
      {rings.map((g, i) => (
        <mesh key={i} geometry={g} position={[0, 0.005, 0]}>
          <meshBasicMaterial
            color={HALYARD.fg}
            transparent
            opacity={i === 1 ? 0.1 : 0.06}
            depthWrite={false}
          />
        </mesh>
      ))}
      <lineSegments geometry={ticks} position={[0, 0.005, 0]}>
        <lineBasicMaterial color={HALYARD.fg} transparent opacity={0.16} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

type ControlsImpl = ElementRef<typeof OrbitControls>;
const desired = new THREE.Vector3();
const delta = new THREE.Vector3();
const offset = new THREE.Vector3();
const HOME = new THREE.Vector3(0, 1.2, 0);

function CameraRig({ selection, radius }: { selection: Selection; radius: number }) {
  const store = useSceneStore();
  const controls = useRef<ControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const lastInteract = useRef(-Infinity);
  const focusStart = useRef(-Infinity);
  const selKey = selection ? `${selection.kind}:${selection.id}` : '';

  useEffect(() => {
    focusStart.current = selKey ? store.t : -Infinity;
  }, [selKey, store]);

  useFrame((_, dtRaw) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(dtRaw, 0.05);
    const userActive = performance.now() - lastInteract.current < 8000;
    c.autoRotate = !store.reduced && !selection && !userActive;
    c.autoRotateSpeed = 0.28;
    if (store.selectionPosition(selection, desired)) {
      const since = store.t - focusStart.current;
      const focusing = since < 1.8;
      const k = store.reduced ? 1 : damp(focusing ? 3.2 : 6, dt);
      delta.copy(desired).sub(c.target).multiplyScalar(k);
      c.target.add(delta);
      camera.position.add(delta);
      if (focusing) {
        const want = selection?.kind === 'project' ? 11 : 6;
        offset.copy(camera.position).sub(c.target);
        const len = offset.length();
        const next = store.reduced ? want : THREE.MathUtils.lerp(len, want, damp(2.4, dt));
        if (len > 1e-4) offset.multiplyScalar(next / len);
        camera.position.copy(c.target).add(offset);
      }
    } else if (!userActive && !store.reduced) {
      delta.copy(HOME).sub(c.target).multiplyScalar(damp(0.5, dt));
      c.target.add(delta);
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={2.5}
      maxDistance={Math.max(40, radius * 4)}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.47}
      enablePan={!selection}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      onStart={() => {
        lastInteract.current = performance.now();
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
    });
  }
  return out;
}

function SceneContents({ view, selection, onSelect }: FleetSceneProps) {
  const store = useSceneStore();
  const snap = view.snapshot;
  store.setSnapshot(snap);
  const stations = useMemo(() => (snap ? buildStations(snap, store) : []), [snap, store]);
  const radius = layoutRadius(store.projectCount);

  useEffect(() => {
    const scratch = new THREE.Vector3();
    return view.onEvent((e) => store.handleEvent(e, scratch));
  }, [view, store]);

  const selectProject = useCallback((id: string) => onSelect({ kind: 'project', id }), [onSelect]);
  const selectAgent = useCallback((id: string) => onSelect({ kind: 'agent', id }), [onSelect]);
  const agents = useMemo(() => (snap ? snap.agents.slice(0, MAX_BOTS) : []), [snap]);

  return (
    <>
      <SceneClock />
      <color attach="background" args={[THEME.background]} />
      <fog attach="fog" args={[THEME.fog, radius * 1.2, radius * 5]} />
      <ambientLight intensity={0.25} color={HALYARD.fg} />
      <directionalLight position={[8, 14, 6]} intensity={0.6} color={HALYARD.fg} />
      <Stars
        radius={160}
        depth={70}
        count={1400}
        factor={2.2}
        saturation={0}
        fade
        speed={store.reduced ? 0 : 0.25}
      />
      <Floor radius={radius} />
      {stations.map((d) => (
        <Station
          key={d.id}
          d={d}
          selected={selection?.kind === 'project' && selection.id === d.id}
          onSelect={selectProject}
        />
      ))}
      {snap && <TaskSatellites snapshot={snap} onSelectProject={selectProject} />}
      {agents.map((a) => (
        <Bot
          key={a.id}
          agent={a}
          selected={
            !!selection &&
            (selection.kind === 'agent' || selection.kind === 'session') &&
            selection.id === a.id
          }
          onSelect={selectAgent}
        />
      ))}
      <Effects />
      <Hud selection={selection} snapshot={snap} onClose={() => onSelect(null)} />
      <CameraRig selection={selection} radius={radius} />
    </>
  );
}

const overlayText: CSSProperties = {
  position: 'absolute',
  fontFamily: HALYARD.fontMono,
  fontSize: 10,
  letterSpacing: HALYARD.trackingCaps,
  textTransform: 'uppercase',
  color: HALYARD.fgSubtle,
  pointerEvents: 'none',
  userSelect: 'none',
};

function Legend() {
  return (
    <div style={{ ...overlayText, left: 16, bottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        {(Object.keys(MODEL_COLORS) as (keyof typeof MODEL_COLORS)[])
          .filter((m) => m !== 'unknown')
          .map((m) => (
            <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 6,
                  background: MODEL_COLORS[m],
                  display: 'inline-block',
                }}
              />
              {m}
            </span>
          ))}
      </div>
      <div style={{ display: 'flex', gap: 14, color: HALYARD.fgSubtle }}>
        <span>◆ lead</span>
        <span>■ coder</span>
        <span>▲ critic</span>
        <span>● scout</span>
        <span>○ tester</span>
      </div>
    </div>
  );
}

function StatusLine({ view }: { view: FleetView }) {
  const s = view.snapshot;
  const working = s ? s.agents.filter((a) => a.status === 'working').length : 0;
  const mode = view.mode === 'live' ? (view.connected ? 'live' : 'offline') : view.mode;
  return (
    <div style={{ ...overlayText, left: 16, top: 14, display: 'flex', gap: 16 }}>
      <span style={{ color: view.mode === 'live' && view.connected ? HALYARD.success : HALYARD.accent }}>
        ● {mode}
      </span>
      {s && (
        <>
          <span>{String(s.projects.length).padStart(2, '0')} stations</span>
          <span>
            {String(working).padStart(2, '0')}/{String(s.agents.length).padStart(2, '0')} agents active
          </span>
          {s.demo && <span style={{ color: HALYARD.fgMuted }}>synthetic data</span>}
        </>
      )}
    </div>
  );
}

export default function FleetScene({ view, selection, onSelect }: FleetSceneProps) {
  const [store] = useState(() => new SceneStore());
  const reduced = usePrefersReducedMotion();
  store.reduced = reduced;
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1),
  );
  const radius = layoutRadius(view.snapshot?.projects.length ?? 1);
  const [initialCamera] = useState(() => ({
    position: [radius * 0.1, radius * 0.95, radius * 1.85] as [number, number, number],
    fov: 40,
    near: 0.1,
    far: 600,
  }));
  const chroma = useMemo(() => new THREE.Vector2(0.00035, 0.00035), []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 320,
        background: THEME.background,
        overflow: 'hidden',
      }}
    >
      <Canvas
        dpr={dpr}
        camera={initialCamera}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        onPointerMissed={() => onSelect(null)}
      >
        <SceneStoreContext.Provider value={store}>
          <PerformanceMonitor
            onIncline={() => setDpr((d) => Math.min(2, d + 0.5, window.devicePixelRatio || 1))}
            onDecline={() => setDpr((d) => Math.max(1, d - 0.5))}
            flipflops={3}
            onFallback={() => setDpr(1)}
          >
            <SceneContents view={view} selection={selection} onSelect={onSelect} />
            <EffectComposer multisampling={4} enableNormalPass={false}>
              <Bloom
                mipmapBlur
                luminanceThreshold={1}
                luminanceSmoothing={0.25}
                intensity={0.85}
                radius={0.72}
              />
              <ChromaticAberration offset={chroma} radialModulation modulationOffset={0.45} />
              <Vignette darkness={0.62} offset={0.28} />
              <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.32} />
            </EffectComposer>
          </PerformanceMonitor>
        </SceneStoreContext.Provider>
      </Canvas>
      <StatusLine view={view} />
      <Legend />
      {!view.snapshot && (
        <div
          style={{
            ...overlayText,
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: HALYARD.fgMuted,
          }}
        >
          awaiting telemetry
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
