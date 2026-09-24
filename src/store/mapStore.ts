import { create } from 'zustand';
import type { MapState, MapBounds } from '../types';
import type { TileViewBrandStats } from '../services/cameraIndexService';

interface FlyToCommand {
  center: [number, number];
  zoom?: number;
  timestamp: number;
}

interface MapStoreState extends MapState {
  // Map interaction state
  isInteracting: boolean;
  selectedCameraId: number | null;
  showCameraLayer: boolean;
  showRouteLayer: boolean;

  // FlyTo command for map to consume
  flyToCommand: FlyToCommand | null;

  // Timeline tick callback - MapLibreContainer registers its filter handler here
  _timelineTickCallback: ((dateStr: string) => void) | null;

  /** Approximate camera count in view when rendering from tiles (null = geojson mode). */
  tileViewCameraCount: number | null;

  /** Top-4 brand mix in view. Non-null only when rendering unfiltered tiles
   *  with the positions index loaded; null hides the breakdown UI. */
  tileViewBrandStats: TileViewBrandStats | null;

  /** Flock devices in view on the Leak tab (rendered features deduped by id,
   *  z9 and up); null off the tab or below z9, where the header shows totals. */
  tileViewFlockCount: number | null;

  /** True when the boot URL pinned an explicit viewport (share link).
   *  Set once by useUrlSync's seeding; never changes afterwards. */
  urlHadViewport: boolean;

  // Actions
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;
  setBounds: (bounds: MapBounds | null) => void;
  /** Batch center + zoom + bounds in a single store update (used by onMove) */
  setViewState: (center: [number, number], zoom: number, bounds: MapBounds) => void;
  setIsInteracting: (isInteracting: boolean) => void;
  setSelectedCamera: (osmId: number | null) => void;
  toggleCameraLayer: () => void;
  toggleRouteLayer: () => void;
  flyTo: (center: [number, number], zoom?: number) => void;
  clearFlyToCommand: () => void;
  fitBounds: (bounds: MapBounds) => void;
  setTimelineTickCallback: (cb: ((dateStr: string) => void) | null) => void;
  setTileViewCameraCount: (count: number | null) => void;
  setTileViewBrandStats: (stats: TileViewBrandStats | null) => void;
  setTileViewFlockCount: (count: number | null) => void;

  /** One-shot command consumed by MapLibreContainer — frames the given
   *  bounds with the map's real projection/aspect (unlike flyTo's guess). */
  fitBoundsCommand: MapBounds | null;
  requestFitBounds: (bounds: MapBounds) => void;
  clearFitBoundsCommand: () => void;
}

// Default center: Geographic center of the contiguous US
const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
// On mobile (< 1024px), use a lower zoom so the whole US is visible on first load
const DEFAULT_ZOOM = typeof window !== 'undefined' && window.innerWidth < 1024 ? 2.5 : 4;

export const useMapStore = create<MapStoreState>((set) => ({
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  bounds: null,
  isInteracting: false,
  selectedCameraId: null,
  showCameraLayer: true,
  showRouteLayer: true,
  flyToCommand: null,
  _timelineTickCallback: null,
  tileViewCameraCount: null,
  tileViewBrandStats: null,
  tileViewFlockCount: null,
  urlHadViewport: false,
  fitBoundsCommand: null,

  setCenter: (center: [number, number]) => {
    set({ center });
  },

  setZoom: (zoom: number) => {
    set({ zoom });
  },

  setBounds: (bounds: MapBounds | null) => {
    set({ bounds });
  },

  setViewState: (center, zoom, bounds) => {
    set({ center, zoom, bounds });
  },

  setIsInteracting: (isInteracting: boolean) => {
    set({ isInteracting });
  },

  setSelectedCamera: (osmId: number | null) => {
    set({ selectedCameraId: osmId });
  },

  toggleCameraLayer: () => {
    set((state) => ({ showCameraLayer: !state.showCameraLayer }));
  },

  toggleRouteLayer: () => {
    set((state) => ({ showRouteLayer: !state.showRouteLayer }));
  },

  flyTo: (center: [number, number], zoom?: number) => {
    set({ 
      flyToCommand: { center, zoom, timestamp: Date.now() },
      center,
      ...(zoom !== undefined && { zoom }),
    });
  },

  clearFlyToCommand: () => {
    set({ flyToCommand: null });
  },

  fitBounds: (bounds: MapBounds) => {
    set({ bounds });
  },

  requestFitBounds: (bounds) => set({ fitBoundsCommand: bounds }),
  clearFitBoundsCommand: () => set({ fitBoundsCommand: null }),

  setTimelineTickCallback: (cb) => set({ _timelineTickCallback: cb }),

  setTileViewCameraCount: (count) => set({ tileViewCameraCount: count }),
  setTileViewBrandStats: (stats) => set({ tileViewBrandStats: stats }),
  setTileViewFlockCount: (count) =>
    set((s) => (s.tileViewFlockCount === count ? {} : { tileViewFlockCount: count })),
}));

