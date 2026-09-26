import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useTripStore,
  tripStopFromGroup,
  orderedStops,
  readStoredStops,
  writeStoredStops,
  TRIP_MAX_STOPS,
  _resetTripStoreForTests,
  type TripStop,
} from './tripStore';
import type { FlockDeviceRecord } from '../lib/flockInventory';

function device(over: Partial<FlockDeviceRecord> = {}): FlockDeviceRecord {
  return {
    id: 1, g: 1, s: 1, q: 0, type: 'Falcon', name: '#28 Jefferson St EB from I-45',
    created: '', features: [], active: true, rotationAngle: null, lat: 29.75, lon: -95.36, ...over,
  } as FlockDeviceRecord;
}

function stop(lon: number, lat = 0): TripStop {
  return { key: `${lat},${lon}`, lat, lon, markLat: lat, markLon: lon, name: `Stop at ${lon}`, type: 'Falcon', deviceCount: 1 };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

beforeEach(() => _resetTripStoreForTests());
afterEach(() => vi.unstubAllGlobals());

describe('tripStopFromGroup', () => {
  it('names the stop by the lead device and keys it by the exact coordinate', () => {
    const s = tripStopFromGroup({ lat: 29.75, lon: -95.36, markLat: 29.7501, markLon: -95.3601, devices: [device()] });
    expect(s).toEqual({
      key: '29.75,-95.36', lat: 29.75, lon: -95.36, markLat: 29.7501, markLon: -95.3601,
      name: '#28 Jefferson St EB from I-45', type: 'Falcon', deviceCount: 1,
    });
  });

  it('makes one stop for a stack of devices on one pole', () => {
    const s = tripStopFromGroup({
      lat: 1, lon: 2, markLat: 1, markLon: 2,
      devices: [device({ id: 1, name: 'Pole A' }), device({ id: 2, g: 7, name: 'Compute box' })],
    });
    expect(s?.name).toBe('Pole A');
    expect(s?.deviceCount).toBe(2);
  });

  it('is null when the tap carried no device records (below z9)', () => {
    expect(tripStopFromGroup({ lat: 1, lon: 2, markLat: 1, markLon: 2, devices: [] })).toBeNull();
  });

  it('falls back to a plain label for an unnamed device', () => {
    expect(tripStopFromGroup({ lat: 1, lon: 2, markLat: 1, markLon: 2, devices: [device({ name: '' })] })?.name).toBe('Unnamed device');
  });
});

describe('toggleStop', () => {
  it('adds, then removes the same stop', () => {
    const t = useTripStore.getState();
    expect(t.toggleStop(stop(1))).toBe('added');
    expect(useTripStore.getState().stops).toHaveLength(1);
    expect(useTripStore.getState().toggleStop(stop(1))).toBe('removed');
    expect(useTripStore.getState().stops).toHaveLength(0);
  });

  it('holds at the cap and ignores new stops there', () => {
    for (let i = 0; i < TRIP_MAX_STOPS; i++) useTripStore.getState().toggleStop(stop(i));
    expect(useTripStore.getState().toggleStop(stop(99))).toBe('full');
    expect(useTripStore.getState().stops).toHaveLength(TRIP_MAX_STOPS);
    // Removing still works at the cap.
    expect(useTripStore.getState().toggleStop(stop(3))).toBe('removed');
  });

  it('keeps the driving order current as stops change', () => {
    useTripStore.getState().setOrigin({ lat: 0, lon: 0 });
    useTripStore.getState().toggleStop(stop(3));
    useTripStore.getState().toggleStop(stop(1));
    useTripStore.getState().toggleStop(stop(2));
    const { stops, order } = useTripStore.getState();
    expect(orderedStops(stops, order).map((s) => s.lon)).toEqual([1, 2, 3]);
  });

  it('reorders when the origin arrives', () => {
    useTripStore.getState().toggleStop(stop(1));
    useTripStore.getState().toggleStop(stop(2));
    useTripStore.getState().setOrigin({ lat: 0, lon: 5 });
    const { stops, order } = useTripStore.getState();
    expect(orderedStops(stops, order).map((s) => s.lon)).toEqual([2, 1]);
  });
});

describe('removeStop and clear', () => {
  it('removes by key and clears everything', () => {
    useTripStore.getState().toggleStop(stop(1));
    useTripStore.getState().toggleStop(stop(2));
    useTripStore.getState().removeStop('0,1');
    expect(useTripStore.getState().stops.map((s) => s.lon)).toEqual([2]);
    useTripStore.getState().clear();
    expect(useTripStore.getState().stops).toEqual([]);
    expect(useTripStore.getState().order).toEqual([]);
  });
});

describe('open, close and location', () => {
  it('opens without geolocation and marks location unavailable', () => {
    vi.stubGlobal('navigator', {});
    useTripStore.getState().open();
    expect(useTripStore.getState().active).toBe(true);
    expect(useTripStore.getState().locationStatus).toBe('unavailable');
    useTripStore.getState().close();
    expect(useTripStore.getState().active).toBe(false);
  });

  it('uses the position when granted and asks only once per page load', () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 29.7, longitude: -95.3 } } as GeolocationPosition)
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    useTripStore.getState().open();
    expect(useTripStore.getState().origin).toEqual({ lat: 29.7, lon: -95.3 });
    expect(useTripStore.getState().locationStatus).toBe('granted');
    useTripStore.getState().close();
    useTripStore.getState().open();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('records a refusal and keeps working without an origin', () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
      fail?.({ code: 1, message: 'denied' } as GeolocationPositionError)
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    useTripStore.getState().open();
    expect(useTripStore.getState().locationStatus).toBe('denied');
    expect(useTripStore.getState().origin).toBeNull();
    expect(useTripStore.getState().toggleStop(stop(1))).toBe('added');
  });
});

describe('storage', () => {
  it('round-trips stops', () => {
    const storage = memoryStorage();
    writeStoredStops(storage, [stop(1), stop(2)]);
    expect(readStoredStops(storage)).toEqual([stop(1), stop(2)]);
  });

  it('removes the entry when the trip is empty', () => {
    const storage = memoryStorage();
    writeStoredStops(storage, [stop(1)]);
    writeStoredStops(storage, []);
    expect(storage.data.size).toBe(0);
  });

  it('survives missing storage, corrupt JSON and bad entries', () => {
    expect(readStoredStops(null)).toEqual([]);
    const storage = memoryStorage();
    storage.setItem('deflock:trip:v1', '{not json');
    expect(readStoredStops(storage)).toEqual([]);
    storage.setItem('deflock:trip:v1', JSON.stringify({ stops: [] }));
    expect(readStoredStops(storage)).toEqual([]);
    storage.setItem('deflock:trip:v1', JSON.stringify([stop(1), { key: 5 }, null, { ...stop(2), lat: 'x' }]));
    expect(readStoredStops(storage)).toEqual([stop(1)]);
  });

  it('never restores more than the cap', () => {
    const storage = memoryStorage();
    storage.setItem('deflock:trip:v1', JSON.stringify(Array.from({ length: 14 }, (_, i) => stop(i))));
    expect(readStoredStops(storage)).toHaveLength(TRIP_MAX_STOPS);
  });

  it('never throws when storage refuses writes', () => {
    const storage = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(() => writeStoredStops(storage, [stop(1)])).not.toThrow();
  });
});
