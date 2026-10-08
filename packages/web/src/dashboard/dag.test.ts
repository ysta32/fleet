import { describe, expect, it } from 'vitest';
import type { OrchTask } from '@fleet/shared';
import { dagLayout } from './model';
import {
  DAG_NODE_H,
  DAG_NODE_W,
  busOffset,
  dagEdgePaths,
  dagFocusNode,
  dagScrollLeft,
  dagFit,
  dagVisibleHeight,
  DAG_MIN_SCALE,
  roundedPath,
} from './dag';

const task = (id: string, depends: string[] = [], state: OrchTask['state'] = 'queued'): OrchTask => ({
  id,
  slug: id,
  depends,
  state,
});

/** Axis-aligned segments of a routed path, ignoring the rounded corner curves. */
function segments(d: string): [number, number, number, number][] {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  const out: [number, number, number, number][] = [];
  for (let i = 1; i < pts.length; i++) out.push([...pts[i - 1], ...pts[i]]);
  return out.filter(([x1, y1, x2, y2]) => x1 === x2 || y1 === y2);
}

describe('dagEdgePaths', () => {
  const fan = [task('t01'), ...Array.from({ length: 10 }, (_, i) => task(`t${i + 2}`, ['t01']))];
  it('routes a fan as one trunk and one bus: every edge leaves on the same line', () => {
    const routes = dagEdgePaths(dagLayout(fan));
    expect(routes).toHaveLength(10);
    expect(new Set(routes.map((route) => route.d.split(' L ')[0])).size).toBe(1);
    // every bend (corner control point) on the source side sits on one shared vertical bus
    const buses = routes
      .map((route) => /Q (-?[\d.]+) /.exec(route.d)?.[1])
      .filter((x): x is string => x !== undefined);
    expect(buses.length).toBeGreaterThanOrEqual(9);
    expect(new Set(buses).size).toBe(1);
  });
  it('gives different sources in one column different buses', () => {
    const layout = dagLayout([task('a'), task('b'), task('c', ['a']), task('d', ['b'])]);
    const buses = dagEdgePaths(layout).map((route) => Number(route.d.split(' L ')[1].split(' ')[0]));
    expect(new Set(buses).size).toBe(2);
  });
  it('gives every source in a column its own bus, even past four sources', () => {
    // five sources in column 0; s0 feeds the bottom target, s4 the top one (crossing buses)
    const sources = ['s0', 's1', 's2', 's3', 's4'].map((id) => task(id));
    const targets = ['t0', 't1', 't2', 't3', 't4'].map((id, i) => task(id, [`s${4 - i}`]));
    const layout = dagLayout([...sources, ...targets]);
    const busOf = new Map<string, number>();
    for (const route of dagEdgePaths(layout))
      busOf.set(route.from, Number(route.d.split(' L ')[1].split(' ')[0]));
    expect(busOf.size).toBe(5);
    expect(new Set(busOf.values()).size).toBe(5);
  });
  it('keeps bus lanes distinct and inside the gutter band for any column size', () => {
    for (const count of [1, 2, 4, 5, 9, 20]) {
      const offsets = Array.from({ length: count }, (_, slot) => busOffset(slot, count));
      expect(new Set(offsets).size).toBe(count);
      for (const offset of offsets) {
        expect(offset).toBeGreaterThanOrEqual(6);
        expect(offset).toBeLessThanOrEqual(22);
      }
    }
  });
  it('never runs a straight segment through a node box', () => {
    const tasks = [
      task('t01'),
      task('t02'),
      task('t03', ['t01']),
      task('t04', ['t01', 't03']),
      task('t05', ['t02']),
      task('t06', ['t01', 't04']),
    ];
    const layout = dagLayout(tasks);
    for (const route of dagEdgePaths(layout)) {
      for (const [x1, y1, x2, y2] of segments(route.d)) {
        for (const node of layout.nodes) {
          const inside =
            Math.max(x1, x2) > node.x + 1 &&
            Math.min(x1, x2) < node.x + DAG_NODE_W - 1 &&
            Math.max(y1, y2) > node.y + 1 &&
            Math.min(y1, y2) < node.y + DAG_NODE_H - 1;
          expect(inside, `${route.from}->${route.to} crosses ${node.task.id}`).toBe(false);
        }
      }
    }
  });
  it('enters every target at its left edge, mid height', () => {
    const layout = dagLayout(fan);
    const byId = new Map(layout.nodes.map((node) => [node.task.id, node]));
    for (const route of dagEdgePaths(layout)) {
      const to = byId.get(route.to)!;
      expect(route.d.endsWith(`L ${to.x} ${to.y + DAG_NODE_H / 2}`)).toBe(true);
    }
  });
});

describe('roundedPath', () => {
  it('draws straight lines and rounds corners', () => {
    expect(
      roundedPath([
        [0, 0],
        [10, 0],
      ]),
    ).toBe('M 0 0 L 10 0');
    expect(
      roundedPath(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        4,
      ),
    ).toBe('M 0 0 L 6 0 Q 10 0 10 4 L 10 10');
  });
  it('drops repeated points', () => {
    expect(
      roundedPath([
        [0, 0],
        [0, 0],
        [5, 0],
      ]),
    ).toBe('M 0 0 L 5 0');
  });
});

describe('dag focus and scroll', () => {
  it('prefers blocked, then failed, running, review', () => {
    const layout = dagLayout([
      task('a', [], 'running'),
      task('b', [], 'review'),
      task('c', ['a'], 'blocked'),
    ]);
    expect(dagFocusNode(layout)?.task.id).toBe('c');
    expect(dagFocusNode(dagLayout([task('a', [], 'review'), task('b', [], 'running')]))?.task.id).toBe('b');
    expect(dagFocusNode(dagLayout([task('a', [], 'landed')]))).toBeUndefined();
  });
  it('centres the node and clamps to the scroll range', () => {
    const layout = dagLayout([task('a'), task('b', ['a']), task('c', ['b']), task('d', ['c'], 'blocked')]);
    const d = layout.nodes.find((node) => node.task.id === 'd')!;
    const a = layout.nodes.find((node) => node.task.id === 'a')!;
    // drawn at 1:1, viewport 300 wide
    expect(dagScrollLeft(d, layout.width, layout.width, 300)).toBe(layout.width - 300);
    expect(dagScrollLeft(a, layout.width, layout.width, 300)).toBe(0);
    const b = layout.nodes.find((node) => node.task.id === 'b')!;
    expect(dagScrollLeft(b, layout.width, layout.width, 300)).toBe(Math.round(b.x + DAG_NODE_W / 2 - 150));
    // fits: no scroll
    expect(dagScrollLeft(d, layout.width, 200, 300)).toBe(0);
  });
});

describe('dagFit (M9)', () => {
  const chain = (n: number, blockedAt = -1) =>
    Array.from({ length: n }, (_, i) =>
      task(`t${i}`, i ? [`t${i - 1}`] : [], i === blockedAt ? 'blocked' : 'queued'),
    );

  it('scales to fit when the whole graph fits at DAG_MIN_SCALE or more, never above 1:1', () => {
    const layout = dagLayout(chain(2));
    const wide = dagFit(layout, layout.width + 200);
    expect(wide).toMatchObject({ scale: 1, scroll: false, scrollLeft: 0 });
    const snug = dagFit(layout, Math.ceil(layout.width * 0.8));
    expect(snug.scroll).toBe(false);
    expect(snug.scale).toBeGreaterThanOrEqual(DAG_MIN_SCALE);
    expect(snug.width).toBeLessThanOrEqual(Math.ceil(layout.width * 0.8));
    // the card follows the drawn content: height scales with the graph, no fixed box
    expect(snug.height).toBeCloseTo(layout.height * snug.scale);
  });

  it('scrolls below DAG_MIN_SCALE, with the focus node whole and no node cut at either edge', () => {
    for (const viewport of [300, 368, 480, 640]) {
      for (let blocked = 0; blocked < 8; blocked++) {
        const layout = dagLayout(chain(8, blocked));
        const focus = dagFocusNode(layout)!;
        const fit = dagFit(layout, viewport, focus);
        expect(fit.scroll).toBe(true);
        expect(fit.scale).toBeGreaterThanOrEqual(DAG_MIN_SCALE);
        expect(fit.scale).toBeLessThanOrEqual(1);
        const left = fit.scrollLeft;
        const right = left + viewport;
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(Math.max(0, fit.width - viewport) + 0.5);
        const fx0 = focus.x * fit.scale;
        expect(fx0).toBeGreaterThanOrEqual(left - 0.5);
        expect(fx0 + DAG_NODE_W * fit.scale).toBeLessThanOrEqual(right + 0.5);
        // whole-column windows are exact whenever the column scale is not clamped at 1:1
        if (fit.scale < 1)
          for (const node of layout.nodes) {
            const a = node.x * fit.scale;
            const b = (node.x + DAG_NODE_W) * fit.scale;
            const inside = a >= left - 0.5 && b <= right + 0.5;
            const outside = b <= left + 0.5 || a >= right - 0.5;
            expect(inside || outside).toBe(true);
          }
      }
    }
  });

  it('keeps the focus column in the middle slot when there is room on both sides', () => {
    const layout = dagLayout(chain(9, 4));
    const focus = dagFocusNode(layout)!;
    const fit = dagFit(layout, 3 * 210 * 0.8, focus);
    const mid = (focus.x + DAG_NODE_W / 2) * fit.scale - fit.scrollLeft;
    expect(Math.abs(mid - (3 * 210 * 0.8) / 2)).toBeLessThan(30);
  });

  it('does not scroll before the viewport is measured', () => {
    const layout = dagLayout(chain(8, 3));
    expect(dagFit(layout, 0, dagFocusNode(layout))).toMatchObject({ scale: 1, scroll: false, scrollLeft: 0 });
  });
});

describe('dagVisibleHeight (M9 dead space)', () => {
  // a: one row at layer 0; b, c, d fan out under a; e depends on b only
  const tasks = [task('a'), task('b', ['a']), task('c', ['a']), task('d', ['a']), task('e', ['b'])];
  const layout = dagLayout(tasks);
  it('reserves only the rows in the horizontal window', () => {
    const scale = 0.8;
    const col0 = dagVisibleHeight(layout, scale, 0, 180 * scale);
    expect(col0).toBe(Math.ceil((24 + DAG_NODE_H + 24) * scale));
    const col1 = dagVisibleHeight(layout, scale, 210 * scale, 180 * scale);
    expect(col1).toBe(Math.ceil(layout.height * scale));
  });
  it('falls back to the full height when nothing is measured or in view', () => {
    expect(dagVisibleHeight(layout, 1, 0, 0)).toBe(layout.height);
    expect(dagVisibleHeight(layout, 1, 5000, 300)).toBe(layout.height);
  });
});
