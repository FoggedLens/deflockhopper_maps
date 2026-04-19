import { useMapStore } from '@/store/mapStore';
import { useAppModeStore } from '@/store/appModeStore';
import type { AppMode } from '@/store/appModeStore';

interface ViewportParams {
  lat: number;
  lng: number;
  zoom: number;
}

const MODE_PATHS: Record<AppMode, string> = {
  map: '/',
  route: '/route',
  explore: '/timeline',
  density: '/analysis',
  network: '/network',
};

/**
 * Parse viewport params (lat, lng, zoom) from URL search params.
 * Returns null if lat/lng are missing or out of range.
 */
export function parseViewportFromURL(searchParams: URLSearchParams): ViewportParams | null {
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');
  const zoom = parseFloat(searchParams.get('zoom') ?? '');

  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    lat,
    lng,
    zoom: isNaN(zoom) ? 4 : Math.max(1, Math.min(20, zoom)),
  };
}

/**
 * Write viewport params (lat/lng/zoom, plus viz in explore mode) onto the given
 * URLSearchParams, mutating and returning it. Single source of truth used by
 * both the live URL sync and the Share button so their output stays identical.
 */
export function writeViewportParams(params: URLSearchParams): URLSearchParams {
  const { center, zoom } = useMapStore.getState();
  const { appMode, mapVisualization } = useAppModeStore.getState();

  params.set('lat', center[0].toFixed(4));
  params.set('lng', center[1].toFixed(4));
  params.set('zoom', zoom.toFixed(2));
  if (appMode === 'explore') {
    params.set('viz', mapVisualization);
  } else {
    params.delete('viz');
  }

  return params;
}

/**
 * Build a shareable URL from current Zustand store state.
 * Reads directly from stores — no React subscription, no re-renders.
 */
export function buildShareURL(): string {
  const { appMode } = useAppModeStore.getState();
  const path = MODE_PATHS[appMode] ?? '/';
  const params = writeViewportParams(new URLSearchParams());
  return `${window.location.origin}${path}?${params.toString()}`;
}
