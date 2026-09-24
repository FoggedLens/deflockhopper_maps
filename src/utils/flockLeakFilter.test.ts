import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { combineFilters, flockLayerFilter } from './flockLeakFilter';

function passes(filter: unknown, properties: Record<string, unknown>): boolean {
  if (filter === undefined) return true;
  const parsed = createExpression(filter as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return Boolean(parsed.value.evaluate({ zoom: 4 }, { type: 1, properties, geometry: null } as never));
}

describe('flockLayerFilter', () => {
  it('default (clean, in service) at a national zoom with only g/s/q present', () => {
    const f = flockLayerFilter([], [1], false);
    expect(passes(f, { g: 1, s: 1, q: 0 })).toBe(true);
    expect(passes(f, { g: 1, s: 2, q: 0 })).toBe(false);
    expect(passes(f, { g: 1, s: 1, q: 3 })).toBe(false);
  });

  it('is undefined only when suspect records are shown, every status is on and no group is picked', () => {
    expect(flockLayerFilter([], [1, 2, 3], true)).toBeUndefined();
    expect(flockLayerFilter([], [1, 2, 3], false)).toEqual(['==', ['get', 'q'], 0]);
  });

  it('shows suspect records when asked', () => {
    const f = flockLayerFilter([], [1, 2, 3], true);
    expect(passes(f, { g: 8, s: 1, q: 2 })).toBe(true);
    expect(passes(f, { g: 1, s: 4, q: 1 })).toBe(true);
  });

  it('filters by group', () => {
    const f = flockLayerFilter([1, 3], [1, 2, 3], false);
    expect(passes(f, { g: 1, s: 1, q: 0 })).toBe(true);
    expect(passes(f, { g: 3, s: 3, q: 0 })).toBe(true);
    expect(passes(f, { g: 2, s: 1, q: 0 })).toBe(false);
  });

  it('combines group and status', () => {
    const f = flockLayerFilter([5], [2], false);
    expect(passes(f, { g: 5, s: 2, q: 0 })).toBe(true);
    expect(passes(f, { g: 5, s: 1, q: 0 })).toBe(false);
    expect(passes(f, { g: 1, s: 2, q: 0 })).toBe(false);
  });

  it('matches the contract example shape', () => {
    expect(flockLayerFilter([1, 3], [1], false)).toEqual([
      'all',
      ['==', ['get', 'q'], 0],
      ['in', ['get', 'g'], ['literal', [1, 3]]],
      ['in', ['get', 's'], ['literal', [1]]],
    ]);
  });
});

describe('combineFilters', () => {
  it('returns undefined for nothing, the filter itself for one, and all-of for many', () => {
    expect(combineFilters()).toBeUndefined();
    const a = ['==', ['get', 'a'], 1] as never;
    const b = ['==', ['get', 'b'], 2] as never;
    expect(combineFilters(a)).toBe(a);
    expect(combineFilters(undefined, a)).toBe(a);
    expect(combineFilters(a, b)).toEqual(['all', a, b]);
  });
});
