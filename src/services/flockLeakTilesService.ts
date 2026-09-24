/**
 * The leaked Flock device inventory tileset (flock-inventory-v2, the
 * December 14, 2025 export). Unlike the camera tiles it lives at ONE fixed
 * URL, not on whichever tile host is active, and a failure here never fails
 * the app over: a missing leak file must not degrade the Map tab.
 * Contract: docs/superpowers/specs/2026-09-23-flock-inventory-v2-contract.md
 */
export const FLOCK_LEAK_SOURCE_ID = 'flock-leak-tiles';
export const FLOCK_LEAK_SOURCE_LAYER = 'cameras';
export const FLOCK_LEAK_MAXZOOM = 14;
/** Full device records start here; below it the tiles carry merged points. */
export const FLOCK_LEAK_POINTS_MINZOOM = 9;
export const FLOCK_LEAK_SNAPSHOT_LABEL = 'Dec 14, 2025';

/**
 * Joshua Michael's published work on the export (flocksurveillance.org).
 * His paper asks for credit (CC BY 4.0, "use with credit"), so the tab names
 * him wherever the data appears: panel, popup and map attribution. The
 * license covers his paper; the records are Flock's, so no license is
 * claimed for them here.
 */
export const FLOCK_LEAK_RESEARCHER = 'Joshua Michael';
export const FLOCK_LEAK_LINKS = {
  site: 'https://flocksurveillance.org',
  paper: 'https://flocksurveillance.org/formal-research-paper.html',
  table: 'https://flocksurveillance.org/table.html',
} as const;
/** The research site's table filtered to one exact coordinate (the same
 *  `=` exact-match query its own map builds for a stack of devices). */
export const flockTableUrlAt = (lat: number, lon: number): string =>
  `${FLOCK_LEAK_LINKS.table}?${new URLSearchParams({ lat: `=${lat}`, lon: `=${lon}` }).toString()}`;
/** Map attribution for the Flock source (HTML, rendered by MapLibre). */
export const FLOCK_LEAK_ATTRIBUTION =
  `Flock records via <a href="${FLOCK_LEAK_LINKS.site}" target="_blank" rel="noopener noreferrer">${FLOCK_LEAK_RESEARCHER}</a>`;
export const FLOCK_LEAK_TILEJSON_URL = 'https://tiles.dontgetflocked.com/flock-inventory-v2.json';

/** Kept as a function so callers read like the camera tile URLs. */
export const flockLeakTileJsonUrl = (): string => FLOCK_LEAK_TILEJSON_URL;

export interface FlockLeakTileJson {
  tiles: string[];
  name?: string;
  description?: string;
}

const _cache = new Map<string, Promise<FlockLeakTileJson | null>>();

/**
 * Fetch the TileJSON. Resolves null when missing or unusable; never throws,
 * never fails the app over. Successes are cached; failures are not.
 */
export function loadFlockLeakTileJson(): Promise<FlockLeakTileJson | null> {
  const url = flockLeakTileJsonUrl();
  const hit = _cache.get(url);
  if (hit) return hit;

  const promise = (async (): Promise<FlockLeakTileJson | null> => {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch {
      console.warn('[flock-leak] tilejson network error');
      return null;
    }
    if (!res.ok) {
      console.warn(`[flock-leak] tilejson HTTP ${res.status}`);
      return null;
    }
    try {
      const data = (await res.json()) as Record<string, unknown> | null;
      if (!data || !Array.isArray(data.tiles)) return null;
      const doc: FlockLeakTileJson = { tiles: data.tiles as string[] };
      if (typeof data.name === 'string') doc.name = data.name;
      if (typeof data.description === 'string') doc.description = data.description;
      return doc;
    } catch {
      return null;
    }
  })();

  _cache.set(url, promise);
  void promise.then((doc) => {
    if (!doc) _cache.delete(url);
  });
  return promise;
}

/** Test hook — not for app code. */
export function _resetFlockLeakTileJsonCacheForTests(): void {
  _cache.clear();
}
