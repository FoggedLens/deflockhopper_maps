import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import { zoomOpacityByStatus } from './flockLeakStyle';

const spec = (name: 'circle-opacity' | 'icon-opacity') =>
  (name === 'circle-opacity' ? v8.paint_circle['circle-opacity'] : v8.paint_symbol['icon-opacity']) as never;

describe('zoomOpacityByStatus', () => {
  it('is a valid composite (zoom + data) paint expression for both layers', () => {
    for (const name of ['circle-opacity', 'icon-opacity'] as const) {
      const res = createPropertyExpression(zoomOpacityByStatus([9, 0, 9.6, 1], 0.35) as never, spec(name));
      expect(res.result, name).toBe('success');
    }
  });

  it('scales every stop for decommissioned devices only', () => {
    const res = createPropertyExpression(zoomOpacityByStatus([0, 0.5, 10, 0], 0.5) as never, spec('circle-opacity'));
    if (res.result !== 'success') throw new Error(JSON.stringify(res.value));
    const ev = (zoom: number, s: number) => res.value.evaluate({ zoom }, { type: 1, properties: { s }, geometry: null } as never);
    expect(ev(0, 1)).toBeCloseTo(0.5);
    expect(ev(0, 3)).toBeCloseTo(0.25);
    expect(ev(5, 1)).toBeCloseTo(0.25);
    expect(ev(5, 3)).toBeCloseTo(0.125);
  });

  it('rejects the naive multiply-by-zoom-interpolate form (the bug this guards)', () => {
    const naive = ['*', ['interpolate', ['linear'], ['zoom'], 9, 0, 9.6, 1], ['case', ['==', ['get', 's'], 3], 0.35, 1]];
    expect(createPropertyExpression(naive as never, spec('icon-opacity')).result).toBe('error');
  });
});
