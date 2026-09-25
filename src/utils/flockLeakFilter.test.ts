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
  it('in service only at a national zoom with only g/s/q present', () => {
    const f = flockLayerFilter([], [1]);
    expect(passes(f, { g: 1, s: 1, q: 0 })).toBe(true);
    expect(passes(f, { g: 1, s: 2, q: 0 })).toBe(false);
    expect(passes(f, { g: 1, s: 1, q: 3 })).toBe(false);
  });

  it('is only the clean-record clause for the default (every group, every status)', () => {
    expect(flockLayerFilter([], [1, 2, 3])).toEqual(['==', ['get', 'q'], 0]);
  });

  it('never draws flagged records', () => {
    const f = flockLayerFilter([], [1, 2, 3]);
    expect(passes(f, { g: 8, s: 1, q: 2 })).toBe(false);
    expect(passes(f, { g: 1, s: 4, q: 1 })).toBe(false);
  });

  it('filters by group', () => {
    const f = flockLayerFilter([1, 3], [1, 2, 3]);
    expect(passes(f, { g: 1, s: 1, q: 0 })).toBe(true);
    expect(passes(f, { g: 3, s: 3, q: 0 })).toBe(true);
    expect(passes(f, { g: 2, s: 1, q: 0 })).toBe(false);
  });

  it('combines group and status', () => {
    const f = flockLayerFilter([5], [2]);
    expect(passes(f, { g: 5, s: 2, q: 0 })).toBe(true);
    expect(passes(f, { g: 5, s: 1, q: 0 })).toBe(false);
    expect(passes(f, { g: 1, s: 2, q: 0 })).toBe(false);
  });

  it('matches the contract example shape', () => {
    expect(flockLayerFilter([1, 3], [1])).toEqual([
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
