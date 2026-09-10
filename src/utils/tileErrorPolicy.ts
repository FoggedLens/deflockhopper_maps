/**
 * Decides what a MapLibre `error` event on a tile source means for the app.
 *
 * Two failure shapes matter:
 *  - source-level: the TileJSON itself could not be fetched (network error or
 *    non-2xx). MapLibre fires it with a `sourceId` and no `tile`. On the
 *    primary host that is the failover signal, immediately.
 *  - tile-level: a single tile request failed (non-404). MapLibre fires it
 *    with a `tile`. The camera sources keep the existing rule: errors before
 *    the first successful load count, and the third trips. The first trip
 *    fails over; a trip on backup marks the source failed (retry pill).
 *
 * Basemap and boundary tile-level errors are ignored as before; only their
 * TileJSON failures participate in failover.
 */
export const TILE_ERROR_THRESHOLD = 3;

export const CAMERA_TILE_SOURCE_ID = 'camera-tiles';
export const FILTER_TILE_SOURCE_ID = 'camera-tiles-filtered';
export const BASEMAP_SOURCE_ID = 'protomaps';
export const BOUNDARY_SOURCE_ID = 'boundaries-us';

const TILE_SOURCE_IDS: ReadonlySet<string> = new Set([
  CAMERA_TILE_SOURCE_ID,
  FILTER_TILE_SOURCE_ID,
  BASEMAP_SOURCE_ID,
  BOUNDARY_SOURCE_ID,
]);

export interface TileErrorInput {
  sourceId: string | undefined;
  /** True when the error carries a tile (one tile request failed); false for
   *  a source-level failure (the TileJSON document itself). */
  tileLevel: boolean;
  /** The source has loaded successfully at least once since it mounted. */
  loadSeen: boolean;
  /** Tile-level errors already counted for this source since it mounted. */
  errorCount: number;
  onBackup: boolean;
}

export type TileErrorAction =
  | { kind: 'ignore' }
  | { kind: 'count' }
  | { kind: 'failover'; reason: string }
  | { kind: 'fail'; source: 'camera' | 'filter' };

const IGNORE: TileErrorAction = { kind: 'ignore' };

export function planTileError(input: TileErrorInput): TileErrorAction {
  const { sourceId } = input;
  if (!sourceId || !TILE_SOURCE_IDS.has(sourceId)) return IGNORE;

  const cameraSource =
    sourceId === CAMERA_TILE_SOURCE_ID ? 'camera'
    : sourceId === FILTER_TILE_SOURCE_ID ? 'filter'
    : null;

  if (!input.tileLevel) {
    if (!input.onBackup) return { kind: 'failover', reason: `${sourceId} tilejson` };
    return cameraSource ? { kind: 'fail', source: cameraSource } : IGNORE;
  }

  if (!cameraSource || input.loadSeen) return IGNORE;
  if (input.errorCount + 1 < TILE_ERROR_THRESHOLD) return { kind: 'count' };
  return input.onBackup
    ? { kind: 'fail', source: cameraSource }
    : { kind: 'failover', reason: `${sourceId} tiles` };
}
