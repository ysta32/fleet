import type { OrchTask } from '@fleet/shared';
import type { DagLayout, DagNode } from './model';

/** Node box size in the task graph (viewBox units); dagLayout spaces columns 210 and rows 80 apart. */
export const DAG_NODE_W = 170;
export const DAG_NODE_H = 52;
/** Corner radius of routed edges. */
const CORNER = 6;

type Point = [number, number];

/** SVG path through `points` with rounded corners (radius clamped to half of each adjacent segment). */
export function roundedPath(points: readonly Point[], radius = CORNER): string {
  const pts = points.filter(
    (point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1],
  );
  if (!pts.length) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/** Bus lanes stay inside this band of the 40-unit column gutter, clear of the skip-edge entry at 28. */
const BUS_FIRST = 6;
const BUS_LAST = 22;
const BUS_STEP = 5;

/**
 * Gutter offset of the vertical bus for source `slot` of `count` sources in one column: every source gets
 * its own lane (5 apart, compressed evenly to fit the band when a column has many sources).
 */
export function busOffset(slot: number, count: number): number {
  const step = count > 1 ? Math.min(BUS_STEP, (BUS_LAST - BUS_FIRST) / (count - 1)) : 0;
  return BUS_FIRST + Math.min(Math.max(0, slot), Math.max(0, count - 1)) * step;
}

/**
 * Orthogonal, bundled edge routes. Every edge leaves its source on one trunk into the column gutter,
 * runs along that source's own vertical bus, then enters the target from the left; edges from one source
 * share trunk and bus (a tree, not a fan of overlapping curves). Each source in a column gets its own bus
 * offset so neighbouring sources never draw on top of each other. Edges that skip columns travel in the
 * gap above the target's row, so they never cross a node box.
 */
export function dagEdgePaths(layout: DagLayout): { from: string; to: string; d: string }[] {
  const nodes = new Map(layout.nodes.map((node) => [node.task.id, node]));
  // per-column bus slot for each source, in row order (rows are laid out top to bottom)
  const slots = new Map<string, number>();
  const used = new Map<number, number>();
  const sources = [...new Set(layout.edges.map((edge) => edge.from))]
    .map((id) => nodes.get(id))
    .filter((node): node is DagNode => node !== undefined)
    .sort((a, b) => a.layer - b.layer || a.y - b.y);
  for (const node of sources) {
    const slot = used.get(node.layer) ?? 0;
    used.set(node.layer, slot + 1);
    slots.set(node.task.id, slot);
  }
  const routes: { from: string; to: string; d: string }[] = [];
  for (const edge of layout.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const startY = from.y + DAG_NODE_H / 2;
    const endY = to.y + DAG_NODE_H / 2;
    const startX = from.x + DAG_NODE_W;
    const bus = startX + busOffset(slots.get(edge.from) ?? 0, used.get(from.layer) ?? 1);
    let points: Point[];
    if (to.x <= startX) {
      // back edge (cycle) or same column: loop out right, then come back in above the target
      const lane = to.y - 12;
      points = [
        [startX, startY],
        [bus, startY],
        [bus, lane],
        [to.x - 10, lane],
        [to.x - 10, endY],
        [to.x, endY],
      ];
    } else if (to.layer === from.layer + 1) {
      points = [
        [startX, startY],
        [bus, startY],
        [bus, endY],
        [to.x, endY],
      ];
    } else {
      // skips a column: ride the gap above the target's row, drop in from the gutter before the target
      const lane = to.y - 14;
      const entry = to.x - 12;
      points = [
        [startX, startY],
        [bus, startY],
        [bus, lane],
        [entry, lane],
        [entry, endY],
        [to.x, endY],
      ];
    }
    routes.push({ from: edge.from, to: edge.to, d: roundedPath(points) });
  }
  return routes;
}

const FOCUS_ORDER: readonly OrchTask['state'][] = ['blocked', 'failed', 'running', 'review'];

/** The node the graph scrolls to: the first blocked task, else failed, else running, else in review. */
export function dagFocusNode(layout: DagLayout): DagNode | undefined {
  for (const state of FOCUS_ORDER) {
    const node = layout.nodes.find((item) => item.task.state === state);
    if (node) return node;
  }
  return undefined;
}

/**
 * scrollLeft that centres `node` in a viewport `viewport` px wide over a graph drawn `drawn` px wide
 * (layout.width viewBox units), clamped to the scrollable range.
 */
export function dagScrollLeft(node: DagNode, layoutWidth: number, drawn: number, viewport: number): number {
  if (drawn <= viewport || layoutWidth <= 0) return 0;
  const scale = drawn / layoutWidth;
  const centre = (node.x + DAG_NODE_W / 2) * scale;
  return Math.round(Math.min(drawn - viewport, Math.max(0, centre - viewport / 2)));
}

/** Column pitch and outer padding of dagLayout (viewBox units). */
export const DAG_COL = 210;
export const DAG_PAD = 24;
/** Smallest scale the graph is drawn at: below it, node text stops being legible and the graph scrolls. */
export const DAG_MIN_SCALE = 0.75;

export interface DagFit {
  /** px per viewBox unit */
  scale: number;
  /** true when the drawn graph is wider than the viewport */
  scroll: boolean;
  /** drawn size in px */
  width: number;
  height: number;
  /** initial scrollLeft (0 when it fits) */
  scrollLeft: number;
}

/**
 * How to draw a task graph in a viewport `viewport` px wide. If the whole graph fits at
 * DAG_MIN_SCALE or more it is scaled to fit (never enlarged past 1:1). Otherwise it scrolls at the
 * scale that shows a whole number of columns exactly, and the window is snapped to column gaps
 * with the focus column in the middle slot, so no node is cut at either edge.
 */
export function dagFit(layout: DagLayout, viewport: number, focus?: DagNode): DagFit {
  const draw = (scale: number, scrollLeft = 0, scroll = false): DagFit => ({
    scale,
    scroll,
    width: layout.width * scale,
    height: layout.height * scale,
    scrollLeft,
  });
  if (!(viewport > 0) || !(layout.width > 0)) return draw(1);
  const fit = viewport / layout.width;
  if (fit >= DAG_MIN_SCALE) return draw(Math.min(1, fit));
  const visible = Math.max(1, Math.floor(viewport / (DAG_COL * DAG_MIN_SCALE)));
  const scale = Math.min(1, Math.max(DAG_MIN_SCALE, viewport / (visible * DAG_COL)));
  const columns = layout.nodes.reduce((max, node) => Math.max(max, node.layer + 1), 1);
  const width = layout.width * scale;
  const maxLeft = Math.max(0, width - viewport);
  if (!focus) return draw(scale, 0, true);
  const first = Math.min(
    Math.max(0, columns - visible),
    Math.max(0, focus.layer - Math.floor((visible - 1) / 2)),
  );
  // a window that starts at a column starts in the gap before that column's nodes
  const left = first === 0 ? 0 : (first * DAG_COL + (DAG_PAD - (DAG_COL - DAG_NODE_W) / 2)) * scale;
  return draw(scale, Math.round(Math.min(maxLeft, Math.max(0, left))), true);
}

/**
 * Height (px) the graph needs to show every node at least partly inside the horizontal window
 * [left, left + viewport]: a scrolled graph only reserves the rows it is showing, so a one-row
 * stretch of a deep graph does not leave dead space under it. Never more than the whole graph.
 */
export function dagVisibleHeight(layout: DagLayout, scale: number, left: number, viewport: number): number {
  const full = layout.height * scale;
  if (!(viewport > 0) || !(scale > 0)) return full;
  const right = left + viewport;
  let bottom = 0;
  for (const node of layout.nodes) {
    const a = node.x * scale;
    const b = (node.x + DAG_NODE_W) * scale;
    if (b <= left || a >= right) continue;
    bottom = Math.max(bottom, node.y + DAG_NODE_H + DAG_PAD);
  }
  return bottom > 0 ? Math.min(full, Math.ceil(bottom * scale)) : full;
}
