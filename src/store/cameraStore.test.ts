import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCameraStore } from './cameraStore';
import { _resetManifestCacheForTests } from '../services/cameraManifestService';
import { _resetCameraTileJsonCacheForTests } from '../services/cameraTilesService';
import { _resetTilesHostForTests } from './tilesHostStore';
import { clearCameraCache } from '../services/cameraDataService';
import { fetchByUrl, jsonResponse, callsTo } from '../test/fetchByUrl';
import type { ALPRCamera } from '../types';

const validManifest = {
  version: 'v1',
  generatedAt: '2026-07-17T00:00:00Z',
  total: 3,
  brands: [{ id: 1, label: 'Flock Safety', count: 2 }],
  operators: [],
  zones: [],
  mounts: [],
};

/** Backup-style camera TileJSON: no build-pinned companions, so the store
 *  goes through the alias manifest / filter TileJSON pair (the skew-prone path). */
const plainTileJson = { tiles: ['https://tiles.dontgetflocked.com/cameras-us-hourly/{z}/{x}/{y}.mvt'] };

function cam(osmId: number, brand?: string, operator?: string): ALPRCamera {
  return { osmId, osmType: 'node', lat: 33.7, lon: -84.4, brand, operator };
}

beforeEach(() => {
  _resetManifestCacheForTests();
  _resetCameraTileJsonCacheForTests();
  _resetTilesHostForTests();
  vi.unstubAllGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useCameraStore.setState({
    manifest: null,
    manifestPhase: 'idle',
    filterTilesFailed: false,
    cameras: [],
    filteredCameras: [],
    filters: {
      operators: [], brands: [], surveillanceZones: [], mountTypes: [], showAll: true,
    },
    pendingFilters: { brands: [], operators: [], surveillanceZones: [], mountTypes: [], state: null },
  });
});

describe('ensureManifestLoaded', () => {
  it('loads the manifest and flips phase to ready', async () => {
    fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse(plainTileJson)],
      ['-manifest.json', () => jsonResponse(validManifest)],
    ]);
    await useCameraStore.getState().ensureManifestLoaded();
    expect(useCameraStore.getState().manifestPhase).toBe('ready');
    expect(useCameraStore.getState().manifest?.brands[0].label).toBe('Flock Safety');
  });

  it('flips phase to error on failure without throwing to caller', async () => {
    fetchByUrl([['cameras-us-hourly.json', () => jsonResponse(plainTileJson)]]);
    await useCameraStore.getState().ensureManifestLoaded();
    expect(useCameraStore.getState().manifestPhase).toBe('error');
  });

  it('is idempotent once ready (no additional manifest fetch on re-invoke)', async () => {
    const fetchMock = fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse(plainTileJson)],
      ['-manifest.json', () => jsonResponse(validManifest)],
      ['-filter.json', () => jsonResponse({ name: 'cameras-filter' })],
    ]);
    await useCameraStore.getState().ensureManifestLoaded();
    // First call triggers the manifest fetch plus the fire-and-forget
    // build-skew check (filter TileJSON fetch) — let it settle before counting.
    await vi.waitFor(() => expect(callsTo(fetchMock, '-filter.json')).toHaveLength(1));
    await useCameraStore.getState().ensureManifestLoaded();
    // Re-invoking after manifest is ready returns early — no new fetches.
    expect(callsTo(fetchMock, '-manifest.json')).toHaveLength(1);
    expect(callsTo(fetchMock, '-filter.json')).toHaveLength(1);
  });

  it('degrades to the geojson path when even a cache-busted pair mismatches', async () => {
    const versionedManifest = { ...validManifest, version: 'abc123def4567890' };
    const fetchMock = fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse(plainTileJson)],
      ['-manifest.json', () => jsonResponse(versionedManifest)],
      ['-filter.json', () => jsonResponse({ name: 'cameras-filter 1111111111111111' })],
    ]);
    await useCameraStore.getState().ensureManifestLoaded();
    expect(useCameraStore.getState().filterTilesFailed).toBe(false);
    await vi.waitFor(() => {
      expect(useCameraStore.getState().filterTilesFailed).toBe(true);
    });
    // initial pair + cache-busted retry pair
    expect(callsTo(fetchMock, '-manifest.json')).toHaveLength(2);
    expect(callsTo(fetchMock, '-filter.json')).toHaveLength(2);
  });

  it('recovers from CDN edge-cache skew via cache-busted refetch', async () => {
    // Edge served a manifest and TileJSON from different hourly builds;
    // origin (cache-busted) copies agree. Filters must survive.
    const staleManifest = { ...validManifest, version: 'aaaaaaaaaaaaaaaa' };
    const freshManifest = {
      ...validManifest,
      version: 'bbbbbbbbbbbbbbbb',
      brands: [{ id: 1, label: 'Fresh Brand', count: 5 }],
    };
    const fetchMock = fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse(plainTileJson)],
      ['-manifest.json', (url) => jsonResponse(url.includes('fresh=') ? freshManifest : staleManifest)],
      ['-filter.json', () => jsonResponse({ name: 'cameras-filter bbbbbbbbbbbbbbbb' })],
    ]);
    await useCameraStore.getState().ensureManifestLoaded();
    await vi.waitFor(() => {
      expect(useCameraStore.getState().manifest?.version).toBe('bbbbbbbbbbbbbbbb');
    });
    expect(useCameraStore.getState().filterTilesFailed).toBe(false);
    expect(useCameraStore.getState().manifest?.brands[0].label).toBe('Fresh Brand');
    // retry fetches must be cache-busted
    expect(String(callsTo(fetchMock, '-manifest.json')[1][0])).toContain('fresh=');
    expect(String(callsTo(fetchMock, '-filter.json')[1][0])).toContain('fresh=');
  });
});

describe('retryFilterTiles', () => {
  it('clears filter failure state synchronously and re-requests the manifest', async () => {
    useCameraStore.setState({ filterTilesFailed: true, manifestPhase: 'error', manifest: null });
    const fetchMock = fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse(plainTileJson)],
      ['-manifest.json', () => jsonResponse(validManifest)],
    ]);

    useCameraStore.getState().retryFilterTiles();

    // Failure flag is cleared immediately (synchronous reset)
    expect(useCameraStore.getState().filterTilesFailed).toBe(false);

    // The manifest is re-fetched and resolves
    await vi.waitFor(() => expect(useCameraStore.getState().manifestPhase).toBe('ready'));
    expect(useCameraStore.getState().manifest).not.toBeNull();
    expect(callsTo(fetchMock, '-manifest.json')).toHaveLength(1);
  });
});

describe('normalized filter matching (GeoJSON fallback path)', () => {
  it('applyPendingFilters matches brand typos against canonical labels', () => {
    useCameraStore.setState({
      cameras: [cam(1, 'Flock Saftey'), cam(2, 'Genetec'), cam(3, undefined)],
      pendingFilters: {
        brands: ['Flock Safety'], operators: [], surveillanceZones: [], mountTypes: [], state: null,
      },
    });
    useCameraStore.getState().applyPendingFilters();
    const ids = useCameraStore.getState().filteredCameras.map((c) => c.osmId);
    expect(ids).toEqual([1]);
  });

  it('setFilters matches operators case-insensitively', () => {
    useCameraStore.setState({
      cameras: [cam(1, undefined, ' city of atlanta '), cam(2, undefined, 'Elsewhere')],
    });
    useCameraStore.getState().setFilters({
      operators: ['City of Atlanta'], showAll: false,
    });
    const ids = useCameraStore.getState().filteredCameras.map((c) => c.osmId);
    expect(ids).toEqual([1]);
  });
});

describe('downloadProgress', () => {
  it('tracks percent during a determinate fetch and resets to null on ready', async () => {
    clearCameraCache();
    useCameraStore.setState({
      isInitialized: false, isLoading: false, _initPromise: null,
      loadPhase: 'idle', error: null, cameras: [], country: 'us',
    });

    const body = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-84.4, 33.7] },
        properties: { osmId: 1, osmType: 'node' },
      }],
    });
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes); c.close(); },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': String(bytes.byteLength) }),
      body: stream,
      text: async () => body,
    } as unknown as Response));

    const seen: Array<number | null> = [];
    const unsub = useCameraStore.subscribe((s) => { seen.push(s.downloadProgress); });

    await useCameraStore.getState().initializeCameras();
    unsub();

    expect(seen.some(v => typeof v === 'number')).toBe(true); // saw determinate progress
    expect(useCameraStore.getState().downloadProgress).toBeNull(); // reset when settled
    expect(useCameraStore.getState().loadPhase).toBe('ready');
  });
});
