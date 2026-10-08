import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Agent, AgentStatus } from '@fleet/shared';
import { easing, ease } from '@fleet/ui';
import {
  arcPoint,
  clamp,
  damp,
  flightDuration,
  hash01,
  hoverOffset,
  INTRO_DELAY,
  INTRO_STAGGER,
  locationKey,
  vec3,
} from './layout';
import { useSceneStore, type SceneStore } from './store';
import { ROLE_SCALE, ROLE_SHAPES, useVizTheme, type BotShape, type VizTheme } from './theme';

/**
 * Every vessel in one pass: bodies are instanced per role shape (7 draw calls total), hit-testing
 * is one instanced proxy, and travel trails are ATC-style history dots in a single Points buffer.
 * All per-bot state lives in preallocated records; the frame loop allocates nothing.
 */

const SHAPES: BotShape[] = ['diamond', 'cube', 'tetra', 'sphere', 'torus', 'cone', 'ico'];
let geos: Record<BotShape, THREE.BufferGeometry> | null = null;
function botGeometries(): Record<BotShape, THREE.BufferGeometry> {
  if (!geos) {
    geos = {
      diamond: new THREE.OctahedronGeometry(1, 0).scale(0.8, 1.45, 0.8),
      cube: new THREE.BoxGeometry(1.2, 1.2, 1.2),
      tetra: new THREE.TetrahedronGeometry(1.3, 0),
      sphere: new THREE.IcosahedronGeometry(0.95, 1),
      torus: new THREE.TorusGeometry(0.8, 0.28, 6, 20),
      cone: new THREE.ConeGeometry(0.85, 1.6, 6),
      ico: new THREE.IcosahedronGeometry(1, 0),
    };
  }
  return geos;
}
const hitGeo = new THREE.SphereGeometry(1, 8, 6);
const selGeo = new THREE.RingGeometry(1, 1.06, 48).rotateX(-Math.PI / 2);

/** static glow per status: persistent states never loop (DESIGN.md motion language) */
const STATUS_INTENSITY: Record<AgentStatus, number> = {
  working: 1.6,
  waiting: 2.6,
  idle: 0.7,
  done: 0.3,
  failed: 2.3,
};
/** first-load landing: vessels drop in, army by army, 24ms apart (max 8 staggered, then together) */
const INTRO_DROP = 3.5;
const INTRO_LAND = 0.9;
/** history dots per vessel (sampled while travelling only: a trail means a trip) */
export const TRAIL_N = 18;
const TRAIL_EVERY = 0.045;
const TRAIL_LIFE = TRAIL_N * TRAIL_EVERY;

export interface BotEntry {
  a: Agent;
  order: number;
}

export interface BotRec {
  id: string;
  /** dense index into the hit proxy + trail buffer */
  slot: number;
  /** shape bucket + index inside it */
  shape: number;
  shapeSlot: number;
  agent: Agent;
  phase: number;
  size: number;
  color: THREE.Color;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  key: string;
  start: number;
  dur: number;
  flying: boolean;
  landing: boolean;
  hoverT: number;
  spin: number;
  /** last seek epoch seen; a new epoch (replay scrub) snaps instead of flying */
  epoch: number;
  trail: Float32Array;
  trailT: Float32Array;
  trailHead: number;
  lastSample: number;
}

// per-frame scratch (shared; each frame is processed sequentially)
const target = new THREE.Vector3();
const flyTmp = vec3();
const fromV = vec3();
const toV = vec3();
const hov = vec3();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const s3 = new THREE.Vector3();
const c3 = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Raycast for an instanced mesh whose instances move every frame. three caches the instanced
 * bounding sphere on first raycast, which would make vessels that later travel outside it
 * unclickable. Recomputing lazily here (only when a pointer actually raycasts) keeps the frame loop
 * free of that work.
 */
function raycastMoving(this: THREE.InstancedMesh, rc: THREE.Raycaster, out: THREE.Intersection[]): void {
  if (this.count === 0) return;
  this.computeBoundingSphere();
  THREE.InstancedMesh.prototype.raycast.call(this, rc, out);
}

function botColor(vt: VizTheme, a: Agent): string {
  return a.status === 'failed' ? vt.danger : a.status === 'waiting' ? vt.accent : vt.model[a.model];
}

/** Standard material whose emissive is tinted per instance (instanceColor), so one draw call glows in many colours. */
function bodyMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#ffffff',
    metalness: 0.35,
    roughness: 0.35,
    flatShading: true,
    toneMapped: false,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      'vec3 totalEmissiveRadiance = emissive;',
      'vec3 totalEmissiveRadiance = emissive * vColor.rgb;',
    );
  };
  m.customProgramCacheKey = () => 'fleet-bot-emissive';
  return m;
}

export function initRec(store: SceneStore, e: BotEntry, vt: VizTheme): BotRec {
  const agent = e.a;
  const phase = hash01(agent.id);
  const loc = store.effectiveLocation(agent);
  const r = store.resolveLocation(loc, agent.projectId, target);
  const fresh = store.t > 1.5;
  const from = new THREE.Vector3();
  const hoverT = phase * 20;
  const l = store.layouts.get(agent.projectId);
  if (fresh) {
    // spawned vessels launch from their station core
    if (l) from.copy(l.pos);
    else from.copy(target);
  } else {
    hoverOffset(phase, hoverT, r, hov);
    from.set(target.x + hov.x, target.y + hov.y + (store.reduced ? 0 : INTRO_DROP), target.z + hov.z);
  }
  const intro = !fresh && !store.reduced;
  return {
    id: agent.id,
    slot: 0,
    shape: SHAPES.indexOf(ROLE_SHAPES[agent.role]),
    shapeSlot: 0,
    agent,
    phase,
    size: ROLE_SCALE[agent.role] * (agent.status === 'done' ? 0.7 : 1),
    color: new THREE.Color(botColor(vt, agent)),
    pos: from.clone(),
    from,
    key: fresh ? '' : locationKey(loc.kind, loc.projectId, loc.ref),
    start: intro
      ? INTRO_DELAY + (l?.index ?? 0) * INTRO_STAGGER + 0.35 + Math.min(e.order, 8) * 0.024
      : store.t,
    dur: INTRO_LAND,
    flying: intro,
    landing: intro,
    hoverT,
    spin: phase * Math.PI * 2,
    epoch: store.seekEpoch,
    trail: new Float32Array(TRAIL_N * 3),
    trailT: new Float32Array(TRAIL_N).fill(-1e9),
    trailHead: 0,
    lastSample: -1e9,
  };
}

/** Advance one vessel (writes rec.pos). Exported for the determinism tests. */
export function stepRec(store: SceneStore, rec: BotRec, dt: number): void {
  const t = store.t;
  const live = store.agents.get(rec.id) ?? rec.agent;
  const loc = store.effectiveLocation(live);
  const radius = store.resolveLocation(loc, live.projectId, target);
  const working = live.status === 'working';
  if (store.replaying) {
    rec.hoverT = rec.phase * 20 + store.replaySec;
    rec.spin = (rec.phase * Math.PI * 2 + store.replaySec * 1.1) % (Math.PI * 2);
  } else if (working) rec.hoverT += dt;
  hoverOffset(rec.phase, rec.hoverT, radius * (working ? 1 : 1.15), hov);
  target.x += hov.x;
  target.y += hov.y;
  target.z += hov.z;
  const key = locationKey(loc.kind, loc.projectId, loc.ref);
  const seeked = rec.epoch !== store.seekEpoch;
  if (seeked) {
    // replay scrub / mode switch: the scene is a pure function of the playhead, so snap
    rec.epoch = store.seekEpoch;
    rec.key = key;
    rec.landing = false;
    rec.flying = false;
    rec.pos.copy(target);
    rec.trailT.fill(-1e9);
    return;
  }
  if (key !== rec.key && !rec.landing) {
    rec.key = key;
    rec.from.copy(rec.pos);
    rec.start = t;
    const dist = rec.pos.distanceTo(target);
    rec.dur = flightDuration(dist);
    rec.flying = !store.reduced && dist > 0.25;
    if (store.reduced) rec.pos.copy(target);
  }
  if (rec.landing) {
    const u = (t - rec.start) / rec.dur;
    const e = ease(easing.land, clamp(u, 0, 1));
    rec.pos.set(target.x, target.y + (1 - e) * INTRO_DROP, target.z);
    if (u >= 1) {
      rec.landing = false;
      rec.flying = false;
      rec.key = key;
    }
  } else if (rec.flying) {
    const u = (t - rec.start) / rec.dur;
    if (u >= 1) rec.flying = false;
    fromV.x = rec.from.x;
    fromV.y = rec.from.y;
    fromV.z = rec.from.z;
    toV.x = target.x;
    toV.y = target.y;
    toV.z = target.z;
    arcPoint(fromV, toV, Math.min(1, u), flyTmp);
    rec.pos.set(flyTmp.x, flyTmp.y, flyTmp.z);
    if (t - rec.lastSample >= TRAIL_EVERY) {
      rec.lastSample = t;
      const h = rec.trailHead;
      rec.trail[h * 3] = rec.pos.x;
      rec.trail[h * 3 + 1] = rec.pos.y;
      rec.trail[h * 3 + 2] = rec.pos.z;
      rec.trailT[h] = t;
      rec.trailHead = (h + 1) % TRAIL_N;
    }
  } else if (store.reduced) rec.pos.copy(target);
  else rec.pos.lerp(target, damp(5, dt));
  if (!store.replaying) rec.spin += dt * ((working ? 1.1 : 0) + (rec.flying ? 2.5 : 0));
}

export function Bots({
  entries,
  max,
  selectedId,
  onSelect,
}: {
  entries: BotEntry[];
  /** capacity (instances are preallocated) */
  max: number;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const store = useSceneStore();
  const vt = useVizTheme();
  const recs = useRef(new Map<string, BotRec>());
  const list = useRef<BotRec[]>([]);
  const reconciledEpoch = useRef(store.seekEpoch);
  const counts = useRef<number[]>(SHAPES.map(() => 0));
  const bodies = useRef<(THREE.InstancedMesh | null)[]>([]);
  const hit = useRef<THREE.InstancedMesh>(null);
  const sel = useRef<THREE.Mesh>(null);
  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(max * TRAIL_N * 3), 3);
    const col = new THREE.BufferAttribute(new Float32Array(max * TRAIL_N * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('color', col);
    g.setDrawRange(0, 0);
    return g;
  }, [max]);
  const trailMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        // constant screen size (px, scaled by DPR): radar history dots, not world-space sprites
        size: 3,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        sizeAttenuation: false,
      }),
    [],
  );
  const bodyMats = useMemo(() => SHAPES.map(() => bodyMaterial()), []);
  const hitMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  const selMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }), []);

  useLayoutEffect(() => {
    trailMat.blending = vt.fxBlending;
    trailMat.premultipliedAlpha = !vt.dark;
    trailMat.needsUpdate = true;
    for (const m of bodyMats) {
      m.color.set(vt.coreBody);
      m.emissiveIntensity = vt.dark ? 1 : 0.55;
    }
    selMat.color.set(vt.focus).multiplyScalar(vt.gain(1.6));
    for (const r of recs.current.values()) r.color.set(botColor(vt, r.agent));
  }, [vt, trailMat, bodyMats, selMat]);

  // reconcile records with the snapshot (allocation happens here, never per frame)
  useLayoutEffect(() => {
    // replay (or a fresh seek epoch): new vessels belong to the playhead and appear in place
    const scrubbed = store.replaying || reconciledEpoch.current !== store.seekEpoch;
    reconciledEpoch.current = store.seekEpoch;
    const keep = new Set<string>();
    const next: BotRec[] = [];
    const c = counts.current;
    c.fill(0);
    for (const e of entries) {
      if (next.length >= max) break;
      keep.add(e.a.id);
      let r = recs.current.get(e.a.id);
      if (!r) {
        r = initRec(store, e, vt);
        // created by a scrub: belongs to the new timeline in place (snaps on its first frame)
        if (scrubbed) r.epoch = -1;
        recs.current.set(e.a.id, r);
        store.botPos.set(r.id, r.pos);
      } else {
        r.agent = e.a;
        r.shape = SHAPES.indexOf(ROLE_SHAPES[e.a.role]);
        r.size = ROLE_SCALE[e.a.role] * (e.a.status === 'done' ? 0.7 : 1);
        r.color.set(botColor(vt, e.a));
      }
      r.slot = next.length;
      r.shapeSlot = c[r.shape]!++;
      next.push(r);
    }
    for (const [id, r] of recs.current)
      if (!keep.has(id)) {
        recs.current.delete(id);
        if (store.botPos.get(id) === r.pos) store.botPos.delete(id);
      }
    list.current = next;
    for (let s = 0; s < SHAPES.length; s++) {
      const m = bodies.current[s];
      if (!m) continue;
      m.count = c[s]!;
      if (!m.instanceColor) m.setColorAt(0, c3.set(0, 0, 0));
    }
    if (hit.current) hit.current.count = next.length;
    trailGeo.setDrawRange(0, next.length * TRAIL_N);
  }, [entries, max, store, vt, trailGeo]);

  useLayoutEffect(
    () => () => {
      for (const r of recs.current.values()) if (store.botPos.get(r.id) === r.pos) store.botPos.delete(r.id);
      recs.current.clear();
      trailGeo.dispose();
      trailMat.dispose();
      for (const m of bodyMats) m.dispose();
      hitMat.dispose();
      selMat.dispose();
    },
    [store, trailGeo, trailMat, bodyMats, hitMat, selMat],
  );

  useFrame((_, dtRaw) => {
    const dt = store.reduced ? 0 : Math.min(dtRaw, 0.05);
    const t = store.t;
    const all = list.current;
    const tp = trailGeo.attributes.position as THREE.BufferAttribute;
    const tc = trailGeo.attributes.color as THREE.BufferAttribute;
    const tpa = tp.array as Float32Array;
    const tca = tc.array as Float32Array;
    const h = hit.current;
    let selRec: BotRec | null = null;
    for (let i = 0; i < all.length; i++) {
      const r = all[i]!;
      stepRec(store, r, dt);
      if (r.id === selectedId) selRec = r;
      const live = store.agents.get(r.id) ?? r.agent;
      const visible = !r.landing || t >= r.start;
      const sc = visible ? r.size : 0;
      e3.set(0.35 * Math.sin(r.phase * 7), r.spin, 0);
      q.setFromEuler(e3);
      s3.set(sc, sc, sc);
      m4.compose(r.pos, q, s3);
      const body = bodies.current[r.shape];
      if (body) {
        body.setMatrixAt(r.shapeSlot, m4);
        let k = STATUS_INTENSITY[live.status];
        if (r.flying && !r.landing) k *= 1.35;
        body.setColorAt(r.shapeSlot, c3.copy(r.color).multiplyScalar(vt.gain(k)));
      }
      if (h) {
        const hs = visible ? Math.max(0.45, r.size * 2) : 0;
        s3.set(hs, hs, hs);
        m4.compose(r.pos, q.identity(), s3);
        h.setMatrixAt(i, m4);
      }
      // trail: history dots, oldest faintest; off for vessels that are not travelling
      const base = i * TRAIL_N;
      for (let k = 0; k < TRAIL_N; k++) {
        const o = (base + k) * 3;
        const age = (t - r.trailT[k]!) / TRAIL_LIFE;
        tpa[o] = r.trail[k * 3]!;
        tpa[o + 1] = r.trail[k * 3 + 1]!;
        tpa[o + 2] = r.trail[k * 3 + 2]!;
        const op = age >= 0 && age < 1 ? (1 - age) * (1 - age) : 0;
        if (vt.dark) {
          const g = op * 1.4;
          tca[o] = r.color.r * g;
          tca[o + 1] = r.color.g * g;
          tca[o + 2] = r.color.b * g;
        } else {
          tca[o] = 1 + (r.color.r * 0.85 - 1) * op;
          tca[o + 1] = 1 + (r.color.g * 0.85 - 1) * op;
          tca[o + 2] = 1 + (r.color.b * 0.85 - 1) * op;
        }
      }
    }
    for (let s = 0; s < SHAPES.length; s++) {
      const m = bodies.current[s];
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (h) h.instanceMatrix.needsUpdate = true;
    tp.needsUpdate = true;
    tc.needsUpdate = true;
    const sm = sel.current;
    if (sm) {
      sm.visible = !!selRec;
      if (selRec) {
        sm.position.copy(selRec.pos);
        sm.scale.setScalar(selRec.size * 2.6);
      }
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const r = e.instanceId !== undefined ? list.current[e.instanceId] : undefined;
    if (r) onSelect(r.id);
  };

  const g = botGeometries();
  return (
    <group>
      {SHAPES.map((s, i) => (
        <instancedMesh
          key={s}
          ref={(m) => {
            bodies.current[i] = m;
            if (m && !m.userData.fleetInit) {
              m.userData.fleetInit = true;
              m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
              for (let j = 0; j < max; j++) m.setMatrixAt(j, ZERO);
              if (!m.instanceColor) m.setColorAt(0, c3.set(0, 0, 0));
              m.instanceColor?.setUsage(THREE.DynamicDrawUsage);
              m.count = counts.current[i] ?? 0;
            }
          }}
          args={[g[s], bodyMats[i], max]}
          frustumCulled={false}
        />
      ))}
      <instancedMesh
        ref={hit}
        args={[hitGeo, hitMat, max]}
        frustumCulled={false}
        onClick={click}
        onUpdate={(m) => {
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          m.raycast = raycastMoving;
        }}
      />
      <points geometry={trailGeo} material={trailMat} frustumCulled={false} renderOrder={4} />
      <mesh ref={sel} geometry={selGeo} material={selMat} visible={false} />
    </group>
  );
}
