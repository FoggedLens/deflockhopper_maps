import type { FlockLeakView } from '../store/flockLeakStore';
import { FLOCK_LEAK_POINTS_MINZOOM } from '../services/flockLeakTilesService';
import { FLOCK_INVENTORY } from '../lib/flockInventory';

const n = (v: number | null): string => (v === null ? '…' : v.toLocaleString());

/**
 * Mobile header line on the Leak tab (spec section 7, v2 totals). Below
 * FLOCK_LEAK_POINTS_MINZOOM the tiles carry no per-feature counts, so the
 * line falls back to the known snapshot total instead of "…".
 */
export function formatFlockHeaderCount(input: {
  zoom: number;
  view: FlockLeakView;
  flockCount: number | null;
  osmCount: number | null;
}): string {
  const devices = FLOCK_INVENTORY.devices.toLocaleString();
  if (input.zoom < FLOCK_LEAK_POINTS_MINZOOM) {
    return input.view === 'flock' ? `${devices} Flock devices` : `${n(input.osmCount)} OSM · ${devices} Flock`;
  }
  if (input.view === 'flock') return `${n(input.flockCount)} Flock in view`;
  return `${n(input.osmCount)} OSM · ${n(input.flockCount)} Flock in view`;
}
