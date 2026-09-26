import { haversineDistance } from './geo';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Most stops the exact search takes: Google Maps' own limit for one trip. */
export const TRIP_ORDER_MAX = 10;

/**
 * Indices of `stops` in the order that makes the shortest open path by
 * straight-line distance. With an origin the path starts there. Without one
 * it may start at any stop, and is read from its lower-indexed end.
 * Exact (Held-Karp over subsets): at 10 stops that is about 100k steps, well
 * under a millisecond. Runs on taps only, never in a map move handler.
 */
export function orderStops(origin: LatLon | null, stops: readonly LatLon[]): number[] {
  const n = stops.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  if (n > TRIP_ORDER_MAX) throw new RangeError(`orderStops takes at most ${TRIP_ORDER_MAX} stops`);

  const d = (a: LatLon, b: LatLon) => haversineDistance(a.lat, a.lon, b.lat, b.lon);
  const dist = stops.map((a) => stops.map((b) => d(a, b)));
  const full = (1 << n) - 1;
  const cost = Array.from({ length: full + 1 }, () => new Float64Array(n).fill(Infinity));
  const prev = Array.from({ length: full + 1 }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) cost[1 << i][i] = origin ? d(origin, stops[i]) : 0;

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      const c = cost[mask][last];
      if (!(mask & (1 << last)) || c === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const grown = mask | (1 << next);
        const c2 = c + dist[last][next];
        if (c2 < cost[grown][next]) {
          cost[grown][next] = c2;
          prev[grown][next] = last;
        }
      }
    }
  }

  let end = 0;
  for (let i = 1; i < n; i++) if (cost[full][i] < cost[full][end]) end = i;
  const order: number[] = [];
  for (let mask = full, i = end; i !== -1; ) {
    order.push(i);
    const p = prev[mask][i];
    mask &= ~(1 << i);
    i = p;
  }
  order.reverse();
  // A free-start path reads the same both ways; start from the lower index.
  if (!origin && order[0] > order[order.length - 1]) order.reverse();
  return order;
}
