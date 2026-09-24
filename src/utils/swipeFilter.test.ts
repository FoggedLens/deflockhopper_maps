import { describe, it, expect } from 'vitest';
import {
  clampDivider,
  halfPlaneRect,
  withinFilter,
  combineFilters,
  planSwipe,
  dividerLongitude,
  SWIPE_EDGE,
  NEVER_MATCH,
} from './swipeFilter';

describe('clampDivider', () => {
  it('clamps to 0..1 and treats non-finite as the middle', () => {
    expect(clampDivider(-1)).toBe(0);
    expect(clampDivider(2)).toBe(1);
    expect(clampDivider(0.3)).toBe(0.3);
    expect(clampDivider(NaN)).toBe(0.5);
  });
});

describe('halfPlaneRect', () => {
  it('OSM side is everything west of the divider, Flock side everything east', () => {
    const osm = halfPlaneRect('osm', -95);
    const flock = halfPlaneRect('flock', -95);
    expect(osm.coordinates[0]).toEqual([[-180, -85], [-95, -85], [-95, 85], [-180, 85], [-180, -85]]);
    expect(flock.coordinates[0]).toEqual([[-95, -85], [180, -85], [180, 85], [-95, 85], [-95, -85]]);
  });

  it('withinFilter wraps the rectangle', () => {
    const f = withinFilter('osm', -95) as unknown[];
    expect(f[0]).toBe('within');
    expect((f[1] as GeoJSON.Polygon).type).toBe('Polygon');
  });
});

describe('combineFilters', () => {
  it('returns undefined for nothing, the filter itself for one, and all-of for many', () => {
    expect(combineFilters()).toBeUndefined();
    expect(combineFilters(undefined, undefined)).toBeUndefined();
    const a = ['==', ['get', 'a'], 1] as never;
    const b = ['==', ['get', 'b'], 2] as never;
    expect(combineFilters(a)).toBe(a);
    expect(combineFilters(undefined, a)).toBe(a);
    expect(combineFilters(a, b)).toEqual(['all', a, b]);
  });
});

describe('planSwipe', () => {
  const base = { osm: ['==', ['get', 'brand'], 'x'] as never, flock: ['==', ['get', 'type'], 'y'] as never };

  it('hides OSM at the left edge with a never-matching filter and keeps Flock at its base', () => {
    const plan = planSwipe(0, -95, base);
    expect(plan.osm.filter).toEqual(['all', base.osm, NEVER_MATCH]);
    expect(plan.flock.filter).toBe(base.flock);
  });

  it('hides Flock at the right edge', () => {
    const plan = planSwipe(1, -95, base);
    expect(plan.flock.filter).toEqual(['all', base.flock, NEVER_MATCH]);
    expect(plan.osm.filter).toBe(base.osm);
  });

  it('treats values inside the edge band as the edge', () => {
    expect(planSwipe(SWIPE_EDGE / 2, -95).osm.filter).toEqual(NEVER_MATCH);
    expect(planSwipe(1 - SWIPE_EDGE / 2, -95).flock.filter).toEqual(NEVER_MATCH);
  });

  it('never-match filter is a boolean expression MapLibre accepts', () => {
    expect(NEVER_MATCH).toEqual(['literal', false]);
  });

  it('combines the within filter with each base filter in the middle', () => {
    const plan = planSwipe(0.5, -95, base);
    expect((plan.osm.filter as unknown[])[0]).toBe('all');
    expect((plan.osm.filter as unknown[])[1]).toBe(base.osm);
    expect(((plan.osm.filter as unknown[])[2] as unknown[])[0]).toBe('within');
    expect(((plan.flock.filter as unknown[])[2] as unknown[])[0]).toBe('within');
  });

  it('uses the within filter alone when there is no base filter', () => {
    const plan = planSwipe(0.5, -95);
    expect((plan.osm.filter as unknown[])[0]).toBe('within');
    expect((plan.flock.filter as unknown[])[0]).toBe('within');
  });
});

describe('dividerLongitude', () => {
  it('unprojects at the divider x and mid height', () => {
    const calls: Array<[number, number]> = [];
    const map = {
      getContainer: () => ({ clientWidth: 400, clientHeight: 800 }),
      unproject: (p: [number, number]) => { calls.push(p); return { lng: -95 + p[0] / 100 }; },
    };
    expect(dividerLongitude(map, 0.25)).toBe(-94);
    expect(calls[0]).toEqual([100, 400]);
  });
});
