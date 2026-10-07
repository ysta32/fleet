import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { CiState, OrchPhase } from '@fleet/shared';
import { anchorOffset, hash01, taskOrbitRadius, TASKS_PER_RING, vec3 } from './layout';
import { useSceneStore } from './store';
import { CI_COLORS, HALYARD, PHASE_COLORS, THEME } from './theme';

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
};

const tmpColor = new THREE.Color();
const tmpOff = vec3();
const BONE = new THREE.Color(THEME.hairline);
const DANGER = new THREE.Color(THEME.failure);
const ACCENT_HDR = new THREE.Color(HALYARD.accent).multiplyScalar(1.6);

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
  const base = d.orch ? PHASE_COLORS[d.phase ?? 'idle'] : THEME.stationPlain;
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const wire = useRef<THREE.MeshBasicMaterial>(null);
  const core = useRef<THREE.Group>(null);
  const r1 = useRef<THREE.Group>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const dial = useRef<THREE.LineSegments>(null);
  const sel = useRef<THREE.Group>(null);
  const gateRef = useRef<THREE.Group>(null);
  const orbMat = useRef<THREE.MeshBasicMaterial>(null);
  const phase = useMemo(() => hash01(d.id) * Math.PI * 2, [d.id]);
  const baseColor = useMemo(() => new THREE.Color(base), [base]);
  const s = d.scale;

  const geos = useMemo(
    () => ({
      ring1: new THREE.TorusGeometry(1.15 * s, 0.006, 4, 160),
      ring2: new THREE.TorusGeometry(0.9 * s, 0.005, 4, 128, Math.PI * 1.4),
      dial: dialGeometry(1.45 * s, 72, 6, 0.05),
      cross: crossGeometry(1.9 * s),
      guides: Array.from({ length: Math.ceil(d.taskCount / TASKS_PER_RING) }, (_, i) => ({
        geo: new THREE.TorusGeometry(taskOrbitRadius(i, s), 0.004, 3, 160),
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
  const gateColor = useMemo(
    () => new THREE.Color(THEME.gate).multiplyScalar(d.review > 0 ? 1.7 : 0.55),
    [d.review],
  );
  const ciColor = useMemo(() => new THREE.Color(CI_COLORS[d.ci]), [d.ci]);

  useFrame((_, dtRaw) => {
    const dt = store.reduced ? 0 : Math.min(dtRaw, 0.05);
    const t = store.t;
    const at = store.at;
    const activity = store.activityAt.get(d.id);
    const recent = activity === undefined ? 0 : Math.max(0, 1 - (t - activity) / 1.2);
    const flick = (store.flicker.get(d.id) ?? 0) > t;
    const busy = Math.min(1, d.working / 4 + d.running / 6);
    const breathe = 0.5 + 0.5 * Math.sin(at * (1 + busy * 1.2) + phase);
    let k =
      (d.orch && d.phase !== 'idle') || d.working > 0
        ? 2.4 + busy * 1.6 + breathe * 0.8 + recent * 1.6
        : 1.1 + recent * 1.2;
    if (flick) k = store.reduced ? 4 : Math.sin(t * 38) > 0 ? 0.3 : 5;
    if (coreMat.current) {
      coreMat.current.emissive.copy(flick ? DANGER : baseColor);
      coreMat.current.emissiveIntensity = k;
    }
    if (wire.current) {
      tmpColor.copy(flick ? DANGER : BONE).multiplyScalar(0.55 + recent * 0.35);
      wire.current.color.copy(tmpColor);
    }
    const spin = 0.12 + busy * 0.3;
    if (core.current) {
      core.current.rotation.y += dt * spin * 2;
      core.current.rotation.x = Math.sin(at * 0.3 + phase) * 0.2;
      core.current.position.y = Math.sin(at * 0.7 + phase) * 0.08;
    }
    if (r1.current) {
      r1.current.rotation.x = Math.sin(at * 0.25 + phase) * 0.22;
      r1.current.rotation.z = Math.cos(at * 0.21 + phase) * 0.18;
    }
    if (r2.current) r2.current.rotation.z += dt * spin;
    if (dial.current) dial.current.rotation.y -= dt * 0.05;
    if (sel.current) {
      sel.current.visible = selected;
      sel.current.rotation.y += dt * 0.4;
    }
    if (gateRef.current) gateRef.current.rotation.y += dt * 0.35;
    if (orbMat.current) {
      const p =
        d.ci === 'pending'
          ? 0.8 + (store.reduced ? 0.4 : 0.6 * Math.abs(Math.sin(at * 2.5)))
          : d.ci === 'none'
            ? 0.7
            : 1.5;
      orbMat.current.color.copy(ciColor).multiplyScalar(p);
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(d.id);
  };
  const sub = d.orch
    ? `${d.phase ?? 'idle'} · ${d.taskCount} tasks · ${d.working}/${d.agents} agents`
    : `${d.working}/${d.agents} agents`;
  const hairline = (opacity: number) => (
    <meshBasicMaterial color={BONE} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
  );

  return (
    <group position={[d.x, d.y, d.z]}>
      {/* tether + floor footprint */}
      <lineSegments geometry={shared.tether} position={[0, -d.y, 0]} scale={[1, d.y - 0.6 * s, 1]}>
        <lineBasicMaterial color={BONE} transparent opacity={0.16} depthWrite={false} />
      </lineSegments>
      <mesh geometry={shared.floor} position={[0, -d.y + 0.01, 0]} scale={1.9 * s}>
        {hairline(0.12)}
      </mesh>
      <lineSegments geometry={geos.cross} position={[0, -d.y + 0.01, 0]}>
        <lineBasicMaterial color={BONE} transparent opacity={0.28} depthWrite={false} />
      </lineSegments>

      {/* emissive core: the only bloom source on a station */}
      <group ref={core} scale={s}>
        <mesh geometry={d.orch ? shared.ico : shared.oct} onClick={click}>
          <meshStandardMaterial
            color="#1c1915"
            emissive={base}
            emissiveIntensity={0.16}
            metalness={0.7}
            roughness={0.32}
            flatShading
            transparent
            opacity={0.88}
          />
        </mesh>
        <mesh geometry={shared.pip}>
          <meshStandardMaterial
            ref={coreMat}
            color="#000000"
            emissive={base}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
        <mesh geometry={d.orch ? shared.ico : shared.oct} scale={1.9}>
          <meshBasicMaterial
            ref={wire}
            color={BONE}
            wireframe
            transparent
            opacity={0.4}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* hairline gimbal + dial bezel */}
      <group ref={r1}>
        <mesh geometry={geos.ring1} rotation={[Math.PI / 2, 0, 0]}>
          {hairline(0.5)}
        </mesh>
      </group>
      <mesh ref={r2} geometry={geos.ring2} rotation={[Math.PI / 2.6, 0.4, 0]}>
        {hairline(0.32)}
      </mesh>
      <lineSegments ref={dial} geometry={geos.dial} position={[0, -0.02, 0]}>
        <lineBasicMaterial color={BONE} transparent opacity={0.3} depthWrite={false} />
      </lineSegments>

      {/* selection: four accent brackets */}
      <group ref={sel} visible={selected}>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            geometry={shared.bracket}
            scale={2.15 * s}
            rotation={[Math.PI / 2, 0, i * (Math.PI / 2) + Math.PI / 8]}
          >
            <meshBasicMaterial color={ACCENT_HDR} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* task orbit guides */}
      {geos.guides.map((g, i) => (
        <group key={i} rotation={[g.tilt, 0, 0]}>
          <mesh geometry={g.geo} rotation={[Math.PI / 2, 0, 0]}>
            {hairline(0.12)}
          </mesh>
        </group>
      ))}

      {/* review gate */}
      {d.orch && (
        <group position={gatePos} ref={gateRef}>
          <mesh geometry={shared.gate} onClick={click}>
            <meshBasicMaterial color={gateColor} toneMapped={false} />
          </mesh>
          <mesh geometry={shared.gateInner}>{hairline(0.3)}</mesh>
        </group>
      )}

      {/* CI / deploy beacon */}
      <group position={ciPos}>
        <lineSegments geometry={shared.pillar}>
          <lineBasicMaterial color={BONE} transparent opacity={0.35} depthWrite={false} />
        </lineSegments>
        <mesh geometry={shared.orb} position={[0, 0.6, 0]} onClick={click}>
          <meshBasicMaterial ref={orbMat} color={ciColor} toneMapped={false} />
        </mesh>
      </group>

      <Html
        position={[0, 1.45 * s + 0.75, 0]}
        center
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
          <div
            style={{
              fontFamily: HALYARD.fontDisplay,
              color: selected ? HALYARD.accent : HALYARD.fg,
              fontSize: 22,
              lineHeight: 1.05,
              letterSpacing: '-0.01em',
              textShadow: '0 1px 12px rgba(11,13,12,0.9)',
            }}
          >
            {d.name}
          </div>
          <div
            style={{
              fontFamily: HALYARD.fontMono,
              color: HALYARD.fgSubtle,
              fontSize: 10,
              letterSpacing: HALYARD.trackingCaps,
              textTransform: 'uppercase',
              marginTop: 3,
            }}
          >
            <span style={{ color: base, marginRight: 6 }}>●</span>
            {sub}
          </div>
        </div>
      </Html>
    </group>
  );
}

export const Station = memo(StationImpl);
