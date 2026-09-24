/**
 * Pure MapLibre paint-expression helpers for the Flock Leak layers, split out
 * from FlockLeakLayers.tsx so the expression shape can be pinned by a test
 * that validates it against the real style spec (no react-map-gl/maplibre-gl
 * runtime import needed for that — see flockLeakStyle.test.ts).
 */

export const IS_DECOMMISSIONED = ['==', ['coalesce', ['get', 's'], 4], 3];

/**
 * A zoom-ramped opacity, halved for decommissioned devices (q=3 dimming).
 * MapLibre allows only one zoom-based `step`/`interpolate` subexpression
 * anywhere in an expression tree — not one, but two, even split across
 * `case` branches. Multiplying an interpolate's result by a `case` (the
 * naive shape) trips the same rule from the other side. Both shapes are
 * rejected at style-validation time with no thrown exception, so the layer
 * silently never gets added. The fix: a SINGLE top-level interpolate over
 * zoom, whose per-stop output is a feature-data `case` (data-driven stop
 * values are fine; it's a second zoom curve that isn't).
 */
export function zoomOpacityByStatus(stops: number[], decommissionedScale: number): unknown[] {
  const args: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (let i = 0; i < stops.length; i += 2) {
    args.push(stops[i], ['case', IS_DECOMMISSIONED, stops[i + 1] * decommissionedScale, stops[i + 1]]);
  }
  return args;
}
