/**
 * Pure MapLibre expression helpers for the Flock Leak layers, kept free of
 * the react-map-gl/maplibre-gl runtime so tests can validate them against
 * the style spec.
 *
 * Gotcha kept from the dimming this replaced: MapLibre allows only one
 * zoom-based `interpolate`/`step` in an expression tree, so a status term
 * must be a data-only `case` (as the gray colors are), never a second zoom
 * curve multiplied in. The style rejects the wrong shape silently.
 */

export const IS_DECOMMISSIONED = ['==', ['coalesce', ['get', 's'], 4], 3];
