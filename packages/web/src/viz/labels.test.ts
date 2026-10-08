import { describe, expect, it } from 'vitest';
import {
  clearRect,
  labelOrder,
  leaderPath,
  overlapArea,
  placeLabels,
  segmentHitsRect,
  viewOffsetFor,
  type LabelInput,
  type Rect,
} from './labels';

const tag = (id: string, x: number, y: number, extra: Partial<LabelInput> = {}): LabelInput => ({
  id,
  anchor: { x, y },
  below: { x, y: y + 40 },
  w: 96,
  h: 30,
  needs: false,
  selected: false,
  busy: 0,
  index: 0,
  onScreen: true,
  eligible: true,
  ...extra,
});

const boxOf = (p: { x: number; y: number }, l: LabelInput): Rect => ({ x: p.x, y: p.y, w: l.w, h: l.h });

describe('labelOrder (M3)', () => {
  it('puts needs-you first, then the selection, then the busiest, then layout order', () => {
    const order = labelOrder([
      tag('idle', 0, 0, { index: 0 }),
      tag('busy', 0, 0, { busy: 5, index: 1 }),
      tag('sel', 0, 0, { selected: true, index: 2 }),
      tag('needs', 0, 0, { needs: true, index: 3 }),
      tag('busy2', 0, 0, { busy: 5, index: 4 }),
    ]).map((l) => l.id);
    expect(order).toEqual(['needs', 'sel', 'busy', 'busy2', 'idle']);
  });
});

describe('placeLabels (M3)', () => {
  it('never drops a needs-you tag, even when idle tags crowd its every slot', () => {
    // 375 Overview: the waiting station sits low and right, idle stations all around it
    const width = 375;
    const height = 430;
    const legend: Rect = { x: 12, y: 404, w: 150, h: 14 };
    const crowd = [
      tag('a', 200, 380, { index: 0 }),
      tag('b', 250, 395, { index: 1 }),
      tag('c', 330, 360, { index: 2 }),
      tag('d', 300, 420, { index: 3 }),
    ];
    const needs = tag('nebula-ui', 320, 410, { needs: true, index: 4, below: { x: 320, y: 470 } });
    for (const compact of [true, false]) {
      const out = placeLabels([...crowd, needs], width, height, [legend], { compact });
      const p = out.get('nebula-ui')!;
      expect(p.shown).toBe(true);
      // inside the canvas
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + needs.w).toBeLessThanOrEqual(width);
      expect(p.y + needs.h).toBeLessThanOrEqual(height);
    }
  });

  it('drops the lower-priority tag on a collision, never the needs-you one', () => {
    const needs = tag('needs', 100, 100, { needs: true, index: 1 });
    // same anchor, and overlays cover every slot but the upper right: only one tag fits
    const idle = tag('idle', 100, 100, { index: 0, busy: 9 });
    const overlays: Rect[] = [
      { x: 0, y: 0, w: 66, h: 300 },
      { x: 66, y: 105, w: 334, h: 195 },
    ];
    const out = placeLabels([idle, needs], 400, 300, overlays, { compact: false });
    expect(out.get('needs')!.side).toBe('right');
    expect(out.get('needs')!.shown).toBe(true);
    expect(out.get('idle')!.shown).toBe(false);
  });

  it('places shown tags without overlapping each other or overlays', () => {
    const labels = [
      tag('a', 120, 120, { busy: 3 }),
      tag('b', 150, 128, { busy: 2, index: 1 }),
      tag('c', 260, 220, { index: 2 }),
      tag('d', 60, 260, { index: 3 }),
    ];
    const legend: Rect = { x: 0, y: 280, w: 400, h: 20 };
    const out = placeLabels(labels, 400, 300, [legend], { compact: false });
    const shown = labels.filter((l) => out.get(l.id)!.shown).map((l) => boxOf(out.get(l.id)!, l));
    expect(shown.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < shown.length; i++) {
      expect(overlapArea(shown[i], legend)).toBe(0);
      for (let j = i + 1; j < shown.length; j++) expect(overlapArea(shown[i], shown[j])).toBe(0);
    }
  });

  it('flips to the left near the right edge instead of clipping (NEBULA-UI @1280)', () => {
    const l = tag('edge', 980, 200);
    const p = placeLabels([l], 1000, 600, [], { compact: false }).get('edge')!;
    expect(p.shown).toBe(true);
    expect(p.side).toBe('left');
    expect(p.x + l.w).toBeLessThanOrEqual(1000 - 8);
  });

  it('narrow: a needs-you tag moves beside its station when below would leave the canvas', () => {
    const l = tag('n', 200, 400, { needs: true, below: { x: 200, y: 425 } });
    const p = placeLabels([l], 375, 430, [], { compact: true }).get('n')!;
    expect(p.shown).toBe(true);
    expect(p.side).toBe('left');
    expect(p.y + l.h).toBeLessThanOrEqual(430 - 8);
    expect(p.leader).toEqual([]);
  });

  it('hides tags whose station is off-screen and ineligible idle tags', () => {
    const out = placeLabels(
      [tag('off', 50, 50, { onScreen: false, needs: true }), tag('quiet', 200, 200, { eligible: false })],
      400,
      300,
      [],
      { compact: false },
    );
    expect(out.get('off')!.shown).toBe(false);
    expect(out.get('quiet')!.shown).toBe(false);
  });
});

describe('placeLabels stability', () => {
  it('shows a lone tag at fractional coordinates (float noise is not a collision)', () => {
    const l = tag('q', 171.74948021052708, 242.13651878007855, { w: 129.265625, h: 29.390625, busy: 3 });
    const out = placeLabels(
      [l],
      808,
      694,
      [{ x: 110.50160294109848, y: 230.08477142100054, w: 16.376539426167028, h: 22.06832414104713 }],
      {
        compact: false,
      },
    );
    expect(out.get('q')!.shown).toBe(true);
  });

  it("keeps last frame's slot while it is still clear", () => {
    const l = tag('a', 300, 300, { prev: 'left-down' });
    expect(placeLabels([l], 800, 600, [], { compact: false }).get('a')!.side).toBe('left-down');
    const blocked = placeLabels([l], 800, 600, [{ x: 0, y: 300, w: 300, h: 300 }], { compact: false });
    expect(blocked.get('a')!.side).toBe('right');
  });
});

describe('placeLabels keeps tags off scene hairlines (M12)', () => {
  it('narrow: a needs-you tag sits beside its station, not across its own mast', () => {
    const l = tag('n', 300, 200, { needs: true, w: 120, h: 28, below: { x: 300, y: 228 } });
    // the mast rises from the anchor; below is under the replay bar
    const mast: Rect = { x: 296, y: 140, w: 8, h: 60 };
    const bar: Rect = { x: 0, y: 222, w: 375, h: 98 };
    const p = placeLabels([l], 375, 320, [mast, bar], { compact: true }).get('n')!;
    expect(p.shown).toBe(true);
    expect(p.side).toBe('left');
    const box = { x: p.x, y: p.y, w: l.w, h: l.h };
    expect(overlapArea(box, mast)).toBe(0);
    expect(overlapArea(box, bar)).toBe(0);
  });

  it('wide: a CI pillar through the default slot pushes the tag to a clear one', () => {
    const l = tag('helix', 400, 300);
    const pillar: Rect = { x: 470, y: 230, w: 8, h: 80 };
    const p = placeLabels([l], 1000, 700, [pillar], { compact: false }).get('helix')!;
    expect(p.side).not.toBe('right');
    expect(overlapArea({ x: p.x, y: p.y, w: l.w, h: l.h }, pillar)).toBe(0);
  });
});

describe('leaderPath (M12)', () => {
  it('ends on the box edge and never crosses the tag text', () => {
    const boxes: Rect[] = [
      { x: 134, y: 60, w: 96, h: 30 }, // right, up
      { x: -30, y: 60, w: 96, h: 30 }, // left, up
      { x: 134, y: 110, w: 96, h: 30 }, // right, down
      { x: 70, y: 40, w: 96, h: 30 }, // nudged left over the anchor column (edge clamp)
      { x: 120, y: 20, w: 96, h: 30 }, // directly above-right
    ];
    const anchor = { x: 100, y: 100 };
    for (const box of boxes) {
      const path = leaderPath(anchor, box);
      expect(path.length).toBeGreaterThanOrEqual(2);
      expect(path[0]).toEqual(anchor);
      const end = path[path.length - 1];
      // on the padded edge: outside the box, within the pad of it
      const dx = Math.max(box.x - end.x, 0, end.x - (box.x + box.w));
      const dy = Math.max(box.y - end.y, 0, end.y - (box.y + box.h));
      expect(Math.max(dx, dy)).toBeCloseTo(3, 5);
      for (let i = 1; i < path.length; i++) expect(segmentHitsRect(path[i - 1], path[i], box)).toBe(false);
    }
  });

  it('meets the box at a corner and runs along the edge, not into the middle of a line of text', () => {
    const box = { x: 134, y: 60, w: 96, h: 30 };
    const path = leaderPath({ x: 100, y: 100 }, box);
    const end = path[path.length - 1];
    expect(end).toEqual({ x: 131, y: 93 }); // bottom-left corner, padded
    expect(path).toHaveLength(3);
    expect(path[1].y).toBe(end.y); // horizontal tail along the bottom edge
  });

  it('has no leader when the anchor is inside the padded box', () => {
    expect(leaderPath({ x: 10, y: 10 }, { x: 0, y: 0, w: 50, h: 20 })).toEqual([]);
  });

  it('every placed leader stays outside its own box', () => {
    const labels = [tag('a', 100, 100), tag('b', 395, 150, { index: 1 }), tag('c', 200, 15, { index: 2 })];
    const out = placeLabels(labels, 400, 300, [], { compact: false });
    for (const l of labels) {
      const p = out.get(l.id)!;
      if (!p.shown) continue;
      const box = boxOf(p, l);
      for (let i = 1; i < p.leader.length; i++)
        expect(segmentHitsRect(p.leader[i - 1], p.leader[i], box)).toBe(false);
    }
  });
});

describe('clearRect / viewOffsetFor (N4)', () => {
  it('trims a bottom legend band and centres the focus in what is left', () => {
    const clear = clearRect(1000, 600, [{ x: 16, y: 560, w: 968, h: 28 }]);
    expect(clear).toEqual({ x: 0, y: 0, w: 1000, h: 560 });
    const off = viewOffsetFor(1000, 600, clear);
    expect(off.x).toBe(0);
    // positive y shift: the target is drawn above the canvas centre, clear of the legend
    expect(off.y).toBe(20);
  });

  it('trims a drawer covering the right side and ignores small chips', () => {
    const clear = clearRect(1000, 600, [
      { x: 640, y: 0, w: 360, h: 600 },
      { x: 20, y: 20, w: 140, h: 40 },
    ]);
    expect(clear).toEqual({ x: 0, y: 0, w: 640, h: 600 });
    expect(viewOffsetFor(1000, 600, clear).x).toBe(180);
  });

  it('ignores a full-screen sheet instead of collapsing the clear area', () => {
    expect(clearRect(375, 500, [{ x: 0, y: 0, w: 375, h: 500 }])).toEqual({ x: 0, y: 0, w: 375, h: 500 });
  });
});
