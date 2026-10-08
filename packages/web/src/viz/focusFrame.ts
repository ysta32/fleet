import * as THREE from 'three';
import type { Rect } from './labels';
import type { Vec3 } from './layout';

export interface FocusFrameInput {
  /** world point the camera looks at */
  target: Vec3;
  /** camera distance from the target once the focus settles */
  distance: number;
  /** polar angle from +Y (rad), kept from the current camera */
  phi: number;
  /** current azimuth (rad, THREE.Spherical theta) */
  theta: number;
  fov: number;
  width: number;
  height: number;
  /** setViewOffset x/y applied while focused */
  offset: { x: number; y: number };
  /** neighbouring station centres (the focused one may be included: it sits in the clear centre) */
  neighbours: readonly Vec3[];
  /** canvas areas a station should not sit under (legend, HUD, drawer), px */
  avoid: readonly Rect[];
  /** px around a station's projected centre that counts as "under" an overlay (default max(36, 15% of height)) */
  reach?: number;
}

/** Azimuth swings tried around the current heading (rad); small swings win ties. */
const SWINGS = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8];
const SWING_COST = 0.25;

const cam = new THREE.PerspectiveCamera();
const sph = new THREE.Spherical();
const tmp = new THREE.Vector3();
const look = new THREE.Vector3();

/** Projected px position of `p` for a camera at azimuth `theta`, or null when behind the camera. */
export function projectFrom(input: FocusFrameInput, theta: number, p: Vec3): { x: number; y: number } | null {
  const { width, height } = input;
  cam.fov = input.fov;
  cam.aspect = width / Math.max(1, height);
  cam.near = 0.1;
  cam.far = 1000;
  cam.setViewOffset(width, height, input.offset.x, input.offset.y, width, height);
  look.set(input.target.x, input.target.y, input.target.z);
  sph.set(input.distance, input.phi, theta);
  cam.position.setFromSpherical(sph).add(look);
  cam.up.set(0, 1, 0);
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  tmp.set(p.x, p.y, p.z).project(cam);
  if (tmp.z > 1 || tmp.z < -1) return null;
  return { x: (tmp.x * 0.5 + 0.5) * width, y: (1 - (tmp.y * 0.5 + 0.5)) * height };
}

/** How many neighbours sit under an overlay for a camera at azimuth `theta`. */
export function coveredNeighbours(input: FocusFrameInput, theta: number): number {
  // a station's rings reach well past its centre: count it as covered from about a seventh of the canvas away
  const reach = input.reach ?? Math.max(36, input.height * 0.15);
  let n = 0;
  for (const p of input.neighbours) {
    const s = projectFrom(input, theta, p);
    if (!s) continue;
    if (s.x < -reach || s.y < -reach || s.x > input.width + reach || s.y > input.height + reach) continue;
    if (
      input.avoid.some(
        (r) => s.x > r.x - reach && s.x < r.x + r.w + reach && s.y > r.y - reach && s.y < r.y + r.h + reach,
      )
    )
      n++;
  }
  return n;
}

/**
 * Heading for a selection focus: the azimuth (near the current one) that leaves the fewest
 * neighbouring stations under the legend and other overlays. Returns the current heading when
 * nothing is covered or nothing better exists, so a calm focus never swings the camera.
 */
export function focusHeading(input: FocusFrameInput): number {
  if (!input.avoid.length || !input.neighbours.length || input.width <= 0 || input.height <= 0)
    return input.theta;
  let best = input.theta;
  let bestCost = Infinity;
  for (const swing of SWINGS) {
    const cost = coveredNeighbours(input, input.theta + swing) + Math.abs(swing) * SWING_COST;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = input.theta + swing;
    }
  }
  return best;
}
