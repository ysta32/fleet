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
    const bus = startX + 10 + ((slots.get(edge.from) ?? 0) % 4) * 5;
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
