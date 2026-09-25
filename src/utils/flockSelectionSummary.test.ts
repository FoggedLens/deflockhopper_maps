import { describe, it, expect } from 'vitest';
import { flockSelectionSummary } from './flockSelectionSummary';
import type { FlockSelection } from '../store/flockLeakStore';
import type { FlockDeviceRecord } from '../lib/flockInventory';

const IMPORTED = '2024-03-26T18:02:45.611000+00:00';

const device = (over: Partial<FlockDeviceRecord> = {}): FlockDeviceRecord => ({
  id: 54151,
  g: 1,
  s: 1,
  q: 0,
  type: 'falcon',
  name: 'HPW28 - I45 (SB) Exit Ramp onto McKinney at City Hall',
  created: IMPORTED,
  features: ['livestream', 'readsLicensePlates'],
  active: true,
  rotationAngle: null,
  lat: 29.7604,
  lon: -95.3698,
  ...over,
});

const selection = (over: Partial<FlockSelection> = {}): FlockSelection => ({
  lon: -95.3698,
  lat: 29.7604,
  markLon: -95.3698,
  markLat: 29.7604,
  zoom: 15,
  g: 1,
  s: 1,
  q: 0,
  devices: [device()],
  nearestOsmMeters: null,
  ...over,
});

describe('flockSelectionSummary', () => {
  it('names a single device by its type, with group, status, name and date', () => {
    expect(flockSelectionSummary(selection(), 'flock')).toEqual({
      title: 'Falcon',
      meta: 'Plate reader · In service',
      primary: 'HPW28 - I45 (SB) Exit Ramp onto McKinney at City Hall',
      secondary: 'Created on or before Mar 26, 2024',
      secondaryIsHint: false,
    });
  });

  it('keeps an exact creation date as written', () => {
    const s = flockSelectionSummary(selection({ devices: [device({ created: '2025-11-10T06:07:48.053000+00:00' })] }), 'flock');
    expect(s.secondary).toBe('Created Nov 10, 2025');
  });

  it('falls back to the type when a device has no name', () => {
    const s = flockSelectionSummary(selection({ devices: [device({ name: '' })] }), 'flock');
    expect(s.primary).toBeNull();
  });

  it('counts a stack by type and leads with the first device', () => {
    const devices = [
      device({ id: 1, g: 5, s: 2, type: 'droneDockingStation', name: 'DS#008 - San Francisco PD - Dock 3' }),
      device({ id: 2, g: 5, s: 2, type: 'droneDockingStation', name: 'DS#009 - San Francisco PD - Dock 4' }),
      device({ id: 3, g: 7, s: 2, type: 'picard', name: 'P#008' }),
      device({ id: 4, g: 7, s: 2, type: 'picard', name: 'P#009' }),
    ];
    const s = flockSelectionSummary(selection({ devices, g: 5, s: 2 }), 'flock');
    expect(s.title).toBe('4 devices on one spot');
    expect(s.meta).toBeNull();
    expect(s.primary).toBe('2 Drone Dock · 2 Picard');
    expect(s.secondary).toBe('DS#008 - San Francisco PD - Dock 3');
    expect(s.secondaryIsHint).toBe(false);
  });

  it('asks for a zoom on a merged point below z9', () => {
    expect(flockSelectionSummary(selection({ zoom: 6, devices: [], g: 1, s: 1 }), 'flock')).toEqual({
      title: 'Flock ALPR',
      meta: 'In service',
      primary: 'Zoom in for device names and details.',
      secondary: null,
      secondaryIsHint: false,
    });
  });

  it('while comparing, the nearby OSM hint replaces the date', () => {
    const s = flockSelectionSummary(selection({ nearestOsmMeters: 5.2 }), 'overlay');
    expect(s.secondary).toBe('OSM has a camera 5 m from here.');
    expect(s.secondaryIsHint).toBe(true);
  });

  it('shows no hint in the Flock view, where OSM is not drawn', () => {
    const s = flockSelectionSummary(selection({ nearestOsmMeters: 5.2 }), 'flock');
    expect(s.secondaryIsHint).toBe(false);
  });

  it('never uses an em dash', () => {
    const all = [
      flockSelectionSummary(selection(), 'overlay'),
      flockSelectionSummary(selection({ zoom: 6, devices: [] }), 'flock'),
    ];
    for (const s of all) expect(JSON.stringify(s)).not.toContain('—');
  });
});
