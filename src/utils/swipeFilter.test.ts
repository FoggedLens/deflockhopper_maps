import { describe, it, expect } from 'vitest';
import { clampDivider, combineFilters, swipeClipInsets } from './swipeFilter';

describe('clampDivider', () => {
  it('clamps to 0..1 and treats non-finite as the middle', () => {
    expect(clampDivider(-1)).toBe(0);
    expect(clampDivider(2)).toBe(1);
    expect(clampDivider(0.3)).toBe(0.3);
    expect(clampDivider(NaN)).toBe(0.5);
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

describe('swipeClipInsets', () => {
  it('shows OSM left of the divider and Flock right of it', () => {
    expect(swipeClipInsets(0.5)).toEqual({ osm: 'inset(0 50.000% 0 0)', flock: 'inset(0 0 0 50.000%)' });
    expect(swipeClipInsets(0.25)).toEqual({ osm: 'inset(0 75.000% 0 0)', flock: 'inset(0 0 0 25.000%)' });
  });

  it('hides a side completely at the extremes', () => {
    expect(swipeClipInsets(0).osm).toBe('inset(0 100.000% 0 0)');
    expect(swipeClipInsets(1).flock).toBe('inset(0 0 0 100.000%)');
  });

  it('clamps and defaults like clampDivider', () => {
    expect(swipeClipInsets(7)).toEqual(swipeClipInsets(1));
    expect(swipeClipInsets(NaN)).toEqual(swipeClipInsets(0.5));
  });
});
