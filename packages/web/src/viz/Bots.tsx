import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent, AgentStatus } from '@fleet/shared';
import { easing, ease } from '@fleet/ui';
import { arcPoint, clamp, damp, flightDuration, hash01, hoverOffset, locationKey, vec3 } from './layout';
import { INTRO_DELAY, INTRO_STAGGER } from './Station';
import { useSceneStore } from './store';
import { ROLE_SCALE, ROLE_SHAPES, useVizTheme, type BotShape } from './theme';

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
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/** static glow per status: persistent states never loop (DESIGN.md motion language) */
const STATUS_INTENSITY: Record<AgentStatus, number> = {
  working: 1.7,
  waiting: 2.4,
  idle: 0.75,
  done: 0.3,
  failed: 2.2,
};
/** first-load landing: vessels drop in, army by army, 24ms apart (max 8 staggered, then together) */
const INTRO_DROP = 3.5;
const INTRO_LAND = 0.9;
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
  /** first-load landing (vertical drop with land easing) instead of an arc */
  landing: boolean;
  /** per-bot hover clock: advances only while working */
  hoverT: number;
}

function BotImpl({
  agent,
  order,
  selected,
  onSelect,
}: {
  agent: Agent;
  /** index among its project's agents (intro stagger) */
  order: number;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const store = useSceneStore();
  const vt = useVizTheme();
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const sel = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => hash01(agent.id), [agent.id]);
  const shape = ROLE_SHAPES[agent.role];
  const size = ROLE_SCALE[agent.role] * (agent.status === 'done' ? 0.7 : 1);
  const color =
    agent.status === 'failed' ? vt.danger : agent.status === 'waiting' ? vt.accent : vt.model[agent.model];
  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const trailColor = useMemo(() => new THREE.Color(color).multiplyScalar(vt.gain(1.1)), [color, vt]);
  const wireColor = useMemo(() => new THREE.Color(color).multiplyScalar(vt.dark ? 0.7 : 1), [color, vt]);
  const selColor = useMemo(() => new THREE.Color(vt.focus).multiplyScalar(vt.gain(1.5)), [vt]);
  const status = agent.status;

  // initial position: spawned bots emerge from their station core, initial-load bots start in place
  const [motion] = useState<Motion>(() => {
    const loc = store.effectiveLocation(agent);
    const r = store.resolveLocation(loc, agent.projectId, target);
    const fresh = store.t > 1.5;
    const from = new THREE.Vector3();
    const hoverT = phase * 20;
    const l = store.layouts.get(agent.projectId);
    if (fresh) {
      if (l) from.copy(l.pos);
      else from.copy(target);
    } else {
      hoverOffset(phase, hoverT, r, hov);
      from.set(target.x + hov.x, target.y + hov.y + (store.reduced ? 0 : INTRO_DROP), target.z + hov.z);
    }
    const intro = !fresh && !store.reduced;
    return {
      key: fresh ? '' : locationKey(loc.kind, loc.projectId, loc.ref),
      from,
      start: intro
        ? INTRO_DELAY + (l?.index ?? 0) * INTRO_STAGGER + 0.35 + Math.min(order, 8) * 0.024
        : store.t,
      dur: INTRO_LAND,
      flying: intro,
      landing: intro,
      hoverT,
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
    const live = store.agents.get(agent.id) ?? agent;
    const loc = store.effectiveLocation(live);
    const radius = store.resolveLocation(loc, live.projectId, target);
    const working = live.status === 'working';
    if (working) motion.hoverT += dt;
    hoverOffset(phase, motion.hoverT, radius * (working ? 1 : 1.15), hov);
    target.x += hov.x;
    target.y += hov.y;
    target.z += hov.z;
    const key = locationKey(loc.kind, loc.projectId, loc.ref);
    if (key !== motion.key && !motion.landing) {
      motion.key = key;
      motion.from.copy(pos);
      motion.start = t;
      const dist = pos.distanceTo(target);
      motion.dur = flightDuration(dist);
      motion.flying = !store.reduced && dist > 0.25;
      if (store.reduced) pos.copy(target);
    }
    if (motion.landing) {
      const u = (t - motion.start) / motion.dur;
      g.visible = u >= 0;
      const e = ease(easing.land, clamp(u, 0, 1));
      pos.set(target.x, target.y + (1 - e) * INTRO_DROP, target.z);
      if (u >= 1) {
        motion.landing = false;
        motion.flying = false;
        motion.key = key;
      }
    } else if (motion.flying) {
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
      const spin = working ? 1.2 : 0;
      body.current.rotation.y += dt * (spin + (motion.flying ? 3 : 0));
      body.current.rotation.x = 0.35 * Math.sin(phase * 7);
    }
    if (mat.current) {
      let k = STATUS_INTENSITY[live.status];
      if (motion.flying) k *= 1.3;
      mat.current.emissiveIntensity = vt.gain(k);
    }
    if (sel.current) {
      sel.current.visible = selected;
      sel.current.rotation.x = Math.PI / 2;
      sel.current.rotation.z += dt * 0.8;
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(agent.id);
  };

  const g = botGeometries()[shape];
  return (
    <>
      <group ref={group} position={initialPos} visible={!motion.landing}>
        <mesh ref={body} geometry={g} scale={size}>
          <meshStandardMaterial
            ref={mat}
            color={vt.coreBody}
            emissive={baseColor}
            emissiveIntensity={vt.gain(STATUS_INTENSITY[status])}
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
          <meshBasicMaterial color={selColor} toneMapped={false} />
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
