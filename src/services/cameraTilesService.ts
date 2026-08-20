import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

/**
 * Camera vector tiles served as a raw PMTiles archive from the
 * flockhopper-tiles worker (R2-backed, Range requests).
 *
 * Archive facts (from its TileJSON):
 * - source-layer: 'cameras', zooms 0-14, rebuilt hourly
 * - z0-8 tiles are geometry-only (built with --exclude-all)
 * - z9+ tiles carry full attributes for popups/cones
 * - zero tile buffer — no duplicated points along tile seams, so
 *   translucent circle layers never double-blend
 */
export const CAMERA_TILES_HOST =
  import.meta.env.VITE_CAMERA_TILES_HOST || 'https://tiles.dontgetflocked.com';

/** Countries with hourly tile archives (both main + filter companions). */
export type CameraTileCountry = 'us' | 'ca';

export const cameraTilesUrl = (country: CameraTileCountry) =>
  `pmtiles://${CAMERA_TILES_HOST}/cameras-${country}-hourly.pmtiles`;
/**
 * Filter-enabled companion archive: same points, but with integer filter
 * codes (b/o/z/m) at ALL zooms — z9+ additionally carries the full
 * attributes, mirroring the main archive. Only attached to the map once a
 * filter activates; idle users never fetch it.
 */
export const cameraFilterTilesUrl = (country: CameraTileCountry) =>
  `pmtiles://${CAMERA_TILES_HOST}/cameras-${country}-hourly-filter.pmtiles`;
/** TileJSON endpoint for the filter archive — used to verify the manifest and
 *  tileset came from the same pipeline build (build-scoped ids). */
export const cameraFilterTileJsonUrl = (country: CameraTileCountry) =>
  `${CAMERA_TILES_HOST}/cameras-${country}-hourly-filter.json`;
/** Filter dictionary paired with the filter archive — ids are build-scoped,
 *  so it is served alongside the tiles and must be fetched fresh with them. */
export const cameraManifestUrl = (country: CameraTileCountry) =>
  `${CAMERA_TILES_HOST}/cameras-${country}-hourly-manifest.json`;

export const CAMERA_TILES_URL = cameraTilesUrl('us');
export const CAMERA_TILES_SOURCE_LAYER = 'cameras';
export const CAMERA_TILES_MAXZOOM = 14;
/** Documents the published tile archives' attribute threshold: attributes exist
 * in tiles from z9 up. Retained as the single named constant for the pipeline contract. */
export const CAMERA_METADATA_MINZOOM = 9;
/**
 * Zoom at which the full camera points layer takes over from the density dots.
 * The dots layer runs to maxzoom 10, so the two overlap on [9, 10).
 *
 * Shared so the viewport count can query whichever single layer covers the
 * current zoom: queryRenderedFeatures ignores paint opacity, so querying both
 * across the overlap returns every camera twice (measured +102.8% back when
 * the overlap sat at z11). Keep this equal to the points layer's minzoom in
 * CameraTileLayers.
 */
export const CAMERA_POINTS_MINZOOM = 9;

let _protocol: Protocol | null = null;
const _loadedArchives = new Set<string>();

/** Failure sink wired up by the map composition layer (MapLibreContainer), so
 *  this service stays decoupled from the store (avoids an import cycle:
 *  cameraStore -> cameraManifestService -> cameraTilesService). */
export type PMTilesArchiveKind = 'main' | 'filter';
let _onArchiveFailure: ((kind: PMTilesArchiveKind) => void) | null = null;
export function setPMTilesFailureHandler(
  fn: ((kind: PMTilesArchiveKind) => void) | null,
): void {
  _onArchiveFailure = fn;
}

/** Which camera archive a pmtiles request targets, or null for anything that
 *  is not a camera archive (the basemap uses the TileJSON route, not pmtiles). */
export function archiveKey(url: string): string | null {
  const m = url.match(/cameras-(?:us|ca)-hourly(?:-filter)?\.pmtiles/);
  return m ? m[0] : null;
}

/** Register the shared pmtiles protocol exactly once (camera archives only).
 *  A blocked or 404 archive presents to MapLibre as a loaded-but-empty source,
 *  so MapLibre error events are not a reliable failure signal. The protocol
 *  handler is: it reports a load failure that happens before that archive ever
 *  loaded successfully (ignoring aborts), which the UI turns into a retry pill. */
export function ensurePMTilesProtocol(): Protocol {
  if (!_protocol) {
    _protocol = new Protocol();
    const tileFn = _protocol.tile.bind(_protocol);
    maplibregl.addProtocol('pmtiles', async (params, abortController) => {
      const key = archiveKey(params.url);
      try {
        const result = await tileFn(params, abortController);
        if (key) _loadedArchives.add(key);
        return result;
      } catch (err) {
        const aborted =
          abortController?.signal?.aborted || (err as Error)?.name === 'AbortError';
        if (!aborted && key && !_loadedArchives.has(key)) {
          _onArchiveFailure?.(key.includes('-filter') ? 'filter' : 'main');
        }
        throw err;
      }
    });
  }
  return _protocol;
}

/** Re-register a FRESH pmtiles protocol, discarding the header cache (pmtiles
 *  caches a rejected header fetch for the app's lifetime). The retry pill calls
 *  this so a genuine re-fetch is attempted after an outage clears. */
export function resetPMTilesProtocol(): void {
  maplibregl.removeProtocol('pmtiles');
  _protocol = null;
  _loadedArchives.clear();
  ensurePMTilesProtocol();
}
