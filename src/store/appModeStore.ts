import { create } from 'zustand';
import { TIMELINE_START } from '../modes/timeline/timelineUtils';

export type AppMode = 'map' | 'route' | 'explore' | 'network';
export type ExploreFeature = 'heatmap'; // extend: | 'density-3d' | 'timeline' | 'score' | 'demographics'

export type ColorSchemeId = 'neon' | 'thermal' | 'inferno' | 'classic' | 'plasma' | 'viridis';
export type MapVisualizationType = 'heatmap' | 'dots';
export type MapTileStyleId = 'dark' | 'light';

const THEME_STORAGE_KEY = 'deflock-map-theme';

function loadStoredTheme(): MapTileStyleId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // storage unavailable (private mode / denied) — use default
  }
  return 'dark';
}

export interface HeatmapSettings {
  intensity: number;
  radius: number;
  opacity: number;
  colorScheme: ColorSchemeId;
  showMarkers: boolean;
}

export interface DotDensitySettings {
  color: string;           // dot color hex — size and opacity are tuned zoom curves
}

export interface TimelineSettings {
  currentDate: string;    // ISO date string for slider position (YYYY-MM-DD)
  isPlaying: boolean;     // Auto-advance animation state
  playSpeed: number;      // Days per second (7, 14, 28, 45)
}

const DEFAULT_HEATMAP_SETTINGS: HeatmapSettings = {
  intensity: 1.0,
  radius: 10,
  opacity: 0.85,
  colorScheme: 'plasma',
  showMarkers: false,
};

const DEFAULT_DOT_DENSITY_SETTINGS: DotDensitySettings = {
  color: '#4DA6FF',
};

const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
  currentDate: TIMELINE_START,
  isPlaying: false,
  playSpeed: 45,
};

interface AppModeState {
  appMode: AppMode;
  exploreFeature: ExploreFeature;
  mapVisualization: MapVisualizationType;
  setAppMode: (mode: AppMode) => void;
  /** Enter Timeline (explore) at the animation start date. The only
   *  entry point for explore mode — deep links and tab clicks both. */
  enterTimeline: (viz?: MapVisualizationType) => void;
  setExploreFeature: (feature: ExploreFeature) => void;
  setMapVisualization: (type: MapVisualizationType) => void;

  heatmapSettings: HeatmapSettings;
  updateHeatmapSettings: (settings: Partial<HeatmapSettings>) => void;

  dotDensitySettings: DotDensitySettings;
  updateDotDensitySettings: (settings: Partial<DotDensitySettings>) => void;

  timelineSettings: TimelineSettings;
  updateTimelineSettings: (settings: Partial<TimelineSettings>) => void;

  mapTileStyle: MapTileStyleId;
  setMapTileStyle: (style: MapTileStyleId) => void;
}

export const useAppModeStore = create<AppModeState>((set) => ({
  appMode: 'map',
  exploreFeature: 'heatmap',
  mapVisualization: 'heatmap',
  setAppMode: (mode) =>
    set((state) => ({
      appMode: mode,
      timelineSettings: { ...state.timelineSettings, isPlaying: false },
    })),
  enterTimeline: (viz = 'dots') =>
    set({
      appMode: 'explore',
      mapVisualization: viz,
      timelineSettings: { ...DEFAULT_TIMELINE_SETTINGS },
    }),
  setExploreFeature: (feature) => set({ exploreFeature: feature }),
  setMapVisualization: (type) => set((state) => ({
    mapVisualization: type,
    timelineSettings: { ...state.timelineSettings, isPlaying: false },
  })),

  heatmapSettings: DEFAULT_HEATMAP_SETTINGS,
  updateHeatmapSettings: (settings) =>
    set((state) => ({
      heatmapSettings: { ...state.heatmapSettings, ...settings },
    })),

  dotDensitySettings: DEFAULT_DOT_DENSITY_SETTINGS,
  updateDotDensitySettings: (settings) =>
    set((state) => ({
      dotDensitySettings: { ...state.dotDensitySettings, ...settings },
    })),

  timelineSettings: DEFAULT_TIMELINE_SETTINGS,
  updateTimelineSettings: (settings) =>
    set((state) => ({
      timelineSettings: { ...state.timelineSettings, ...settings },
    })),

  mapTileStyle: loadStoredTheme(),
  setMapTileStyle: (style) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, style);
    } catch {
      // storage unavailable — theme applies for this session only
    }
    set({ mapTileStyle: style });
  },
}));
