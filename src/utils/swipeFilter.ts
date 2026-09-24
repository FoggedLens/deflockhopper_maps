import type { FilterSpecification } from 'maplibre-gl';

/**
 * Swipe geometry. The divider is a fraction of the map width. Each side of
 * the swipe is a transparent overlay map clipped with CSS: no layer filter
 * ever changes on a drag, so MapLibre never re-buckets tiles.
 */
export function clampDivider(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function combineFilters(
  ...filters: Array<FilterSpecification | undefined>
): FilterSpecification | undefined {
  const present = filters.filter((f): f is FilterSpecification => f != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return ['all', ...present] as unknown as FilterSpecification;
}

/** CSS clip-path values for the two overlays: OSM keeps the left of the
 *  divider, Flock keeps the right. */
export function swipeClipInsets(divider: number): { osm: string; flock: string } {
  const d = clampDivider(divider);
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  return { osm: `inset(0 ${pct(1 - d)} 0 0)`, flock: `inset(0 0 0 ${pct(d)})` };
}
