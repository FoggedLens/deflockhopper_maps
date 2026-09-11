import type { RequestParameters, ResourceType } from 'maplibre-gl';
import { getTilesHost, failoverTilesHost } from '../store/tilesHostStore';

/**
 * Camera vector tiles — plain MVT tilesets addressed by TileJSON, served from
 * the active DeFlock tile host (see tilesHostStore for primary/backup).
 *
 * Every vector source uses `url: <TileJSON>`. Never pmtiles:// and never a
 * *.pmtiles archive: byte-range requests are not edge-cacheable on either
 * host, whereas the per-tile URLs a TileJSON hands out are. Tile URLs are
 * always read from the TileJSON, never hand-built.
 *
 * Archive facts (from the TileJSON):
 * - source-layer: 'cameras', zooms 0-14, rebuilt hourly
 * - z0-8 tiles are geometry-only (built with --exclude-all)
 * - z9+ tiles carry full attributes for popups/cones
 * - zero tile buffer — no duplicated points along tile seams, so
 *   translucent circle layers never double-blend
 */

/** Countries with hourly tilesets (both main + filter companions). */
export type CameraTileCountry = 'us' | 'ca';

/** Main camera TileJSON (alias — always the latest hourly build). */
export const cameraTileJsonUrl = (country: CameraTileCountry) =>
  `${getTilesHost()}/cameras-${country}-hourly.json`;
/**
 * Filter-enabled companion tileset: same points, but with integer filter
 * codes (b/o/z/m) at ALL zooms — z9+ additionally carries the full
 * attributes, mirroring the main tileset. Only attached to the map once a
 * filter activates; idle users never fetch it.
 */
export const cameraFilterTileJsonUrl = (country: CameraTileCountry) =>
  `${getTilesHost()}/cameras-${country}-hourly-filter.json`;
/** Filter dictionary paired with the filter tileset — ids are build-scoped,
 *  so it is served alongside the tiles and must be fetched fresh with them. */
export const cameraManifestUrl = (country: CameraTileCountry) =>
  `${getTilesHost()}/cameras-${country}-hourly-manifest.json`;

export const CAMERA_TILES_SOURCE_LAYER = 'cameras';
export const CAMERA_TILES_MAXZOOM = 14;
/** Documents the published tilesets' attribute threshold: attributes exist
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

/**
 * The camera TileJSON as the primary host publishes it. Beyond the standard
 * fields it carries build-pinned companion URLs (immutable, 1-year cache)
 * from the same hourly build. Consumers prefer these over the unversioned
 * aliases so manifest, filter tileset and index always form a coherent set.
 * The backup host serves plain TileJSON: the companions are absent there.
 */
export interface CameraTileJson {
  tiles: string[];
  name?: string;
  build?: string;
  manifest?: string;
  filter_tilejson?: string;
  index_bin?: string;
  index_json?: string;
}

const _tileJsonCache = new Map<string, Promise<CameraTileJson | null>>();

/**
 * Fetch the camera TileJSON alias from the active host. Resolves null when
 * the document is unusable. A network error or non-2xx on the primary host
 * fails the whole app over to the backup host (the source components remount
 * on that); the same failure on backup is final. Cached per host + country,
 * so a call after a failover fetches from the new host. Never throws.
 */
export function loadCameraTileJson(country: CameraTileCountry): Promise<CameraTileJson | null> {
  const url = cameraTileJsonUrl(country);
  const hit = _tileJsonCache.get(url);
  if (hit) return hit;

  const promise = (async (): Promise<CameraTileJson | null> => {
    let res: Response;
    try {
      // Alias docs revalidate on every load so a reload picks up the hourly build.
      res = await fetch(url, { cache: 'no-cache' });
    } catch {
      failoverTilesHost(`camera tilejson ${country}: network error`);
      return null;
    }
    if (!res.ok) {
      failoverTilesHost(`camera tilejson ${country}: HTTP ${res.status}`);
      return null;
    }
    try {
      const data = (await res.json()) as Partial<CameraTileJson> | null;
      if (!data || !Array.isArray(data.tiles)) return null;
      return data as CameraTileJson;
    } catch {
      return null;
    }
  })();

  _tileJsonCache.set(url, promise);
  // Only successes stay cached; a failed entry would pin the failure for the session.
  void promise.then((doc) => {
    if (!doc) _tileJsonCache.delete(url);
  });
  return promise;
}

const SOURCE_RESOURCE = 'Source' as unknown as ResourceType;

/**
 * MapLibre transformRequest: TileJSON documents (resource type 'Source') are
 * alias URLs that change hourly, so they must revalidate on reload. Tile
 * URLs come from the TileJSON with immutable caching — leave them alone.
 */
export function tilesTransformRequest(
  url: string,
  resourceType?: ResourceType
): RequestParameters | undefined {
  if (resourceType === SOURCE_RESOURCE) return { url, cache: 'no-cache' };
  return undefined;
}

/** Test hook — not for app code. */
export function _resetCameraTileJsonCacheForTests(): void {
  _tileJsonCache.clear();
}
