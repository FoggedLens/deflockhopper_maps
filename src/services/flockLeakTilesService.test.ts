import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  flockLeakTileJsonUrl,
  loadFlockLeakTileJson,
  _resetFlockLeakTileJsonCacheForTests,
  FLOCK_LEAK_SOURCE_ID,
} from './flockLeakTilesService';
import { useTilesHostStore, failoverTilesHost, _resetTilesHostForTests } from '../store/tilesHostStore';

const PRIMARY = 'https://deflock.dontgetflocked.com';
const BACKUP = 'https://tiles.dontgetflocked.com';

const doc = {
  tilejson: '3.0.0',
  tiles: [`${PRIMARY}/flock-leak-abc123/{z}/{x}/{y}.mvt`],
  snapshot: '2025-12',
  source_url: 'https://flocksurveillance.org',
  stats: { total: 84120, byType: { Falcon: 80000, Condor: 4120 }, byStatus: { Active: 84120 } },
};

beforeEach(() => {
  _resetTilesHostForTests();
  _resetFlockLeakTileJsonCacheForTests();
  vi.unstubAllGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('flockLeakTileJsonUrl', () => {
  it('builds the alias on the active host', () => {
    expect(flockLeakTileJsonUrl()).toBe(`${PRIMARY}/flock-leak.json`);
    failoverTilesHost('test');
    expect(flockLeakTileJsonUrl()).toBe(`${BACKUP}/flock-leak.json`);
  });

  it('source id is stable (map error handling keys on it)', () => {
    expect(FLOCK_LEAK_SOURCE_ID).toBe('flock-leak-tiles');
  });
});

describe('loadFlockLeakTileJson', () => {
  it('fetches with cache: no-cache and returns the stats', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(doc), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadFlockLeakTileJson();
    expect(fetchMock).toHaveBeenCalledWith(`${PRIMARY}/flock-leak.json`, expect.objectContaining({ cache: 'no-cache' }));
    expect(result?.stats?.total).toBe(84120);
    expect(result?.snapshot).toBe('2025-12');
  });

  it('caches a success (one fetch for repeated calls)', async () => {
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
    expect((await loadFlockLeakTileJson())?.stats?.total).toBe(84120);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a document without a tiles array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ stats: { total: 1 } }), { status: 200 })));
    expect(await loadFlockLeakTileJson()).toBeNull();
  });

  it('drops malformed stats but keeps the tiles', async () => {
    const bad = { ...doc, stats: { total: 'lots' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(bad), { status: 200 })));
    const result = await loadFlockLeakTileJson();
    expect(result?.tiles).toEqual(doc.tiles);
    expect(result?.stats).toBeUndefined();
  });
});
