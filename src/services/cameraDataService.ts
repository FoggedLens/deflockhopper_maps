import type { ALPRCamera } from '../types';

/**
 * Camera data is fetched from the data Worker at data.dontgetflocked.com
 * which serves gzipped GeoJSON from Cloudflare R2.
 *
 * The data contains ~62,000 US cameras as a GeoJSON FeatureCollection.
 * Browser handles gzip decompression automatically via Content-Encoding header.
 */

// Cache the loaded cameras
let cachedCameras: ALPRCamera[] | null = null;
let isLoading = false;
let loadPromise: Promise<ALPRCamera[]> | null = null;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Load camera data from bundled JSON file
 * This is instantaneous after first load (cached)
 * Includes retry logic for network failures
 */
export async function loadBundledCameras(): Promise<ALPRCamera[]> {
  // Return cached data if available
  if (cachedCameras && cachedCameras.length > 0) {
    if (import.meta.env.DEV) {
      console.log(`[CameraService] Returning ${cachedCameras.length} cached cameras`);
    }
    return cachedCameras;
  }
  
  // Return existing promise if already loading (prevents race conditions)
  if (isLoading && loadPromise) {
    if (import.meta.env.DEV) {
      console.log('[CameraService] Already loading, returning existing promise');
    }
    return loadPromise;
  }
  
  // Set loading state BEFORE creating promise (synchronous, prevents race condition)
  isLoading = true;
  loadAttempts = 0;
  
  if (import.meta.env.DEV) {
    console.log('[CameraService] Starting camera data load...');
  }
  
  loadPromise = (async () => {
    const startTime = performance.now();
    
    let lastError: Error | null = null;
    
    while (loadAttempts < MAX_LOAD_ATTEMPTS) {
      loadAttempts++;
      
      try {
        // Fetch from data Worker — browser handles gzip decompression automatically
        const response = await fetch('https://data.dontgetflocked.com/cameras.geojson.gz', {
          headers: {
            'Accept': 'application/geo+json, application/json',
          },
          cache: 'default',
        });
        
        if (!response.ok) {
          throw new Error(`Failed to load camera data: ${response.status}`);
        }
        
        const data = await response.json();

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
          console.log(`[CameraService] Loaded ${cameras.length} cameras in ${loadTime}ms`);
        }
        
        // Cache the data (set before clearing loading state)
        cachedCameras = cameras;
        loadAttempts = 0;
        isLoading = false;
        
        return cameras;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[CameraService] Load attempt ${loadAttempts}/${MAX_LOAD_ATTEMPTS} failed:`, lastError.message);
        
        if (loadAttempts < MAX_LOAD_ATTEMPTS) {
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * loadAttempts));
        }
      }
    }
    
    // All attempts failed - clean up state
    isLoading = false;
    loadPromise = null;
    cachedCameras = null;
    throw lastError || new Error('Failed to load camera data after multiple attempts');
  })();
  
  return loadPromise;
}

/**
 * Retry loading cameras (for UI retry buttons)
 */
export async function retryLoadCameras(): Promise<ALPRCamera[]> {
  if (import.meta.env.DEV) {
    console.log('[CameraService] Retry requested, clearing state...');
  }
  
  // Clear all state to allow fresh retry
  loadPromise = null;
  isLoading = false;
  cachedCameras = null;
  loadAttempts = 0;
  
  return loadBundledCameras();
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
  cachedCameras = null;
  loadPromise = null;
  isLoading = false;
}

