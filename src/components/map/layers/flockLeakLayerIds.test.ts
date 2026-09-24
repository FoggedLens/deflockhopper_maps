import { describe, it, expect } from 'vitest';
import { flockHitLayers, hasFlockHitLayers, layersToRaise, FLOCK_LAYER_ORDER, FLOCK_LEAK_OTHERS_LAYER, FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER } from './flockLeakLayerIds';

const mapWith = (...ids: string[]) => ({ getLayer: (id: string) => (ids.includes(id) ? {} : undefined) });

describe('flockHitLayers', () => {
  it('queries the core and planned layers on the compare marks', () => {
    expect(flockHitLayers(mapWith(FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER))).toEqual([
      FLOCK_LEAK_CORE_LAYER,
      FLOCK_LEAK_PLANNED_LAYER,
    ]);
  });

  it('never names a layer the map does not have', () => {
    expect(flockHitLayers(mapWith())).toEqual([]);
    expect(hasFlockHitLayers(mapWith())).toBe(false);
    expect(hasFlockHitLayers(mapWith(FLOCK_LEAK_CORE_LAYER))).toBe(true);
  });
});

describe('layersToRaise', () => {
  const ours = [FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER];

  it('returns nothing when the Flock layers already sit on top, in order', () => {
    const order = ['basemap', 'camera-tile-points', FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER];
    expect(layersToRaise(order, ours)).toEqual([]);
  });

  it('lists the mounted Flock layers, bottom to top, when OSM layers landed above them', () => {
    const order = ['basemap', FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER, 'camera-tile-glow-filtered', 'camera-tile-points-filtered'];
    expect(layersToRaise(order, ours)).toEqual([FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER]);
  });

  it('raises when the Flock layers are on top but out of order', () => {
    const order = ['basemap', FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_DOTS_LAYER];
    expect(layersToRaise(order, ours)).toEqual([FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_CORE_LAYER]);
  });

  it('ignores Flock layers that are not mounted', () => {
    expect(layersToRaise(['basemap', 'camera-tile-points'], ours)).toEqual([]);
  });
});

describe('the other-groups layer', () => {
  it('is queried for taps and counts when mounted', () => {
    expect(flockHitLayers(mapWith(FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_OTHERS_LAYER))).toEqual([FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_OTHERS_LAYER]);
  });

  it('is part of the Flock layer order', () => {
    expect(FLOCK_LAYER_ORDER).toContain(FLOCK_LEAK_OTHERS_LAYER);
  });
});

describe('layer ids', () => {
  it('has no separate landing points layer: the Flock view draws the filled marks', async () => {
    const mod = await import('./flockLeakLayerIds');
    expect('FLOCK_LEAK_POINTS_LAYER' in mod).toBe(false);
  });
});
