import { loadCameraTileJson, type CameraTileCountry } from './cameraTilesService';
import { getTilesHost } from '../store/tilesHostStore';

/**
 * Camera positions index — the counting companion to the tile archives.
 *
 * Rendering stays on tiles; arithmetic ("N cameras in view") moves here.
 * Counting via queryRenderedFeatures deserializes every rendered feature on
 * the main thread (~112k at national zoom, ~280ms per gesture at 6x CPU
 * throttle, measured 2026-07-18); this index answers the same question from
 * typed arrays in well under a millisecond, at any zoom, during the gesture,
 * and independent of which tiles have loaded (no count/tile-load races).
 *
 * File contract (FHIX v1, built hourly alongside the archives):
 *   header: "FHIX" | uint32 version=1 | uint32 count | uint32 reserved
 *   columns: int32[count] lat microdegrees, int32[count] lng microdegrees,
 *            uint8[count] brandId (0 = unknown; names in the JSON sidecar)
 * Little-endian, columnar, sorted by (lat, lng). ~1MB raw for the US.
 */

export interface CameraIndexSidecar {
  version: number;
  count: number;
  build?: string;
  brands: string[];
}

export interface CameraIndex {
  count: number;
  build?: string;
  brands: string[];
  latMicro: Int32Array;
  lngMicro: Int32Array;
  brandIds: Uint8Array;
  /** 0.5-degree grid, CSR layout over occupied cells only. */
  cellKeys: Int32Array;
  cellStarts: Uint32Array;
  order: Uint32Array;
}

/** Unversioned aliases on the active tile host (latest hourly build). The
 *  primary host's camera TileJSON also names build-pinned copies, which
 *  ensureCameraIndex prefers so bin and sidecar always come from one build. */
export const cameraIndexBinUrl = (country: CameraTileCountry) =>
  `${getTilesHost()}/cameras-${country}-hourly-index.bin`;
export const cameraIndexSidecarUrl = (country: CameraTileCountry) =>
  `${getTilesHost()}/cameras-${country}-hourly-index.json`;

/** Grid cell edge in degrees — matches cameraStore's spatial grid. */
const CELL_DEG = 0.5;
const CELLS_X = Math.round(360 / CELL_DEG); // 720
const CELLS_Y = Math.round(180 / CELL_DEG); // 360
const CELL_MICRO = CELL_DEG * 1e6;

const HEADER_BYTES = 16;
const MAGIC = 0x58494846; // "FHIX" little-endian

function cellOf(latMicro: number, lngMicro: number): number {
  let cy = Math.floor((latMicro + 90_000_000) / CELL_MICRO);
  let cx = Math.floor((lngMicro + 180_000_000) / CELL_MICRO);
  // +90.0 / +180.0 exactly land one past the last cell — fold back in
  if (cy >= CELLS_Y) cy = CELLS_Y - 1;
  if (cx >= CELLS_X) cx = CELLS_X - 1;
  return cy * CELLS_X + cx;
}

/**
 * Validate an FHIX binary against its sidecar and build the counting grid.
 * Throws on any contract violation — callers treat that as "no index".
 */
export function decodeCameraIndex(bin: ArrayBuffer, sidecar: CameraIndexSidecar): CameraIndex {
  if (bin.byteLength < HEADER_BYTES) throw new Error('camera index: size below header');
  const dv = new DataView(bin);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('camera index: bad magic');
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`camera index: unsupported version ${version}`);
  const n = dv.getUint32(8, true);
  if (n !== sidecar.count) {
    throw new Error(`camera index: count mismatch (bin ${n}, sidecar ${sidecar.count})`);
  }
  const expected = HEADER_BYTES + n * 4 + n * 4 + n;
  if (bin.byteLength !== expected) {
    throw new Error(`camera index: size mismatch (got ${bin.byteLength}, want ${expected})`);
  }
  const latMicro = new Int32Array(bin, HEADER_BYTES, n);
  const lngMicro = new Int32Array(bin, HEADER_BYTES + n * 4, n);
  const brandIds = new Uint8Array(bin, HEADER_BYTES + n * 8, n);

  // Single validation pass + per-cell tally (counting sort, no JS objects)
  const cellCounts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const lat = latMicro[i];
    const lng = lngMicro[i];
    if (lat < -90_000_000 || lat > 90_000_000 || lng < -180_000_000 || lng > 180_000_000) {
      throw new Error(`camera index: coordinate out of range at record ${i}`);
    }
    const c = cellOf(lat, lng);
    cellCounts.set(c, (cellCounts.get(c) ?? 0) + 1);
  }

  // CSR over occupied cells, keys sorted for binary search
  const cellKeys = Int32Array.from([...cellCounts.keys()].sort((a, b) => a - b));
  const cellStarts = new Uint32Array(cellKeys.length + 1);
  const keyToSlot = new Map<number, number>();
  for (let s = 0; s < cellKeys.length; s++) {
    keyToSlot.set(cellKeys[s], s);
    cellStarts[s + 1] = cellStarts[s] + (cellCounts.get(cellKeys[s]) ?? 0);
  }
  const order = new Uint32Array(n);
  const fill = Uint32Array.from(cellStarts.subarray(0, cellKeys.length));
  for (let i = 0; i < n; i++) {
    const slot = keyToSlot.get(cellOf(latMicro[i], lngMicro[i]))!;
    order[fill[slot]++] = i;
  }

  return {
    count: n,
    build: sidecar.build,
    brands: sidecar.brands,
    latMicro,
    lngMicro,
    brandIds,
    cellKeys,
    cellStarts,
    order,
  };
}

function lowerBound(arr: Int32Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Count cameras in one non-wrapping lat/lng range (microdegrees). */
function countRange(
  idx: CameraIndex,
  southM: number,
  northM: number,
  westM: number,
  eastM: number
): number {
  const y0 = Math.max(0, Math.floor((southM + 90_000_000) / CELL_MICRO));
  const y1 = Math.min(CELLS_Y - 1, Math.floor((northM + 90_000_000) / CELL_MICRO));
  const x0 = Math.max(0, Math.floor((westM + 180_000_000) / CELL_MICRO));
  const x1 = Math.min(CELLS_X - 1, Math.floor((eastM + 180_000_000) / CELL_MICRO));
  const { cellKeys, cellStarts, order, latMicro, lngMicro } = idx;

  let total = 0;
  for (let y = y0; y <= y1; y++) {
    const rowInteriorLat =
      y * CELL_MICRO - 90_000_000 >= southM && (y + 1) * CELL_MICRO - 90_000_000 <= northM;
    // Occupied cells of this row within [x0, x1] sit contiguously in cellKeys
    const from = lowerBound(cellKeys, y * CELLS_X + x0);
    const to = lowerBound(cellKeys, y * CELLS_X + x1 + 1);
    for (let s = from; s < to; s++) {
      const x = cellKeys[s] - y * CELLS_X;
      const interior =
        rowInteriorLat &&
        x * CELL_MICRO - 180_000_000 >= westM &&
        (x + 1) * CELL_MICRO - 180_000_000 <= eastM;
      if (interior) {
        total += cellStarts[s + 1] - cellStarts[s];
        continue;
      }
      for (let k = cellStarts[s]; k < cellStarts[s + 1]; k++) {
        const i = order[k];
        const lat = latMicro[i];
        const lng = lngMicro[i];
        if (lat >= southM && lat <= northM && lng >= westM && lng <= eastM) total++;
      }
    }
  }
  return total;
}

/**
 * Exact camera count for a viewport. Accepts raw maplibre getBounds() output:
 * lat is clamped, lng may exceed [-180, 180] or wrap the antimeridian.
 */
export function countInBounds(
  idx: CameraIndex,
  bounds: { north: number; south: number; east: number; west: number }
): number {
  const southM = Math.round(Math.max(-90, bounds.south) * 1e6);
  const northM = Math.round(Math.min(90, bounds.north) * 1e6);
  if (northM < southM) return 0;

  // east < west is a raw antimeridian wrap (e.g. west=175, east=-175)
  let span = bounds.east - bounds.west;
  if (span < 0) span += 360;
  if (span >= 360) {
    return countRange(idx, southM, northM, -180_000_000, 180_000_000);
  }
  // Normalize the west edge into [-180, 180), keep the span
  const w = ((bounds.west + 180) % 360 + 360) % 360 - 180;
  const e = w + span;
  const westM = Math.round(w * 1e6);
  const eastM = Math.round(e * 1e6);
  if (eastM <= 180_000_000) {
    return countRange(idx, southM, northM, westM, eastM);
  }
  return (
    countRange(idx, southM, northM, westM, 180_000_000) +
    countRange(idx, southM, northM, -180_000_000, eastM - 360_000_000)
  );
}

export interface BrandTally {
  total: number;
  /** Count per brandId (index = brandId, 0 = unknown). Length 256. */
  counts: Uint32Array;
}

/** Like countRange, but tallies brandIds. Interior cells skip the bounds
 *  comparisons but still iterate members to read each brandId. */
function tallyRange(
  idx: CameraIndex,
  southM: number,
  northM: number,
  westM: number,
  eastM: number,
  counts: Uint32Array
): number {
  const y0 = Math.max(0, Math.floor((southM + 90_000_000) / CELL_MICRO));
  const y1 = Math.min(CELLS_Y - 1, Math.floor((northM + 90_000_000) / CELL_MICRO));
  const x0 = Math.max(0, Math.floor((westM + 180_000_000) / CELL_MICRO));
  const x1 = Math.min(CELLS_X - 1, Math.floor((eastM + 180_000_000) / CELL_MICRO));
  const { cellKeys, cellStarts, order, latMicro, lngMicro, brandIds } = idx;

  let total = 0;
  for (let y = y0; y <= y1; y++) {
    const rowInteriorLat =
      y * CELL_MICRO - 90_000_000 >= southM && (y + 1) * CELL_MICRO - 90_000_000 <= northM;
    const from = lowerBound(cellKeys, y * CELLS_X + x0);
    const to = lowerBound(cellKeys, y * CELLS_X + x1 + 1);
    for (let s = from; s < to; s++) {
      const x = cellKeys[s] - y * CELLS_X;
      const interior =
        rowInteriorLat &&
        x * CELL_MICRO - 180_000_000 >= westM &&
        (x + 1) * CELL_MICRO - 180_000_000 <= eastM;
      if (interior) {
        for (let k = cellStarts[s]; k < cellStarts[s + 1]; k++) counts[brandIds[order[k]]]++;
        total += cellStarts[s + 1] - cellStarts[s];
        continue;
      }
      for (let k = cellStarts[s]; k < cellStarts[s + 1]; k++) {
        const i = order[k];
        const lat = latMicro[i];
        const lng = lngMicro[i];
        if (lat >= southM && lat <= northM && lng >= westM && lng <= eastM) {
          counts[brandIds[i]]++;
          total++;
        }
      }
    }
  }
  return total;
}

/**
 * Per-brand viewport tally. Bounds semantics are identical to countInBounds
 * (lat clamped, lng may exceed [-180, 180] or wrap the antimeridian), and
 * `total` always equals countInBounds for the same bounds.
 */
export function tallyInBounds(
  idx: CameraIndex,
  bounds: { north: number; south: number; east: number; west: number }
): BrandTally {
  const counts = new Uint32Array(256);
  const southM = Math.round(Math.max(-90, bounds.south) * 1e6);
  const northM = Math.round(Math.min(90, bounds.north) * 1e6);
  if (northM < southM) return { total: 0, counts };

  let span = bounds.east - bounds.west;
  if (span < 0) span += 360;
  if (span >= 360) {
    return {
      total: tallyRange(idx, southM, northM, -180_000_000, 180_000_000, counts),
      counts,
    };
  }
  const w = ((bounds.west + 180) % 360 + 360) % 360 - 180;
  const e = w + span;
  const westM = Math.round(w * 1e6);
  const eastM = Math.round(e * 1e6);
  if (eastM <= 180_000_000) {
    return { total: tallyRange(idx, southM, northM, westM, eastM, counts), counts };
  }
  const total =
    tallyRange(idx, southM, northM, westM, 180_000_000, counts) +
    tallyRange(idx, southM, northM, -180_000_000, eastM - 360_000_000, counts);
  return { total, counts };
}

export interface TileViewBrandStats {
  total: number;
  /** Top 4 by count. Ties break by lower brandId. */
  top: { label: string; count: number; unknown: boolean }[];
  otherCount: number;
  otherBrands: number;
}

/**
 * Fold a raw tally into the compact object the UI renders: top 4 brands plus
 * an aggregate for the rest. brandId 0 displays as "Unknown"; ids beyond the
 * sidecar's brands array display as "Other". Both carry unknown: true so the
 * UI renders them gray in any rank slot.
 */
export function deriveBrandStats(tally: BrandTally, brands: string[]): TileViewBrandStats {
  const entries: { id: number; count: number }[] = [];
  for (let id = 0; id < 256; id++) {
    const c = tally.counts[id];
    if (c > 0) entries.push({ id, count: c });
  }
  entries.sort((a, b) => b.count - a.count || a.id - b.id);

  const top = entries.slice(0, 4).map((e) => ({
    label: e.id === 0 ? 'Unknown' : e.id < brands.length ? brands[e.id] : 'Other',
    count: e.count,
    unknown: e.id === 0 || e.id >= brands.length,
  }));
  let otherCount = 0;
  for (const e of entries.slice(4)) otherCount += e.count;
  return { total: tally.total, top, otherCount, otherBrands: Math.max(0, entries.length - 4) };
}

/**
 * Value equality for derived brand stats. deriveBrandStats returns a fresh
 * object each call, so store writes must be gated on this — otherwise every
 * map idle event re-renders every subscriber with identical data (the exact
 * per-gesture commit storm the 2026-07-18 drag fix removed).
 */
export function brandStatsEqual(
  a: TileViewBrandStats | null,
  b: TileViewBrandStats | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.total !== b.total ||
    a.otherCount !== b.otherCount ||
    a.otherBrands !== b.otherBrands ||
    a.top.length !== b.top.length
  ) {
    return false;
  }
  for (let i = 0; i < a.top.length; i++) {
    const x = a.top[i];
    const y = b.top[i];
    if (x.count !== y.count || x.label !== y.label || x.unknown !== y.unknown) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Fetch orchestration — one background attempt per country per session.

const _cache = new Map<CameraTileCountry, CameraIndex | null | Promise<CameraIndex | null>>();

/**
 * Fetch + decode the index for a country. Resolves null on any failure
 * (missing artifact, network, contract violation) — callers fall back to
 * the query-based count. Never throws. Cached per session.
 */
export function ensureCameraIndex(country: CameraTileCountry): Promise<CameraIndex | null> {
  const hit = _cache.get(country);
  if (hit !== undefined) return Promise.resolve(hit);
  const p = (async (): Promise<CameraIndex | null> => {
    try {
      // Build-pinned pair from the camera TileJSON when the host publishes one
      // (immutable, coherent). Otherwise the hourly aliases, fetched no-cache so
      // bin and sidecar revalidate together rather than skewing across builds.
      // Aliases are resolved only after the TileJSON lookup settles — that
      // lookup is what fails the app over to the backup host.
      const tileJson = await loadCameraTileJson(country);
      const pinned = tileJson?.index_bin && tileJson?.index_json
        ? { bin: tileJson.index_bin, sidecar: tileJson.index_json, init: undefined }
        : {
            bin: cameraIndexBinUrl(country),
            sidecar: cameraIndexSidecarUrl(country),
            init: { cache: 'no-cache' as const },
          };
      const [binRes, sideRes] = await Promise.all([
        fetch(pinned.bin, pinned.init),
        fetch(pinned.sidecar, pinned.init),
      ]);
      if (!binRes.ok || !sideRes.ok) return null;
      const [bin, sidecar] = await Promise.all([
        binRes.arrayBuffer(),
        sideRes.json() as Promise<CameraIndexSidecar>,
      ]);
      const idx = decodeCameraIndex(bin, sidecar);
      _cache.set(country, idx);
      if (import.meta.env.DEV) console.log(`[camera-index] loaded ${country}: ${idx.count} cameras`);
      return idx;
    } catch (err) {
      if (import.meta.env.DEV) console.warn(`[camera-index] ${country} failed:`, err);
      _cache.set(country, null);
      return null;
    }
  })();
  _cache.set(country, p);
  return p;
}

/** Synchronous accessor — the index if it has finished loading, else null. */
export function getCameraIndex(country: CameraTileCountry): CameraIndex | null {
  const hit = _cache.get(country);
  return hit instanceof Promise || hit === undefined ? null : hit;
}

/** Test hook. */
export function _resetCameraIndexCacheForTests(): void {
  _cache.clear();
}
