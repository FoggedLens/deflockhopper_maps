import { describe, it, expect } from 'vitest';
import {
  decodeCameraIndex,
  countInBounds,
  tallyInBounds,
  deriveBrandStats,
  brandStatsEqual,
  type CameraIndexSidecar,
} from './cameraIndexService';

/** Build a spec-conformant FHIX v1 binary from camera records. */
function makeBin(records: Array<{ lat: number; lng: number; brand?: number }>): ArrayBuffer {
  const n = records.length;
  const buf = new ArrayBuffer(16 + n * 4 + n * 4 + n * 1);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x46); // F
  dv.setUint8(1, 0x48); // H
  dv.setUint8(2, 0x49); // I
  dv.setUint8(3, 0x58); // X
  dv.setUint32(4, 1, true); // version
  dv.setUint32(8, n, true); // count
  dv.setUint32(12, 0, true); // reserved
  const lat = new Int32Array(buf, 16, n);
  const lng = new Int32Array(buf, 16 + n * 4, n);
  const brand = new Uint8Array(buf, 16 + n * 8, n);
  records.forEach((r, i) => {
    lat[i] = Math.round(r.lat * 1e6);
    lng[i] = Math.round(r.lng * 1e6);
    brand[i] = r.brand ?? 0;
  });
  return buf;
}

function sidecarFor(records: Array<unknown>, brands = ['unknown', 'Flock Safety']): CameraIndexSidecar {
  return { version: 1, count: records.length, build: 'test-build', brands };
}

/** Reference implementation: straight linear scan with the same edge rules. */
function bruteForce(
  records: Array<{ lat: number; lng: number }>,
  b: { north: number; south: number; east: number; west: number }
): number {
  // Same normalization contract as countInBounds: lat clamped, lng range
  // normalized to a span starting in [-180, 180).
  const south = Math.max(-90, b.south);
  const north = Math.min(90, b.north);
  if (north < south) return 0;
  let span = b.east - b.west;
  if (span < 0) span += 360;
  return records.filter((r) => {
    // round-trip through microdegrees like the binary does
    const lat = Math.round(r.lat * 1e6) / 1e6;
    const lng = Math.round(r.lng * 1e6) / 1e6;
    if (lat < south || lat > north) return false;
    if (span >= 360) return true;
    const w = ((b.west + 180) % 360 + 360) % 360 - 180;
    const e = w + span;
    if (e <= 180) return lng >= w && lng <= e;
    return lng >= w || lng <= e - 360;
  }).length;
}

/** Deterministic PRNG so failures reproduce. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('decodeCameraIndex', () => {
  it('decodes a valid file and exposes columns and metadata', () => {
    const records = [
      { lat: 29.7604, lng: -95.3698, brand: 1 },
      { lat: 40.7128, lng: -74.006, brand: 0 },
    ];
    const idx = decodeCameraIndex(makeBin(records), sidecarFor(records));
    expect(idx.count).toBe(2);
    expect(idx.brands).toEqual(['unknown', 'Flock Safety']);
    expect(idx.build).toBe('test-build');
    expect(idx.latMicro[0]).toBe(29760400);
    expect(idx.lngMicro[1]).toBe(-74006000);
    expect(idx.brandIds[0]).toBe(1);
  });

  it('rejects a bad magic', () => {
    const bin = makeBin([{ lat: 0, lng: 0 }]);
    new DataView(bin).setUint8(0, 0x00);
    expect(() => decodeCameraIndex(bin, sidecarFor([{}]))).toThrow(/magic/i);
  });

  it('rejects an unknown version', () => {
    const bin = makeBin([{ lat: 0, lng: 0 }]);
    new DataView(bin).setUint32(4, 2, true);
    expect(() => decodeCameraIndex(bin, sidecarFor([{}]))).toThrow(/version/i);
  });

  it('rejects a count/sidecar mismatch', () => {
    const bin = makeBin([{ lat: 0, lng: 0 }]);
    expect(() => decodeCameraIndex(bin, sidecarFor([{}, {}]))).toThrow(/count/i);
  });

  it('rejects a truncated file', () => {
    const bin = makeBin([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]);
    expect(() => decodeCameraIndex(bin.slice(0, bin.byteLength - 3), sidecarFor([{}, {}]))).toThrow(/size/i);
  });

  it('rejects out-of-range coordinates', () => {
    const bin = makeBin([{ lat: 91, lng: 0 }]);
    expect(() => decodeCameraIndex(bin, sidecarFor([{}]))).toThrow(/coordinate/i);
  });
});

describe('countInBounds', () => {
  const usLike = [
    { lat: 29.7604, lng: -95.3698 }, // Houston
    { lat: 29.7405, lng: -95.4 },    // Houston area
    { lat: 40.7128, lng: -74.006 },  // NYC
    { lat: 34.0522, lng: -118.2437 },// LA
    { lat: 61.2181, lng: -149.9003 },// Anchorage
    { lat: 21.3069, lng: -157.8583 },// Honolulu
  ];
  const idx = decodeCameraIndex(makeBin(usLike), sidecarFor(usLike));

  it('counts a city-scale viewport exactly', () => {
    const b = { north: 30.2, south: 29.3, east: -94.9, west: -95.9 };
    expect(countInBounds(idx, b)).toBe(2);
  });

  it('counts a continental viewport', () => {
    const b = { north: 50, south: 24, east: -66, west: -125 };
    expect(countInBounds(idx, b)).toBe(4); // excludes AK + HI
  });

  it('includes cameras exactly on the boundary', () => {
    const b = { north: 29.7604, south: 29.7604, east: -95.3698, west: -95.3698 };
    expect(countInBounds(idx, b)).toBe(1);
  });

  it('returns total for a whole-world viewport (lng span >= 360)', () => {
    const b = { north: 90, south: -90, east: 250, west: -250 };
    expect(countInBounds(idx, b)).toBe(usLike.length);
  });

  it('still restricts by latitude when lng spans the world', () => {
    const b = { north: 45, south: 25, east: 250, west: -250 };
    expect(countInBounds(idx, b)).toBe(4);
  });

  it('handles an antimeridian-wrapping viewport', () => {
    const wrap = [
      { lat: 52, lng: 179.5 },
      { lat: 52, lng: -179.5 },
      { lat: 52, lng: 170 },
      { lat: 52, lng: 0 },
    ];
    const wIdx = decodeCameraIndex(makeBin(wrap), sidecarFor(wrap));
    const b = { north: 60, south: 45, east: -175, west: 175 };
    expect(countInBounds(wIdx, b)).toBe(2);
  });

  it('handles out-of-range lng bounds from low-zoom maplibre getBounds', () => {
    // maplibre can report e.g. west=-200 when the world wraps in view
    const b = { north: 45, south: 20, east: -60, west: -200 };
    expect(countInBounds(idx, b)).toBe(bruteForce(usLike, b));
  });

  it('returns 0 for an empty region and inverted lat bounds', () => {
    expect(countInBounds(idx, { north: 10, south: 0, east: 10, west: 0 })).toBe(0);
    expect(countInBounds(idx, { north: 0, south: 10, east: 10, west: 0 })).toBe(0);
  });

  it('matches brute force on 500 random viewports over 2000 random cameras', () => {
    const rnd = mulberry32(42);
    const records = Array.from({ length: 2000 }, () => ({
      lat: rnd() * 180 - 90,
      lng: rnd() * 360 - 180,
    }));
    const rIdx = decodeCameraIndex(makeBin(records), sidecarFor(records, ['unknown']));
    for (let i = 0; i < 500; i++) {
      const south = rnd() * 170 - 90;
      const north = south + rnd() * (90 - south);
      const west = rnd() * 400 - 220; // deliberately out-of-range sometimes
      const east = west + rnd() * 380;
      const b = { north, south, east, west };
      expect(countInBounds(rIdx, b), JSON.stringify(b)).toBe(bruteForce(records, b));
    }
  });

  it('counts cells straddling the viewport edge exactly (not by whole cell)', () => {
    // two cameras in the same 0.5-degree cell, bounds splitting them
    const pair = [
      { lat: 29.71, lng: -95.3 },
      { lat: 29.74, lng: -95.3 },
    ];
    const pIdx = decodeCameraIndex(makeBin(pair), sidecarFor(pair));
    expect(countInBounds(pIdx, { north: 29.72, south: 29.7, east: -95.0, west: -95.5 })).toBe(1);
  });
});

describe('tallyInBounds', () => {
  const brands = ['unknown', 'Flock Safety', 'Motorola Solutions', 'Genetec'];
  const cams = [
    { lat: 29.7604, lng: -95.3698, brand: 1 }, // Houston, Flock
    { lat: 29.7405, lng: -95.4, brand: 2 },    // Houston, Motorola
    { lat: 29.75, lng: -95.39, brand: 0 },     // Houston, unknown
    { lat: 40.7128, lng: -74.006, brand: 3 },  // NYC, Genetec
    { lat: 61.2181, lng: -149.9003, brand: 1 },// Anchorage, Flock
  ];
  const idx = decodeCameraIndex(makeBin(cams), sidecarFor(cams, brands));

  it('tallies per-brand counts for a city viewport', () => {
    const t = tallyInBounds(idx, { north: 30.2, south: 29.3, east: -94.9, west: -95.9 });
    expect(t.total).toBe(3);
    expect(t.counts[0]).toBe(1); // unknown
    expect(t.counts[1]).toBe(1); // Flock
    expect(t.counts[2]).toBe(1); // Motorola
    expect(t.counts[3]).toBe(0); // Genetec (NYC, out of view)
  });

  it('total always equals countInBounds for identical bounds', () => {
    const boxes = [
      { north: 30.2, south: 29.3, east: -94.9, west: -95.9 },
      { north: 90, south: -90, east: 250, west: -250 },   // whole world
      { north: 60, south: 45, east: -175, west: 175 },    // antimeridian wrap
      { north: 45, south: 20, east: -60, west: -200 },    // out-of-range lng
      { north: 0, south: 10, east: 10, west: 0 },         // inverted lat
    ];
    for (const b of boxes) {
      const t = tallyInBounds(idx, b);
      expect(t.total, JSON.stringify(b)).toBe(countInBounds(idx, b));
      let sum = 0;
      for (let i = 0; i < 256; i++) sum += t.counts[i];
      expect(sum, JSON.stringify(b)).toBe(t.total);
    }
  });

  it('interior-cell fast path tallies brands exactly (cell fully inside bounds)', () => {
    // Cluster fills one 0.5-degree cell; bounds cover the whole cell plus margin.
    const cluster = [
      { lat: 29.6, lng: -95.4, brand: 1 },
      { lat: 29.7, lng: -95.3, brand: 1 },
      { lat: 29.8, lng: -95.2, brand: 2 },
    ];
    const cIdx = decodeCameraIndex(makeBin(cluster), sidecarFor(cluster, brands));
    const t = tallyInBounds(cIdx, { north: 35, south: 25, east: -90, west: -100 });
    expect(t.total).toBe(3);
    expect(t.counts[1]).toBe(2);
    expect(t.counts[2]).toBe(1);
  });

  it('matches per-brand brute force on 200 random viewports over 2000 random cameras', () => {
    const rnd = mulberry32(1337);
    const records = Array.from({ length: 2000 }, () => ({
      lat: rnd() * 180 - 90,
      lng: rnd() * 360 - 180,
      brand: Math.floor(rnd() * 5),
    }));
    const names = ['unknown', 'A', 'B', 'C', 'D'];
    const rIdx = decodeCameraIndex(makeBin(records), sidecarFor(records, names));
    for (let i = 0; i < 200; i++) {
      const south = rnd() * 170 - 90;
      const north = south + rnd() * (90 - south);
      const west = rnd() * 400 - 220;
      const east = west + rnd() * 380;
      const b = { north, south, east, west };
      const t = tallyInBounds(rIdx, b);
      for (let brand = 0; brand < 5; brand++) {
        const expected = bruteForce(records.filter((r) => r.brand === brand), b);
        expect(t.counts[brand], `brand ${brand} ${JSON.stringify(b)}`).toBe(expected);
      }
      expect(t.total).toBe(countInBounds(rIdx, b));
    }
  });
});

describe('deriveBrandStats', () => {
  const brands = ['unknown', 'Flock Safety', 'Motorola Solutions', 'Genetec', 'Leonardo', 'Ekin', 'Rekor'];

  function tallyOf(pairs: Array<[number, number]>): { total: number; counts: Uint32Array } {
    const counts = new Uint32Array(256);
    let total = 0;
    for (const [id, c] of pairs) { counts[id] = c; total += c; }
    return { total, counts };
  }

  it('ranks top 4 by count and folds the rest into other', () => {
    const s = deriveBrandStats(
      tallyOf([[1, 985], [0, 409], [2, 289], [3, 35], [4, 9], [5, 5], [6, 2]]),
      brands
    );
    expect(s.total).toBe(1734);
    expect(s.top.map((t) => t.label)).toEqual(['Flock Safety', 'Unknown', 'Motorola Solutions', 'Genetec']);
    expect(s.top.map((t) => t.count)).toEqual([985, 409, 289, 35]);
    expect(s.top[1].unknown).toBe(true);
    expect(s.top[0].unknown).toBe(false);
    expect(s.otherCount).toBe(16);
    expect(s.otherBrands).toBe(3);
  });

  it('handles fewer than 4 brands with no other row', () => {
    const s = deriveBrandStats(tallyOf([[1, 22], [6, 1]]), brands);
    expect(s.top).toHaveLength(2);
    expect(s.otherCount).toBe(0);
    expect(s.otherBrands).toBe(0);
  });

  it('labels an id beyond the sidecar as Other and marks it unknown', () => {
    const s = deriveBrandStats(tallyOf([[200, 7]]), brands);
    expect(s.top[0]).toEqual({ label: 'Other', count: 7, unknown: true });
  });

  it('returns an empty shape for an empty tally', () => {
    const s = deriveBrandStats(tallyOf([]), brands);
    expect(s).toEqual({ total: 0, top: [], otherCount: 0, otherBrands: 0 });
  });

  it('breaks count ties by lower brandId for a stable order', () => {
    const s = deriveBrandStats(tallyOf([[2, 5], [1, 5], [3, 5], [4, 5], [5, 5]]), brands);
    expect(s.top.map((t) => t.label)).toEqual(['Flock Safety', 'Motorola Solutions', 'Genetec', 'Leonardo']);
    expect(s.otherBrands).toBe(1);
  });
});

describe('brandStatsEqual', () => {
  const brands = ['unknown', 'Flock Safety', 'Motorola Solutions'];

  function tallyOf(pairs: Array<[number, number]>): { total: number; counts: Uint32Array } {
    const counts = new Uint32Array(256);
    let total = 0;
    for (const [id, c] of pairs) { counts[id] = c; total += c; }
    return { total, counts };
  }

  it('treats two independently derived identical stats as equal', () => {
    const a = deriveBrandStats(tallyOf([[1, 985], [0, 409], [2, 289]]), brands);
    const b = deriveBrandStats(tallyOf([[1, 985], [0, 409], [2, 289]]), brands);
    expect(a).not.toBe(b); // fresh objects
    expect(brandStatsEqual(a, b)).toBe(true);
  });

  it('detects a count change', () => {
    const a = deriveBrandStats(tallyOf([[1, 985], [2, 289]]), brands);
    const b = deriveBrandStats(tallyOf([[1, 984], [2, 289]]), brands);
    expect(brandStatsEqual(a, b)).toBe(false);
  });

  it('detects a ranking change', () => {
    const a = deriveBrandStats(tallyOf([[1, 10], [2, 5]]), brands);
    const b = deriveBrandStats(tallyOf([[1, 5], [2, 10]]), brands);
    expect(brandStatsEqual(a, b)).toBe(false);
  });

  it('detects other-bucket changes and differing top lengths', () => {
    const a = deriveBrandStats(tallyOf([[1, 9], [2, 8], [3, 7], [4, 6], [5, 5]]), brands);
    const b = deriveBrandStats(tallyOf([[1, 9], [2, 8], [3, 7], [4, 6]]), brands);
    expect(brandStatsEqual(a, b)).toBe(false);
    const c = deriveBrandStats(tallyOf([[1, 9]]), brands);
    const d = deriveBrandStats(tallyOf([[1, 9], [2, 1]]), brands);
    expect(brandStatsEqual(c, d)).toBe(false);
  });

  it('handles null on either side', () => {
    const a = deriveBrandStats(tallyOf([[1, 9]]), brands);
    expect(brandStatsEqual(null, null)).toBe(true);
    expect(brandStatsEqual(a, null)).toBe(false);
    expect(brandStatsEqual(null, a)).toBe(false);
    expect(brandStatsEqual(a, a)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fetch orchestration against the tile host

import { vi, beforeEach } from 'vitest';
import { ensureCameraIndex, _resetCameraIndexCacheForTests } from './cameraIndexService';
import { _resetCameraTileJsonCacheForTests } from './cameraTilesService';
import { _resetTilesHostForTests } from '../store/tilesHostStore';
import { fetchByUrl, jsonResponse, callsTo } from '../test/fetchByUrl';

describe('ensureCameraIndex', () => {
  const PRIMARY = 'https://deflock.dontgetflocked.com';
  const BUILD = '63b8af37657d';
  const records = [{ lat: 33.7, lng: -84.4, brand: 1 }];
  const bin = () => makeBin(records);
  const sidecar = sidecarFor(records);
  const tilesOnly = { tiles: [`${PRIMARY}/cameras-us-hourly/{z}/{x}/{y}.mvt`] };

  beforeEach(() => {
    _resetCameraIndexCacheForTests();
    _resetCameraTileJsonCacheForTests();
    _resetTilesHostForTests();
    vi.unstubAllGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('loads the build-pinned index pair named by the camera TileJSON', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse({
        ...tilesOnly,
        index_bin: `${PRIMARY}/cameras-us-hourly-index-${BUILD}.bin`,
        index_json: `${PRIMARY}/cameras-us-hourly-index-${BUILD}.json`,
      })],
      [`index-${BUILD}.bin`, () => new Response(bin(), { status: 200 })],
      [`index-${BUILD}.json`, () => jsonResponse(sidecar)],
    ]);
    const idx = await ensureCameraIndex('us');
    expect(idx?.count).toBe(1);
    expect(callsTo(mock, 'cameras-us-hourly-index.bin')).toHaveLength(0);
    expect(callsTo(mock, 'cameras-us-hourly-index.json')).toHaveLength(0);
  });

  it('falls back to the alias pair, fetched no-cache, when the TileJSON has no companions', async () => {
    const mock = fetchByUrl([
      ['cameras-us-hourly.json', () => jsonResponse(tilesOnly)],
      ['cameras-us-hourly-index.bin', () => new Response(bin(), { status: 200 })],
      ['cameras-us-hourly-index.json', () => jsonResponse(sidecar)],
    ]);
    const idx = await ensureCameraIndex('us');
    expect(idx?.count).toBe(1);
    for (const match of ['cameras-us-hourly-index.bin', 'cameras-us-hourly-index.json']) {
      const [call] = callsTo(mock, match);
      expect(String(call[0])).toBe(`${PRIMARY}/${match}`);
      expect(call[1]).toEqual(expect.objectContaining({ cache: 'no-cache' }));
    }
  });

  it('resolves null when the index is unavailable', async () => {
    fetchByUrl([['cameras-us-hourly.json', () => jsonResponse(tilesOnly)]]);
    expect(await ensureCameraIndex('us')).toBeNull();
  });
});
