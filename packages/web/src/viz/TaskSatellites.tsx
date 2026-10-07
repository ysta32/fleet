import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { FleetSnapshot, OrchTaskState } from '@fleet/shared';
import { normTaskId, taskOrbitOffset, vec3 } from './layout';
import { useSceneStore } from './store';
import { TASK_STATE_COLORS, TASK_STATE_INTENSITY } from './theme';

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
const stateColors = Object.fromEntries(
  (Object.keys(TASK_STATE_COLORS) as OrchTaskState[]).map((k) => [k, new THREE.Color(TASK_STATE_COLORS[k])]),
) as Record<OrchTaskState, THREE.Color>;

/** All orch task satellites of all stations in a single instanced draw call (+ one for halos). */
export function TaskSatellites({
  snapshot,
  onSelectProject,
}: {
  snapshot: FleetSnapshot;
  onSelectProject(id: string): void;
}) {
  const store = useSceneStore();
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
        blending: THREE.AdditiveBlending,
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

  useFrame(() => {
    const m = mesh.current;
    const h = halo.current;
    if (!m || !h) return;
    const t = store.at;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      const l = store.layouts.get(s.projectId);
      if (!l) continue;
      taskOrbitOffset(s.index, s.count, t, l.scale, off);
      s.pos.set(l.pos.x + off.x, l.pos.y + off.y, l.pos.z + off.z);
      const running = s.state === 'running';
      const landed = s.state === 'landed';
      e3.set(0, t * (running ? 2.2 : 0.4) + s.index, 0);
      q.setFromEuler(e3);
      const pulse = running ? 1 + 0.18 * Math.sin(t * 6 + s.phase * 6.28) : 1;
      const sc = (landed ? 1.05 : s.state === 'queued' ? 0.8 : 1) * pulse;
      s3.set(sc, sc, sc);
      m4.compose(s.pos, q, s3);
      m.setMatrixAt(i, m4);
      let k = TASK_STATE_INTENSITY[s.state];
      if (running) k *= 0.65 + 0.45 * (0.5 + 0.5 * Math.sin(t * 5 + s.phase * 6.28));
      if (s.state === 'blocked' || s.state === 'failed')
        k *= 0.6 + 0.6 * (Math.sin(t * 9 + s.phase) > 0 ? 1 : 0.3);
      c3.copy(stateColors[s.state]).multiplyScalar(k);
      m.setColorAt(i, c3);
      const hs = running ? 1 + 0.3 * Math.sin(t * 4 + s.phase * 6.28) : 0.0001;
      s3.set(hs, 1, hs);
      m4.compose(s.pos, q, s3);
      h.setMatrixAt(i, m4);
      c3.copy(stateColors[s.state]).multiplyScalar(k * 0.6);
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
