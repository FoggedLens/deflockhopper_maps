import { create } from 'zustand';
import { loadFlockLeakTileJson, type FlockLeakTileJson } from '../services/flockLeakTilesService';
import { useCameraStore } from './cameraStore';
import type { CameraFilters } from '../types';
import { LEAK_COMPARE_FLOCK_GROUPS, LEAK_COMPARE_FLOCK_STATUSES, seedOsmFilters, shouldSeedCompare } from '../utils/leakCompareDefaults';
import {
  FLOCK_SELECTABLE_STATUSES,
  type FlockGroup,
  type FlockStatus,
  type FlockQuality,
  type FlockDeviceRecord,
} from '../lib/flockInventory';

/** Flock alone, or Flock over the OSM cameras (the compare view). */
export type FlockLeakView = 'flock' | 'overlay';
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

/** Every lifecycle status: the landing view shows the whole list. Records
 *  with q > 0 (unknown status, fixtures, placeholder stacks, outside North
 *  America) are never drawn; the panel says how many. */
export const DEFAULT_FLOCK_STATUSES: readonly FlockStatus[] = [...FLOCK_SELECTABLE_STATUSES];

/** Both sides' filters as they were when the tab was entered. The Leak
 *  tab's filters are per visit: leaving puts everything back. */
/** Both sides' filters at one moment: what a visit began with, or what the
 *  view you are not in was showing. */
interface FilterSet {
  osm: CameraFilters;
  groups: FlockGroup[];
  statuses: FlockStatus[];
}

interface FlockLeakState {
  view: FlockLeakView;
  /** Empty means every selectable group. */
  groups: FlockGroup[];
  statuses: FlockStatus[];
  selection: FlockSelection | null;
  tileJson: FlockLeakTileJson | null;
  loadPhase: FlockLeakLoadPhase;
  error: string | null;
  /** Set by the map's tile error handling; cleared on a successful load. */
  tilesFailed: boolean;
  /** Bumped by retry so the map remounts the Flock source. */
  sourceEpoch: number;
  /** True once this visit's compare defaults (Flock plate readers, every
   *  status, OSM brand Flock Safety) have been applied. Reset by beginVisit. */
  compareSeeded: boolean;
  visitSnapshot: FilterSet | null;
  /** The other view's filters, parked while this view shows its own. Each
   *  view keeps its own set within a visit (user's call, 2026-09-25): going
   *  back to Flock's records shows what it had before comparing. */
  parked: FilterSet | null;

  /** Tab entered: snapshot both sides' filters. */
  beginVisit: () => void;
  /** Tab left: restore the snapshot and land the next visit on Flock. */
  endVisit: () => void;
  /** Changes the view, parking this view's filters and restoring the other
   *  view's. The first move from Flock into Overlay in a visit seeds the
   *  compare defaults on both sides instead. */
  setView: (view: FlockLeakView) => void;
  toggleGroup: (group: FlockGroup) => void;
  /** One chip can stand for several groups (Other is trailers + components):
   *  on when all are selected; a toggle adds the missing ones or removes all. */
  toggleGroups: (groups: readonly FlockGroup[]) => void;
  clearGroups: () => void;
  toggleStatus: (status: FlockStatus) => void;
  setSelection: (selection: FlockSelection | null) => void;
  setTilesFailed: (failed: boolean) => void;
  ensureTileJsonLoaded: () => Promise<void>;
  retry: () => void;
}

const INITIAL = {
  view: 'flock' as FlockLeakView,
  groups: [] as FlockGroup[],
  statuses: [...DEFAULT_FLOCK_STATUSES],
  selection: null as FlockSelection | null,
  tileJson: null as FlockLeakTileJson | null,
  loadPhase: 'idle' as FlockLeakLoadPhase,
  error: null as string | null,
  tilesFailed: false,
  sourceEpoch: 0,
  compareSeeded: false,
  visitSnapshot: null as FilterSet | null,
  parked: null as FilterSet | null,
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
      },
      compareSeeded: false,
      parked: null,
    });
  },
  endVisit: () => {
    const snap = get().visitSnapshot;
    if (!snap) return;
    set({
      view: 'flock',
      groups: snap.groups,
      statuses: snap.statuses,
      compareSeeded: false,
      visitSnapshot: null,
      parked: null,
      selection: null,
    });
    useCameraStore.getState().setFilters(snap.osm);
  },
  setView: (view) => {
    const s = get();
    if (s.view === view) return;
    const cam = useCameraStore.getState();
    const leaving: FilterSet = { osm: { ...cam.filters }, groups: [...s.groups], statuses: [...s.statuses] };
    if (shouldSeedCompare(s.view, view, s.compareSeeded)) {
      set({
        view,
        groups: [...LEAK_COMPARE_FLOCK_GROUPS],
        statuses: [...LEAK_COMPARE_FLOCK_STATUSES],
        compareSeeded: true,
        parked: leaving,
      });
      cam.setFilters(seedOsmFilters(cam.filters));
      return;
    }
    const arriving = s.parked;
    set({ view, parked: leaving, ...(arriving && { groups: arriving.groups, statuses: arriving.statuses }) });
    if (arriving) cam.setFilters(arriving.osm);
  },
  toggleGroup: (group) =>
    set((s) => ({
      groups: s.groups.includes(group) ? s.groups.filter((g) => g !== group) : [...s.groups, group],
    })),
  toggleGroups: (groups) =>
    set((s) => {
      const allOn = groups.every((g) => s.groups.includes(g));
      return {
        groups: allOn
          ? s.groups.filter((g) => !groups.includes(g))
          : [...s.groups, ...groups.filter((g) => !s.groups.includes(g))],
      };
    }),
  clearGroups: () => {
    if (get().groups.length > 0) set({ groups: [] });
  },
  toggleStatus: (status) =>
    set((s) => ({
      statuses: s.statuses.includes(status)
        ? s.statuses.filter((x) => x !== status)
        : [...s.statuses, status],
    })),
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

/** Badge count for the filter button: one for a device-type selection,
 *  one for any status left out. The all-statuses default counts nothing. */
export function activeFlockFilterCount(s: { groups: FlockGroup[]; statuses: FlockStatus[] }): number {
  const groupActive = s.groups.length > 0 ? 1 : 0;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((x) => s.statuses.includes(x));
  return groupActive + (allStatuses ? 0 : 1);
}

/** Test hook — not for app code. */
export function _resetFlockLeakStoreForTests(): void {
  // Fresh arrays every time: INITIAL's arrays must never be shared across resets.
  useFlockLeakStore.setState({ ...INITIAL, statuses: [...DEFAULT_FLOCK_STATUSES], groups: [] });
}
