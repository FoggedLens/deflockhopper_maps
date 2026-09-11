/**
 * Sharing-network data, published weekly (Mondays ~06:00 UTC) by the
 * deflock-data repo to a public bucket. Three files, schema frozen and
 * enforced by the publisher:
 *
 *   sharing-network-nodes.geojson   FeatureCollection, one Point per agency
 *   sharing-network-adjacency.json  { [slug]: string[] } outbound edges
 *   sharing-network-meta.json       provenance + headline counts
 *
 * Data files are stored gzip with Content-Encoding: gzip (fetch decodes them
 * transparently); cache-control is public, max-age=3600 for data and 300 for
 * meta. There is no edge cache on the host and no cache-busting is wanted.
 *
 * The base is a build-time env var so a dev can point at a local copy or a
 * staging bucket without code changes. It is read at call time so tests can
 * stub it.
 */
export const DEFAULT_NETWORK_DATA_BASE = 'https://deflockdata.dontgetflocked.com';

export type NetworkDataFile =
  | 'sharing-network-nodes.geojson'
  | 'sharing-network-adjacency.json'
  | 'sharing-network-meta.json';

export function networkDataBase(): string {
  const raw = (import.meta.env.VITE_NETWORK_DATA_BASE as string | undefined)?.trim();
  const base = raw || DEFAULT_NETWORK_DATA_BASE;
  return base.replace(/\/+$/, '');
}

export const networkDataUrl = (file: NetworkDataFile): string => `${networkDataBase()}/${file}`;

/** Provenance for the loaded snapshot. Only generatedAt is guaranteed; the
 *  counts are informational and may be absent. */
export interface NetworkMeta {
  generatedAt: string;
  featureCount?: number;
  portalCount?: number;
  adjacencyKeys?: number;
  directedEdges?: number;
}

const COUNT_KEYS = ['featureCount', 'portalCount', 'adjacencyKeys', 'directedEdges'] as const;

/** Tolerant parse: null when the document cannot tell us when it was generated. */
export function parseNetworkMeta(data: unknown): NetworkMeta | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.generatedAt !== 'string' || !d.generatedAt) return null;
  const meta: NetworkMeta = { generatedAt: d.generatedAt };
  for (const key of COUNT_KEYS) {
    if (typeof d[key] === 'number') meta[key] = d[key] as number;
  }
  return meta;
}
