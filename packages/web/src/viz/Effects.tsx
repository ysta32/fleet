import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp, easeOutCubic, ringPulse, type PulseState } from './layout';
import { BEAM_POOL, PARTICLE_POOL, RING_POOL, useSceneStore, type SceneStore } from './store';
import { useVizTheme } from './theme';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const black = new THREE.Color(0, 0, 0);
const c3 = new THREE.Color();
const pulse: PulseState = { scale: 0, opacity: 0, alive: false };
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const white = new THREE.Color(1, 1, 1);

/**
 * Write the effect colour for opacity `op` into c3. On ink (additive) light fades to black;
 * on paper (multiply) ink fades to white. Paper never exceeds the base colour.
 */
function fade(store: SceneStore, color: THREE.Color, gain: number, op: number): THREE.Color {
  if (store.vt.dark) return c3.copy(color).multiplyScalar(gain * op);
  return c3.copy(white).lerp(color, Math.min(1, op * Math.min(1, gain)));
}

function additive(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function initInstances(mesh: THREE.InstancedMesh, n: number) {
  for (let i = 0; i < n; i++) {
    mesh.setMatrixAt(i, ZERO);
    mesh.setColorAt(i, black);
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.needsUpdate = true;
  }
}

/** Pooled, instanced effects: shockwave / pulse / scan rings, light beams, spark particles. */
export function Effects() {
  const store = useSceneStore();
  const rings = useRef<THREE.InstancedMesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);
  const parts = useRef<THREE.InstancedMesh>(null);

  const ringGeo = useMemo(() => new THREE.RingGeometry(0.975, 1, 160).rotateX(-Math.PI / 2), []);
  const beamGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0), []);
  const partGeo = useMemo(() => new THREE.OctahedronGeometry(0.085, 0), []);
  const ringMat = useMemo(additive, []);
  const beamMat = useMemo(additive, []);
  const partMat = useMemo(additive, []);

  const vt = useVizTheme();
  useLayoutEffect(() => {
    for (const m of [ringMat, beamMat, partMat]) {
      m.blending = vt.fxBlending;
      m.premultipliedAlpha = !vt.dark;
      m.needsUpdate = true;
    }
  }, [vt, ringMat, beamMat, partMat]);

  useLayoutEffect(() => {
    if (rings.current) initInstances(rings.current, RING_POOL);
    if (beams.current) initInstances(beams.current, BEAM_POOL);
    if (parts.current) initInstances(parts.current, PARTICLE_POOL);
  }, []);

  useLayoutEffect(
    () => () => {
      ringGeo.dispose();
      beamGeo.dispose();
      partGeo.dispose();
      ringMat.dispose();
      beamMat.dispose();
      partMat.dispose();
    },
    [ringGeo, beamGeo, partGeo, ringMat, beamMat, partMat],
  );

  const epoch = useRef(store.seekEpoch);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = store.t;
    if (epoch.current !== store.seekEpoch) {
      // replay scrub: transient effects belong to the old timeline
      epoch.current = store.seekEpoch;
      if (rings.current) initInstances(rings.current, RING_POOL);
      if (beams.current) initInstances(beams.current, BEAM_POOL);
      if (parts.current) initInstances(parts.current, PARTICLE_POOL);
    }
    const rm = rings.current;
    if (rm) {
      for (let i = 0; i < RING_POOL; i++) {
        const r = store.rings[i]!;
        if (!r.active) continue;
        const age = t - r.start;
        if (age < 0) {
          // staggered echo not started yet
          rm.setMatrixAt(i, ZERO);
          continue;
        }
        ringPulse(age, r.dur, r.from, r.to, pulse);
        if (!pulse.alive) {
          r.active = false;
          rm.setMatrixAt(i, ZERO);
          rm.setColorAt(i, black);
          continue;
        }
        let op = pulse.opacity;
        p3.copy(r.pos);
        if (r.kind === 'scan') {
          const u = clamp(age / r.dur, 0, 1);
          p3.y += -r.rise * 0.5 + r.rise * easeOutCubic(u);
          op = Math.sin(Math.PI * u);
        } else if (r.kind === 'pulse') {
          if (!store.reduced) op *= 0.65 + 0.35 * Math.cos(age * 28);
        }
        s3.set(pulse.scale, 1, pulse.scale);
        m4.compose(p3, q.identity(), s3);
        rm.setMatrixAt(i, m4);
        rm.setColorAt(i, fade(store, r.color, r.gain, op));
      }
      rm.instanceMatrix.needsUpdate = true;
      if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
    }

    const bm = beams.current;
    if (bm) {
      for (let i = 0; i < BEAM_POOL; i++) {
        const b = store.beams[i]!;
        if (!b.active) continue;
        const u = (t - b.start) / b.dur;
        if (u >= 1) {
          b.active = false;
          bm.setMatrixAt(i, ZERO);
          bm.setColorAt(i, black);
          continue;
        }
        const grow = store.reduced ? 1 : easeOutCubic(clamp(u * 3, 0, 1));
        const rad = b.radius * (1 - 0.7 * u);
        s3.set(rad, b.height * grow, rad);
        m4.compose(b.pos, q.identity(), s3);
        bm.setMatrixAt(i, m4);
        bm.setColorAt(i, fade(store, b.color, b.gain, Math.pow(1 - u, 1.5)));
      }
      bm.instanceMatrix.needsUpdate = true;
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    }

    const pm = parts.current;
    if (pm) {
      const drag = Math.exp(-1.8 * dt);
      for (let i = 0; i < PARTICLE_POOL; i++) {
        const p = store.particles[i]!;
        if (!p.active) continue;
        const u = (t - p.start) / p.life;
        if (u >= 1) {
          p.active = false;
          pm.setMatrixAt(i, ZERO);
          pm.setColorAt(i, black);
          continue;
        }
        p.vel.multiplyScalar(drag);
        p.vel.y -= 1.2 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const sc = p.size * (1 - u * 0.6);
        s3.set(sc, sc, sc);
        m4.compose(p.pos, q.identity(), s3);
        pm.setMatrixAt(i, m4);
        pm.setColorAt(i, fade(store, p.color, p.gain, 1 - u));
      }
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={rings} args={[ringGeo, ringMat, RING_POOL]} frustumCulled={false} renderOrder={5} />
      <instancedMesh ref={beams} args={[beamGeo, beamMat, BEAM_POOL]} frustumCulled={false} renderOrder={5} />
      <instancedMesh
        ref={parts}
        args={[partGeo, partMat, PARTICLE_POOL]}
        frustumCulled={false}
        renderOrder={6}
      />
    </group>
  );
}
