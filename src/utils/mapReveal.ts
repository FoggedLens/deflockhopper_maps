/**
 * When the map may fade in from the loading state.
 *
 * Both the basemap and the camera source must be in, so the first frame a
 * user sees is a complete map (approved 2026-09-10; supersedes the July
 * choice to reveal on camera tiles alone, which left the basemap filling in
 * behind the dots while the loading indicator had already gone).
 *
 *  - cameraSourceReady: the active camera tile source has loaded its viewport
 *  - mapLoaded: MapLibre's `load` fired — style, sprite, glyphs and the first
 *    complete render of every source in view
 *  - tilesFailed: the camera source gave up (retry pill carries the failure);
 *    the basemap alone is then revealed rather than a spinner forever
 */
export interface MapRevealInputs {
  cameraSourceReady: boolean;
  mapLoaded: boolean;
  tilesFailed: boolean;
}

export function isMapRevealReady(i: MapRevealInputs): boolean {
  if (!i.mapLoaded) return false;
  return i.cameraSourceReady || i.tilesFailed;
}
