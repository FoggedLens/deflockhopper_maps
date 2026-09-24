import type { FilterSpecification } from 'maplibre-gl';
import { FLOCK_SELECTABLE_STATUSES, type FlockGroup, type FlockStatus } from '../lib/flockInventory';

/** ['all', ...] of the filters present; one filter as is; none as undefined. */
export function combineFilters(
  ...filters: Array<FilterSpecification | undefined>
): FilterSpecification | undefined {
  const present = filters.filter((f): f is FilterSpecification => f != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return ['all', ...present] as unknown as FilterSpecification;
}

/**
 * Layer filter for the Flock layers from the chips. Works at every zoom
 * because g, s and q are present on every feature. Never triggers a tile
 * request: it is a layer filter over tiles already loaded.
 *
 * - quality: q must be 0 unless suspect records are shown
 * - groups: empty means all
 * - statuses: all three selectable statuses on means no status clause
 */
export function flockLayerFilter(
  groups: FlockGroup[],
  statuses: FlockStatus[],
  showSuspect: boolean
): FilterSpecification | undefined {
  const quality = showSuspect ? undefined : (['==', ['get', 'q'], 0] as unknown as FilterSpecification);
  const group =
    groups.length > 0 ? (['in', ['get', 'g'], ['literal', groups]] as unknown as FilterSpecification) : undefined;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((s) => statuses.includes(s));
  const status = allStatuses
    ? undefined
    : (['in', ['get', 's'], ['literal', statuses]] as unknown as FilterSpecification);
  return combineFilters(quality, group, status);
}
