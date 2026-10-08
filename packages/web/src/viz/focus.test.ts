import { describe, expect, it } from 'vitest';
import { FOCUS_MAX_ZOOM, cameraFitDistance, focusDistance, layoutRadius } from './layout';

describe('focusDistance (selection dolly cap)', () => {
  it('never magnifies the fitted framing by more than FOCUS_MAX_ZOOM', () => {
    for (const n of [2, 6, 8, 14, 30]) {
      const fitted = layoutRadius(n);
      const fit = cameraFitDistance(fitted);
      for (const kind of ['session', 'agent', 'project'] as const) {
        const distance = focusDistance(kind, fitted);
        expect(fit / distance).toBeLessThanOrEqual(FOCUS_MAX_ZOOM + 1e-9);
      }
    }
  });
  it('caps at about 1.6x', () => {
    expect(FOCUS_MAX_ZOOM).toBeCloseTo(1.6);
    const fitted = layoutRadius(6);
    expect(focusDistance('session', fitted)).toBeCloseTo(cameraFitDistance(fitted) / 1.6);
  });
  it('keeps a whole station framed on a one-station harbour', () => {
    const fitted = layoutRadius(1);
    expect(focusDistance('session', fitted)).toBeGreaterThanOrEqual(11);
    expect(focusDistance('project', fitted)).toBeGreaterThanOrEqual(focusDistance('agent', fitted));
  });
  it('is finite and positive for degenerate radii', () => {
    expect(focusDistance('agent', 0)).toBe(11);
    expect(focusDistance('agent', -5)).toBe(11);
  });
});
