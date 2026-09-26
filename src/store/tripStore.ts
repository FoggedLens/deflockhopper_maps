import { create } from 'zustand';
import type { FlockDeviceRecord } from '../lib/flockInventory';
import { orderStops, type LatLon } from '../utils/tripOrder';

/** Google Maps' limit for one trip: 9 waypoints plus the destination. */
export const TRIP_MAX_STOPS = 10;
const STORAGE_KEY = 'deflock:trip:v1';

/** One place to drive to: every device at one exact coordinate, named by
 *  its lead device. The chip sits on the drawn mark (markLat/markLon); the
 *  link and the order use the exact coordinate. */
export interface TripStop {
  key: string;
  lat: number;
  lon: number;
  markLat: number;
  markLon: number;
  name: string;
  type: string;
  deviceCount: number;
}

export type TripLocationStatus = 'idle' | 'pending' | 'granted' | 'denied' | 'unavailable';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A resolved Leak tap as a stop. The devices come lead-first from
 *  groupDevicesAtCoordinate. Null when the tap carried no device records
 *  (below z9 the tiles hold only codes). */
export function tripStopFromGroup(group: {
  lat: number;
  lon: number;
  markLat: number;
  markLon: number;
  devices: readonly FlockDeviceRecord[];
}): TripStop | null {
  const lead = group.devices[0];
  if (!lead) return null;
  return {
    key: `${group.lat},${group.lon}`,
    lat: group.lat,
    lon: group.lon,
    markLat: group.markLat,
    markLon: group.markLon,
    name: lead.name || 'Unnamed device',
    type: lead.type,
    deviceCount: group.devices.length,
  };
}

/** Stops in driving order. Components call this inside useMemo: a selector
 *  returning a fresh array would re-render on every store change. */
export function orderedStops(stops: readonly TripStop[], order: readonly string[]): TripStop[] {
  const byKey = new Map(stops.map((s) => [s.key, s]));
  return order.map((k) => byKey.get(k)).filter((s): s is TripStop => s !== undefined);
}

function isTripStop(v: unknown): v is TripStop {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  return typeof s.key === 'string' && num(s.lat) && num(s.lon) && num(s.markLat) && num(s.markLon)
    && typeof s.name === 'string' && typeof s.type === 'string' && num(s.deviceCount);
}

/** Saved stops, or none. Anything malformed is dropped rather than trusted. */
export function readStoredStops(storage: StorageLike | null): TripStop[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTripStop).slice(0, TRIP_MAX_STOPS);
  } catch {
    return [];
  }
}

export function writeStoredStops(storage: StorageLike | null, stops: readonly TripStop[]): void {
  if (!storage) return;
  try {
    if (stops.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(stops));
  } catch {
    // Private mode or a full quota: the trip just won't survive a reload.
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const orderKeys = (origin: LatLon | null, stops: readonly TripStop[]): string[] =>
  orderStops(origin, stops).map((i) => stops[i].key);

interface TripState {
  /** Trip mode is open (Leak tab, phones). */
  active: boolean;
  /** At most TRIP_MAX_STOPS, in the order they were added. */
  stops: TripStop[];
  /** Stop keys in driving order, recomputed by every change. */
  order: string[];
  /** The phone's position when known. Orders the stops and draws the dot;
   *  never goes in the link. */
  origin: LatLon | null;
  locationStatus: TripLocationStatus;

  open: () => void;
  /** Done: leaves trip mode, keeps the stops. */
  close: () => void;
  /** Adds the stop, or removes it when its key is already in the trip. At the
   *  cap a new stop is ignored. */
  toggleStop: (stop: TripStop) => 'added' | 'removed' | 'full';
  removeStop: (key: string) => void;
  clear: () => void;
  setOrigin: (origin: LatLon | null) => void;
  setLocationStatus: (status: TripLocationStatus) => void;
  /** Re-reads the position when it was already granted. Never asks. */
  refreshOrigin: () => void;
}

const savedStops = readStoredStops(browserStorage());

export const useTripStore = create<TripState>((set, get) => {
  const commit = (stops: TripStop[]) => {
    set({ stops, order: orderKeys(get().origin, stops) });
    writeStoredStops(browserStorage(), stops);
  };

  return {
    active: false,
    stops: savedStops,
    order: orderKeys(null, savedStops),
    origin: null,
    locationStatus: 'idle',

    open: () => {
      if (get().active) return;
      set({ active: true });
      // The first open asks. Once granted, every open re-reads the position
      // (no prompt), so a trip planned later starts from where the phone is now.
      const status = get().locationStatus;
      if (status === 'idle' || status === 'granted') requestTripOrigin();
    },
    close: () => {
      if (get().active) set({ active: false });
    },
    toggleStop: (stop) => {
      const { stops } = get();
      if (stops.some((s) => s.key === stop.key)) {
        commit(stops.filter((s) => s.key !== stop.key));
        return 'removed';
      }
      if (stops.length >= TRIP_MAX_STOPS) return 'full';
      commit([...stops, stop]);
      return 'added';
    },
    removeStop: (key) => {
      const { stops } = get();
      if (stops.some((s) => s.key === key)) commit(stops.filter((s) => s.key !== key));
    },
    clear: () => {
      if (get().stops.length > 0) commit([]);
    },
    setOrigin: (origin) => set({ origin, order: orderKeys(origin, get().stops) }),
    setLocationStatus: (locationStatus) => set({ locationStatus }),
    refreshOrigin: () => {
      if (get().locationStatus === 'granted') requestTripOrigin();
    },
  };
});

/**
 * Reads the phone's position so the order can start where the user is. The
 * browser prompts only the first time; a refusal is never asked again.
 * Refusal, errors and timeouts clear the origin (a stale one would order the
 * trip from the wrong place) and the order starts at stop 1.
 */
export function requestTripOrigin(): void {
  const { setLocationStatus, setOrigin } = useTripStore.getState();
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) {
    setLocationStatus('unavailable');
    return;
  }
  setLocationStatus('pending');
  geo.getCurrentPosition(
    (pos) => {
      setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      setLocationStatus('granted');
    },
    (err) => {
      setOrigin(null);
      setLocationStatus(err.code === 1 ? 'denied' : 'unavailable');
    },
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
  );
}

/** Test hook: not for app code. */
export function _resetTripStoreForTests(): void {
  useTripStore.setState({ active: false, stops: [], order: [], origin: null, locationStatus: 'idle' });
}
