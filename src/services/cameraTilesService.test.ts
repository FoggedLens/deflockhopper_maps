import { describe, it, expect, vi } from 'vitest';
import { archiveKey } from './cameraTilesService';

describe('archiveKey', () => {
  it('matches the main US/CA camera archives', () => {
    expect(archiveKey('pmtiles://tiles.dontgetflocked.com/cameras-us-hourly.pmtiles/9/1/2'))
      .toBe('cameras-us-hourly.pmtiles');
    expect(archiveKey('pmtiles://tiles.dontgetflocked.com/cameras-ca-hourly.pmtiles'))
      .toBe('cameras-ca-hourly.pmtiles');
  });
  it('matches the filter companions', () => {
    expect(archiveKey('pmtiles://tiles.dontgetflocked.com/cameras-us-hourly-filter.pmtiles/10/5/6'))
      .toBe('cameras-us-hourly-filter.pmtiles');
  });
  it('returns null for non-camera / basemap urls', () => {
    expect(archiveKey('https://tiles.dontgetflocked.com/planet.json')).toBeNull();
    expect(archiveKey('pmtiles://example.com/something-else.pmtiles')).toBeNull();
  });
});

describe('development camera tiles host override', () => {
  it('uses VITE_CAMERA_TILES_HOST for every tile artifact URL', async () => {
    vi.stubEnv('VITE_CAMERA_TILES_HOST', 'http://127.0.0.1:4174');
    vi.resetModules();

    try {
      const {
        cameraTilesUrl,
        cameraFilterTilesUrl,
        cameraFilterTileJsonUrl,
        cameraManifestUrl,
      } = await import('./cameraTilesService');

      expect(cameraTilesUrl('us')).toBe(
        'pmtiles://http://127.0.0.1:4174/cameras-us-hourly.pmtiles',
      );
      expect(cameraFilterTilesUrl('us')).toBe(
        'pmtiles://http://127.0.0.1:4174/cameras-us-hourly-filter.pmtiles',
      );
      expect(cameraFilterTileJsonUrl('us')).toBe(
        'http://127.0.0.1:4174/cameras-us-hourly-filter.json',
      );
      expect(cameraManifestUrl('us')).toBe(
        'http://127.0.0.1:4174/cameras-us-hourly-manifest.json',
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
