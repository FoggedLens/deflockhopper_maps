import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadCameraManifest,
  verifyFilterTilesetVersion,
  _resetManifestCacheForTests,
} from './cameraManifestService';
import { _resetCameraTileJsonCacheForTests } from './cameraTilesService';
import { _resetTilesHostForTests, failoverTilesHost } from '../store/tilesHostStore';
import { fetchByUrl, jsonResponse as json, callsTo } from '../test/fetchByUrl';

const PRIMARY = 'https://deflock.dontgetflocked.com';
const BACKUP = 'https://tiles.dontgetflocked.com';
const BUILD = '63b8af37657d';

const validManifest = {
  version: '2026-07-17',
  generatedAt: '2026-07-17T00:00:00Z',
  total: 114000,
  brands: [{ id: 1, label: 'Flock Safety', count: 81234 }],
  operators: [{ id: 1, label: 'City of Atlanta', count: 120 }],
  zones: [{ id: 1, label: 'traffic', count: 90000 }],
  mounts: [{ id: 1, label: 'pole', count: 100000 }],
};

/** Primary-style camera TileJSON: build-pinned companion URLs present. */
const pinnedTileJson = {
  tiles: [`${PRIMARY}/cameras-us-hourly-${BUILD}/{z}/{x}/{y}.mvt`],
  build: BUILD,
  manifest: `${PRIMARY}/cameras-us-hourly-manifest-${BUILD}.json`,
  filter_tilejson: `${PRIMARY}/cameras-us-hourly-filter-${BUILD}.json`,
};
/** Backup-style camera TileJSON: tiles only, no companions. */
const plainTileJson = { tiles: [`${BACKUP}/cameras-us-hourly/{z}/{x}/{y}.mvt`] };

beforeEach(() => {
  _resetManifestCacheForTests();
  _resetCameraTileJsonCacheForTests();
  _resetTilesHostForTests();
  vi.unstubAllGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadCameraManifest', () => {
  it('prefers the build-pinned manifest URL from the camera TileJSON', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      [`cameras-us-hourly-manifest-${BUILD}.json`, () => json(validManifest)],
    ]);
    const m = await loadCameraManifest('us');
    expect(m.brands[0].label).toBe('Flock Safety');
    expect(callsTo(mock, `manifest-${BUILD}.json`)).toHaveLength(1);
    expect(callsTo(mock, 'cameras-us-hourly-manifest.json')).toHaveLength(0);
  });

  it('falls back to the alias manifest, fetched no-cache, when the TileJSON has no companions', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => json(plainTileJson)],
      ['cameras-us-hourly-manifest.json', () => json(validManifest)],
    ]);
    const m = await loadCameraManifest('us');
    expect(m.total).toBe(114000);
    const [call] = callsTo(mock, 'cameras-us-hourly-manifest.json');
    expect(String(call[0])).toBe(`${PRIMARY}/cameras-us-hourly-manifest.json`);
    expect(call[1]).toEqual(expect.objectContaining({ cache: 'no-cache' }));
  });

  it('falls back to the alias manifest when the TileJSON itself is unavailable', async () => {
    // Primary TileJSON 503 → failover → backup TileJSON (plain) → backup alias manifest
    const mock = fetchByUrl([
      [`${PRIMARY}/cameras-us-hourly.json`, () => new Response('down', { status: 503 })],
      [`${BACKUP}/cameras-us-hourly.json`, () => json(plainTileJson)],
      [`${BACKUP}/cameras-us-hourly-manifest.json`, () => json(validManifest)],
    ]);
    const m = await loadCameraManifest('us');
    expect(m.total).toBe(114000);
    expect(callsTo(mock, `${BACKUP}/cameras-us-hourly-manifest.json`)).toHaveLength(1);
  });

  it('caches after first load (one manifest fetch)', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      ['-manifest-', () => json(validManifest)],
    ]);
    await loadCameraManifest('us');
    await loadCameraManifest('us');
    expect(callsTo(mock, '-manifest-')).toHaveLength(1);
  });

  it('dedupes concurrent calls into one manifest fetch', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      ['-manifest-', () => json(validManifest)],
    ]);
    await Promise.all([loadCameraManifest('us'), loadCameraManifest('us')]);
    expect(callsTo(mock, '-manifest-')).toHaveLength(1);
  });

  it('throws on HTTP error and allows retry', async () => {
    let first = true;
    fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      ['-manifest-', () => {
        if (first) { first = false; return new Response('nope', { status: 404 }); }
        return json(validManifest);
      }],
    ]);
    await expect(loadCameraManifest('us')).rejects.toThrow();
    const m = await loadCameraManifest('us');
    expect(m.total).toBe(114000);
  });

  it('throws on malformed payload', async () => {
    fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      ['-manifest-', () => json({ hello: 'world' })],
    ]);
    await expect(loadCameraManifest('us')).rejects.toThrow();
  });

  it('fresh: cache-busts only the alias manifest, never a build-pinned one', async () => {
    const pinned = fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      ['-manifest-', () => json(validManifest)],
    ]);
    await loadCameraManifest('us', { fresh: true });
    expect(String(callsTo(pinned, '-manifest-')[0][0])).not.toContain('fresh=');

    _resetManifestCacheForTests();
    _resetCameraTileJsonCacheForTests();
    const alias = fetchByUrl([
      ['cameras-us-hourly.json', () => json(plainTileJson)],
      ['cameras-us-hourly-manifest.json', () => json(validManifest)],
    ]);
    await loadCameraManifest('us', { fresh: true });
    expect(String(callsTo(alias, 'cameras-us-hourly-manifest.json')[0][0])).toContain('fresh=');
  });
});

describe('verifyFilterTilesetVersion', () => {
  const manifestVersion = 'abc123def4567890';

  it('reads the build-pinned filter TileJSON when the camera TileJSON names one', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => json(pinnedTileJson)],
      [`cameras-us-hourly-filter-${BUILD}.json`, () => json({ name: `cameras-filter ${manifestVersion}` })],
    ]);
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('match');
    expect(callsTo(mock, 'cameras-us-hourly-filter.json')).toHaveLength(0);
  });

  it('falls back to the alias filter TileJSON (no-cache) without companions', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => json(plainTileJson)],
      ['cameras-us-hourly-filter.json', () => json({ name: `cameras-filter ${manifestVersion}` })],
    ]);
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('match');
    const [call] = callsTo(mock, 'cameras-us-hourly-filter.json');
    expect(call[1]).toEqual(expect.objectContaining({ cache: 'no-cache' }));
  });

  it('returns "mismatch" when the TileJSON name contains a different stamp', async () => {
    fetchByUrl([
      ['cameras-us-hourly.json', () => json(plainTileJson)],
      ['-filter.json', () => json({ name: 'cameras-filter 1111111111111111' })],
    ]);
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('mismatch');
  });

  it('returns "unknown" when the TileJSON name has no stamp', async () => {
    fetchByUrl([
      ['cameras-us-hourly.json', () => json(plainTileJson)],
      ['-filter.json', () => json({ name: 'cameras-filter' })],
    ]);
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('unknown');
  });

  it('returns "unknown" on a non-ok response', async () => {
    fetchByUrl([
      ['cameras-us-hourly.json', () => json(plainTileJson)],
      ['-filter.json', () => new Response('nope', { status: 404 })],
    ]);
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('unknown');
  });

  it('returns "unknown" when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('unknown');
  });

  it('after a failover, reads the alias from the backup host', async () => {
    failoverTilesHost('test');
    const mock = fetchByUrl([
      [`${BACKUP}/cameras-us-hourly.json`, () => json(plainTileJson)],
      [`${BACKUP}/cameras-us-hourly-filter.json`, () => json({ name: `cameras-filter ${manifestVersion}` })],
    ]);
    await expect(verifyFilterTilesetVersion(manifestVersion, 'us')).resolves.toBe('match');
    expect(callsTo(mock, PRIMARY)).toHaveLength(0);
  });
});
