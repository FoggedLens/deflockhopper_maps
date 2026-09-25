import { describe, it, expect } from 'vitest';
import type { CameraFilters } from '../types';
import {
  LEAK_OSM_DEFAULT_BRAND,
  LEAK_COMPARE_FLOCK_GROUPS,
  LEAK_COMPARE_FLOCK_STATUSES,
  isCompareView,
  shouldSeedCompare,
  seedOsmFilters,
  compareSeedHolds,
} from './leakCompareDefaults';

const clean: CameraFilters = {
  operators: [],
  brands: [],
  surveillanceZones: [],
  mountTypes: [],
  state: undefined,
  showAll: true,
  timelineDate: undefined,
};

describe('compare defaults', () => {
  it('narrows Flock to plate readers (every status) and OSM to Flock Safety', () => {
    expect(LEAK_COMPARE_FLOCK_GROUPS).toEqual([1]);
    expect(LEAK_COMPARE_FLOCK_STATUSES).toEqual([1, 2, 3]);
    expect(LEAK_OSM_DEFAULT_BRAND).toBe('Flock Safety');
  });

  it('Overlay is the compare view, Flock is not', () => {
    expect(isCompareView('flock')).toBe(false);
    expect(isCompareView('overlay')).toBe(true);
  });
});

describe('shouldSeedCompare', () => {
  it('seeds when leaving the Flock view for Overlay the first time', () => {
    expect(shouldSeedCompare('flock', 'overlay', false)).toBe(true);
  });

  it('never seeds twice in one visit', () => {
    expect(shouldSeedCompare('flock', 'overlay', true)).toBe(false);
  });

  it('does not seed when staying in Overlay or going back to Flock', () => {
    expect(shouldSeedCompare('overlay', 'overlay', false)).toBe(false);
    expect(shouldSeedCompare('overlay', 'flock', false)).toBe(false);
    expect(shouldSeedCompare('flock', 'flock', false)).toBe(false);
  });
});

describe('seedOsmFilters', () => {
  it('sets the brand to Flock Safety and turns showAll off', () => {
    const out = seedOsmFilters(clean);
    expect(out.brands).toEqual(['Flock Safety']);
    expect(out.showAll).toBe(false);
  });

  it('keeps the other facets the user arrived with', () => {
    const out = seedOsmFilters({ ...clean, state: 'TX', surveillanceZones: ['traffic'], showAll: false });
    expect(out.state).toBe('TX');
    expect(out.surveillanceZones).toEqual(['traffic']);
    expect(out.operators).toEqual([]);
  });

  it('replaces any brand selection rather than appending to it', () => {
    const out = seedOsmFilters({ ...clean, brands: ['Motorola Solutions'], showAll: false });
    expect(out.brands).toEqual(['Flock Safety']);
  });

  it('does not mutate its input', () => {
    const input = { ...clean, brands: ['Genetec'] };
    seedOsmFilters(input);
    expect(input.brands).toEqual(['Genetec']);
    expect(input.showAll).toBe(true);
  });
});

describe('compareSeedHolds', () => {
  const seeded = { groups: [1], statuses: [1, 2, 3], brands: ['Flock Safety'] } as const;

  it('holds right after the seed, whatever the order of the arrays', () => {
    expect(compareSeedHolds({ groups: [1], statuses: [3, 1, 2], brands: ['Flock Safety'] })).toBe(true);
  });

  it('breaks once the user widens or narrows either side', () => {
    expect(compareSeedHolds({ ...seeded, groups: [1, 2] })).toBe(false);
    expect(compareSeedHolds({ ...seeded, statuses: [1] })).toBe(false);
    expect(compareSeedHolds({ ...seeded, brands: [] })).toBe(false);
    expect(compareSeedHolds({ ...seeded, brands: ['Flock Safety', 'Genetec'] })).toBe(false);
  });
});
