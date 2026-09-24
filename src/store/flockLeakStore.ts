import { create } from 'zustand';
import { clampDivider } from '../utils/swipeFilter';
import { loadFlockLeakTileJson, type FlockLeakTileJson } from '../services/flockLeakTilesService';
import {
  FLOCK_SELECTABLE_STATUSES,
  type FlockDeviceType,
  type FlockDeviceStatus,
} from '../lib/flockTypeNormalization';

export type FlockLeakView = 'flock' | 'swipe' | 'overlay';
export type FlockLeakLoadPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface FlockDeviceSelection {
  lon: number;
  lat: number;
  type: FlockDeviceType;
  status: FlockDeviceStatus;
  rawType: string;
  rawStatus: string;
  /** Every other tile attribute, stringified, for the popup rows. */
  extra: Array<[string, string]>;
  /** Nearest rendered OSM camera at click time; null when none was found. */
  nearestOsmMeters: number | null;
  zoom: number;
}

export const DEFAULT_FLOCK_STATUSES: readonly FlockDeviceStatus[] = ['active'];

interface FlockLeakState {
  view: FlockLeakView;
  /** Swipe divider as a fraction of the map width, 0..1. The only value
   *  written during a gesture. */
  divider: number;
  types: FlockDeviceType[];
  statuses: FlockDeviceStatus[];
  tileJson: FlockLeakTileJson | null;
  loadPhase: FlockLeakLoadPhase;
  error: string | null;
  /** Set by the map's tile error handling; cleared on a successful load. */
  tilesFailed: boolean;
  /** Bumped by retry so the map remounts the Flock source. */
  sourceEpoch: number;
  selectedDevice: FlockDeviceSelection | null;

  setView: (view: FlockLeakView) => void;
  setDivider: (divider: number) => void;
  toggleType: (type: FlockDeviceType) => void;
  clearTypes: () => void;
  toggleStatus: (status: FlockDeviceStatus) => void;
  setSelectedDevice: (selection: FlockDeviceSelection | null) => void;
  setTilesFailed: (failed: boolean) => void;
  ensureTileJsonLoaded: () => Promise<void>;
  retry: () => void;
}

const INITIAL = {
  view: 'flock' as FlockLeakView,
  divider: 0.5,
  types: [] as FlockDeviceType[],
  statuses: [...DEFAULT_FLOCK_STATUSES],
  tileJson: null as FlockLeakTileJson | null,
  loadPhase: 'idle' as FlockLeakLoadPhase,
  error: null as string | null,
  tilesFailed: false,
  sourceEpoch: 0,
  selectedDevice: null as FlockDeviceSelection | null,
};

export const useFlockLeakStore = create<FlockLeakState>((set, get) => ({
  ...INITIAL,

  setView: (view) => {
    if (get().view !== view) set({ view });
  },
  setDivider: (divider) => {
    const next = clampDivider(divider);
    if (next !== get().divider) set({ divider: next });
  },
  toggleType: (type) =>
    set((s) => ({
      types: s.types.includes(type) ? s.types.filter((t) => t !== type) : [...s.types, type],
    })),
  clearTypes: () => {
    if (get().types.length > 0) set({ types: [] });
  },
  toggleStatus: (status) =>
    set((s) => ({
      statuses: s.statuses.includes(status)
        ? s.statuses.filter((x) => x !== status)
        : [...s.statuses, status],
    })),
  setSelectedDevice: (selectedDevice) => set({ selectedDevice }),
  setTilesFailed: (tilesFailed) => {
    if (get().tilesFailed !== tilesFailed) set({ tilesFailed });
  },

  ensureTileJsonLoaded: async () => {
    const { loadPhase } = get();
    if (loadPhase === 'loading' || loadPhase === 'ready') return;
    set({ loadPhase: 'loading', error: null });
    const doc = await loadFlockLeakTileJson();
    if (doc) set({ tileJson: doc, loadPhase: 'ready' });
    else set({ loadPhase: 'error', error: 'Flock data unavailable' });
  },

  retry: () => {
    set((s) => ({ loadPhase: 'idle', error: null, tilesFailed: false, sourceEpoch: s.sourceEpoch + 1 }));
    void get().ensureTileJsonLoaded();
  },
}));

/** Badge count for the filter button. The Active-only default is a filter
 *  the user can see (Planned and Decommissioned are hidden), so it counts. */
export function activeFlockFilterCount(s: { types: FlockDeviceType[]; statuses: FlockDeviceStatus[] }): number {
  const typeActive = s.types.length > 0 ? 1 : 0;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((x) => s.statuses.includes(x));
  return typeActive + (allStatuses ? 0 : 1);
}

/** Test hook — not for app code. */
export function _resetFlockLeakStoreForTests(): void {
  useFlockLeakStore.setState({ ...INITIAL, statuses: [...DEFAULT_FLOCK_STATUSES], types: [] });
}
