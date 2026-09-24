import { haversineDistance } from './geo';

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
  /** Flock's raw product type string (e.g. 'falcon'). Was constrained to a
   *  canonical enum removed by the v2 contract rework (Task 8); kept as a
   *  plain string here so this module has no dependency on that rework.
   *  Group 1 (plate readers) maps to 'alpr'. */
  type: string;
  nearestMeters: number | null;
  osmVisible: boolean;
}): string | null {
  if (!input.osmVisible || input.zoom < NEARBY_MIN_ZOOM) return null;
  if (input.nearestMeters != null && input.nearestMeters <= NEARBY_MAX_METERS) {
    const base = `OSM has a camera ${Math.round(input.nearestMeters)} m from here.`;
    return input.type === 'alpr' ? base : `${base} Could be a mis-tag. Verify in person.`;
  }
  // Only the OSM cameras on screen are searched, and the compare view starts
  // filtered to Flock Safety, so this says "shown", never "on OSM".
  return 'No OSM camera shown within 50 m. Check in person before adding one.';
}
