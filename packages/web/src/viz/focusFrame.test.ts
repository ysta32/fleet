import { describe, expect, it } from 'vitest';
import { coveredNeighbours, focusHeading, projectFrom, type FocusFrameInput } from './focusFrame';

const base = (over: Partial<FocusFrameInput> = {}): FocusFrameInput => ({
  target: { x: 0, y: 2.2, z: 0 },
  distance: 20,
  phi: 1.05,
  theta: 0,
  fov: 40,
  width: 1000,
  height: 700,
  offset: { x: 0, y: 0 },
  neighbours: [],
  avoid: [],
  ...over,
});

const legend = { x: 16, y: 660, w: 968, h: 26 };

describe('focusHeading (N4)', () => {
  it('projects the target to the canvas centre (shifted by the view offset)', () => {
    const p = projectFrom(base(), 0, { x: 0, y: 2.2, z: 0 })!;
    expect(p.x).toBeCloseTo(500, 3);
    expect(p.y).toBeCloseTo(350, 3);
    const q = projectFrom(base({ offset: { x: 0, y: 20 } }), 0, { x: 0, y: 2.2, z: 0 })!;
    expect(q.y).toBeCloseTo(330, 3);
  });

  it('keeps the heading when no neighbour is under an overlay', () => {
    const input = base({ neighbours: [{ x: -6, y: 2.2, z: -6 }], avoid: [legend] });
    expect(coveredNeighbours(input, 0)).toBe(0);
    expect(focusHeading(input)).toBe(0);
  });

  it('swings the camera so a neighbour in front of and below the target leaves the legend band', () => {
    // a neighbour between the camera and the target, off to one side, lands low: under the legend
    const neighbour = { x: 4, y: 2.2, z: 8 };
    const input = base({ neighbours: [{ x: 0, y: 2.2, z: 0 }, neighbour], avoid: [legend] });
    const p = projectFrom(input, 0, neighbour)!;
    expect(p.y).toBeGreaterThan(legend.y - 0.15 * 700);
    expect(coveredNeighbours(input, 0)).toBe(1);
    const heading = focusHeading(input);
    expect(heading).not.toBe(0);
    expect(Math.abs(heading)).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(coveredNeighbours(input, heading)).toBe(0);
    // the focused station itself stays in view
    const t = projectFrom(input, heading, input.target)!;
    expect(t.y).toBeLessThan(legend.y);
  });

  it('is a no-op without overlays or a measured canvas', () => {
    const neighbours = [{ x: 0, y: 2.2, z: 9 }];
    expect(focusHeading(base({ neighbours, theta: 0.4 }))).toBe(0.4);
    expect(focusHeading(base({ neighbours, avoid: [legend], width: 0, theta: 0.4 }))).toBe(0.4);
  });
});
