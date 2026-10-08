import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { placeLabels, type LabelInput, type LabelPlacement, type Rect } from './labels';
import { useSceneStore } from './store';

/** One station's tag, registered by the station and laid out here with every other tag. */
export interface TagRecord {
  /** world-space tag anchor (top of the station, or the mast top when it needs you) */
  anchor: THREE.Object3D;
  /** world-space point under the station (narrow viewport "below" slot) */
  below: THREE.Object3D;
  /**
   * vertical hairlines drawn in the scene near the tag (the needs-you mast, the CI beacon pillar):
   * tags keep clear of them so no line strikes through text. `on()` says whether it is drawn.
   */
  posts: { lo: THREE.Object3D; hi: THREE.Object3D; on(): boolean }[];
  /** the absolutely positioned tag root inside drei's Html (origin = projected anchor) */
  root: HTMLDivElement;
  block: HTMLDivElement;
  leader: SVGPathElement;
  /** measured block size, px */
  w: number;
  h: number;
  needs: boolean;
  selected: boolean;
  busy: number;
  index: number;
  eligible: boolean;
  /** last applied state, to skip redundant style writes */
  applied: { shown: boolean; x: number; y: number; side: string; d: string };
}

/**
 * DOM overlays the scene keeps tags and focus targets clear of. On phones the replay bar and the
 * dashboard sheet sit over the lower part of the canvas; elsewhere they do not intersect it.
 */
export const OVERLAY_SELECTOR = '[data-fl-overlay], [data-fl-legend], .replay-bar, .inspector';
const OVERLAY_SAMPLE_MS = 250;
/** half-width of the keep-out strip around a scene hairline, px */
const POST_HALF = 6;

const proj = new THREE.Vector3();

/** Overlay rects in canvas px (clipped to the canvas; hidden overlays skipped). */
export function sampleOverlays(canvas: HTMLElement): Rect[] {
  if (typeof document === 'undefined') return [];
  const c = canvas.getBoundingClientRect();
  const out: Rect[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const x0 = Math.max(c.left, r.left);
    const y0 = Math.max(c.top, r.top);
    const x1 = Math.min(c.right, r.right);
    const y1 = Math.min(c.bottom, r.bottom);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ x: x0 - c.left, y: y0 - c.top, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

function project(o: THREE.Object3D, camera: THREE.Camera, w: number, h: number) {
  o.getWorldPosition(proj).project(camera);
  const onScreen = proj.z < 1 && proj.z > -1 && Math.abs(proj.x) <= 1 && Math.abs(proj.y) <= 1;
  return { x: (proj.x * 0.5 + 0.5) * w, y: (1 - (proj.y * 0.5 + 0.5)) * h, onScreen };
}

function apply(t: TagRecord, p: LabelPlacement | undefined, ax: number, ay: number) {
  const shown = !!p?.shown;
  if (shown !== t.applied.shown) {
    t.applied.shown = shown;
    t.root.style.visibility = shown ? '' : 'hidden';
  }
  if (!p || !shown) return;
  const x = p.x - ax;
  const y = p.y - ay;
  // NaN-safe: the first placement always writes (applied starts at NaN)
  if (!(Math.abs(x - t.applied.x) <= 0.5) || !(Math.abs(y - t.applied.y) <= 0.5)) {
    t.applied.x = x;
    t.applied.y = y;
    t.block.style.left = `${x.toFixed(1)}px`;
    t.block.style.top = `${y.toFixed(1)}px`;
  }
  if (p.side !== t.applied.side) {
    t.applied.side = p.side;
    t.root.dataset.side = p.side;
  }
  const d = p.leader.length
    ? p.leader.map((q, i) => `${i ? 'L' : 'M'}${(q.x - ax).toFixed(1)} ${(q.y - ay).toFixed(1)}`).join(' ')
    : '';
  if (d !== t.applied.d) {
    t.applied.d = d;
    if (d) t.leader.setAttribute('d', d);
    else t.leader.removeAttribute('d');
  }
}

/**
 * Lays out every station tag each frame (priority order, collision-free, clear of overlays) and
 * samples the DOM overlays a few times a second for the tags and the camera rig.
 */
export function TagLayout({ compact }: { compact: boolean }) {
  const store = useSceneStore();
  const gl = useThree((s) => s.gl);
  useFrame(({ camera, size }) => {
    const now = performance.now();
    if (now - store.overlaysAt > OVERLAY_SAMPLE_MS) {
      store.overlaysAt = now;
      store.overlays = sampleOverlays(gl.domElement);
    }
    if (!store.tags.size) return;
    const inputs: LabelInput[] = [];
    const anchors = new Map<string, { x: number; y: number }>();
    for (const [id, t] of store.tags) {
      const a = project(t.anchor, camera, size.width, size.height);
      const b = project(t.below, camera, size.width, size.height);
      anchors.set(id, a);
      inputs.push({
        id,
        anchor: a,
        below: b,
        w: t.w,
        h: t.h,
        needs: t.needs,
        selected: t.selected,
        busy: t.busy,
        index: t.index,
        // a needs-you tag stays while any part of its station is on screen
        onScreen: a.onScreen || (t.needs && b.onScreen),
        eligible: t.eligible,
        prev: t.applied.shown ? (t.applied.side as LabelInput['prev']) : undefined,
      });
    }
    const obstacles = store.overlays.slice();
    for (const t of store.tags.values())
      for (const post of t.posts) {
        if (!post.on()) continue;
        const lo = project(post.lo, camera, size.width, size.height);
        const hi = project(post.hi, camera, size.width, size.height);
        if (!lo.onScreen && !hi.onScreen) continue;
        obstacles.push({
          x: Math.min(lo.x, hi.x) - POST_HALF,
          y: Math.min(lo.y, hi.y),
          w: Math.abs(lo.x - hi.x) + 2 * POST_HALF,
          h: Math.abs(lo.y - hi.y),
        });
      }
    const placed = placeLabels(inputs, size.width, size.height, obstacles, { compact });
    for (const [id, t] of store.tags) {
      const a = anchors.get(id)!;
      apply(t, placed.get(id), a.x, a.y);
    }
  });
  return null;
}
