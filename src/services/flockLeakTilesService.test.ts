import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  flockLeakTileJsonUrl,
  loadFlockLeakTileJson,
  _resetFlockLeakTileJsonCacheForTests,
  FLOCK_LEAK_SOURCE_ID,
  FLOCK_LEAK_SOURCE_LAYER,
  FLOCK_LEAK_TILEJSON_URL,
} from './flockLeakTilesService';
import { useTilesHostStore, failoverTilesHost, _resetTilesHostForTests } from '../store/tilesHostStore';

const doc = {
  tilejson: '3.0.0',
  name: 'flock-inventory-v2 2025-12-14',
  tiles: ['https://tiles.dontgetflocked.com/flock-inventory-v2/{z}/{x}/{y}.mvt'],
};

beforeEach(() => {
  _resetTilesHostForTests();
  _resetFlockLeakTileJsonCacheForTests();
  vi.unstubAllGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('constants', () => {
  it('uses the fixed v2 URL regardless of the active tile host', () => {
    expect(FLOCK_LEAK_TILEJSON_URL).toBe('https://tiles.dontgetflocked.com/flock-inventory-v2.json');
    expect(flockLeakTileJsonUrl()).toBe(FLOCK_LEAK_TILEJSON_URL);
    failoverTilesHost('test');
    expect(flockLeakTileJsonUrl()).toBe(FLOCK_LEAK_TILEJSON_URL);
  });

  it('never points at the v1 tileset', () => {
    expect(FLOCK_LEAK_TILEJSON_URL).not.toMatch(/flock-inventory\.json/);
  });

  it('source id and layer are stable (map wiring keys on them)', () => {
    expect(FLOCK_LEAK_SOURCE_ID).toBe('flock-leak-tiles');
    expect(FLOCK_LEAK_SOURCE_LAYER).toBe('cameras');
  });
});

describe('loadFlockLeakTileJson', () => {
  it('fetches with cache: no-cache and returns the document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(doc), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadFlockLeakTileJson();
    expect(fetchMock).toHaveBeenCalledWith(FLOCK_LEAK_TILEJSON_URL, expect.objectContaining({ cache: 'no-cache' }));
    expect(result?.tiles).toEqual(doc.tiles);
    expect(result?.name).toBe(doc.name);
  });

  it('caches a success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(doc), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await loadFlockLeakTileJson();
    await loadFlockLeakTileJson();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on HTTP error and does NOT fail the app over', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect(await loadFlockLeakTileJson()).toBeNull();
    expect(useTilesHostStore.getState().hostId).toBe('primary');
  });

  it('returns null on network error and does NOT fail the app over', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await loadFlockLeakTileJson()).toBeNull();
    expect(useTilesHostStore.getState().hostId).toBe('primary');
  });

  it('does not cache a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(doc), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadFlockLeakTileJson()).toBeNull();
    expect((await loadFlockLeakTileJson())?.tiles).toEqual(doc.tiles);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a document without a tiles array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'x' }), { status: 200 })));
    expect(await loadFlockLeakTileJson()).toBeNull();
  });
});
