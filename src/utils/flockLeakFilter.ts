import type { FilterSpecification } from 'maplibre-gl';
import {
  flockTypeExpression,
  flockStatusExpression,
  FLOCK_SELECTABLE_STATUSES,
  type FlockDeviceType,
  type FlockDeviceStatus,
} from '../lib/flockTypeNormalization';
import { combineFilters } from './swipeFilter';

/**
 * Layer filter for the Flock layers from the user's chips. Empty `types`
 * means all types. Devices with an unknown status always pass the status
 * filter: the chips can hide Flock's labels, never Flock's silence.
 */
export function flockLayerFilter(
  types: FlockDeviceType[],
  statuses: FlockDeviceStatus[]
): FilterSpecification | undefined {
  const typeFilter =
    types.length > 0
      ? (['in', flockTypeExpression(), ['literal', types]] as unknown as FilterSpecification)
      : undefined;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((s) => statuses.includes(s));
  const statusFilter = allStatuses
    ? undefined
    : (['in', flockStatusExpression(), ['literal', [...statuses, 'unknown']]] as unknown as FilterSpecification);
  return combineFilters(typeFilter, statusFilter);
}
