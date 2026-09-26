import type { LatLon } from './tripOrder';

const DIRECTIONS = 'https://www.google.com/maps/dir/';

const coord = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/**
 * Google Maps driving directions through `stops` in the order given: the
 * last is the destination, the rest are waypoints. There is no origin, so
 * Google starts from the phone's own location and the app never puts the
 * user's position in the link. No dir_action: the driver sees the route
 * preview before starting. The Maps app takes 9 waypoints; a phone browser
 * without the app takes 3, which the site cannot detect.
 */
export function googleMapsTripUrl(stops: readonly LatLon[]): string | null {
  if (stops.length === 0) return null;
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination: coord(stops[stops.length - 1]),
  });
  if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(coord).join('|'));
  return `${DIRECTIONS}?${params.toString()}`;
}
