import type { AppMode, MapVisualizationType } from '@/store/appModeStore';
import type { CameraCountry } from '@/services/cameraDataService';
import { normalizeStateCode, stateFromSlug, stateSlug } from '@/services/stateFilterService';
import { useMapStore } from '@/store/mapStore';
import { useAppModeStore } from '@/store/appModeStore';
import { useCameraStore } from '@/store/cameraStore';

export interface UrlViewport {
  lat: number;
  lng: number;
  zoom: number;
}

export interface AppUrlState {
  mode: AppMode;
  stateFilter: string | null;
  viewport: UrlViewport | null;
  country: CameraCountry | null;
  viz: MapVisualizationType | null;
}

/** Canonical pathname per app mode — the only URL↔mode vocabulary. */
export const MODE_PATHS: Record<AppMode, string> = {
  map: '/',
  route: '/route',
  explore: '/timeline',
  leak: '/leak',
  network: '/network',
};

// Canonical paths plus legacy aliases, accepted as input only.
// '/analysis' was the retired Analysis tab; old links land on the map.
const PATH_MODES: Record<string, AppMode | undefined> = {
  '/': 'map',
  '/map': 'map',
  '/route': 'route',
  '/timeline': 'explore',
  '/explore': 'explore',
  '/analysis': 'map',
  '/leak': 'leak',
  '/flock-leak': 'leak',
  '/network': 'network',
};

const LEGACY_MODE_PARAM: Record<string, AppMode | undefined> = {
  route: 'route',
  explore: 'explore',
  leak: 'leak',
  network: 'network',
};

/** Minimal country check for main.tsx's pre-React seeding. */
export function parseCountryParam(search: string): CameraCountry | null {
  return new URLSearchParams(search).get('country') === 'ca' ? 'ca' : null;
}

function parseViewport(params: URLSearchParams): UrlViewport | null {
  const lat = parseFloat(params.get('lat') ?? '');
  const lng = parseFloat(params.get('lng') ?? '');
  const zoom = parseFloat(params.get('zoom') ?? '');

  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng, zoom: isNaN(zoom) ? 4 : Math.max(1, Math.min(20, zoom)) };
}

/**
 * Parse any supported URL (canonical or legacy) into app state.
 * Pure — the single entry point for URL interpretation.
 */
export function parseAppUrl(pathname: string, search: string): AppUrlState {
  const params = new URLSearchParams(search);
  const path = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  const stateMatch = path.match(/^\/state\/([^/]+)$/);
  const stateFilter =
    stateFromSlug(stateMatch?.[1]) ?? normalizeStateCode(params.get('state'));

  let mode: AppMode = stateMatch ? 'map' : PATH_MODES[path] ?? 'map';
  if (path === '/' || path === '/map') {
    // Legacy ?mode= links — honored only where no canonical path competes
    const legacy = LEGACY_MODE_PARAM[params.get('mode') ?? ''];
    if (legacy) mode = legacy;
  }

  const vizParam = params.get('viz');

  return {
    mode,
    stateFilter,
    viewport: parseViewport(params),
    country: parseCountryParam(search),
    viz: vizParam === 'heatmap' ? 'heatmap' : vizParam === 'dots' ? 'dots' : null,
  };
}

/**
 * Serialize current store state into the canonical URL. Single source of
 * truth shared by the live URL sync and the Share button, so the address
 * bar and share links are identical by construction.
 */
export function buildAppUrl(): { pathname: string; search: string } {
  const { appMode, mapVisualization } = useAppModeStore.getState();
  const { center, zoom } = useMapStore.getState();
  const { country, filters } = useCameraStore.getState();

  const pathname =
    appMode === 'map' && filters.state
      ? `/state/${stateSlug(filters.state)}`
      : MODE_PATHS[appMode];

  const params = new URLSearchParams();
  params.set('lat', center[0].toFixed(4));
  params.set('lng', center[1].toFixed(4));
  params.set('zoom', zoom.toFixed(2));
  if (appMode === 'explore') params.set('viz', mapVisualization);
  if (country !== 'us') params.set('country', country);

  return { pathname, search: `?${params.toString()}` };
}

/** Full shareable URL for the current app state. */
export function buildShareURL(): string {
  const { pathname, search } = buildAppUrl();
  return `${window.location.origin}${pathname}${search}`;
}
