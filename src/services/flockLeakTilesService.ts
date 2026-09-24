import { getTilesHost } from '../store/tilesHostStore';

/**
 * The leaked Flock device inventory tileset (December 2025 snapshot). Same
 * hosts and TileJSON addressing as the camera tiles. Contract in
 * docs/superpowers/specs/2026-09-23-flock-leak-tab-design.md section 2.
 */
export const FLOCK_LEAK_SOURCE_ID = 'flock-leak-tiles';
export const FLOCK_LEAK_SOURCE_LAYER = 'devices';
export const FLOCK_LEAK_MAXZOOM = 14;
/** Icons take over from the density dots here (dots run to maxzoom 10). */
export const FLOCK_LEAK_POINTS_MINZOOM = 9;
export const FLOCK_LEAK_SNAPSHOT_LABEL = 'Dec 2025';
export const FLOCK_LEAK_STORY_URL = 'https://flocksurveillance.org';

export const flockLeakTileJsonUrl = (): string => `${getTilesHost()}/flock-leak.json`;

export interface FlockLeakStats {
  total: number;
  byType?: Record<string, number>;
  byStatus?: Record<string, number>;
}

export interface FlockLeakTileJson {
  tiles: string[];
  snapshot?: string;
  source_url?: string;
  stats?: FlockLeakStats;
}

const _cache = new Map<string, Promise<FlockLeakTileJson | null>>();

function parseStats(raw: unknown): FlockLeakStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.total !== 'number' || !Number.isFinite(r.total)) return undefined;
  const counts = (v: unknown): Record<string, number> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, number>) : undefined;
  return { total: r.total, byType: counts(r.byType), byStatus: counts(r.byStatus) };
}

/**
 * Fetch the Flock TileJSON from the active host. Resolves null when missing
 * or unusable. Unlike the camera TileJSON this NEVER fails the app over: a
 * missing leak file must not degrade the Map tab. The Leak tab shows its own
 * retry pill instead. Successes are cached per host; failures are not.
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
      if (typeof data.snapshot === 'string') doc.snapshot = data.snapshot;
      if (typeof data.source_url === 'string') doc.source_url = data.source_url;
      const stats = parseStats(data.stats);
      if (stats) doc.stats = stats;
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
