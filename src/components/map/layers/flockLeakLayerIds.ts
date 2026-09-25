/** Flock Leak layer ids, shared by the layer component, the pure spec
 *  builders and the map container (clicks, counts, interactivity). */
/** Density dots, every mark mode, z0 to 10. */
export const FLOCK_LEAK_DOTS_LAYER = 'flock-leak-dots';
/** Marks from z9 (see flockCompareStyle): plate readers as the lens (glow +
 *  core) or the ring (core only), planned plate readers as a dashed ring, and
 *  every other group as its own icon. The same ids serve both mark modes. */
export const FLOCK_LEAK_GLOW_LAYER = 'flock-leak-glow';
export const FLOCK_LEAK_CORE_LAYER = 'flock-leak-core';
export const FLOCK_LEAK_PLANNED_LAYER = 'flock-leak-planned';
/** Video, Wing, Raven and drones: their own icons, above plate readers. */
export const FLOCK_LEAK_OTHERS_LAYER = 'flock-leak-others';
/** Trailers and components (the Other class): beneath plate readers, so a
 *  Picard compute box sharing a pole with a Falcon never covers its mark. */
export const FLOCK_LEAK_MINOR_LAYER = 'flock-leak-minor';

const HIT_CANDIDATES = [FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER, FLOCK_LEAK_OTHERS_LAYER, FLOCK_LEAK_MINOR_LAYER];

/** Layers a tap or a count should query: whichever mark layers the map has
 *  right now. Naming a missing layer makes MapLibre log an error, so only
 *  mounted layers are listed. */
export function flockHitLayers(map: { getLayer(id: string): unknown }): string[] {
  return HIT_CANDIDATES.filter((id) => map.getLayer(id));
}

export const hasFlockHitLayers = (map: { getLayer(id: string): unknown }): boolean => flockHitLayers(map).length > 0;

/** Every Flock layer, bottom to top, as it should sit in the style. */
export const FLOCK_LAYER_ORDER: readonly string[] = [
  FLOCK_LEAK_DOTS_LAYER,
  FLOCK_LEAK_MINOR_LAYER,
  FLOCK_LEAK_GLOW_LAYER,
  FLOCK_LEAK_CORE_LAYER,
  FLOCK_LEAK_PLANNED_LAYER,
  FLOCK_LEAK_OTHERS_LAYER,
];

/** Ids to move to the top, bottom to top, so the mounted Flock layers end
 *  above everything else in `wanted` order. Empty when they already do, so
 *  a styledata-driven caller settles in one pass. */
export function layersToRaise(order: readonly string[], wanted: readonly string[]): string[] {
  const present = wanted.filter((id) => order.includes(id));
  if (present.length === 0) return [];
  const tail = order.slice(order.length - present.length);
  const onTop = tail.every((id, i) => id === present[i]);
  return onTop ? [] : present;
}
