import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cameraTileJsonUrl,
  cameraFilterTileJsonUrl,
  cameraManifestUrl,
  loadCameraTileJson,
  tilesTransformRequest,
  _resetCameraTileJsonCacheForTests,
} from './cameraTilesService';
import {
  useTilesHostStore,
  failoverTilesHost,
  _resetTilesHostForTests,
} from '../store/tilesHostStore';

const PRIMARY = 'https://deflock.dontgetflocked.com';
const BACKUP = 'https://tiles.dontgetflocked.com';

const primaryTileJson = {
  tilejson: '3.0.0',
  tiles: [`${PRIMARY}/cameras-us-hourly-63b8af37657d/{z}/{x}/{y}.mvt`],
  build: '63b8af37657d',
  manifest: `${PRIMARY}/cameras-us-hourly-manifest-63b8af37657d.json`,
  filter_tilejson: `${PRIMARY}/cameras-us-hourly-filter-63b8af37657d.json`,
  index_bin: `${PRIMARY}/cameras-us-hourly-index-63b8af37657d.bin`,
  index_json: `${PRIMARY}/cameras-us-hourly-index-63b8af37657d.json`,
};

beforeEach(() => {
  _resetTilesHostForTests();
  _resetCameraTileJsonCacheForTests();
  vi.unstubAllGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('camera tile URL builders', () => {
  it('build TileJSON alias URLs on the primary host by default', () => {
    expect(cameraTileJsonUrl('us')).toBe(`${PRIMARY}/cameras-us-hourly.json`);
    expect(cameraTileJsonUrl('ca')).toBe(`${PRIMARY}/cameras-ca-hourly.json`);
    expect(cameraFilterTileJsonUrl('us')).toBe(`${PRIMARY}/cameras-us-hourly-filter.json`);
    expect(cameraManifestUrl('ca')).toBe(`${PRIMARY}/cameras-ca-hourly-manifest.json`);
  });

  it('follow the active host after a failover', () => {
    failoverTilesHost('test');
    expect(cameraTileJsonUrl('us')).toBe(`${BACKUP}/cameras-us-hourly.json`);
    expect(cameraFilterTileJsonUrl('us')).toBe(`${BACKUP}/cameras-us-hourly-filter.json`);
    expect(cameraManifestUrl('us')).toBe(`${BACKUP}/cameras-us-hourly-manifest.json`);
  });

  it('never produce pmtiles URLs', () => {
    for (const url of [cameraTileJsonUrl('us'), cameraFilterTileJsonUrl('us')]) {
      expect(url).not.toMatch(/pmtiles/);
    }
  });
});

describe('loadCameraTileJson', () => {
  it('fetches the alias doc with cache: no-cache and returns its companion URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(primaryTileJson), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const doc = await loadCameraTileJson('us');
    expect(fetchMock).toHaveBeenCalledWith(
      `${PRIMARY}/cameras-us-hourly.json`,
      expect.objectContaining({ cache: 'no-cache' })
    );
    expect(doc?.build).toBe('63b8af37657d');
    expect(doc?.manifest).toBe(primaryTileJson.manifest);
    expect(doc?.filter_tilejson).toBe(primaryTileJson.filter_tilejson);
    expect(doc?.index_bin).toBe(primaryTileJson.index_bin);
    expect(doc?.index_json).toBe(primaryTileJson.index_json);
  });

  it('caches per host and country (one fetch for repeated calls)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(primaryTileJson), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([loadCameraTileJson('us'), loadCameraTileJson('us')]);
    await loadCameraTileJson('us');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails over to backup and resolves null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 502 })));
    const doc = await loadCameraTileJson('us');
    expect(doc).toBeNull();
    expect(useTilesHostStore.getState().hostId).toBe('backup');
  });

  it('fails over to backup and resolves null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const doc = await loadCameraTileJson('us');
    expect(doc).toBeNull();
    expect(useTilesHostStore.getState().hostId).toBe('backup');
  });

  it('after failover, refetches from the backup host instead of reusing the failed entry', async () => {
    const backupTileJson = { tilejson: '3.0.0', tiles: [`${BACKUP}/cameras-us-hourly/{z}/{x}/{y}.mvt`] };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith(PRIMARY)
          ? new Response('down', { status: 503 })
          : new Response(JSON.stringify(backupTileJson), { status: 200 })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadCameraTileJson('us')).toBeNull();
    const doc = await loadCameraTileJson('us');
    expect(doc?.tiles[0]).toContain(BACKUP);
    expect(doc?.manifest).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${BACKUP}/cameras-us-hourly.json`);
  });

  it('treats a doc without a tiles array as unusable (null) without failing over', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
    ));
    expect(await loadCameraTileJson('us')).toBeNull();
    expect(useTilesHostStore.getState().hostId).toBe('primary');
  });
});

describe('tilesTransformRequest', () => {
  it('marks TileJSON (Source) documents no-cache so reloads revalidate', () => {
    const out = tilesTransformRequest(`${PRIMARY}/cameras-us-hourly.json`, 'Source' as never);
    expect(out).toEqual({ url: `${PRIMARY}/cameras-us-hourly.json`, cache: 'no-cache' });
  });

  it('leaves tile requests untouched so they stay immutably cached', () => {
    expect(
      tilesTransformRequest(`${PRIMARY}/cameras-us-hourly-63b8af37657d/9/1/2.mvt`, 'Tile' as never)
    ).toBeUndefined();
  });

  it('leaves glyphs and sprites untouched', () => {
    expect(tilesTransformRequest(`${PRIMARY}/fonts/Noto/0-255.pbf`, 'Glyphs' as never)).toBeUndefined();
    expect(tilesTransformRequest(`${PRIMARY}/sprites/v4/dark.json`, 'SpriteJSON' as never)).toBeUndefined();
  });
});
