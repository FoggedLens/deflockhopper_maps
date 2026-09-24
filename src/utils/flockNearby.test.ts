import { describe, it, expect } from 'vitest';
import { nearestDistanceMeters, flockNearbyHint } from './flockNearby';

describe('nearestDistanceMeters', () => {
  it('returns null with no candidates', () => {
    expect(nearestDistanceMeters({ lon: -95, lat: 29 }, [])).toBeNull();
  });

  it('returns the closest distance in meters', () => {
    const origin = { lon: -95.3698, lat: 29.7604 };
    const near = { lon: -95.3698, lat: 29.7605 }; // ~11 m north
    const far = { lon: -95.36, lat: 29.7604 };
    const d = nearestDistanceMeters(origin, [far, near]);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(9);
    expect(d!).toBeLessThan(13);
  });
});

describe('flockNearbyHint', () => {
  it('says nothing below z10', () => {
    expect(flockNearbyHint({ zoom: 9.9, type: 'alpr', nearestMeters: 5, osmVisible: true })).toBeNull();
  });

  it('says nothing when OSM is hidden (Flock view), since nothing was queried', () => {
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: null, osmVisible: false })).toBeNull();
  });

  it('reports a nearby OSM camera for an ALPR without a mis-tag note', () => {
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: 6.4, osmVisible: true }))
      .toBe('OSM has a camera 6 m from here.');
  });

  it('adds the mis-tag note when the Flock type is not an ALPR', () => {
    expect(flockNearbyHint({ zoom: 14, type: 'condor', nearestMeters: 6.4, osmVisible: true }))
      .toBe('OSM has a camera 6 m from here. Could be a mis-tag. Verify in person.');
  });

  it('reports nothing nearby beyond 50 m or with no candidates', () => {
    const msg = 'No OSM camera shown within 50 m. Check in person before adding one.';
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: 51, osmVisible: true })).toBe(msg);
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: null, osmVisible: true })).toBe(msg);
  });
});
