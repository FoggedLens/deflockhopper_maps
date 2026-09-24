import type { FilterSpecification } from 'maplibre-gl';

/**
 * Pure geometry for the Flock Leak swipe: the divider is a fraction of the
 * map width; with the map locked north-up it is a line of constant
 * longitude, so each side of the swipe is a rectangle and MapLibre's
 * `within` expression cuts the point layers without any per-feature data.
 */
export type SwipeSide = 'osm' | 'flock';

/** Inside this band from either edge the hidden side gets NEVER_MATCH
 *  instead of a sliver-thin polygon. */
export const SWIPE_EDGE = 0.005;

/** A filter no feature passes. Used to hide a side of the swipe through the
 *  filter alone: layer visibility stays declarative (react-map-gl owns it),
 *  so leaving Swipe for the Flock-only view never fights a restored
 *  'visible'. */
export const NEVER_MATCH: FilterSpecification = ['literal', false] as unknown as FilterSpecification;

export function clampDivider(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function halfPlaneRect(side: SwipeSide, dividerLon: number): GeoJSON.Polygon {
  const west = side === 'osm' ? -180 : dividerLon;
  const east = side === 'osm' ? dividerLon : 180;
  return {
    type: 'Polygon',
    coordinates: [[[west, -85], [east, -85], [east, 85], [west, 85], [west, -85]]],
  };
}

export function withinFilter(side: SwipeSide, dividerLon: number): FilterSpecification {
  return ['within', halfPlaneRect(side, dividerLon)] as unknown as FilterSpecification;
}

export function combineFilters(
  ...filters: Array<FilterSpecification | undefined>
): FilterSpecification | undefined {
  const present = filters.filter((f): f is FilterSpecification => f != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return ['all', ...present] as unknown as FilterSpecification;
}

export interface SwipeLayerState {
  filter: FilterSpecification | undefined;
}

export interface SwipePlan {
  osm: SwipeLayerState;
  flock: SwipeLayerState;
}

export function planSwipe(
  divider: number,
  dividerLon: number,
  base: { osm?: FilterSpecification; flock?: FilterSpecification } = {}
): SwipePlan {
  const d = clampDivider(divider);
  if (d <= SWIPE_EDGE) {
    return {
      osm: { filter: combineFilters(base.osm, NEVER_MATCH) },
      flock: { filter: base.flock },
    };
  }
  if (d >= 1 - SWIPE_EDGE) {
    return {
      osm: { filter: base.osm },
      flock: { filter: combineFilters(base.flock, NEVER_MATCH) },
    };
  }
  return {
    osm: { filter: combineFilters(base.osm, withinFilter('osm', dividerLon)) },
    flock: { filter: combineFilters(base.flock, withinFilter('flock', dividerLon)) },
  };
}

export interface DividerMapLike {
  getContainer(): { clientWidth: number; clientHeight: number };
  unproject(point: [number, number]): { lng: number };
}

/** Longitude under the divider, read at mid height (north-up, so any height works). */
export function dividerLongitude(map: DividerMapLike, divider: number): number {
  const { clientWidth, clientHeight } = map.getContainer();
  return map.unproject([clientWidth * clampDivider(divider), clientHeight / 2]).lng;
}
