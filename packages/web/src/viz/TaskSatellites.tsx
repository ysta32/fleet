import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { FleetSnapshot, OrchTaskState } from '@fleet/shared';
import { easing, ease } from '@fleet/ui';
import {
  clamp,
  hash01,
  INTRO_DELAY,
  INTRO_DUR,
  INTRO_STAGGER,
  normTaskId,
  taskOrbitOffset,
  vec3,
} from './layout';
import { useSceneStore } from './store';
import { useVizTheme } from './theme';

interface TaskSlot {
  projectId: string;
  key: string;
  index: number;
  count: number;
  state: OrchTaskState;
  phase: number;
  pos: THREE.Vector3;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e3 = new THREE.Euler();
const s3 = new THREE.Vector3();
const c3 = new THREE.Color();
const off = vec3();
const MAX_TASKS = 1024;

/** All orch task satellites of all stations in a single instanced draw call (+ one for halos). */
export function TaskSatellites({
  snapshot,
  onSelectProject,
}: {
  snapshot: FleetSnapshot;
  onSelectProject(id: string): void;
}) {
  const store = useSceneStore();
  const vt = useVizTheme();
  const stateColors = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(vt.task) as OrchTaskState[]).map((k) => [
          k,
          new THREE.Color(vt.task[k]).multiplyScalar(vt.taskGain[k]),
        ]),
      ) as Record<OrchTaskState, THREE.Color>,
    [vt],
  );
  const mesh = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.1, 0.1, 0.13, 6), []);
  const haloGeo = useMemo(() => new THREE.CylinderGeometry(0.17, 0.17, 0.02, 6, 1, true), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), []);
  const haloMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  const slots = useMemo(() => {
    const out: TaskSlot[] = [];
    for (const p of snapshot.projects) {
      const tasks = p.orch?.tasks ?? [];
      tasks.forEach((t, i) => {
        if (out.length >= MAX_TASKS) return;
        const key = `${p.id}/${normTaskId(t.id)}`;
        out.push({
          projectId: p.id,
          key,
          index: i,
          count: tasks.length,
          state: t.state,
          phase: (i * 0.37) % 1,
          pos: store.taskPos.get(key) ?? new THREE.Vector3(),
        });
      });
    }
    return out;
  }, [snapshot, store]);

  // keep store.taskPos in sync with the live slots (positions are reused objects)
  useLayoutEffect(() => {
    const live = new Set<string>();
    for (const s of slots) {
      store.taskPos.set(s.key, s.pos);
      live.add(s.key);
    }
    for (const k of store.taskPos.keys()) if (!live.has(k)) store.taskPos.delete(k);
    const m = mesh.current;
    const h = halo.current;
    if (m && h) {
      if (!m.instanceColor) m.setColorAt(0, c3.set(0, 0, 0));
      if (!h.instanceColor) h.setColorAt(0, c3.set(0, 0, 0));
      m.count = slots.length;
      h.count = slots.length;
      for (let i = 0; i < slots.length; i++) {
        m.setColorAt(i, c3.set(0, 0, 0));
        h.setColorAt(i, c3);
      }
    }
  }, [slots, store]);

  useEffect(
    () => () => {
      geo.dispose();
      haloGeo.dispose();
      mat.dispose();
      haloMat.dispose();
    },
    [geo, haloGeo, mat, haloMat],
  );

  useEffect(() => {
    haloMat.blending = vt.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    haloMat.needsUpdate = true;
  }, [vt, haloMat]);

  useFrame((_, dtRaw) => {
    const m = mesh.current;
    const h = halo.current;
    if (!m || !h) return;
    // motion means work: each army's orbit only advances while it has running tasks / working agents
    const dt = store.reduced ? 0 : Math.min(dtRaw, 0.05);
    for (const l of store.layouts.values())
      // replay: orbit phase is a function of the playhead (deterministic scrub)
      l.orbitT = store.replaying ? hash01(l.id) * 40 + store.replaySec : l.orbitT + dt * (l.busy ? 1 : 0);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      const l = store.layouts.get(s.projectId);
      if (!l) continue;
      const t = l.orbitT;
      const iu = store.reduced
        ? 1
        : clamp((store.t - INTRO_DELAY - l.index * INTRO_STAGGER - 0.15 - s.index * 0.024) / INTRO_DUR, 0, 1);
      const ie = ease(easing.land, iu);
      taskOrbitOffset(s.index, s.count, t, l.scale, off);
      s.pos.set(l.pos.x + off.x, l.pos.y + off.y, l.pos.z + off.z);
      const running = s.state === 'running';
      const landed = s.state === 'landed';
      e3.set(0, t * (running ? 1.2 : 0) + s.index, 0);
      q.setFromEuler(e3);
      const sc = (landed ? 0.9 : s.state === 'queued' ? 0.75 : 1) * ie;
      s3.set(sc, sc, sc);
      m4.compose(s.pos, q, s3);
      m.setMatrixAt(i, m4);
      // persistent states are static glows; only events animate
      m.setColorAt(i, stateColors[s.state]);
      const ringed = running || s.state === 'blocked';
      const hs = ringed ? ie : 0.0001;
      s3.set(hs, 1, hs);
      m4.compose(s.pos, q, s3);
      h.setMatrixAt(i, m4);
      c3.copy(stateColors[s.state]).multiplyScalar(vt.dark ? 0.55 : 1);
      h.setColorAt(i, c3);
    }
    m.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = e.instanceId !== undefined ? slots[e.instanceId] : undefined;
    if (s) onSelectProject(s.projectId);
  };

  return (
    <group>
      <instancedMesh ref={mesh} args={[geo, mat, MAX_TASKS]} frustumCulled={false} onClick={click} />
      <instancedMesh ref={halo} args={[haloGeo, haloMat, MAX_TASKS]} frustumCulled={false} />
    </group>
  );
}
