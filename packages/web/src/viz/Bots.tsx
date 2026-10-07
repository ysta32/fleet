import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent, AgentStatus } from '@fleet/shared';
import { arcPoint, damp, flightDuration, hash01, hoverOffset, locationKey, vec3 } from './layout';
import { useSceneStore } from './store';
import { MODEL_COLORS, ROLE_SCALE, ROLE_SHAPES, THEME, type BotShape } from './theme';

let geos: Record<BotShape, THREE.BufferGeometry> | null = null;
function botGeometries(): Record<BotShape, THREE.BufferGeometry> {
  if (!geos) {
    geos = {
      diamond: new THREE.OctahedronGeometry(1, 0).scale(0.8, 1.45, 0.8),
      cube: new THREE.BoxGeometry(1.25, 1.25, 1.25),
      tetra: new THREE.TetrahedronGeometry(1.3, 0),
      sphere: new THREE.IcosahedronGeometry(0.95, 2),
      torus: new THREE.TorusGeometry(0.8, 0.3, 10, 28),
      cone: new THREE.ConeGeometry(0.85, 1.6, 6),
      ico: new THREE.IcosahedronGeometry(1, 0),
    };
  }
  return geos;
}
const hitGeo = new THREE.SphereGeometry(1, 8, 6);
const selGeo = new THREE.TorusGeometry(1, 0.025, 4, 48);
const SEL_COLOR = new THREE.Color(THEME.accent).multiplyScalar(1.6);
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

const STATUS_INTENSITY: Record<AgentStatus, number> = {
  working: 1.9,
  waiting: 1.3,
  idle: 0.8,
  done: 0.35,
  failed: 2.2,
};
const trailAttenuation = (w: number) => w * w;

// per-frame scratch (shared by all bots; each frame is processed sequentially)
const target = new THREE.Vector3();
const flyTmp = vec3();
const fromV = vec3();
const toV = vec3();
const hov = vec3();

interface Motion {
  key: string;
  from: THREE.Vector3;
  start: number;
  dur: number;
  flying: boolean;
}

function BotImpl({
  agent,
  selected,
  onSelect,
}: {
  agent: Agent;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const store = useSceneStore();
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const sel = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => hash01(agent.id), [agent.id]);
  const shape = ROLE_SHAPES[agent.role];
  const size = ROLE_SCALE[agent.role] * (agent.status === 'done' ? 0.7 : 1);
  const color = agent.status === 'failed' ? THEME.failure : MODEL_COLORS[agent.model];
  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const trailColor = useMemo(() => new THREE.Color(color).multiplyScalar(1.15), [color]);
  const wireColor = useMemo(() => new THREE.Color(color).multiplyScalar(0.8), [color]);
  const status = agent.status;

  // initial position: spawned bots emerge from their station core, initial-load bots start in place
  const [motion] = useState<Motion>(() => {
    const loc = store.effectiveLocation(agent);
    const r = store.resolveLocation(loc, agent.projectId, target);
    const fresh = store.t > 1.5;
    const from = new THREE.Vector3();
    if (fresh) {
      const l = store.layouts.get(agent.projectId);
      if (l) from.copy(l.pos);
      else from.copy(target);
    } else {
      hoverOffset(phase, store.at, r, hov);
      from.set(target.x + hov.x, target.y + hov.y, target.z + hov.z);
    }
    return {
      key: fresh ? '' : locationKey(loc.kind, loc.projectId, loc.ref),
      from,
      start: store.t,
      dur: 1,
      flying: false,
    };
  });
  const [initialPos] = useState<[number, number, number]>(() => [
    motion.from.x,
    motion.from.y,
    motion.from.z,
  ]);
  const pos = useMemo(() => {
    const v = new THREE.Vector3(initialPos[0], initialPos[1], initialPos[2]);
    return v;
  }, [initialPos]);

  useEffect(() => {
    store.botPos.set(agent.id, pos);
    return () => {
      if (store.botPos.get(agent.id) === pos) store.botPos.delete(agent.id);
    };
  }, [store, agent.id, pos]);

  useFrame((_, dtRaw) => {
    const g = group.current;
    if (!g) return;
    const dt = store.reduced ? 0 : Math.min(dtRaw, 0.05);
    const t = store.t;
    const at = store.at;
    const live = store.agents.get(agent.id) ?? agent;
    const loc = store.effectiveLocation(live);
    const radius = store.resolveLocation(loc, live.projectId, target);
    const idle = live.status !== 'working';
    hoverOffset(phase, at * (idle ? 0.6 : 1), radius * (idle ? 1.15 : 1), hov);
    target.x += hov.x;
    target.y += hov.y;
    target.z += hov.z;
    const key = locationKey(loc.kind, loc.projectId, loc.ref);
    if (key !== motion.key) {
      motion.key = key;
      motion.from.copy(pos);
      motion.start = t;
      const dist = pos.distanceTo(target);
      motion.dur = flightDuration(dist);
      motion.flying = !store.reduced && dist > 0.25;
      if (store.reduced) pos.copy(target);
    }
    if (motion.flying) {
      const u = (t - motion.start) / motion.dur;
      if (u >= 1) motion.flying = false;
      fromV.x = motion.from.x;
      fromV.y = motion.from.y;
      fromV.z = motion.from.z;
      toV.x = target.x;
      toV.y = target.y;
      toV.z = target.z;
      arcPoint(fromV, toV, Math.min(1, u), flyTmp);
      pos.set(flyTmp.x, flyTmp.y, flyTmp.z);
    } else {
      if (store.reduced) pos.copy(target);
      else pos.lerp(target, damp(5, dt));
    }
    g.position.copy(pos);
    if (body.current) {
      const spin = live.status === 'working' ? 1.6 : 0.5;
      body.current.rotation.y += dt * spin * (motion.flying ? 3 : 1);
      body.current.rotation.x = Math.sin(at * 1.1 + phase * 7) * 0.4;
    }
    if (mat.current) {
      let k = STATUS_INTENSITY[live.status];
      if (live.status === 'working') k *= 0.8 + 0.3 * Math.sin(at * 4 + phase * 9);
      if (live.status === 'failed') k *= Math.sin(at * 10) > 0 ? 1 : 0.25;
      if (live.status === 'waiting') k *= 0.7 + 0.5 * Math.abs(Math.sin(at * 2));
      if (motion.flying) k *= 1.4;
      mat.current.emissiveIntensity = k;
    }
    if (sel.current) {
      sel.current.visible = selected;
      sel.current.rotation.x = Math.PI / 2 + Math.sin(at * 2) * 0.2;
      sel.current.rotation.z += dt * 2;
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(agent.id);
  };

  const g = botGeometries()[shape];
  return (
    <>
      <group ref={group} position={initialPos}>
        <mesh ref={body} geometry={g} scale={size}>
          <meshStandardMaterial
            ref={mat}
            color="#0a0f18"
            emissive={baseColor}
            emissiveIntensity={STATUS_INTENSITY[status]}
            metalness={0.4}
            roughness={0.3}
            flatShading
            toneMapped={false}
          />
        </mesh>
        <mesh geometry={g} scale={size * 1.3}>
          <meshBasicMaterial
            color={wireColor}
            wireframe
            transparent
            opacity={0.35}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={sel} geometry={selGeo} scale={size * 2.4} visible={selected}>
          <meshBasicMaterial color={SEL_COLOR} toneMapped={false} />
        </mesh>
        <mesh geometry={hitGeo} material={hitMat} scale={Math.max(0.45, size * 2)} onClick={click} />
      </group>
      {status !== 'done' && (
        <Trail
          target={group}
          width={size * 3.2}
          length={4}
          decay={1}
          attenuation={trailAttenuation}
          color={trailColor}
        />
      )}
    </>
  );
}

export const Bot = memo(BotImpl);
