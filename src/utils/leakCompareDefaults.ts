import type { CameraFilters } from '../types';
import { FLOCK_SELECTABLE_STATUSES, type FlockGroup, type FlockStatus } from '../lib/flockInventory';
import type { FlockLeakView } from '../store/flockLeakStore';

/**
 * Defaults for the Leak tab's compare views (approved 2026-09-24). The
 * landing view shows every device; turning on the OSM comparison narrows both
 * sides to the comparison that matters: Flock's plate readers (every
 * status) against OSM cameras tagged Flock Safety. Seeded once per tab visit; after that the
 * filters are the user's.
 */
export const LEAK_OSM_DEFAULT_BRAND = 'Flock Safety';
export const LEAK_COMPARE_FLOCK_GROUPS: readonly FlockGroup[] = [1];
/** Every status (user's call, 2026-09-24): planned (dashed ring) and
 *  decommissioned (gray ring) stay on while comparing, since the marks tell
 *  them apart from live devices. Seeded, so a narrower selection made before
 *  comparing is reset to the full set. */
export const LEAK_COMPARE_FLOCK_STATUSES: readonly FlockStatus[] = [...FLOCK_SELECTABLE_STATUSES];

export const isCompareView = (view: FlockLeakView): boolean => view === 'overlay';

export function shouldSeedCompare(prev: FlockLeakView, next: FlockLeakView, seededThisVisit: boolean): boolean {
  return !seededThisVisit && !isCompareView(prev) && isCompareView(next);
}

/** The OSM filters with the brand set to Flock Safety; every other facet kept. */
export function seedOsmFilters(filters: CameraFilters): CameraFilters {
  return { ...filters, brands: [LEAK_OSM_DEFAULT_BRAND], showAll: false };
}
