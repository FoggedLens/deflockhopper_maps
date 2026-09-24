import { describe, it, expect } from 'vitest';
import {
  FLOCK_GROUPS,
  FLOCK_SELECTABLE_GROUPS,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_GROUP_LABEL,
  FLOCK_TYPE_LABEL,
  FLOCK_INVENTORY,
  FLOCK_IMPORT_SENTINEL,
  parseGroup,
  parseStatus,
  parseQuality,
  flockTypeLabel,
  formatCreated,
  parseFeatures,
  parseDeviceRecord,
  groupDevicesAtCoordinate,
  nearestCoordinateGroup,
  typeCountLine,
  cleanPointsFor,
} from './flockInventory';

describe('codes', () => {
  it('parses valid codes and rejects everything else', () => {
    expect(parseGroup(1)).toBe(1);
    expect(parseGroup('3')).toBe(3);
    expect(parseGroup(8)).toBe(8);
    expect(parseGroup(9)).toBeNull();
    expect(parseGroup(0)).toBeNull();
    expect(parseGroup(undefined)).toBeNull();
    expect(parseStatus(4)).toBe(4);
    expect(parseStatus(5)).toBeNull();
    expect(parseQuality(0)).toBe(0);
    expect(parseQuality(4)).toBe(4);
    expect(parseQuality(-1)).toBeNull();
    expect(parseQuality('x')).toBeNull();
  });

  it('group 8 is never selectable; statuses 1..3 are', () => {
    expect(FLOCK_GROUPS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(FLOCK_SELECTABLE_GROUPS).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(FLOCK_SELECTABLE_STATUSES).toEqual([1, 2, 3]);
    for (const g of FLOCK_GROUPS) expect(FLOCK_GROUP_LABEL[g].length).toBeGreaterThan(0);
  });
});

describe('type labels', () => {
  it('covers every type the contract lists', () => {
    const contractTypes = [
      'falcon', 'falconHighway', 'falconFlex', 'sparrow', 'lprTrailer',
      'condor', 'picardPtz',
      'wing', 'wingUbiuia', 'wingGateway', 'wingApi', 'external',
      'raven',
      'drone', 'droneDockingStation', 'droneControllerBox', 'droneRadar',
      'trailer', 'picardTrailer',
      'picard', 'avicore', 'talkDown', 'backhaulBox', 'multiEvidenceDevice', 'owl', 'automotus',
      'factoryFixture',
    ];
    for (const t of contractTypes) expect(FLOCK_TYPE_LABEL[t], t).toBeTruthy();
    expect(flockTypeLabel('droneDockingStation')).toBe('Drone Dock');
    expect(flockTypeLabel('picard')).toBe('Picard');
  });

  it('falls back to the trimmed raw value, or a placeholder when empty', () => {
    expect(flockTypeLabel('newThing ')).toBe('newThing');
    expect(flockTypeLabel('')).toBe('Unknown type');
    expect(flockTypeLabel(undefined)).toBe('Unknown type');
  });
});

describe('formatCreated', () => {
  it('renders the import sentinel as an upper bound', () => {
    expect(formatCreated(FLOCK_IMPORT_SENTINEL)).toBe('On or before Mar 26, 2024');
  });

  it('renders a normal timestamp as a date', () => {
    expect(formatCreated('2025-11-10T06:07:48.053000+00:00')).toBe('Nov 10, 2025');
  });

  it('returns null for garbage', () => {
    expect(formatCreated('')).toBeNull();
    expect(formatCreated(undefined)).toBeNull();
    expect(formatCreated('not a date')).toBeNull();
  });
});

describe('parseFeatures', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseFeatures('lpr,readsLicensePlates')).toEqual(['lpr', 'readsLicensePlates']);
    expect(parseFeatures(' replay , livestream ')).toEqual(['replay', 'livestream']);
    expect(parseFeatures('')).toEqual([]);
    expect(parseFeatures(undefined)).toEqual([]);
  });
});

const rec = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, g: 5, s: 2, q: 0, type: 'droneDockingStation', name: 'DS#008 - San Francisco PD - Dock 3 ',
  created: '2025-11-10T06:07:48.053000+00:00', features: '', active: 0, lat: 37.77946, lon: -122.50264,
  ...over,
});

describe('parseDeviceRecord', () => {
  it('parses a full z9+ record and trims the name', () => {
    const r = parseDeviceRecord(rec());
    expect(r).not.toBeNull();
    expect(r!.name).toBe('DS#008 - San Francisco PD - Dock 3');
    expect(r!.g).toBe(5);
    expect(r!.active).toBe(false);
    expect(r!.rotationAngle).toBeNull();
    expect(r!.features).toEqual([]);
  });

  it('keeps rotationAngle only when present and numeric', () => {
    expect(parseDeviceRecord(rec({ rotationAngle: 90 }))!.rotationAngle).toBe(90);
    expect(parseDeviceRecord(rec({ rotationAngle: 'x' }))!.rotationAngle).toBeNull();
  });

  it('returns null without an identity or a coordinate (z0..8 features)', () => {
    expect(parseDeviceRecord({ g: 1, s: 1, q: 0 })).toBeNull();
    expect(parseDeviceRecord(rec({ id: undefined }))).toBeNull();
    expect(parseDeviceRecord(rec({ lat: undefined }))).toBeNull();
    expect(parseDeviceRecord(rec({ g: 42 }))).toBeNull();
  });
});

describe('groupDevicesAtCoordinate and typeCountLine', () => {
  const at = (id: number, type: string, g: number, lat = 37.77946, lon = -122.50264) =>
    parseDeviceRecord(rec({ id, type, g, lat, lon }))!;

  it('keeps only devices at the exact coordinate, dedups by id, leads with non-components', () => {
    const rows = [
      at(9, 'picard', 7), at(8, 'picard', 7), at(1, 'droneDockingStation', 5), at(2, 'droneDockingStation', 5),
      at(2, 'droneDockingStation', 5), // tile-border duplicate
      at(3, 'drone', 5, 37.7795, -122.5026), // a few meters away
    ];
    const group = groupDevicesAtCoordinate(rows, 37.77946, -122.50264);
    expect(group.map((d) => d.id)).toEqual([1, 2, 9, 8]);
  });

  it('counts types in label order of first appearance', () => {
    const group = [at(1, 'droneDockingStation', 5), at(2, 'droneDockingStation', 5), at(8, 'picard', 7), at(9, 'picard', 7)];
    expect(typeCountLine(group)).toBe('2 Drone Dock · 2 Picard');
    expect(typeCountLine([at(1, 'falcon', 1)])).toBe('1 Falcon');
    expect(typeCountLine([])).toBe('');
  });

  it('nearestCoordinateGroup picks the coordinate closest to the click, not the first record', () => {
    const stack = [at(1, 'droneDockingStation', 5), at(2, 'droneDockingStation', 5)];
    const drone = at(3, 'drone', 5, 37.7795, -122.5026);
    // click 1 m from the stack: the drone record comes first in the list but the stack wins
    expect(nearestCoordinateGroup([drone, ...stack], 37.779465, -122.50264)).toEqual({ lat: 37.77946, lon: -122.50264 });
    // click on the drone's spot
    expect(nearestCoordinateGroup([...stack, drone], 37.7795, -122.5026)).toEqual({ lat: 37.7795, lon: -122.5026 });
    expect(nearestCoordinateGroup([], 0, 0)).toBeNull();
  });
});

describe('FLOCK_INVENTORY totals', () => {
  it('are internally consistent with the contract', () => {
    expect(FLOCK_INVENTORY.devices).toBe(FLOCK_INVENTORY.devicesClean + FLOCK_INVENTORY.devicesFlagged);
    const s = FLOCK_INVENTORY.cleanByStatus;
    expect(s.inService + s.planned + s.decommissioned).toBe(FLOCK_INVENTORY.nationalPointsClean);
    const byGroup = Object.values(FLOCK_INVENTORY.cleanByGroup).reduce((a, [i, p, d]) => a + i + p + d, 0);
    expect(byGroup).toBe(FLOCK_INVENTORY.nationalPointsClean);
  });
});

describe('cleanPointsFor', () => {
  it('sums the clean points for the selected statuses', () => {
    expect(cleanPointsFor(1, [1])).toBe(117_959);
    expect(cleanPointsFor(1, [1, 2, 3])).toBe(117_959 + 39_701 + 18_196);
    expect(cleanPointsFor(4, [2, 3])).toBe(6_429 + 4_961);
  });

  it('is zero with no statuses, for unknown status and for fixtures', () => {
    expect(cleanPointsFor(1, [])).toBe(0);
    expect(cleanPointsFor(1, [4])).toBe(0);
    expect(cleanPointsFor(8, [1, 2, 3])).toBe(0);
  });
});
