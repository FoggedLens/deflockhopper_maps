import { haversineDistance } from './geo';
import type { FlockDeviceType } from '../lib/flockTypeNormalization';

/** Half-size of the screen box queried around a tapped Flock mark. */
export const NEARBY_QUERY_PX = 20;
export const NEARBY_MAX_METERS = 50;
/** Below this the OSM layer renders density dots, not cameras: no hint. */
export const NEARBY_MIN_ZOOM = 10;

export function nearestDistanceMeters(
  origin: { lon: number; lat: number },
  points: Array<{ lon: number; lat: number }>
): number | null {
  let best: number | null = null;
  for (const p of points) {
    const d = haversineDistance(origin.lat, origin.lon, p.lat, p.lon);
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Popup line under a Flock device. Worded as a prompt to verify, never a
 * verdict: nine months separate the datasets (spec section 6).
 */
export function flockNearbyHint(input: {
  zoom: number;
  type: FlockDeviceType;
  nearestMeters: number | null;
  osmVisible: boolean;
}): string | null {
  if (!input.osmVisible || input.zoom < NEARBY_MIN_ZOOM) return null;
  if (input.nearestMeters != null && input.nearestMeters <= NEARBY_MAX_METERS) {
    const base = `OSM has a camera ${Math.round(input.nearestMeters)} m from here.`;
    return input.type === 'alpr' ? base : `${base} Could be a mis-tag. Verify in person.`;
  }
  return 'Nothing on OSM within 50 m. Verify in person before adding it.';
}
