import type { ALPRCamera } from '../types';

/**
 * Camera data is fetched from the data Worker at data.dontgetflocked.com
 * which serves gzipped GeoJSON from Cloudflare R2, one dataset per country.
 *
 * The US dataset contains ~114k (July 2026) cameras as a GeoJSON FeatureCollection.
 * Canada is fetched lazily, only when the user selects it.
 * Browser handles gzip decompression automatically via Content-Encoding header.
 */

export type CameraCountry = 'us' | 'ca';

/** Progress for a streamed dataset download. `null` = indeterminate (unknown total). */
export type DownloadProgressCallback = (percent: number | null, loadedBytes: number) => void;

/** Snapshot of a streamed download, stored by consumers for UI display. */
export interface DownloadProgress {
  percent: number | null;
  loadedBytes: number;
}

export interface ReadBodyOptions {
  /** The publisher stores this file gzip. Cross-origin responses do not
   *  expose Content-Encoding (it is not CORS-safelisted) while Content-Length
   *  still reports the compressed size, so the header check below cannot see
   *  the compression and the ratio would lie. Force indeterminate progress. */
  assumeCompressed?: boolean;
}

/**
 * Read a response body as text, reporting download progress. Percent is only
 * determinate when Content-Length is present AND no Content-Encoding is set:
 * with edge compression the reader yields decompressed bytes while
 * Content-Length counts compressed ones, so the ratio would lie.
 */
export async function readBodyWithProgress(
  response: Response,
  onProgress?: DownloadProgressCallback,
  opts?: ReadBodyOptions
): Promise<string> {
  const total = Number(response.headers.get('Content-Length') ?? 0);
  const determinate =
    total > 0 && !response.headers.get('Content-Encoding') && !opts?.assumeCompressed;

  if (!response.body) {
    onProgress?.(null, 0);
    const text = await response.text();
    onProgress?.(100, text.length);
    return text;
  }

  onProgress?.(determinate ? 0 : null, 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(
      determinate ? Math.min(99, Math.round((loaded / total) * 100)) : null,
      loaded
    );
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(100, loaded);
  return new TextDecoder().decode(merged);
}

export interface CountryConfig {
  id: CameraCountry;
  label: string;
  flag: string;
  dataUrl: string;
  /** Default map view when switching to this country */
  center: [number, number]; // [lat, lng]
  zoom: number;
}

export const COUNTRIES: Record<CameraCountry, CountryConfig> = {
  us: {
    id: 'us',
    label: 'United States',
    flag: '🇺🇸',
    dataUrl: 'https://data.dontgetflocked.com/cameras.geojson.gz',
    center: [39.8283, -98.5795],
    zoom: 4,
  },
  ca: {
    id: 'ca',
    label: 'Canada',
    flag: '🇨🇦',
    // Center sits east of the geographic middle so the Toronto–Montreal and
    // Vancouver corridors (where the cameras are) both frame in
    dataUrl: 'https://data.dontgetflocked.com/cameras-ca.geojson.gz',
    center: [56.5, -96],
    zoom: 3.3,
  },
};

/** Country zoom levels are tuned for desktop; phones need to sit further out
 *  (same 1.5-level offset the initial US view uses). */
export function countryZoomForViewport(country: CameraCountry): number {
  const mobileOffset =
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 1.5 : 0;
  return COUNTRIES[country].zoom - mobileOffset;
}

/** App modes that depend on US-only backends: the routing API, US census
 *  boundary data, and the US agency sharing network. Map and Timeline run
 *  off the loaded camera dataset and work for any country. */
const US_ONLY_MODES = new Set(['route', 'density', 'network']);

export function isModeAvailable(mode: string, country: CameraCountry): boolean {
  return country === 'us' || !US_ONLY_MODES.has(mode);
}

// Per-country cache and in-flight load state
interface CountryLoadState {
  cachedCameras: ALPRCamera[] | null;
  isLoading: boolean;
  loadPromise: Promise<ALPRCamera[]> | null;
  loadAttempts: number;
}

const loadStates: Record<CameraCountry, CountryLoadState> = {
  us: { cachedCameras: null, isLoading: false, loadPromise: null, loadAttempts: 0 },
  ca: { cachedCameras: null, isLoading: false, loadPromise: null, loadAttempts: 0 },
};

const MAX_LOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Load camera data for a country from the data Worker
 * This is instantaneous after first load (cached per country)
 * Includes retry logic for network failures
 */
export async function loadBundledCameras(
  country: CameraCountry = 'us',
  onProgress?: DownloadProgressCallback
): Promise<ALPRCamera[]> {
  const state = loadStates[country];

  // Return cached data if available
  if (state.cachedCameras && state.cachedCameras.length > 0) {
    if (import.meta.env.DEV) {
      console.log(`[CameraService] Returning ${state.cachedCameras.length} cached ${country} cameras`);
    }
    return state.cachedCameras;
  }

  // Return existing promise if already loading (prevents race conditions)
  if (state.isLoading && state.loadPromise) {
    if (import.meta.env.DEV) {
      console.log(`[CameraService] Already loading ${country}, returning existing promise`);
    }
    return state.loadPromise;
  }

  // Set loading state BEFORE creating promise (synchronous, prevents race condition)
  state.isLoading = true;
  state.loadAttempts = 0;

  if (import.meta.env.DEV) {
    console.log(`[CameraService] Starting ${country} camera data load...`);
  }

  state.loadPromise = (async () => {
    const startTime = performance.now();

    let lastError: Error | null = null;

    while (state.loadAttempts < MAX_LOAD_ATTEMPTS) {
      state.loadAttempts++;

      try {
        // Fetch from data Worker — browser handles gzip decompression automatically
        const response = await fetch(COUNTRIES[country].dataUrl, {
          headers: {
            'Accept': 'application/geo+json, application/json',
          },
          cache: 'default',
        });
        
        if (!response.ok) {
          throw new Error(`Failed to load camera data: ${response.status}`);
        }
        
        // Note: when a load is already in flight, callers get the cached
        // promise and this onProgress belongs to the first initiator only.
        const data = JSON.parse(await readBodyWithProgress(response, onProgress));

        // Support both GeoJSON FeatureCollection (from Worker) and legacy flat array
        let cameras: ALPRCamera[];

        if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
          // GeoJSON format from data Worker
          if (data.features.length === 0) {
            throw new Error('Camera data file is empty');
          }
          cameras = new Array(data.features.length);
          for (let i = 0; i < data.features.length; i++) {
            const f = data.features[i];
            const p = f.properties;
            cameras[i] = {
              osmId: p.osmId,
              osmType: p.osmType || 'node',
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
              operator: p.operator,
              brand: p.brand,
              direction: p.direction,
              directions: p.directions,
              directionCardinal: p.directionCardinal,
              surveillanceZone: p.surveillanceZone,
              mountType: p.mountType,
              ref: p.ref,
              startDate: p.startDate,
              osmTimestamp: p.osmTimestamp,
              osmVersion: p.osmVersion,
              wikimediaCommons: p.wikimediaCommons,
            };
          }
        } else if (Array.isArray(data)) {
          // Legacy flat array format (backwards compatibility during migration)
          if (data.length === 0) {
            throw new Error('Camera data file is empty');
          }
          cameras = new Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const cam = data[i];
            cameras[i] = {
              osmId: cam.osmId,
              osmType: cam.osmType || 'node',
              lat: cam.lat,
              lon: cam.lon,
              operator: cam.operator,
              brand: cam.brand,
              direction: cam.direction,
              directions: cam.directions,
              directionCardinal: cam.directionCardinal,
              surveillanceZone: cam.surveillanceZone,
              mountType: cam.mountType,
              ref: cam.ref,
              startDate: cam.startDate,
              osmTimestamp: cam.osmTimestamp,
              osmVersion: cam.osmVersion,
              wikimediaCommons: cam.wikimediaCommons,
            };
          }
        } else {
          throw new Error('Invalid camera data format');
        }
        
        const loadTime = (performance.now() - startTime).toFixed(0);
        if (import.meta.env.DEV) {
          console.log(`[CameraService] Loaded ${cameras.length} ${country} cameras in ${loadTime}ms`);
        }

        // Cache the data (set before clearing loading state)
        state.cachedCameras = cameras;
        state.loadAttempts = 0;
        state.isLoading = false;

        return cameras;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[CameraService] ${country} load attempt ${state.loadAttempts}/${MAX_LOAD_ATTEMPTS} failed:`, lastError.message);

        if (state.loadAttempts < MAX_LOAD_ATTEMPTS) {
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * state.loadAttempts));
        }
      }
    }

    // All attempts failed - clean up state
    state.isLoading = false;
    state.loadPromise = null;
    state.cachedCameras = null;
    throw lastError || new Error('Failed to load camera data after multiple attempts');
  })();

  return state.loadPromise;
}

/**
 * Retry loading cameras (for UI retry buttons)
 */
export async function retryLoadCameras(
  country: CameraCountry = 'us',
  onProgress?: DownloadProgressCallback
): Promise<ALPRCamera[]> {
  if (import.meta.env.DEV) {
    console.log(`[CameraService] Retry requested for ${country}, clearing state...`);
  }

  // Clear country state to allow fresh retry
  const state = loadStates[country];
  state.loadPromise = null;
  state.isLoading = false;
  state.cachedCameras = null;
  state.loadAttempts = 0;

  return loadBundledCameras(country, onProgress);
}

/**
 * Get cameras in a bounding box (for map display optimization)
 */
export function getCamerasInBounds(
  cameras: ALPRCamera[],
  north: number,
  south: number,
  east: number,
  west: number
): ALPRCamera[] {
  return cameras.filter(
    (c) => c.lat >= south && c.lat <= north && c.lon >= west && c.lon <= east
  );
}

/**
 * Get unique operators from camera list
 */
export function getUniqueOperators(cameras: ALPRCamera[]): string[] {
  const operators = new Set<string>();
  cameras.forEach((c) => {
    if (c.operator) operators.add(c.operator);
  });
  return Array.from(operators).sort();
}

/**
 * Get unique brands from camera list
 */
export function getUniqueBrands(cameras: ALPRCamera[]): string[] {
  const brands = new Set<string>();
  cameras.forEach((c) => {
    if (c.brand) brands.add(c.brand);
  });
  return Array.from(brands).sort();
}

/**
 * Clear cached camera data (for testing/refresh)
 */
export function clearCameraCache(): void {
  for (const state of Object.values(loadStates)) {
    state.cachedCameras = null;
    state.loadPromise = null;
    state.isLoading = false;
  }
}

