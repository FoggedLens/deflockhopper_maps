import type { CameraFilters } from '../types';
import type { FlockGroup } from '../lib/flockInventory';
import type { FlockLeakView } from '../store/flockLeakStore';

/**
 * Defaults for the Leak tab's compare views (approved 2026-09-24). The
 * landing view shows every device; entering Swipe or Overlay narrows both
 * sides to the comparison that matters: Flock's plate readers against OSM
 * cameras tagged Flock Safety. Seeded once per tab visit; after that the
 * filters are the user's.
 */
export const LEAK_OSM_DEFAULT_BRAND = 'Flock Safety';
export const LEAK_COMPARE_FLOCK_GROUPS: readonly FlockGroup[] = [1];

export const isCompareView = (view: FlockLeakView): boolean => view === 'swipe' || view === 'overlay';

export function shouldSeedCompare(prev: FlockLeakView, next: FlockLeakView, seededThisVisit: boolean): boolean {
  return !seededThisVisit && !isCompareView(prev) && isCompareView(next);
}

/** The OSM filters with the brand set to Flock Safety; every other facet kept. */
export function seedOsmFilters(filters: CameraFilters): CameraFilters {
  return { ...filters, brands: [LEAK_OSM_DEFAULT_BRAND], showAll: false };
}
