import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { CiState, OrchPhase } from '@fleet/shared';
import { easing, ease } from '@fleet/ui';
import { anchorOffset, clamp, hash01, taskOrbitRadius, TASKS_PER_RING, vec3 } from './layout';
import { useSceneStore } from './store';
import { FONTS, useVizTheme } from './theme';

export interface StationData {
  id: string;
  name: string;
  orch: boolean;
  phase: OrchPhase | null;
  scale: number;
  x: number;
  y: number;
  z: number;
  agents: number;
  working: number;
  taskCount: number;
  review: number;
  running: number;
  ci: CiState;
  /** layout order, used to stagger the first-load choreography */
  index: number;
  /** blocked tasks + waiting agents: the "needs you" count (signal orange) */
  needs: number;
}

/** Tick-marked dial ring (instrument bezel) as line segments in the xz plane. */
function dialGeometry(radius: number, ticks: number, major: number, len: number): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const l = i % major === 0 ? len * 2.2 : len;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push(c * radius, 0, s * radius, c * (radius + l), 0, s * (radius + l));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** Floor crosshair + footprint. */
function crossGeometry(r: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const k = r * 0.35;
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -r - k,
        0,
        0,
        -r + k,
        0,
        0,
        r - k,
        0,
        0,
        r + k,
        0,
        0,
        0,
        0,
        -r - k,
        0,
        0,
        -r + k,
        0,
        0,
        r - k,
        0,
        0,
        r + k,
      ],
      3,
    ),
  );
  return g;
}

const shared = {
  ico: new THREE.IcosahedronGeometry(0.42, 0),
  oct: new THREE.OctahedronGeometry(0.46, 0),
  pip: new THREE.IcosahedronGeometry(0.11, 2),
  tether: new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3),
  ),
  floor: new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2),
  pillar: new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, -0.8, 0, 0, 0.5, 0], 3),
  ),
  orb: new THREE.IcosahedronGeometry(0.11, 1),
  gate: new THREE.TorusGeometry(0.42, 0.008, 4, 64),
  gateInner: new THREE.TorusGeometry(0.3, 0.005, 4, 48),
  bracket: new THREE.TorusGeometry(1, 0.012, 4, 24, Math.PI / 4),
  /** the halyard: a hairline mast that raises a signal pennant when a station needs you */
  mast: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3)),
  pennant: (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.62, -0.17, 0, 0, -0.34, 0], 3));
    g.computeVertexNormals();
    return g;
  })(),
};
const MAST_H = 3.1;
const RAISE = 0.42;

const tmpColor = new THREE.Color();
const tmpOff = vec3();
/** first-load choreography: the harbour fades up station by station (cinematic, land easing) */
export const INTRO_DELAY = 0.2;
export const INTRO_STAGGER = 0.09;
export const INTRO_DUR = 0.9;
const ALERT_DUR = 0.64;

function StationImpl({
  d,
  selected,
  onSelect,
}: {
  d: StationData;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const store = useSceneStore();
  const vt = useVizTheme();
  const needs = d.needs > 0;
  const base = needs ? vt.accent : d.orch ? vt.phase[d.phase ?? 'idle'] : vt.fgMuted;
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const wire = useRef<THREE.MeshBasicMaterial>(null);
  const intro = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const r1 = useRef<THREE.Group>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const dial = useRef<THREE.LineSegments>(null);
  const sel = useRef<THREE.Group>(null);
  const gateRef = useRef<THREE.Group>(null);
  const orbMat = useRef<THREE.MeshBasicMaterial>(null);
  const label = useRef<HTMLDivElement>(null);
  const mast = useRef<THREE.Group>(null);
  const pennant = useRef<THREE.Mesh>(null);
  const raisedAt = useRef<number | null>(null);
  if (needs && raisedAt.current === null) raisedAt.current = store.t;
  if (!needs) raisedAt.current = null;
  const labelOp = useRef(-1);
  const phase = useMemo(() => hash01(d.id) * Math.PI * 2, [d.id]);
  const colors = useMemo(
    () => ({
      base: new THREE.Color(base),
      line: new THREE.Color(vt.fg),
      accent: new THREE.Color(vt.accent),
      signal: new THREE.Color(vt.accent).multiplyScalar(vt.gain(2.4)),
      danger: new THREE.Color(vt.danger),
      focus: new THREE.Color(vt.focus).multiplyScalar(vt.gain(1.5)),
      gate: new THREE.Color(vt.warn).multiplyScalar(d.review > 0 ? vt.gain(1.5) : vt.dark ? 0.5 : 0.8),
      ci: new THREE.Color(vt.ci[d.ci]),
    }),
    [base, vt, d.review, d.ci],
  );
  const s = d.scale;

  const geos = useMemo(
    () => ({
      ring1: new THREE.TorusGeometry(1.15 * s, 0.005, 4, 160),
      ring2: new THREE.TorusGeometry(0.9 * s, 0.004, 4, 128, Math.PI * 1.4),
      dial: dialGeometry(1.45 * s, 72, 6, 0.05),
      cross: crossGeometry(1.9 * s),
      guides: Array.from({ length: Math.ceil(d.taskCount / TASKS_PER_RING) }, (_, i) => ({
        geo: new THREE.TorusGeometry(taskOrbitRadius(i, s), 0.0035, 3, 160),
        tilt: -Math.atan((0.18 + i * 0.08) * (i % 2 === 0 ? 1 : -1)),
      })),
    }),
    [s, d.taskCount],
  );
  useEffect(
    () => () => {
      geos.ring1.dispose();
      geos.ring2.dispose();
      geos.dial.dispose();
      geos.cross.dispose();
      for (const g of geos.guides) g.geo.dispose();
    },
    [geos],
  );

  const gatePos = useMemo(() => {
    const o = anchorOffset('review', d, s, 0, tmpOff);
    return new THREE.Vector3(o.x, o.y, o.z);
  }, [d, s]);
  const ciPos = useMemo(() => {
    const o = anchorOffset('ci', d, s, 0, tmpOff);
    return new THREE.Vector3(o.x, o.y, o.z);
  }, [d, s]);

  useFrame((_, dtRaw) => {
    const dt = store.reduced ? 0 : Math.min(dtRaw, 0.05);
    const t = store.t;
    // intro: fade up in layout order
    const iu = store.reduced ? 1 : clamp((t - INTRO_DELAY - d.index * INTRO_STAGGER) / INTRO_DUR, 0, 1);
    const ie = ease(easing.land, iu);
    if (intro.current) {
      intro.current.position.y = -(1 - ie) * 0.9;
      intro.current.scale.setScalar(0.9 + 0.1 * ie);
    }
    if (label.current && Math.abs(labelOp.current - ie) > 0.004) {
      labelOp.current = ie;
      label.current.style.opacity = String(ie);
    }
    const activity = store.activityAt.get(d.id);
    const recent = activity === undefined ? 0 : Math.max(0, 1 - (t - activity) / 1.2);
    const busy = Math.min(1, d.working / 4 + d.running / 6);
    // one-shot alert (overshoot pulse); persistent state stays a static glow
    const al = store.alerts.get(d.id);
    const au = al ? (t - al.start) / ALERT_DUR : 1;
    const alerting = au >= 0 && au < 1;
    const pulse = alerting ? Math.sin(Math.PI * ease(easing.alert, au)) : 0;
    const live = (d.orch && d.phase !== 'idle') || d.working > 0;
    const k = (needs ? 3 : live ? 1.7 + busy * 0.9 : 0.8) + recent * 0.8 + pulse * 2.5;
    const alertColor = al?.kind === 'fail' ? colors.danger : colors.accent;
    if (coreMat.current) {
      coreMat.current.emissive.copy(alerting ? alertColor : colors.base);
      coreMat.current.emissiveIntensity = vt.gain(k) * ie;
    }
    if (core.current) {
      core.current.scale.setScalar(s * (1 + 0.35 * pulse));
      core.current.rotation.y += dt * busy * 0.5;
    }
    if (wire.current) {
      tmpColor.copy(alerting ? alertColor : colors.line);
      wire.current.color.copy(tmpColor);
      wire.current.opacity = (vt.dark ? 0.32 : 0.45) + recent * 0.2 + pulse * 0.4;
    }
    // motion means work: rings turn only while the station is busy
    const spin = busy * 0.25;
    if (r2.current) r2.current.rotation.z += dt * spin;
    if (dial.current) dial.current.rotation.y -= dt * spin * 0.25;
    if (r1.current) r1.current.rotation.z += dt * spin * 0.15;
    if (sel.current) sel.current.visible = selected;
    if (mast.current && raisedAt.current !== null) {
      // raise the flag once (land), then hold still; a fresh alert re-runs the overshoot on the pennant
      const ru = store.reduced ? 1 : clamp((t - Math.max(raisedAt.current, INTRO_DELAY + d.index * INTRO_STAGGER + INTRO_DUR * 0.6)) / RAISE, 0, 1);
      const re = ease(easing.land, ru);
      mast.current.scale.set(1, Math.max(0.001, re), 1);
      if (pennant.current) {
        pennant.current.scale.setScalar(Math.max(0.001, re) * (1 + 0.5 * pulse));
        pennant.current.rotation.y = phase;
      }
    }
    if (gateRef.current && d.review > 0) gateRef.current.rotation.y += dt * 0.35;
    if (orbMat.current) orbMat.current.color.copy(colors.ci).multiplyScalar(vt.gain(d.ci === 'none' ? 0.8 : 1.5));
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(d.id);
  };
  const status = needs
    ? `needs you · ${d.needs}`
    : d.orch
      ? `${d.phase ?? 'idle'} · ${d.taskCount} tasks`
      : d.working > 0
        ? 'working'
        : 'idle';
  const lineOp = vt.dark ? 1 : 1.8;
  const hairline = (opacity: number) => (
    <meshBasicMaterial color={colors.line} transparent opacity={Math.min(1, opacity * lineOp)} depthWrite={false} toneMapped={false} />
  );

  return (
    <group position={[d.x, d.y, d.z]}>
      <group ref={intro}>
        {/* tether + floor footprint */}
        <lineSegments geometry={shared.tether} position={[0, -d.y, 0]} scale={[1, d.y - 0.6 * s, 1]}>
          <lineBasicMaterial color={colors.line} transparent opacity={0.14 * lineOp} depthWrite={false} />
        </lineSegments>
        <mesh geometry={shared.floor} position={[0, -d.y + 0.01, 0]} scale={1.15 * s}>
          {hairline(0.08)}
        </mesh>
        <lineSegments geometry={geos.cross} position={[0, -d.y + 0.01, 0]} scale={0.6}>
          <lineBasicMaterial color={colors.line} transparent opacity={0.18 * lineOp} depthWrite={false} />
        </lineSegments>

        {/* core: a dark faceted hull around one emissive pip (the only bloom source) */}
        <group ref={core} scale={s}>
          <mesh geometry={d.orch ? shared.ico : shared.oct} onClick={click}>
            <meshStandardMaterial
              color={vt.coreBody}
              emissive={base}
              emissiveIntensity={vt.dark ? 0.12 : 0.05}
              metalness={vt.dark ? 0.7 : 0.2}
              roughness={vt.dark ? 0.32 : 0.6}
              flatShading
              transparent
              opacity={0.9}
            />
          </mesh>
          <mesh geometry={shared.pip}>
            <meshStandardMaterial ref={coreMat} color="#000000" emissive={base} emissiveIntensity={1} toneMapped={false} />
          </mesh>
          <mesh geometry={d.orch ? shared.ico : shared.oct} scale={1.9}>
            <meshBasicMaterial ref={wire} color={colors.line} wireframe transparent opacity={0.35} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>

        {/* hairline gimbal + dial bezel */}
        <group ref={r1}>
          <mesh geometry={geos.ring1} rotation={[Math.PI / 2 + Math.sin(phase) * 0.2, 0, Math.cos(phase) * 0.15]}>
            {hairline(0.45)}
          </mesh>
        </group>
        <mesh ref={r2} geometry={geos.ring2} rotation={[Math.PI / 2.6, 0.4, phase]}>
          {hairline(0.28)}
        </mesh>
        <lineSegments ref={dial} geometry={geos.dial} position={[0, -0.02, 0]}>
          <lineBasicMaterial color={colors.line} transparent opacity={0.26 * lineOp} depthWrite={false} />
        </lineSegments>

        {/* selection: four focus brackets */}
        <group ref={sel} visible={selected}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} geometry={shared.bracket} scale={2.15 * s} rotation={[Math.PI / 2, 0, i * (Math.PI / 2) + Math.PI / 8]}>
              <meshBasicMaterial color={colors.focus} toneMapped={false} />
            </mesh>
          ))}
        </group>

        {/* task orbit guides */}
        {geos.guides.map((g, i) => (
          <group key={i} rotation={[g.tilt, 0, 0]}>
            <mesh geometry={g.geo} rotation={[Math.PI / 2, 0, 0]}>
              {hairline(0.1)}
            </mesh>
          </group>
        ))}

        {/* halyard signal: the scene's focal point when something needs you */}
        {needs && (
          <group ref={mast} position={[0, 0.5 * s, 0]} scale={[1, 0.001, 1]}>
            <lineSegments geometry={shared.mast} scale={[1, MAST_H, 1]}>
              <lineBasicMaterial color={colors.signal} toneMapped={false} />
            </lineSegments>
            <mesh ref={pennant} geometry={shared.pennant} position={[0, MAST_H, 0]}>
              <meshBasicMaterial color={colors.signal} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          </group>
        )}

        {/* review gate */}
        {d.orch && (
          <group position={gatePos} ref={gateRef}>
            <mesh geometry={shared.gate} onClick={click}>
              <meshBasicMaterial color={colors.gate} toneMapped={false} />
            </mesh>
            <mesh geometry={shared.gateInner}>{hairline(0.26)}</mesh>
          </group>
        )}

        {/* CI / deploy beacon */}
        <group position={ciPos}>
          <lineSegments geometry={shared.pillar}>
            <lineBasicMaterial color={colors.line} transparent opacity={0.3 * lineOp} depthWrite={false} />
          </lineSegments>
          <mesh geometry={shared.orb} position={[0, 0.6, 0]} onClick={click}>
            <meshBasicMaterial ref={orbMat} color={colors.ci} toneMapped={false} />
          </mesh>
        </group>

        <Html position={[0, 1.45 * s + 0.75, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div ref={label} style={{ textAlign: 'center', whiteSpace: 'nowrap', opacity: 0 }}>
            <div
              className="fl-viz-name"
              style={{
                fontFamily: FONTS.display,
                color: selected ? vt.focus : vt.fg,
                fontSize: 'clamp(15px, 1.25vw, 24px)',
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
                textShadow: vt.dark ? '0 1px 14px rgba(11,13,12,0.95)' : '0 0 10px rgba(243,240,232,0.95)',
              }}
            >
              {d.name}
            </div>
            <div
              className="fl-viz-sub"
              data-needs={needs ? '1' : '0'}
              style={{
                fontFamily: FONTS.mono,
                color: needs ? vt.accent : vt.fgSubtle,
                fontSize: 10,
                letterSpacing: FONTS.trackingCaps,
                textTransform: 'uppercase',
                marginTop: 4,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {status}
              <span style={{ color: vt.fgSubtle }}>
                {' '}
                · {d.working}/{d.agents}
              </span>
            </div>
          </div>
        </Html>
      </group>
    </group>
  );
}

export const Station = memo(StationImpl);
