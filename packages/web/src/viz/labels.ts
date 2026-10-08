/**
 * Station tag layout (pure; screen space, px, origin top-left of the canvas).
 *
 * One pass places every tag in priority order: stations that need you first, then the selection,
 * then the busiest. A tag takes the first candidate slot that stays inside the canvas and clear of
 * the tags already placed and of the DOM overlays (legend, HUD, drawer). A tag with no free slot is
 * dropped, except needs-you and selected tags, which always show (in their least-crowded slot,
 * clamped into the canvas). Leader lines end on the tag box's padded edge, never inside it.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LabelInput {
  id: string;
  /** projected tag anchor (top of the station, or its mast top when it needs you) */
  anchor: Point;
  /** projected point under the station, for the narrow-viewport "below" slot */
  below?: Point;
  /** measured tag box size */
  w: number;
  h: number;
  needs: boolean;
  selected: boolean;
  /** working agents + running tasks */
  busy: number;
  /** layout order (stable tie-break) */
  index: number;
  /** false when the station is off-screen or behind the camera: never placed */
  onScreen: boolean;
  /** large fleets: only some idle stations are eligible for a tag at all */
  eligible: boolean;
  /** slot used last frame: kept while it stays clear, so tags do not flip as the camera drifts */
  prev?: LabelSide;
}

export type LabelSide = 'right' | 'left' | 'right-down' | 'left-down' | 'above' | 'below';

export interface LabelPlacement {
  id: string;
  shown: boolean;
  /** box top-left */
  x: number;
  y: number;
  side: LabelSide;
  /** leader polyline from the anchor to the box edge (empty: no leader) */
  leader: Point[];
}

export interface LabelOptions {
  /** narrow viewport: centred tags above/below the station, no leaders */
  compact: boolean;
  /** keep tags this far inside the canvas */
  margin?: number;
  /** horizontal reach from the anchor to the near edge of the box */
  lead?: number;
  /** vertical lift of the box above (or below) the anchor */
  rise?: number;
  /** gap between the leader end and the box */
  pad?: number;
}

export const TAG_MARGIN = 8;
export const TAG_LEAD = 34;
export const TAG_RISE = 10;
export const TAG_PAD = 3;
/** overlaps smaller than this (px²) count as clear */
const MIN_AREA = 0.5;
/** gap kept between neighbouring tags */
const TAG_GAP = 4;

/** True when the station must keep its tag whatever the crowding. */
export const forcedLabel = (l: Pick<LabelInput, 'needs' | 'selected'>): boolean => l.needs || l.selected;

/** Placement order: needs-you, then selected, then busiest, then layout order. */
export function labelOrder<T extends Pick<LabelInput, 'needs' | 'selected' | 'busy' | 'index'>>(
  labels: readonly T[],
): T[] {
  return labels
    .slice()
    .sort(
      (a, b) =>
        Number(b.needs) - Number(a.needs) ||
        Number(b.selected) - Number(a.selected) ||
        b.busy - a.busy ||
        a.index - b.index,
    );
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area of `r` outside the inner canvas (canvas minus margin). */
function outsideArea(r: Rect, width: number, height: number, margin: number): number {
  const inner = {
    x: margin,
    y: margin,
    w: Math.max(0, width - 2 * margin),
    h: Math.max(0, height - 2 * margin),
  };
  return r.w * r.h - overlapArea(r, inner);
}

function candidates(l: LabelInput, o: Required<LabelOptions>): { side: LabelSide; box: Rect }[] {
  const { x: ax, y: ay } = l.anchor;
  const { w, h } = l;
  if (o.compact) {
    const under = l.below ?? { x: ax, y: ay };
    const above = { side: 'above' as const, box: { x: ax - w / 2, y: ay - TAG_GAP - h, w, h } };
    const below = { side: 'below' as const, box: { x: under.x - w / 2, y: under.y + 6, w, h } };
    // beside the station: centred on the station top, where the hull is narrowest
    const mid = ay - h / 2;
    const left = { side: 'left' as const, box: { x: Math.min(ax, under.x) - 14 - w, y: mid, w, h } };
    const right = { side: 'right' as const, box: { x: Math.max(ax, under.x) + 14, y: mid, w, h } };
    // a station that needs you keeps its tag off the pennant mast (which rises from the top)
    return l.needs ? [below, left, right, above] : [above, below, right, left];
  }
  return [
    { side: 'right', box: { x: ax + o.lead, y: ay - o.rise - h, w, h } },
    { side: 'left', box: { x: ax - o.lead - w, y: ay - o.rise - h, w, h } },
    { side: 'right-down', box: { x: ax + o.lead, y: ay + o.rise, w, h } },
    { side: 'left-down', box: { x: ax - o.lead - w, y: ay + o.rise, w, h } },
  ];
}

/** Clamp a box into the inner canvas (a box larger than the canvas pins to the top-left margin). */
export function clampBox(box: Rect, width: number, height: number, margin = TAG_MARGIN): Rect {
  const x = Math.max(margin, Math.min(box.x, width - margin - box.w));
  const y = Math.max(margin, Math.min(box.y, height - margin - box.h));
  return { ...box, x, y };
}

/** Closest point to `p` on the border of `r` (p outside r), or null when p is inside r. */
export function closestOnRect(p: Point, r: Rect): Point | null {
  const x = Math.max(r.x, Math.min(p.x, r.x + r.w));
  const y = Math.max(r.y, Math.min(p.y, r.y + r.h));
  if (x === p.x && y === p.y) return null;
  return { x, y };
}

/**
 * Leader from `anchor` to the tag box: it ends on the box padded by `pad` (the point nearest the
 * anchor), with a short horizontal tail along that edge when it lands on a corner, so it reads as
 * pointing at the tag rather than striking through its text. Empty when the anchor sits inside
 * the padded box (a clamped tag that covers its own station needs no leader).
 */
export function leaderPath(anchor: Point, box: Rect, pad = TAG_PAD, tail = 10): Point[] {
  const padded = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
  const end = closestOnRect(anchor, padded);
  if (!end) return [];
  const onLeft = end.x === padded.x;
  const onRight = end.x === padded.x + padded.w;
  const onTop = end.y === padded.y;
  const onBottom = end.y === padded.y + padded.h;
  const corner = (onLeft || onRight) && (onTop || onBottom);
  if (!corner) return [anchor, end];
  // elbow: step back along the horizontal edge line, away from the box, by up to `tail`
  const dx = Math.min(tail, Math.abs(end.x - anchor.x));
  const elbow = { x: onLeft ? end.x - dx : end.x + dx, y: end.y };
  if (dx < 0.5) return [anchor, end];
  return [anchor, elbow, end];
}

/** True when segment a-b passes through the interior of r. */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  // Liang-Barsky clip against the open rectangle
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const eps = 1e-6;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < eps) {
      if (q <= eps) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1 - eps) return false;
  }
  return t1 - t0 > eps;
}

export function placeLabels(
  labels: readonly LabelInput[],
  width: number,
  height: number,
  obstacles: readonly Rect[],
  options: LabelOptions,
): Map<string, LabelPlacement> {
  const o: Required<LabelOptions> = {
    compact: options.compact,
    margin: options.margin ?? TAG_MARGIN,
    lead: options.lead ?? TAG_LEAD,
    rise: options.rise ?? TAG_RISE,
    pad: options.pad ?? TAG_PAD,
  };
  const out = new Map<string, LabelPlacement>();
  const placed: Rect[] = [];
  const grow = (r: Rect): Rect => ({
    x: r.x - TAG_GAP,
    y: r.y - TAG_GAP,
    w: r.w + 2 * TAG_GAP,
    h: r.h + 2 * TAG_GAP,
  });
  for (const l of labelOrder(labels)) {
    const forced = forcedLabel(l);
    const hidden: LabelPlacement = { id: l.id, shown: false, x: 0, y: 0, side: 'right', leader: [] };
    if (!l.onScreen || !(l.w > 0 && l.h > 0) || !(forced || l.eligible)) {
      out.set(l.id, hidden);
      continue;
    }
    let best: { side: LabelSide; box: Rect; cost: number } | null = null;
    const slots = candidates(l, o);
    const keep = slots.findIndex((c) => c.side === l.prev);
    if (keep > 0) slots.unshift(...slots.splice(keep, 1));
    for (const c of slots) {
      const g = grow(c.box);
      const crowd =
        placed.reduce((sum, r) => sum + overlapArea(g, r), 0) +
        obstacles.reduce((sum, r) => sum + overlapArea(g, r), 0);
      const raw = crowd + outsideArea(c.box, width, height, o.margin) * 2;
      // sub-pixel areas are float noise from the box arithmetic, not a real collision
      const cost = raw < MIN_AREA ? 0 : raw;
      if (!best || cost < best.cost) best = { ...c, cost };
      if (cost === 0) break;
    }
    if (!best || (best.cost > 0 && !forced)) {
      out.set(l.id, hidden);
      continue;
    }
    const box = best.cost > 0 ? clampBox(best.box, width, height, o.margin) : best.box;
    placed.push(box);
    out.set(l.id, {
      id: l.id,
      shown: true,
      x: box.x,
      y: box.y,
      side: best.side,
      leader: o.compact ? [] : leaderPath(l.anchor, box, o.pad),
    });
  }
  return out;
}

/**
 * The part of the canvas not covered by overlays. Each overlay that spans most of the canvas
 * width trims the top or bottom band it sits in; one that spans most of its height trims the left
 * or right side. Smaller overlays (chips, corner HUD text) are ignored here: labels avoid them.
 */
export function clearRect(width: number, height: number, overlays: readonly Rect[]): Rect {
  let top = 0;
  let bottom = height;
  let left = 0;
  let right = width;
  for (const r of overlays) {
    const x0 = Math.max(0, r.x);
    const x1 = Math.min(width, r.x + r.w);
    const y0 = Math.max(0, r.y);
    const y1 = Math.min(height, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) continue;
    const wide = (x1 - x0) / Math.max(1, width) >= 0.5;
    const tall = (y1 - y0) / Math.max(1, height) >= 0.5;
    if (wide && !tall) {
      if (y0 + y1 > height) bottom = Math.min(bottom, y0);
      else top = Math.max(top, y1);
    } else if (tall && !wide) {
      if (x0 + x1 > width) right = Math.min(right, x0);
      else left = Math.max(left, x1);
    }
  }
  // never collapse below a third of the canvas: an overlay that big is a sheet, not a band
  if (bottom - top < height / 3) {
    top = 0;
    bottom = height;
  }
  if (right - left < width / 3) {
    left = 0;
    right = width;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Pixel offset (setViewOffset x/y) that moves the canvas centre to the centre of `clear`: the
 * focused target then sits in the middle of the uncovered area instead of under an overlay.
 */
export function viewOffsetFor(width: number, height: number, clear: Rect): Point {
  return { x: width / 2 - (clear.x + clear.w / 2), y: height / 2 - (clear.y + clear.h / 2) };
}
