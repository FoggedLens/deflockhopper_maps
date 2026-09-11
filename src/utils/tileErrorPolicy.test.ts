import { describe, it, expect } from 'vitest';
import { planTileError, TILE_ERROR_THRESHOLD } from './tileErrorPolicy';

const base = { tileLevel: true, loadSeen: false, errorCount: 0, onBackup: false };

describe('planTileError', () => {
  it('ignores errors without a source id (glyphs, sprites, style)', () => {
    expect(planTileError({ ...base, sourceId: undefined })).toEqual({ kind: 'ignore' });
  });

  it('ignores errors from non-tile sources (geojson layers)', () => {
    expect(planTileError({ ...base, sourceId: 'camera-tile-cones', tileLevel: false }))
      .toEqual({ kind: 'ignore' });
  });

  describe('source-level (TileJSON) failures', () => {
    it('fail over immediately on primary for any tile source', () => {
      for (const sourceId of ['camera-tiles', 'camera-tiles-filtered', 'protomaps', 'boundaries-us']) {
        expect(planTileError({ ...base, sourceId, tileLevel: false }))
          .toEqual({ kind: 'failover', reason: `${sourceId} tilejson` });
      }
    });

    it('mark the camera source failed when already on backup', () => {
      expect(planTileError({ ...base, sourceId: 'camera-tiles', tileLevel: false, onBackup: true }))
        .toEqual({ kind: 'fail', source: 'camera' });
    });

    it('mark the filter source failed when already on backup', () => {
      expect(planTileError({ ...base, sourceId: 'camera-tiles-filtered', tileLevel: false, onBackup: true }))
        .toEqual({ kind: 'fail', source: 'filter' });
    });

    it('are ignored for basemap/boundaries when already on backup (nothing left to do)', () => {
      expect(planTileError({ ...base, sourceId: 'protomaps', tileLevel: false, onBackup: true }))
        .toEqual({ kind: 'ignore' });
    });
  });

  describe('tile-level failures (existing tilesFailed logic)', () => {
    it('ignore basemap and boundary tile errors', () => {
      expect(planTileError({ ...base, sourceId: 'protomaps' })).toEqual({ kind: 'ignore' });
      expect(planTileError({ ...base, sourceId: 'boundaries-us' })).toEqual({ kind: 'ignore' });
    });

    it('ignore camera tile errors once the source has loaded successfully', () => {
      expect(planTileError({ ...base, sourceId: 'camera-tiles', loadSeen: true, errorCount: 99 }))
        .toEqual({ kind: 'ignore' });
    });

    it('count camera tile errors below the threshold', () => {
      expect(planTileError({ ...base, sourceId: 'camera-tiles', errorCount: 0 })).toEqual({ kind: 'count' });
      expect(planTileError({ ...base, sourceId: 'camera-tiles', errorCount: TILE_ERROR_THRESHOLD - 2 }))
        .toEqual({ kind: 'count' });
    });

    it('fail over on primary when the threshold trips', () => {
      expect(planTileError({ ...base, sourceId: 'camera-tiles', errorCount: TILE_ERROR_THRESHOLD - 1 }))
        .toEqual({ kind: 'failover', reason: 'camera-tiles tiles' });
    });

    it('mark camera tiles failed when the threshold trips on backup', () => {
      expect(planTileError({
        ...base, sourceId: 'camera-tiles', errorCount: TILE_ERROR_THRESHOLD - 1, onBackup: true,
      })).toEqual({ kind: 'fail', source: 'camera' });
    });

    it('mark filter tiles failed when the threshold trips on backup', () => {
      expect(planTileError({
        ...base, sourceId: 'camera-tiles-filtered', errorCount: TILE_ERROR_THRESHOLD - 1, onBackup: true,
      })).toEqual({ kind: 'fail', source: 'filter' });
    });
  });
});
