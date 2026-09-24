import { create } from 'zustand';
import { clampDivider } from '../utils/swipeFilter';
import { loadFlockLeakTileJson, type FlockLeakTileJson } from '../services/flockLeakTilesService';
import { useCameraStore } from './cameraStore';
import type { CameraFilters } from '../types';
import { LEAK_COMPARE_FLOCK_GROUPS, seedOsmFilters, shouldSeedCompare } from '../utils/leakCompareDefaults';
import {
  FLOCK_SELECTABLE_STATUSES,
  type FlockGroup,
  type FlockStatus,
  type FlockQuality,
  type FlockDeviceRecord,
} from '../lib/flockInventory';

export type FlockLeakView = 'flock' | 'swipe' | 'overlay';
export type FlockLeakLoadPhase = 'idle' | 'loading' | 'ready' | 'error';

/** What a tap on the Flock layer resolved to. Below z9 the tiles carry only
 *  codes, so `devices` is empty and g/s/q describe the merged point. */
export interface FlockSelection {
  lon: number;
  lat: number;
  zoom: number;
  g: FlockGroup | null;
  s: FlockStatus | null;
  q: FlockQuality | null;
  /** Devices at exactly this coordinate (z9+), deduped by id, lead device first. */
  devices: FlockDeviceRecord[];
  /** Nearest rendered OSM camera at click time; null when none or OSM hidden. */
  nearestOsmMeters: number | null;
}

export const DEFAULT_FLOCK_STATUSES: readonly FlockStatus[] = [1];

/** Both sides' filters as they were when the tab was entered. The Leak
 *  tab's filters are per visit: leaving puts everything back. */
interface VisitSnapshot {
  osm: CameraFilters;
  groups: FlockGroup[];
  statuses: FlockStatus[];
  showSuspect: boolean;
}

interface FlockLeakState {
  view: FlockLeakView;
  /** Swipe divider as a fraction of the map width, 0..1. The only value
   *  written during a gesture. */
  divider: number;
  /** Empty means every selectable group. */
  groups: FlockGroup[];
  statuses: FlockStatus[];
  /** Reveal q > 0 records (unknown status, fixtures, placeholder stacks, outside NA). */
  showSuspect: boolean;
  selection: FlockSelection | null;
  tileJson: FlockLeakTileJson | null;
  loadPhase: FlockLeakLoadPhase;
  error: string | null;
  /** Set by the map's tile error handling; cleared on a successful load. */
  tilesFailed: boolean;
  /** Bumped by retry so the map remounts the Flock source. */
  sourceEpoch: number;
  /** True once this visit's compare defaults (Flock plate readers, OSM
   *  brand Flock Safety) have been applied. Reset by beginVisit. */
  compareSeeded: boolean;
  visitSnapshot: VisitSnapshot | null;

  /** Tab entered: snapshot both sides' filters. */
  beginVisit: () => void;
  /** Tab left: restore the snapshot and land the next visit on Flock. */
  endVisit: () => void;
  /** Changes the view; the first move from Flock into Swipe or Overlay in a
   *  visit seeds the compare defaults on both sides. */
  setView: (view: FlockLeakView) => void;
  setDivider: (divider: number) => void;
  toggleGroup: (group: FlockGroup) => void;
  clearGroups: () => void;
  toggleStatus: (status: FlockStatus) => void;
  setShowSuspect: (show: boolean) => void;
  setSelection: (selection: FlockSelection | null) => void;
  setTilesFailed: (failed: boolean) => void;
  ensureTileJsonLoaded: () => Promise<void>;
  retry: () => void;
}

const INITIAL = {
  view: 'flock' as FlockLeakView,
  divider: 0.5,
  groups: [] as FlockGroup[],
  statuses: [...DEFAULT_FLOCK_STATUSES],
  showSuspect: false,
  selection: null as FlockSelection | null,
  tileJson: null as FlockLeakTileJson | null,
  loadPhase: 'idle' as FlockLeakLoadPhase,
  error: null as string | null,
  tilesFailed: false,
  sourceEpoch: 0,
  compareSeeded: false,
  visitSnapshot: null as VisitSnapshot | null,
};

export const useFlockLeakStore = create<FlockLeakState>((set, get) => ({
  ...INITIAL,

  beginVisit: () => {
    const s = get();
    set({
      visitSnapshot: {
        osm: { ...useCameraStore.getState().filters },
        groups: [...s.groups],
        statuses: [...s.statuses],
        showSuspect: s.showSuspect,
      },
      compareSeeded: false,
    });
  },
  endVisit: () => {
    const snap = get().visitSnapshot;
    if (!snap) return;
    set({
      view: 'flock',
      groups: snap.groups,
      statuses: snap.statuses,
      showSuspect: snap.showSuspect,
      compareSeeded: false,
      visitSnapshot: null,
    });
    useCameraStore.getState().setFilters(snap.osm);
  },
  setView: (view) => {
    const s = get();
    if (s.view === view) return;
    if (!shouldSeedCompare(s.view, view, s.compareSeeded)) {
      set({ view });
      return;
    }
    set({ view, groups: [...LEAK_COMPARE_FLOCK_GROUPS], compareSeeded: true });
    const cam = useCameraStore.getState();
    cam.setFilters(seedOsmFilters(cam.filters));
  },
  setDivider: (divider) => {
    const next = clampDivider(divider);
    if (next !== get().divider) set({ divider: next });
  },
  toggleGroup: (group) =>
    set((s) => ({
      groups: s.groups.includes(group) ? s.groups.filter((g) => g !== group) : [...s.groups, group],
    })),
  clearGroups: () => {
    if (get().groups.length > 0) set({ groups: [] });
  },
  toggleStatus: (status) =>
    set((s) => ({
      statuses: s.statuses.includes(status)
        ? s.statuses.filter((x) => x !== status)
        : [...s.statuses, status],
    })),
  setShowSuspect: (showSuspect) => {
    if (get().showSuspect !== showSuspect) set({ showSuspect });
  },
  setSelection: (selection) => set({ selection }),
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

/** Badge count for the filter button. The In-service-only default is a
 *  filter the user can see (Planned and Decommissioned are hidden), so it
 *  counts; so does revealing suspect records. */
export function activeFlockFilterCount(s: {
  groups: FlockGroup[];
  statuses: FlockStatus[];
  showSuspect: boolean;
}): number {
  const groupActive = s.groups.length > 0 ? 1 : 0;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((x) => s.statuses.includes(x));
  return groupActive + (allStatuses ? 0 : 1) + (s.showSuspect ? 1 : 0);
}

/** Test hook — not for app code. */
export function _resetFlockLeakStoreForTests(): void {
  // Fresh arrays every time: INITIAL's arrays must never be shared across resets.
  useFlockLeakStore.setState({ ...INITIAL, statuses: [...DEFAULT_FLOCK_STATUSES], groups: [] });
}
