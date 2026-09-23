# Flock Leak Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `leak` app mode that shows the leaked Flock device inventory (December 2025 snapshot) on the existing map, with Flock / Swipe / Overlay views against the OSM camera layer, user-driven type and status filters, a device popup, and provenance copy everywhere, on one map with one basemap.

**Architecture:** A new vector-tile source (`flock-leak-tiles`) renders through two MapLibre layers (dots below z10, runtime-generated icons from z9). The Swipe view never adds a second map: an imperative hook subscribes to a divider value in a Zustand store and applies `['within', rectangle]` filters to the OSM and Flock point layers at most 20 times a second, with the map locked north-up so the divider is a line of constant longitude. Everything else follows the patterns the Network tab established: a mode in `appModeStore`, a path in `urlState`, a desktop panel, a drawer peek, map-corner controls in the existing CSS slots.

**Tech Stack:** React 18, TypeScript, Zustand 5, MapLibre GL 5.15 (`within` expression, `styleimagemissing`), react-map-gl 8 (`Source`, `Layer`, `Popup`, `useMap`), Tailwind, vitest with `@maplibre/maplibre-gl-style-spec` `createExpression` for expression parity tests, Playwright for browser checks.

**Spec:** `docs/superpowers/specs/2026-09-23-flock-leak-tab-design.md`. This plan follows it with two implementation choices called out where they land: icons are pre-colored raster images registered at runtime rather than SDF (section 4, same outcome, fewer moving parts), and a Flock TileJSON failure never fails the whole app over to the backup host (section 12 refined: a missing file must not degrade the Map tab; the pill and retry own it).

**Prerequisite:** the Analysis removal plan (`docs/superpowers/plans/2026-09-23-analysis-tab-removal.md`) is merged. `AppMode` is `'map' | 'route' | 'explore' | 'network'` when this plan starts.

## Global Constraints

- One WebGL map. No second `<Map>`; no `maplibre-gl-compare`.
- Gesture path: the swipe drag writes only `divider` to the store (equality-gated); layer filter updates are rAF-coalesced and capped at 20 per second; counts run on idle only; the popup hint runs on click only.
- Tile contract (spec section 2): TileJSON at `<TILES_HOST>/flock-leak.json`, source layer `devices`, minzoom 0, maxzoom 14, `type` and `status` at every zoom, optional `stats.total`, `stats.byType`, `stats.byStatus`, `snapshot`, `source_url`.
- Copy is exactly the strings in spec section 9. No em dashes anywhere in user-facing strings.
- Mobile peek stays at `UNIFORM_PEEK_HEIGHT` (180). The peek carries the identity row and the view switch only.
- US only: `leak` is in `US_ONLY_MODES`.
- Every commit passes `npx tsc -b --noEmit && npm run lint && npm test`. Commit only the files each task names; do not switch branches.
- The spike in Task 1 gates Tasks 8 onward. If it fails, stop and report; do not build the two-map fallback without a decision.

## Review Focus

1. A device whose `type` is missing or an unexpected string must still render (as `other`) and still be counted; it must never vanish from the map. Pinned in Task 2 (normalizer and expression parity tests) and Task 6 (`flockLayerFilter` keeps `unknown` status visible).
2. Dragging the divider to either edge must hide that side completely with no stray marks and must restore both sides when the view leaves Swipe, without the hook ever writing layer visibility (react-map-gl owns it). Pinned in Task 5 (`planSwipe` edge tests, `NEVER_MATCH`) and Task 9 (hook restores filters only).
3. Leaving the Leak tab must re-enable map rotation and cone rendering on the Map tab. Pinned in Task 8 (effect cleanup) and checked in Task 12's browser script.
4. A 404 on `flock-leak.json` on the primary host must show the Flock pill and leave the Map tab and host selection untouched. Pinned in Task 3 (no failover on error) and Task 4 (source-level error is `fail`).
5. A tap on a Flock mark while OSM is hidden (Flock view) must not claim "Nothing on OSM within 50 m". Pinned in Task 5 (`flockNearbyHint` with `osmVisible: false` returns null).

---

### Task 1: Spike the single-map swipe on a throttled browser

**Files:**
- Modify: `src/components/map/MapLibreContainer.tsx:917-930` (inside `onLoad`, DEV-only hook)
- Create: `.superpowers/swipe-spike.mjs` (gitignored)

**Interfaces:**
- Consumes: nothing.
- Produces: a DEV-only `window.__deflockMap` handle (used by harness scripts only) and a pass/fail number for spec section 15.

- [ ] **Step 1: Expose the map instance in dev builds**

In `src/components/map/MapLibreContainer.tsx`, inside `onLoad`, right after `const map = mapRef.current.getMap();`, add:

```ts
      // Dev-only handle for the .superpowers harness scripts (perf spikes,
      // swipe checks). Never set in production builds.
      if (import.meta.env.DEV) {
        (window as unknown as { __deflockMap?: maplibregl.Map }).__deflockMap = map;
      }
```

- [ ] **Step 2: Write the spike script**

Create `.superpowers/swipe-spike.mjs`:

```js
// Swipe spike: applies a `within` half-plane filter to the OSM camera tile
// layers 20 times a second while sweeping the divider across the viewport,
// under CPU throttling, and reports frame timing. Proxy for a phone before
// any UI exists. Usage: node .superpowers/swipe-spike.mjs [cpuThrottle=4]
import { chromium } from 'playwright';

const APP = process.env.APP || 'http://localhost:3000';
const CPU = Number(process.argv[2] ?? 4);
const URL = `${APP}/?lat=29.7604&lng=-95.3698&zoom=12`;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const cdp = await page.context().newCDPSession(page);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__deflockMap && window.__deflockMap.loaded(), null, { timeout: 60000 });
await page.waitForTimeout(6000); // let camera tiles settle

const result = await page.evaluate(async () => {
  const map = window.__deflockMap;
  const layers = ['camera-tile-glow', 'camera-tile-dots', 'camera-tile-points'].filter((id) => map.getLayer(id));
  const rect = (lon) => ({ type: 'Polygon', coordinates: [[[-180, -85], [lon, -85], [lon, 85], [-180, 85], [-180, -85]]] });
  const frames = [];
  const longtasks = [];
  const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) longtasks.push(Math.round(e.duration)); });
  obs.observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  let on = true;
  const tick = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const steps = 80; // 4 s at 20 Hz, two full sweeps
  for (let i = 0; i < steps; i++) {
    const frac = 0.5 + 0.45 * Math.sin((i / steps) * Math.PI * 4);
    const lon = map.unproject([w * frac, h / 2]).lng;
    for (const id of layers) map.setFilter(id, ['within', rect(lon)], { validate: false });
    await new Promise((r) => setTimeout(r, 50));
  }
  on = false;
  obs.disconnect();
  for (const id of layers) map.setFilter(id, null, { validate: false });

  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    layers,
    frames: frames.length,
    p50: pct(50).toFixed(1),
    p95: pct(95).toFixed(1),
    worst: Math.max(...frames).toFixed(1),
    framesOver32ms: frames.filter((f) => f > 32).length,
    longtasks: longtasks.length,
    longtaskMaxMs: longtasks.length ? Math.max(...longtasks) : 0,
  };
});

console.log(JSON.stringify({ cpuThrottle: CPU, ...result }, null, 2));
await browser.close();
```

- [ ] **Step 3: Run it**

Terminal 1: `npm run dev`. Terminal 2:

Run: `node .superpowers/swipe-spike.mjs 4`
Expected (pass criteria, proxy for spec section 15): `p95` at or below 50 ms, `longtaskMaxMs` below 100, `framesOver32ms` below 10% of `frames`. Record the JSON in the PR description. If it fails at 4x, run at 2x and record both; a failure at 2x stops this plan (report, do not build Tasks 8 onward).

- [ ] **Step 4: Commit the dev hook**

```bash
git add src/components/map/MapLibreContainer.tsx
git commit -m "chore: expose the map instance to harness scripts in dev builds"
```

---

### Task 2: Device type and status normalization, in JS and as map expressions

**Files:**
- Create: `src/lib/flockTypeNormalization.ts`
- Test: `src/lib/flockTypeNormalization.test.ts`

**Interfaces:**
- Produces:
  - `type FlockDeviceType = 'alpr' | 'condor' | 'raven' | 'drone' | 'other'`
  - `type FlockDeviceStatus = 'active' | 'planned' | 'decommissioned' | 'unknown'`
  - `FLOCK_TYPES`, `FLOCK_SELECTABLE_TYPES` (`alpr | condor | raven | drone`), `FLOCK_SELECTABLE_STATUSES` (`active | planned | decommissioned`)
  - `FLOCK_TYPE_LABEL`, `FLOCK_TYPE_LONG_LABEL`, `FLOCK_STATUS_LABEL`
  - `normalizeFlockType(raw: unknown): FlockDeviceType`, `normalizeFlockStatus(raw: unknown): FlockDeviceStatus`
  - `flockTypeExpression(): ExpressionSpecification`, `flockStatusExpression(): ExpressionSpecification` (evaluate to the same canonical strings inside MapLibre)
  - `canonicalTypeCounts(byType?: Record<string, number>): Record<FlockDeviceType, number>`, `canonicalStatusCounts(byStatus?: Record<string, number>): Record<FlockDeviceStatus, number>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/flockTypeNormalization.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import {
  normalizeFlockType,
  normalizeFlockStatus,
  flockTypeExpression,
  flockStatusExpression,
  canonicalTypeCounts,
  canonicalStatusCounts,
  FLOCK_TYPES,
} from './flockTypeNormalization';

/** Evaluate a style expression against a point feature with these properties. */
function evaluate(expr: unknown, properties: Record<string, unknown>): unknown {
  const parsed = createExpression(expr as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 10 }, { type: 1, properties, geometry: null } as never);
}

describe('normalizeFlockType', () => {
  it('maps Flock product names to canonical types', () => {
    expect(normalizeFlockType('Falcon')).toBe('alpr');
    expect(normalizeFlockType('Falcon LPR')).toBe('alpr');
    expect(normalizeFlockType('Sparrow')).toBe('alpr');
    expect(normalizeFlockType('Condor PTZ')).toBe('condor');
    expect(normalizeFlockType('Raven Audio')).toBe('raven');
    expect(normalizeFlockType('Drone Dock')).toBe('drone');
    expect(normalizeFlockType('Aerodome')).toBe('drone');
  });

  it('is case-insensitive', () => {
    expect(normalizeFlockType('FALCON')).toBe('alpr');
    expect(normalizeFlockType('condor')).toBe('condor');
  });

  it('never drops a device: unknown, empty, and missing become other', () => {
    expect(normalizeFlockType('Widget 9000')).toBe('other');
    expect(normalizeFlockType('')).toBe('other');
    expect(normalizeFlockType(undefined)).toBe('other');
    expect(normalizeFlockType(null)).toBe('other');
    expect(normalizeFlockType(42)).toBe('other');
  });
});

describe('normalizeFlockStatus', () => {
  it('maps status labels', () => {
    expect(normalizeFlockStatus('Active')).toBe('active');
    expect(normalizeFlockStatus('Online')).toBe('active');
    expect(normalizeFlockStatus('Planned')).toBe('planned');
    expect(normalizeFlockStatus('Pending Install')).toBe('planned');
    expect(normalizeFlockStatus('Decommissioned')).toBe('decommissioned');
    expect(normalizeFlockStatus('Removed')).toBe('decommissioned');
  });

  it('treats inactive as decommissioned, not active', () => {
    expect(normalizeFlockStatus('Inactive')).toBe('decommissioned');
  });

  it('falls back to unknown', () => {
    expect(normalizeFlockStatus('')).toBe('unknown');
    expect(normalizeFlockStatus(undefined)).toBe('unknown');
    expect(normalizeFlockStatus('???')).toBe('unknown');
  });
});

describe('map expressions agree with the JS normalizers', () => {
  const rawTypes = ['Falcon', 'Falcon LPR', 'Sparrow', 'Condor PTZ', 'Raven Audio', 'Drone Dock', 'Widget', '', 'INACTIVE'];
  it.each(rawTypes)('type %s', (raw) => {
    expect(evaluate(flockTypeExpression(), { type: raw })).toBe(normalizeFlockType(raw));
  });

  it('type expression handles a missing property', () => {
    expect(evaluate(flockTypeExpression(), {})).toBe('other');
  });

  const rawStatuses = ['Active', 'Online', 'Planned', 'Pending Install', 'Decommissioned', 'Removed', 'Inactive', '', 'zzz'];
  it.each(rawStatuses)('status %s', (raw) => {
    expect(evaluate(flockStatusExpression(), { status: raw })).toBe(normalizeFlockStatus(raw));
  });

  it('status expression handles a missing property', () => {
    expect(evaluate(flockStatusExpression(), {})).toBe('unknown');
  });
});

describe('canonical counts', () => {
  it('sums raw labels into canonical buckets and zero-fills', () => {
    const counts = canonicalTypeCounts({ Falcon: 10, 'Falcon LPR': 5, Condor: 2, Mystery: 1 });
    expect(counts).toEqual({ alpr: 15, condor: 2, raven: 0, drone: 0, other: 1 });
    for (const t of FLOCK_TYPES) expect(typeof counts[t]).toBe('number');
  });

  it('returns zeros when stats are absent', () => {
    expect(canonicalTypeCounts(undefined)).toEqual({ alpr: 0, condor: 0, raven: 0, drone: 0, other: 0 });
    expect(canonicalStatusCounts(undefined)).toEqual({ active: 0, planned: 0, decommissioned: 0, unknown: 0 });
  });

  it('sums statuses', () => {
    expect(canonicalStatusCounts({ Active: 3, Inactive: 1, Planned: 2 })).toEqual({
      active: 3, planned: 2, decommissioned: 1, unknown: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/flockTypeNormalization.test.ts`
Expected: FAIL, "Cannot find module './flockTypeNormalization'".

- [ ] **Step 3: Implement the module**

Create `src/lib/flockTypeNormalization.ts`:

```ts
import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Canonical device types and statuses for the leaked Flock inventory.
 *
 * The tiles carry Flock's own labels. The same ordered keyword table drives
 * the JS normalizer (popups, counts) and the MapLibre expressions (layer
 * filters, icon selection), so the two can never disagree. Extend the
 * keyword lists from the real vocabulary once the first tile build exists;
 * anything unmatched renders as `other` / `unknown`, never disappears.
 */
export type FlockDeviceType = 'alpr' | 'condor' | 'raven' | 'drone' | 'other';
export type FlockDeviceStatus = 'active' | 'planned' | 'decommissioned' | 'unknown';

export const FLOCK_TYPES: readonly FlockDeviceType[] = ['alpr', 'condor', 'raven', 'drone', 'other'];
export const FLOCK_SELECTABLE_TYPES: readonly FlockDeviceType[] = ['alpr', 'condor', 'raven', 'drone'];
export const FLOCK_STATUSES: readonly FlockDeviceStatus[] = ['active', 'planned', 'decommissioned', 'unknown'];
export const FLOCK_SELECTABLE_STATUSES: readonly FlockDeviceStatus[] = ['active', 'planned', 'decommissioned'];

export const FLOCK_TYPE_LABEL: Record<FlockDeviceType, string> = {
  alpr: 'ALPR',
  condor: 'Condor',
  raven: 'Raven',
  drone: 'Drone',
  other: 'Other',
};

export const FLOCK_TYPE_LONG_LABEL: Record<FlockDeviceType, string> = {
  alpr: 'License plate reader',
  condor: 'PTZ video camera',
  raven: 'Audio detection',
  drone: 'Drone dock',
  other: 'Other device',
};

export const FLOCK_STATUS_LABEL: Record<FlockDeviceStatus, string> = {
  active: 'Active',
  planned: 'Planned',
  decommissioned: 'Decommissioned',
  unknown: 'Status unknown',
};

type Rules<T extends string> = ReadonlyArray<readonly [T, readonly string[]]>;

/** Ordered: first match wins. `drone` before `alpr` so "Falcon drone dock"
 *  is a dock; `decommissioned` before `active` so "inactive" is not active. */
export const FLOCK_TYPE_RULES: Rules<FlockDeviceType> = [
  ['drone', ['drone', 'dock', 'aerodome']],
  ['raven', ['raven', 'audio', 'gunshot']],
  ['condor', ['condor', 'ptz', 'video']],
  ['alpr', ['falcon', 'sparrow', 'lpr', 'plate', 'alpr']],
];

export const FLOCK_STATUS_RULES: Rules<FlockDeviceStatus> = [
  ['decommissioned', ['decom', 'remov', 'retire', 'inactive', 'offline']],
  ['planned', ['plan', 'pending', 'propos', 'schedul']],
  ['active', ['active', 'live', 'online', 'installed', 'deployed']],
];

function matchRules<T extends string>(raw: unknown, rules: Rules<T>, fallback: T): T {
  const lower = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!lower) return fallback;
  for (const [canonical, keywords] of rules) {
    if (keywords.some((k) => lower.includes(k))) return canonical;
  }
  return fallback;
}

export const normalizeFlockType = (raw: unknown): FlockDeviceType =>
  matchRules(raw, FLOCK_TYPE_RULES, 'other');

export const normalizeFlockStatus = (raw: unknown): FlockDeviceStatus =>
  matchRules(raw, FLOCK_STATUS_RULES, 'unknown');

/** Same table as a MapLibre expression: `['case', anyKeywordOf(rule) , canonical, ..., fallback]`. */
function rulesExpression<T extends string>(property: string, rules: Rules<T>, fallback: T): ExpressionSpecification {
  const lower = ['downcase', ['to-string', ['coalesce', ['get', property], '']]];
  const branches: unknown[] = [];
  for (const [canonical, keywords] of rules) {
    branches.push(['any', ...keywords.map((k) => ['in', k, lower])], canonical);
  }
  return ['case', ...branches, fallback] as unknown as ExpressionSpecification;
}

export const flockTypeExpression = (): ExpressionSpecification =>
  rulesExpression('type', FLOCK_TYPE_RULES, 'other');

export const flockStatusExpression = (): ExpressionSpecification =>
  rulesExpression('status', FLOCK_STATUS_RULES, 'unknown');

function sumInto<T extends string>(
  keys: readonly T[],
  raw: Record<string, number> | undefined,
  normalize: (v: string) => T
): Record<T, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
  if (!raw) return out;
  for (const [label, n] of Object.entries(raw)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    out[normalize(label)] += n;
  }
  return out;
}

/** Sum TileJSON `stats.byType` (raw labels) into canonical buckets. */
export const canonicalTypeCounts = (byType?: Record<string, number>): Record<FlockDeviceType, number> =>
  sumInto(FLOCK_TYPES, byType, normalizeFlockType);

export const canonicalStatusCounts = (byStatus?: Record<string, number>): Record<FlockDeviceStatus, number> =>
  sumInto(FLOCK_STATUSES, byStatus, normalizeFlockStatus);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/flockTypeNormalization.test.ts`
Expected: PASS. If `createExpression` is reported missing, import it as `import { expression } from '@maplibre/maplibre-gl-style-spec'` and call `expression.createExpression` (both exports exist in the installed version; verified 2026-09-23).

- [ ] **Step 5: Commit**

```bash
git add src/lib/flockTypeNormalization.ts src/lib/flockTypeNormalization.test.ts
git commit -m "feat(leak): canonical Flock device types and statuses, in JS and as map expressions"
```

---

### Task 3: Flock TileJSON service

**Files:**
- Create: `src/services/flockLeakTilesService.ts`
- Test: `src/services/flockLeakTilesService.test.ts`

**Interfaces:**
- Consumes: `getTilesHost` from `src/store/tilesHostStore.ts`.
- Produces:
  - `FLOCK_LEAK_SOURCE_ID = 'flock-leak-tiles'`, `FLOCK_LEAK_SOURCE_LAYER = 'devices'`, `FLOCK_LEAK_MAXZOOM = 14`, `FLOCK_LEAK_POINTS_MINZOOM = 9`
  - `FLOCK_LEAK_SNAPSHOT_LABEL = 'Dec 2025'`, `FLOCK_LEAK_STORY_URL = 'https://flocksurveillance.org'`
  - `flockLeakTileJsonUrl(): string`
  - `interface FlockLeakStats { total: number; byType?: Record<string, number>; byStatus?: Record<string, number> }`
  - `interface FlockLeakTileJson { tiles: string[]; snapshot?: string; source_url?: string; stats?: FlockLeakStats }`
  - `loadFlockLeakTileJson(): Promise<FlockLeakTileJson | null>` (never throws, never fails over)
  - `_resetFlockLeakTileJsonCacheForTests()`

- [ ] **Step 1: Write the failing tests**

Create `src/services/flockLeakTilesService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/flockLeakTilesService.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the service**

Create `src/services/flockLeakTilesService.ts`:

```ts
import { getTilesHost } from '../store/tilesHostStore';

/**
 * The leaked Flock device inventory tileset (December 2025 snapshot). Same
 * hosts and TileJSON addressing as the camera tiles. Contract in
 * docs/superpowers/specs/2026-09-23-flock-leak-tab-design.md section 2.
 */
export const FLOCK_LEAK_SOURCE_ID = 'flock-leak-tiles';
export const FLOCK_LEAK_SOURCE_LAYER = 'devices';
export const FLOCK_LEAK_MAXZOOM = 14;
/** Icons take over from the density dots here (dots run to maxzoom 10). */
export const FLOCK_LEAK_POINTS_MINZOOM = 9;
export const FLOCK_LEAK_SNAPSHOT_LABEL = 'Dec 2025';
export const FLOCK_LEAK_STORY_URL = 'https://flocksurveillance.org';

export const flockLeakTileJsonUrl = (): string => `${getTilesHost()}/flock-leak.json`;

export interface FlockLeakStats {
  total: number;
  byType?: Record<string, number>;
  byStatus?: Record<string, number>;
}

export interface FlockLeakTileJson {
  tiles: string[];
  snapshot?: string;
  source_url?: string;
  stats?: FlockLeakStats;
}

const _cache = new Map<string, Promise<FlockLeakTileJson | null>>();

function parseStats(raw: unknown): FlockLeakStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.total !== 'number' || !Number.isFinite(r.total)) return undefined;
  const counts = (v: unknown): Record<string, number> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, number>) : undefined;
  return { total: r.total, byType: counts(r.byType), byStatus: counts(r.byStatus) };
}

/**
 * Fetch the Flock TileJSON from the active host. Resolves null when missing
 * or unusable. Unlike the camera TileJSON this NEVER fails the app over: a
 * missing leak file must not degrade the Map tab. The Leak tab shows its own
 * retry pill instead. Successes are cached per host; failures are not.
 */
export function loadFlockLeakTileJson(): Promise<FlockLeakTileJson | null> {
  const url = flockLeakTileJsonUrl();
  const hit = _cache.get(url);
  if (hit) return hit;

  const promise = (async (): Promise<FlockLeakTileJson | null> => {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch {
      console.warn('[flock-leak] tilejson network error');
      return null;
    }
    if (!res.ok) {
      console.warn(`[flock-leak] tilejson HTTP ${res.status}`);
      return null;
    }
    try {
      const data = (await res.json()) as Record<string, unknown> | null;
      if (!data || !Array.isArray(data.tiles)) return null;
      const doc: FlockLeakTileJson = { tiles: data.tiles as string[] };
      if (typeof data.snapshot === 'string') doc.snapshot = data.snapshot;
      if (typeof data.source_url === 'string') doc.source_url = data.source_url;
      const stats = parseStats(data.stats);
      if (stats) doc.stats = stats;
      return doc;
    } catch {
      return null;
    }
  })();

  _cache.set(url, promise);
  void promise.then((doc) => {
    if (!doc) _cache.delete(url);
  });
  return promise;
}

/** Test hook — not for app code. */
export function _resetFlockLeakTileJsonCacheForTests(): void {
  _cache.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/flockLeakTilesService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/flockLeakTilesService.ts src/services/flockLeakTilesService.test.ts
git commit -m "feat(leak): Flock TileJSON loader on the active tile host, no app failover"
```

---

### Task 4: Tile error rule for the Flock source

**Files:**
- Modify: `src/utils/tileErrorPolicy.ts` (append)
- Test: `src/utils/tileErrorPolicy.test.ts` (append)

**Interfaces:**
- Produces: `planLeakTileError(input: { sourceId: string | undefined; tileLevel: boolean; loadSeen: boolean; errorCount: number }): { kind: 'ignore' } | { kind: 'count' } | { kind: 'fail' }`. Reuses `TILE_ERROR_THRESHOLD`.

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/tileErrorPolicy.test.ts` (keep its existing imports; add `planLeakTileError` to the import list from `./tileErrorPolicy`):

```ts
describe('planLeakTileError', () => {
  const base = { sourceId: 'flock-leak-tiles', tileLevel: true, loadSeen: false, errorCount: 0 };

  it('ignores other sources', () => {
    expect(planLeakTileError({ ...base, sourceId: 'camera-tiles' })).toEqual({ kind: 'ignore' });
    expect(planLeakTileError({ ...base, sourceId: undefined })).toEqual({ kind: 'ignore' });
  });

  it('fails immediately on a TileJSON (source-level) error, never fails over', () => {
    expect(planLeakTileError({ ...base, tileLevel: false })).toEqual({ kind: 'fail' });
  });

  it('counts tile errors before the first load and fails on the third', () => {
    expect(planLeakTileError({ ...base, errorCount: 0 })).toEqual({ kind: 'count' });
    expect(planLeakTileError({ ...base, errorCount: 1 })).toEqual({ kind: 'count' });
    expect(planLeakTileError({ ...base, errorCount: 2 })).toEqual({ kind: 'fail' });
  });

  it('ignores tile errors once the source has loaded', () => {
    expect(planLeakTileError({ ...base, loadSeen: true, errorCount: 5 })).toEqual({ kind: 'ignore' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/tileErrorPolicy.test.ts`
Expected: FAIL, `planLeakTileError` is not exported.

- [ ] **Step 3: Implement**

Append to `src/utils/tileErrorPolicy.ts`:

```ts
/** The Flock Leak source (see flockLeakTilesService). Kept as a literal here
 *  so this module stays dependency-free; the service test pins equality. */
export const LEAK_TILE_SOURCE_ID = 'flock-leak-tiles';

export interface LeakTileErrorInput {
  sourceId: string | undefined;
  tileLevel: boolean;
  loadSeen: boolean;
  errorCount: number;
}

export type LeakTileErrorAction = { kind: 'ignore' } | { kind: 'count' } | { kind: 'fail' };

/**
 * The Flock source never participates in host failover: a missing leak file
 * must not degrade the Map tab. A TileJSON failure fails at once; tile-level
 * failures before the first load count to the shared threshold, then fail.
 */
export function planLeakTileError(input: LeakTileErrorInput): LeakTileErrorAction {
  if (input.sourceId !== LEAK_TILE_SOURCE_ID) return IGNORE;
  if (!input.tileLevel) return { kind: 'fail' };
  if (input.loadSeen) return IGNORE;
  if (input.errorCount + 1 < TILE_ERROR_THRESHOLD) return { kind: 'count' };
  return { kind: 'fail' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/utils/tileErrorPolicy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tileErrorPolicy.ts src/utils/tileErrorPolicy.test.ts
git commit -m "feat(leak): tile error rule for the Flock source (fail locally, never fail over)"
```

---

### Task 5: Pure swipe geometry and the nearby-OSM hint

**Files:**
- Create: `src/utils/swipeFilter.ts`, `src/utils/flockNearby.ts`
- Test: `src/utils/swipeFilter.test.ts`, `src/utils/flockNearby.test.ts`

**Interfaces:**
- Consumes: `haversineDistance(lat1, lon1, lat2, lon2)` from `src/utils/geo.ts`; `FlockDeviceType` from Task 2.
- Produces (swipeFilter):
  - `SWIPE_EDGE = 0.005`
  - `clampDivider(v: number): number`
  - `halfPlaneRect(side: 'osm' | 'flock', dividerLon: number): GeoJSON.Polygon`
  - `withinFilter(side, dividerLon): FilterSpecification`
  - `combineFilters(...filters: Array<FilterSpecification | undefined>): FilterSpecification | undefined`
  - `NEVER_MATCH: FilterSpecification` (a filter no feature passes; hides a side without touching layer visibility)
  - `interface SwipeLayerState { filter: FilterSpecification | undefined }`, `interface SwipePlan { osm: SwipeLayerState; flock: SwipeLayerState }`
  - `planSwipe(divider: number, dividerLon: number, base?: { osm?: FilterSpecification; flock?: FilterSpecification }): SwipePlan`
  - `interface DividerMapLike { getContainer(): { clientWidth: number; clientHeight: number }; unproject(p: [number, number]): { lng: number } }`, `dividerLongitude(map: DividerMapLike, divider: number): number`
- Produces (flockNearby):
  - `NEARBY_QUERY_PX = 20`, `NEARBY_MAX_METERS = 50`, `NEARBY_MIN_ZOOM = 10`
  - `nearestDistanceMeters(origin: { lon: number; lat: number }, points: Array<{ lon: number; lat: number }>): number | null`
  - `flockNearbyHint(input: { zoom: number; type: FlockDeviceType; nearestMeters: number | null; osmVisible: boolean }): string | null`

- [ ] **Step 1: Write the failing swipe tests**

Create `src/utils/swipeFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  clampDivider,
  halfPlaneRect,
  withinFilter,
  combineFilters,
  planSwipe,
  dividerLongitude,
  SWIPE_EDGE,
  NEVER_MATCH,
} from './swipeFilter';

describe('clampDivider', () => {
  it('clamps to 0..1 and treats non-finite as the middle', () => {
    expect(clampDivider(-1)).toBe(0);
    expect(clampDivider(2)).toBe(1);
    expect(clampDivider(0.3)).toBe(0.3);
    expect(clampDivider(NaN)).toBe(0.5);
  });
});

describe('halfPlaneRect', () => {
  it('OSM side is everything west of the divider, Flock side everything east', () => {
    const osm = halfPlaneRect('osm', -95);
    const flock = halfPlaneRect('flock', -95);
    expect(osm.coordinates[0]).toEqual([[-180, -85], [-95, -85], [-95, 85], [-180, 85], [-180, -85]]);
    expect(flock.coordinates[0]).toEqual([[-95, -85], [180, -85], [180, 85], [-95, 85], [-95, -85]]);
  });

  it('withinFilter wraps the rectangle', () => {
    const f = withinFilter('osm', -95) as unknown[];
    expect(f[0]).toBe('within');
    expect((f[1] as GeoJSON.Polygon).type).toBe('Polygon');
  });
});

describe('combineFilters', () => {
  it('returns undefined for nothing, the filter itself for one, and all-of for many', () => {
    expect(combineFilters()).toBeUndefined();
    expect(combineFilters(undefined, undefined)).toBeUndefined();
    const a = ['==', ['get', 'a'], 1] as never;
    const b = ['==', ['get', 'b'], 2] as never;
    expect(combineFilters(a)).toBe(a);
    expect(combineFilters(undefined, a)).toBe(a);
    expect(combineFilters(a, b)).toEqual(['all', a, b]);
  });
});

describe('planSwipe', () => {
  const base = { osm: ['==', ['get', 'brand'], 'x'] as never, flock: ['==', ['get', 'type'], 'y'] as never };

  it('hides OSM at the left edge with a never-matching filter and keeps Flock at its base', () => {
    const plan = planSwipe(0, -95, base);
    expect(plan.osm.filter).toEqual(['all', base.osm, NEVER_MATCH]);
    expect(plan.flock.filter).toBe(base.flock);
  });

  it('hides Flock at the right edge', () => {
    const plan = planSwipe(1, -95, base);
    expect(plan.flock.filter).toEqual(['all', base.flock, NEVER_MATCH]);
    expect(plan.osm.filter).toBe(base.osm);
  });

  it('treats values inside the edge band as the edge', () => {
    expect(planSwipe(SWIPE_EDGE / 2, -95).osm.filter).toEqual(NEVER_MATCH);
    expect(planSwipe(1 - SWIPE_EDGE / 2, -95).flock.filter).toEqual(NEVER_MATCH);
  });

  it('never-match filter is a boolean expression MapLibre accepts', () => {
    expect(NEVER_MATCH).toEqual(['literal', false]);
  });

  it('combines the within filter with each base filter in the middle', () => {
    const plan = planSwipe(0.5, -95, base);
    expect((plan.osm.filter as unknown[])[0]).toBe('all');
    expect((plan.osm.filter as unknown[])[1]).toBe(base.osm);
    expect(((plan.osm.filter as unknown[])[2] as unknown[])[0]).toBe('within');
    expect(((plan.flock.filter as unknown[])[2] as unknown[])[0]).toBe('within');
  });

  it('uses the within filter alone when there is no base filter', () => {
    const plan = planSwipe(0.5, -95);
    expect((plan.osm.filter as unknown[])[0]).toBe('within');
    expect((plan.flock.filter as unknown[])[0]).toBe('within');
  });
});

describe('dividerLongitude', () => {
  it('unprojects at the divider x and mid height', () => {
    const calls: Array<[number, number]> = [];
    const map = {
      getContainer: () => ({ clientWidth: 400, clientHeight: 800 }),
      unproject: (p: [number, number]) => { calls.push(p); return { lng: -95 + p[0] / 100 }; },
    };
    expect(dividerLongitude(map, 0.25)).toBe(-94);
    expect(calls[0]).toEqual([100, 400]);
  });
});
```

- [ ] **Step 2: Write the failing nearby tests**

Create `src/utils/flockNearby.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nearestDistanceMeters, flockNearbyHint } from './flockNearby';

describe('nearestDistanceMeters', () => {
  it('returns null with no candidates', () => {
    expect(nearestDistanceMeters({ lon: -95, lat: 29 }, [])).toBeNull();
  });

  it('returns the closest distance in meters', () => {
    const origin = { lon: -95.3698, lat: 29.7604 };
    const near = { lon: -95.3698, lat: 29.7605 }; // ~11 m north
    const far = { lon: -95.36, lat: 29.7604 };
    const d = nearestDistanceMeters(origin, [far, near]);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(9);
    expect(d!).toBeLessThan(13);
  });
});

describe('flockNearbyHint', () => {
  it('says nothing below z10', () => {
    expect(flockNearbyHint({ zoom: 9.9, type: 'alpr', nearestMeters: 5, osmVisible: true })).toBeNull();
  });

  it('says nothing when OSM is hidden (Flock view), since nothing was queried', () => {
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: null, osmVisible: false })).toBeNull();
  });

  it('reports a nearby OSM camera for an ALPR without a mis-tag note', () => {
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: 6.4, osmVisible: true }))
      .toBe('OSM has a camera 6 m from here.');
  });

  it('adds the mis-tag note when the Flock type is not an ALPR', () => {
    expect(flockNearbyHint({ zoom: 14, type: 'condor', nearestMeters: 6.4, osmVisible: true }))
      .toBe('OSM has a camera 6 m from here. Could be a mis-tag. Verify in person.');
  });

  it('reports nothing nearby beyond 50 m or with no candidates', () => {
    const msg = 'Nothing on OSM within 50 m. Verify in person before adding it.';
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: 51, osmVisible: true })).toBe(msg);
    expect(flockNearbyHint({ zoom: 14, type: 'alpr', nearestMeters: null, osmVisible: true })).toBe(msg);
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `npx vitest run src/utils/swipeFilter.test.ts src/utils/flockNearby.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement swipeFilter**

Create `src/utils/swipeFilter.ts`:

```ts
import type { FilterSpecification } from 'maplibre-gl';

/**
 * Pure geometry for the Flock Leak swipe: the divider is a fraction of the
 * map width; with the map locked north-up it is a line of constant
 * longitude, so each side of the swipe is a rectangle and MapLibre's
 * `within` expression cuts the point layers without any per-feature data.
 */
export type SwipeSide = 'osm' | 'flock';

/** Inside this band from either edge the hidden side gets NEVER_MATCH
 *  instead of a sliver-thin polygon. */
export const SWIPE_EDGE = 0.005;

/** A filter no feature passes. Used to hide a side of the swipe through the
 *  filter alone: layer visibility stays declarative (react-map-gl owns it),
 *  so leaving Swipe for the Flock-only view never fights a restored
 *  'visible'. */
export const NEVER_MATCH: FilterSpecification = ['literal', false] as unknown as FilterSpecification;

export function clampDivider(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function halfPlaneRect(side: SwipeSide, dividerLon: number): GeoJSON.Polygon {
  const west = side === 'osm' ? -180 : dividerLon;
  const east = side === 'osm' ? dividerLon : 180;
  return {
    type: 'Polygon',
    coordinates: [[[west, -85], [east, -85], [east, 85], [west, 85], [west, -85]]],
  };
}

export function withinFilter(side: SwipeSide, dividerLon: number): FilterSpecification {
  return ['within', halfPlaneRect(side, dividerLon)] as unknown as FilterSpecification;
}

export function combineFilters(
  ...filters: Array<FilterSpecification | undefined>
): FilterSpecification | undefined {
  const present = filters.filter((f): f is FilterSpecification => f != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return ['all', ...present] as unknown as FilterSpecification;
}

export interface SwipeLayerState {
  filter: FilterSpecification | undefined;
}

export interface SwipePlan {
  osm: SwipeLayerState;
  flock: SwipeLayerState;
}

export function planSwipe(
  divider: number,
  dividerLon: number,
  base: { osm?: FilterSpecification; flock?: FilterSpecification } = {}
): SwipePlan {
  const d = clampDivider(divider);
  if (d <= SWIPE_EDGE) {
    return {
      osm: { filter: combineFilters(base.osm, NEVER_MATCH) },
      flock: { filter: base.flock },
    };
  }
  if (d >= 1 - SWIPE_EDGE) {
    return {
      osm: { filter: base.osm },
      flock: { filter: combineFilters(base.flock, NEVER_MATCH) },
    };
  }
  return {
    osm: { filter: combineFilters(base.osm, withinFilter('osm', dividerLon)) },
    flock: { filter: combineFilters(base.flock, withinFilter('flock', dividerLon)) },
  };
}

export interface DividerMapLike {
  getContainer(): { clientWidth: number; clientHeight: number };
  unproject(point: [number, number]): { lng: number };
}

/** Longitude under the divider, read at mid height (north-up, so any height works). */
export function dividerLongitude(map: DividerMapLike, divider: number): number {
  const { clientWidth, clientHeight } = map.getContainer();
  return map.unproject([clientWidth * clampDivider(divider), clientHeight / 2]).lng;
}
```

- [ ] **Step 5: Implement flockNearby**

Create `src/utils/flockNearby.ts`:

```ts
import { haversineDistance } from './geo';
import type { FlockDeviceType } from '../lib/flockTypeNormalization';

/** Half-size of the screen box queried around a tapped Flock mark. */
export const NEARBY_QUERY_PX = 20;
export const NEARBY_MAX_METERS = 50;
/** Below this the OSM layer renders density dots, not cameras: no hint. */
export const NEARBY_MIN_ZOOM = 10;

export function nearestDistanceMeters(
  origin: { lon: number; lat: number },
  points: Array<{ lon: number; lat: number }>
): number | null {
  let best: number | null = null;
  for (const p of points) {
    const d = haversineDistance(origin.lat, origin.lon, p.lat, p.lon);
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Popup line under a Flock device. Worded as a prompt to verify, never a
 * verdict: nine months separate the datasets (spec section 6).
 */
export function flockNearbyHint(input: {
  zoom: number;
  type: FlockDeviceType;
  nearestMeters: number | null;
  osmVisible: boolean;
}): string | null {
  if (!input.osmVisible || input.zoom < NEARBY_MIN_ZOOM) return null;
  if (input.nearestMeters != null && input.nearestMeters <= NEARBY_MAX_METERS) {
    const base = `OSM has a camera ${Math.round(input.nearestMeters)} m from here.`;
    return input.type === 'alpr' ? base : `${base} Could be a mis-tag. Verify in person.`;
  }
  return 'Nothing on OSM within 50 m. Verify in person before adding it.';
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/utils/swipeFilter.test.ts src/utils/flockNearby.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/swipeFilter.ts src/utils/swipeFilter.test.ts src/utils/flockNearby.ts src/utils/flockNearby.test.ts
git commit -m "feat(leak): pure swipe geometry and the nearby-OSM popup hint"
```

---

### Task 6: The Leak store and the layer filter builder

**Files:**
- Create: `src/store/flockLeakStore.ts`, `src/utils/flockLeakFilter.ts`
- Test: `src/store/flockLeakStore.test.ts`, `src/utils/flockLeakFilter.test.ts`
- Modify: `src/store/index.ts` (export)

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces (store):
  - `type FlockLeakView = 'flock' | 'swipe' | 'overlay'`, `type FlockLeakLoadPhase = 'idle' | 'loading' | 'ready' | 'error'`
  - `interface FlockDeviceSelection { lon: number; lat: number; type: FlockDeviceType; status: FlockDeviceStatus; rawType: string; rawStatus: string; extra: Array<[string, string]>; nearestOsmMeters: number | null; zoom: number }`
  - `useFlockLeakStore` state: `view`, `divider`, `types: FlockDeviceType[]` (empty = all), `statuses: FlockDeviceStatus[]` (default `['active']`), `tileJson`, `loadPhase`, `error`, `tilesFailed`, `sourceEpoch`, `selectedDevice`
  - actions: `setView(v)`, `setDivider(v)` (clamped, equality-gated), `toggleType(t)`, `clearTypes()`, `toggleStatus(s)`, `setSelectedDevice(sel | null)`, `setTilesFailed(b)`, `ensureTileJsonLoaded(): Promise<void>`, `retry(): void` (bumps `sourceEpoch`, clears failure, reloads)
  - `activeFlockFilterCount(s: { types; statuses }): number`
  - `_resetFlockLeakStoreForTests()`
- Produces (filter builder): `flockLayerFilter(types: FlockDeviceType[], statuses: FlockDeviceStatus[]): FilterSpecification | undefined`. `unknown` status always passes.

- [ ] **Step 1: Write the failing filter builder tests**

Create `src/utils/flockLeakFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { flockLayerFilter } from './flockLeakFilter';

function passes(filter: unknown, properties: Record<string, unknown>): boolean {
  if (filter === undefined) return true;
  const parsed = createExpression(filter as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return Boolean(parsed.value.evaluate({ zoom: 10 }, { type: 1, properties, geometry: null } as never));
}

describe('flockLayerFilter', () => {
  it('is undefined when every type and every selectable status is on', () => {
    expect(flockLayerFilter([], ['active', 'planned', 'decommissioned'])).toBeUndefined();
  });

  it('default (Active only) keeps active and unknown, drops planned and decommissioned', () => {
    const f = flockLayerFilter([], ['active']);
    expect(passes(f, { type: 'Falcon', status: 'Active' })).toBe(true);
    expect(passes(f, { type: 'Falcon' })).toBe(true); // unknown status never vanishes
    expect(passes(f, { type: 'Falcon', status: 'Planned' })).toBe(false);
    expect(passes(f, { type: 'Falcon', status: 'Removed' })).toBe(false);
  });

  it('type filter matches canonical types', () => {
    const f = flockLayerFilter(['condor', 'raven'], ['active', 'planned', 'decommissioned']);
    expect(passes(f, { type: 'Condor PTZ', status: 'Active' })).toBe(true);
    expect(passes(f, { type: 'Raven', status: 'Active' })).toBe(true);
    expect(passes(f, { type: 'Falcon', status: 'Active' })).toBe(false);
    expect(passes(f, { status: 'Active' })).toBe(false); // other is not selected
  });

  it('combines type and status', () => {
    const f = flockLayerFilter(['alpr'], ['planned']);
    expect(passes(f, { type: 'Falcon', status: 'Planned' })).toBe(true);
    expect(passes(f, { type: 'Falcon', status: 'Active' })).toBe(false);
    expect(passes(f, { type: 'Condor', status: 'Planned' })).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing store tests**

Create `src/store/flockLeakStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFlockLeakStore, activeFlockFilterCount, _resetFlockLeakStoreForTests } from './flockLeakStore';

vi.mock('../services/flockLeakTilesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/flockLeakTilesService')>();
  return { ...actual, loadFlockLeakTileJson: vi.fn() };
});
import { loadFlockLeakTileJson } from '../services/flockLeakTilesService';
const loadMock = vi.mocked(loadFlockLeakTileJson);

beforeEach(() => {
  _resetFlockLeakStoreForTests();
  loadMock.mockReset();
});

describe('defaults', () => {
  it('lands on the Flock view, divider centered, active only', () => {
    const s = useFlockLeakStore.getState();
    expect(s.view).toBe('flock');
    expect(s.divider).toBe(0.5);
    expect(s.types).toEqual([]);
    expect(s.statuses).toEqual(['active']);
    expect(s.loadPhase).toBe('idle');
  });
});

describe('setDivider', () => {
  it('clamps and is equality-gated (no new state object for the same value)', () => {
    const { setDivider } = useFlockLeakStore.getState();
    setDivider(0.25);
    const before = useFlockLeakStore.getState();
    setDivider(0.25);
    expect(useFlockLeakStore.getState()).toBe(before);
    setDivider(7);
    expect(useFlockLeakStore.getState().divider).toBe(1);
  });
});

describe('filters', () => {
  it('toggles types and clears back to all', () => {
    const s = useFlockLeakStore.getState();
    s.toggleType('condor');
    s.toggleType('alpr');
    expect(useFlockLeakStore.getState().types).toEqual(['condor', 'alpr']);
    s.toggleType('condor');
    expect(useFlockLeakStore.getState().types).toEqual(['alpr']);
    s.clearTypes();
    expect(useFlockLeakStore.getState().types).toEqual([]);
  });

  it('toggles statuses', () => {
    useFlockLeakStore.getState().toggleStatus('planned');
    expect(useFlockLeakStore.getState().statuses).toEqual(['active', 'planned']);
    useFlockLeakStore.getState().toggleStatus('active');
    expect(useFlockLeakStore.getState().statuses).toEqual(['planned']);
  });

  it('counts the Active-only default as one filter, all statuses as none', () => {
    expect(activeFlockFilterCount({ types: [], statuses: ['active'] })).toBe(1);
    expect(activeFlockFilterCount({ types: [], statuses: ['active', 'planned', 'decommissioned'] })).toBe(0);
    expect(activeFlockFilterCount({ types: ['alpr'], statuses: ['active', 'planned', 'decommissioned'] })).toBe(1);
    expect(activeFlockFilterCount({ types: ['alpr'], statuses: ['active'] })).toBe(2);
  });
});

describe('ensureTileJsonLoaded', () => {
  it('stores the document and goes ready', async () => {
    loadMock.mockResolvedValue({ tiles: ['x'], stats: { total: 5 } });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    const s = useFlockLeakStore.getState();
    expect(s.loadPhase).toBe('ready');
    expect(s.tileJson?.stats?.total).toBe(5);
  });

  it('loads once', async () => {
    loadMock.mockResolvedValue({ tiles: ['x'] });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it('records an error and retry reloads with a new source epoch', async () => {
    loadMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ tiles: ['x'] });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    expect(useFlockLeakStore.getState().loadPhase).toBe('error');
    useFlockLeakStore.getState().setTilesFailed(true);
    useFlockLeakStore.getState().retry();
    await vi.waitFor(() => expect(useFlockLeakStore.getState().loadPhase).toBe('ready'));
    expect(useFlockLeakStore.getState().tilesFailed).toBe(false);
    expect(useFlockLeakStore.getState().sourceEpoch).toBe(1);
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `npx vitest run src/utils/flockLeakFilter.test.ts src/store/flockLeakStore.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the filter builder**

Create `src/utils/flockLeakFilter.ts`:

```ts
import type { FilterSpecification } from 'maplibre-gl';
import {
  flockTypeExpression,
  flockStatusExpression,
  FLOCK_SELECTABLE_STATUSES,
  type FlockDeviceType,
  type FlockDeviceStatus,
} from '../lib/flockTypeNormalization';
import { combineFilters } from './swipeFilter';

/**
 * Layer filter for the Flock layers from the user's chips. Empty `types`
 * means all types. Devices with an unknown status always pass the status
 * filter: the chips can hide Flock's labels, never Flock's silence.
 */
export function flockLayerFilter(
  types: FlockDeviceType[],
  statuses: FlockDeviceStatus[]
): FilterSpecification | undefined {
  const typeFilter =
    types.length > 0
      ? (['in', flockTypeExpression(), ['literal', types]] as unknown as FilterSpecification)
      : undefined;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((s) => statuses.includes(s));
  const statusFilter = allStatuses
    ? undefined
    : (['in', flockStatusExpression(), ['literal', [...statuses, 'unknown']]] as unknown as FilterSpecification);
  return combineFilters(typeFilter, statusFilter);
}
```

- [ ] **Step 5: Implement the store**

Create `src/store/flockLeakStore.ts`:

```ts
import { create } from 'zustand';
import { clampDivider } from '../utils/swipeFilter';
import { loadFlockLeakTileJson, type FlockLeakTileJson } from '../services/flockLeakTilesService';
import {
  FLOCK_SELECTABLE_STATUSES,
  type FlockDeviceType,
  type FlockDeviceStatus,
} from '../lib/flockTypeNormalization';

export type FlockLeakView = 'flock' | 'swipe' | 'overlay';
export type FlockLeakLoadPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface FlockDeviceSelection {
  lon: number;
  lat: number;
  type: FlockDeviceType;
  status: FlockDeviceStatus;
  rawType: string;
  rawStatus: string;
  /** Every other tile attribute, stringified, for the popup rows. */
  extra: Array<[string, string]>;
  /** Nearest rendered OSM camera at click time; null when none was found. */
  nearestOsmMeters: number | null;
  zoom: number;
}

export const DEFAULT_FLOCK_STATUSES: readonly FlockDeviceStatus[] = ['active'];

interface FlockLeakState {
  view: FlockLeakView;
  /** Swipe divider as a fraction of the map width, 0..1. The only value
   *  written during a gesture. */
  divider: number;
  types: FlockDeviceType[];
  statuses: FlockDeviceStatus[];
  tileJson: FlockLeakTileJson | null;
  loadPhase: FlockLeakLoadPhase;
  error: string | null;
  /** Set by the map's tile error handling; cleared on a successful load. */
  tilesFailed: boolean;
  /** Bumped by retry so the map remounts the Flock source. */
  sourceEpoch: number;
  selectedDevice: FlockDeviceSelection | null;

  setView: (view: FlockLeakView) => void;
  setDivider: (divider: number) => void;
  toggleType: (type: FlockDeviceType) => void;
  clearTypes: () => void;
  toggleStatus: (status: FlockDeviceStatus) => void;
  setSelectedDevice: (selection: FlockDeviceSelection | null) => void;
  setTilesFailed: (failed: boolean) => void;
  ensureTileJsonLoaded: () => Promise<void>;
  retry: () => void;
}

const INITIAL = {
  view: 'flock' as FlockLeakView,
  divider: 0.5,
  types: [] as FlockDeviceType[],
  statuses: [...DEFAULT_FLOCK_STATUSES],
  tileJson: null as FlockLeakTileJson | null,
  loadPhase: 'idle' as FlockLeakLoadPhase,
  error: null as string | null,
  tilesFailed: false,
  sourceEpoch: 0,
  selectedDevice: null as FlockDeviceSelection | null,
};

export const useFlockLeakStore = create<FlockLeakState>((set, get) => ({
  ...INITIAL,

  setView: (view) => {
    if (get().view !== view) set({ view });
  },
  setDivider: (divider) => {
    const next = clampDivider(divider);
    if (next !== get().divider) set({ divider: next });
  },
  toggleType: (type) =>
    set((s) => ({
      types: s.types.includes(type) ? s.types.filter((t) => t !== type) : [...s.types, type],
    })),
  clearTypes: () => {
    if (get().types.length > 0) set({ types: [] });
  },
  toggleStatus: (status) =>
    set((s) => ({
      statuses: s.statuses.includes(status)
        ? s.statuses.filter((x) => x !== status)
        : [...s.statuses, status],
    })),
  setSelectedDevice: (selectedDevice) => set({ selectedDevice }),
  setTilesFailed: (tilesFailed) => {
    if (get().tilesFailed !== tilesFailed) set({ tilesFailed });
  },

  ensureTileJsonLoaded: async () => {
    const { loadPhase } = get();
    if (loadPhase === 'loading' || loadPhase === 'ready') return;
    set({ loadPhase: 'loading', error: null });
    const doc = await loadFlockLeakTileJson();
    if (doc) set({ tileJson: doc, loadPhase: 'ready' });
    else set({ loadPhase: 'error', error: 'Flock data unavailable' });
  },

  retry: () => {
    set((s) => ({ loadPhase: 'idle', error: null, tilesFailed: false, sourceEpoch: s.sourceEpoch + 1 }));
    void get().ensureTileJsonLoaded();
  },
}));

/** Badge count for the filter button. The Active-only default is a filter
 *  the user can see (Planned and Decommissioned are hidden), so it counts. */
export function activeFlockFilterCount(s: { types: FlockDeviceType[]; statuses: FlockDeviceStatus[] }): number {
  const typeActive = s.types.length > 0 ? 1 : 0;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((x) => s.statuses.includes(x));
  return typeActive + (allStatuses ? 0 : 1);
}

/** Test hook — not for app code. */
export function _resetFlockLeakStoreForTests(): void {
  useFlockLeakStore.setState({ ...INITIAL, statuses: [...DEFAULT_FLOCK_STATUSES], types: [] });
}
```

Add to `src/store/index.ts`:

```ts
export { useFlockLeakStore } from './flockLeakStore';
export type { FlockLeakView, FlockDeviceSelection } from './flockLeakStore';
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/utils/flockLeakFilter.test.ts src/store/flockLeakStore.test.ts && npx tsc -b --noEmit`
Expected: PASS, clean types.

- [ ] **Step 7: Commit**

```bash
git add src/store/flockLeakStore.ts src/store/flockLeakStore.test.ts src/utils/flockLeakFilter.ts src/utils/flockLeakFilter.test.ts src/store/index.ts
git commit -m "feat(leak): leak store (view, divider, filters, TileJSON) and layer filter builder"
```

---

### Task 7: The `leak` mode: store, URL, availability, header tab, drawer tab and peek identity

**Files:**
- Modify: `src/store/appModeStore.ts:4`
- Modify: `src/utils/urlState.ts:23-47`
- Modify: `src/utils/urlState.test.ts` (path table, legacy param test, buildAppUrl table, round-trip loop)
- Modify: `src/services/cameraDataService.ts:120` (typed `ReadonlySet<AppMode>` since the Analysis-removal fix wave)
- Modify: `src/main.tsx:58-66` (router: `/leak` and `/flock-leak` routes; without them the `*` route serves NotFound)
- Create: `src/services/cameraDataService.modeAvailability.test.ts`
- Modify: `src/pages/MapPage.tsx:33` (lucide import), `:40-45` (`MODE_LABELS`), `:263-275` (SEO)
- Modify: `src/components/panels/MobileTabDrawer.tsx` (`TABS`, `PEEK`, `PEEK_MODES`, `IdentityRow` tint)

**Interfaces:**
- Consumes: nothing beyond Task 6's store export (not used yet here).
- Produces: `AppMode` includes `'leak'`; `MODE_PATHS.leak === '/leak'`; `/flock-leak` alias; router routes for both paths; `isModeAvailable('leak', 'ca') === false`; desktop nav order Map, Route, Timeline, Flock Leak, Network; mobile tabs Map, Route, Timeline, Leak, Network; `PEEK.leak` with `tint: 'danger'`.

- [ ] **Step 1: Write the failing URL and availability tests**

In `src/utils/urlState.test.ts`:

Add to the path table:

```ts
    ['/leak', 'leak'],
    ['/flock-leak', 'leak'],
```

In the legacy `?mode=` test add:

```ts
    expect(parseAppUrl('/', '?mode=leak').mode).toBe('leak');
```

Add to the `buildAppUrl` path table:

```ts
      ['leak', '/leak'],
```

Change the round-trip loop to:

```ts
    for (const mode of ['map', 'route', 'explore', 'leak', 'network'] as const) {
```

Create `src/services/cameraDataService.modeAvailability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isModeAvailable } from './cameraDataService';

describe('isModeAvailable', () => {
  it('leak is US only, like route and network', () => {
    expect(isModeAvailable('leak', 'us')).toBe(true);
    expect(isModeAvailable('leak', 'ca')).toBe(false);
    expect(isModeAvailable('route', 'ca')).toBe(false);
    expect(isModeAvailable('network', 'ca')).toBe(false);
  });

  it('map and explore work in Canada', () => {
    expect(isModeAvailable('map', 'ca')).toBe(true);
    expect(isModeAvailable('explore', 'ca')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/urlState.test.ts src/services/cameraDataService.modeAvailability.test.ts`
Expected: FAIL on the `/leak` rows and the `leak`/`ca` assertion.

- [ ] **Step 3: Add the mode**

`src/store/appModeStore.ts`:

```ts
export type AppMode = 'map' | 'route' | 'explore' | 'leak' | 'network';
```

`src/utils/urlState.ts`:

```ts
export const MODE_PATHS: Record<AppMode, string> = {
  map: '/',
  route: '/route',
  explore: '/timeline',
  leak: '/leak',
  network: '/network',
};

// Canonical paths plus legacy aliases, accepted as input only.
// '/analysis' was the retired Analysis tab; old links land on the map.
const PATH_MODES: Record<string, AppMode | undefined> = {
  '/': 'map',
  '/map': 'map',
  '/route': 'route',
  '/timeline': 'explore',
  '/explore': 'explore',
  '/analysis': 'map',
  '/leak': 'leak',
  '/flock-leak': 'leak',
  '/network': 'network',
};

const LEGACY_MODE_PARAM: Record<string, AppMode | undefined> = {
  route: 'route',
  explore: 'explore',
  leak: 'leak',
  network: 'network',
};
```

`src/services/cameraDataService.ts` (the set is `ReadonlySet<AppMode>`, so `tsc` rejects a typo here):

```ts
const US_ONLY_MODES: ReadonlySet<AppMode> = new Set<AppMode>(['route', 'leak', 'network']);
```

`src/main.tsx`: the router is a third copy of the URL vocabulary that types do not police. Add both routes next to the existing mode routes, keeping the file's style:

```tsx
              <Route path="/leak" element={<MapPage />} />
              <Route path="/flock-leak" element={<MapPage />} />
```

- [ ] **Step 4: Header tab and SEO**

In `src/pages/MapPage.tsx`, extend the lucide import to include `Radar`:

```ts
import { Route, Compass, Network, Radar, Map as MapIcon } from 'lucide-react';
```

Change `MODE_LABELS` (object order is nav order):

```ts
const MODE_LABELS: Record<AppMode, { icon: typeof Route; label: string }> = {
  map: { icon: MapIcon, label: 'Map' },
  route: { icon: Route, label: 'Route' },
  explore: { icon: Compass, label: 'Timeline' },
  leak: { icon: Radar, label: 'Flock Leak' },
  network: { icon: Network, label: 'Network' },
};
```

Change the `seo` constant so the leak mode has its own page metadata:

```tsx
  const seo = stateFilter ? (
    <Seo
      title={`${getStateName(stateFilter)} ALPR Cameras | DeFlock Maps`}
      description={`Map of known ALPR (license plate reader) cameras in ${getStateName(stateFilter)}, with brand breakdowns and privacy-optimized routing.`}
      path={`/state/${stateSlug(stateFilter)}`}
    />
  ) : appMode === 'leak' ? (
    <Seo
      title="Leaked Flock Camera Locations | DeFlock Maps"
      description="Flock Safety's leaked device inventory (December 2025) next to the crowdsourced OSM camera map."
      path="/leak"
    />
  ) : (
    <Seo
      title="DeFlock Maps | ALPR Camera Map & Privacy Routes"
      description="Explore the national ALPR camera map and compare direct routes with privacy-optimized alternatives."
      path="/"
    />
  );
```

- [ ] **Step 5: Drawer tab and peek identity**

In `src/components/panels/MobileTabDrawer.tsx`:

Add `Radar` to the lucide import. Change `TABS`:

```ts
const TABS: TabDef[] = [
  { mode: 'map', label: 'Map' },
  { mode: 'route', label: 'Route' },
  { mode: 'explore', label: 'Timeline' },
  { mode: 'leak', label: 'Leak' },
  { mode: 'network', label: 'Network' },
];
```

Change the `PEEK` type and add the entry:

```ts
const PEEK: Partial<Record<AppMode, { title: string; desc: string; Icon: typeof Navigation2; tint?: 'danger' }>> = {
  // route renders the FlockHopper start ad instead of IdentityRow; entry kept so the peek effects treat route as peekable
  route:   { title: 'Route', desc: 'Set a start and destination to see ALPR exposure along your route — and safer alternatives.', Icon: Navigation2 },
  explore: { title: 'Timeline', desc: 'Watch the ALPR camera network grow as volunteers documented it on OpenStreetMap.', Icon: History },
  leak:    { title: 'Flock Leak', desc: "Flock's own device list, leaked Dec 2025.", Icon: Radar, tint: 'danger' },
  network: { title: 'Flock Sharing Network', desc: 'Law enforcement agencies sharing Flock ALPR data with each other, as publicly disclosed. Tap an agency to trace its connections.', Icon: Share2 },
};
```

```ts
const PEEK_MODES: ReadonlySet<AppMode> = new Set(['route', 'explore', 'leak', 'network']);
```

In `IdentityRow`, replace the icon box so the tint is honored:

```tsx
  const boxClass = cfg.tint === 'danger'
    ? 'bg-danger/10 border-danger/35'
    : 'bg-accent-muted border-accent/30';
  const iconClass = cfg.tint === 'danger' ? 'text-danger' : 'text-accent';
  return (
    <div className="mt-3 animate-fade-in">
      <button
        onClick={onExpand}
        className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity min-h-11"
        aria-label={`${cfg.title} — open controls and details`}
      >
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${boxClass}`}>
          <Icon className={`w-[18px] h-[18px] ${iconClass}`} aria-hidden="true" />
        </div>
```

(The rest of `IdentityRow` is unchanged.)

- [ ] **Step 6: Run tests, types, lint**

Run: `npx vitest run src/utils/urlState.test.ts src/services/cameraDataService.modeAvailability.test.ts && npx tsc -b --noEmit && npm run lint`
Expected: PASS. `tsc` may flag `Record<AppMode, ...>` objects elsewhere that now lack `leak`: `MODE_LABELS` and `MODE_PATHS` are the only two in the tree (verified 2026-09-23); both are updated above.

- [ ] **Step 7: Smoke it**

Run `npm run dev`, open `http://localhost:3000/leak` and then `http://localhost:3000/flock-leak`. Expected for both: the header shows FLOCK LEAK selected (not the NotFound page), the address bar settles on `/leak`, the map shows OSM cameras as usual (no Flock data yet), no console errors. On a 390 px wide window the drawer shows five tabs and a red-tinted Flock Leak identity row at peek.

- [ ] **Step 8: Commit**

```bash
git add src/store/appModeStore.ts src/utils/urlState.ts src/utils/urlState.test.ts src/services/cameraDataService.ts src/services/cameraDataService.modeAvailability.test.ts src/main.tsx src/pages/MapPage.tsx src/components/panels/MobileTabDrawer.tsx
git commit -m "feat(leak): leak app mode with /leak path, router routes, US-only gate, header tab, drawer tab and peek"
```

---

### Task 8: Flock layers, runtime icons, map wiring, and the device popup

**Files:**
- Create: `src/components/map/layers/flockLeakIcons.ts`, `src/components/map/layers/FlockLeakLayers.tsx`, `src/components/map/FlockLeakPopup.tsx`
- Test: `src/components/map/layers/flockLeakIcons.test.ts`
- Modify: `src/components/map/layers/CameraTileLayers.tsx` (`cones` prop)
- Modify: `src/store/mapStore.ts` (`tileViewFlockCount`)
- Modify: `src/components/map/MapLibreContainer.tsx` (imports, flags, `showCameraMarkers`, north lock, source events, error handling, click, `interactiveLayerIds`, counts, mounting)

**Interfaces:**
- Consumes: Tasks 2 to 6.
- Produces:
  - `FLOCK_TYPE_COLOR: Record<FlockDeviceType, string>`, `flockIconId(type, planned: boolean): string`, `ensureFlockIcons(map: maplibregl.Map): void`, `drawFlockIcon(ctx, type, size, planned): void`
  - `FLOCK_LEAK_DOTS_LAYER = 'flock-leak-dots'`, `FLOCK_LEAK_POINTS_LAYER = 'flock-leak-points'`, `<FlockLeakLayers visible sourceUrl />`
  - `<FlockLeakPopup />` (renders from `selectedDevice`)
  - `CameraTileLayers` gains `cones?: boolean` (default `true`)
  - `mapStore.tileViewFlockCount: number | null` + `setTileViewFlockCount`

- [ ] **Step 1: Write the failing icon tests**

Create `src/components/map/layers/flockLeakIcons.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flockIconId, ensureFlockIcons, FLOCK_TYPE_COLOR, FLOCK_ICON_IDS } from './flockLeakIcons';
import { FLOCK_TYPES } from '../../../lib/flockTypeNormalization';

describe('flockIconId', () => {
  it('names solid and planned variants', () => {
    expect(flockIconId('alpr', false)).toBe('flock-alpr');
    expect(flockIconId('condor', true)).toBe('flock-condor-planned');
  });

  it('lists every type in both variants', () => {
    expect(FLOCK_ICON_IDS).toHaveLength(FLOCK_TYPES.length * 2);
    for (const t of FLOCK_TYPES) expect(FLOCK_TYPE_COLOR[t]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('ensureFlockIcons', () => {
  // vitest runs in the node environment here (no jsdom, no canvas): stub the
  // one DOM call the renderer makes with a minimal 2D context.
  const ctx = {
    clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    arc: () => {}, rect: () => {}, fill: () => {}, stroke: () => {}, setLineDash: () => {}, save: () => {}, restore: () => {},
    getImageData: () => ({ width: 44, height: 44, data: new Uint8ClampedArray(44 * 44 * 4) }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter',
  };

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds every missing icon once and skips existing ones', () => {
    const added: string[] = [];
    const map = {
      hasImage: (id: string) => id === 'flock-alpr',
      addImage: (id: string) => { added.push(id); },
    };
    ensureFlockIcons(map as never);
    expect(added).not.toContain('flock-alpr');
    expect(added).toContain('flock-alpr-planned');
    expect(added).toHaveLength(FLOCK_ICON_IDS.length - 1);
  });

  it('registers images at pixel ratio 2', () => {
    const opts: unknown[] = [];
    const map = { hasImage: () => false, addImage: (_id: string, _img: unknown, o: unknown) => { opts.push(o); } };
    ensureFlockIcons(map as never);
    expect(opts.every((o) => (o as { pixelRatio: number }).pixelRatio === 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/map/layers/flockLeakIcons.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the icons**

Create `src/components/map/layers/flockLeakIcons.ts`:

```ts
import type maplibregl from 'maplibre-gl';
import { FLOCK_TYPES, type FlockDeviceType } from '../../../lib/flockTypeNormalization';

/**
 * Flock device marks, drawn on a canvas at runtime and registered as map
 * images. No sprite rebuild on the tile host. Pre-colored per type; the
 * planned variant is the same shape as a dashed outline. Decommissioned
 * is the solid icon at reduced opacity (a paint property, not an image).
 */
export const FLOCK_TYPE_COLOR: Record<FlockDeviceType, string> = {
  alpr: '#ef4444',
  condor: '#f59e0b',
  raven: '#a78bfa',
  drone: '#34d399',
  other: '#9ca3af',
};

/** Logical pixel size of the mark at icon-size 1. */
export const FLOCK_ICON_PX = 14;
const PAD = 4;
const RATIO = 2;

export const flockIconId = (type: FlockDeviceType, planned: boolean): string =>
  `flock-${type}${planned ? '-planned' : ''}`;

export const FLOCK_ICON_IDS: readonly string[] = FLOCK_TYPES.flatMap((t) => [
  flockIconId(t, false),
  flockIconId(t, true),
]);

export function drawFlockIcon(
  ctx: CanvasRenderingContext2D,
  type: FlockDeviceType,
  size: number,
  planned: boolean
): void {
  const color = FLOCK_TYPE_COLOR[type];
  const c = size / 2;
  const r = size * 0.36;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (type) {
    case 'alpr':
      ctx.rect(c - r, c - r, r * 2, r * 2);
      break;
    case 'condor':
      ctx.moveTo(c, c - r * 1.15);
      ctx.lineTo(c + r * 1.15, c);
      ctx.lineTo(c, c + r * 1.15);
      ctx.lineTo(c - r * 1.15, c);
      ctx.closePath();
      break;
    case 'drone':
      ctx.moveTo(c, c - r * 1.2);
      ctx.lineTo(c + r * 1.15, c + r * 0.9);
      ctx.lineTo(c - r * 1.15, c + r * 0.9);
      ctx.closePath();
      break;
    case 'raven':
    case 'other':
      ctx.arc(c, c, r, 0, Math.PI * 2);
      break;
  }
  if (planned) {
    ctx.setLineDash([size * 0.14, size * 0.1]);
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else if (type === 'raven') {
    ctx.lineWidth = size * 0.13;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }
  ctx.restore();
}

function renderIcon(type: FlockDeviceType, planned: boolean): { width: number; height: number; data: Uint8ClampedArray } | null {
  const px = (FLOCK_ICON_PX + PAD * 2) * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, px, px);
  drawFlockIcon(ctx, type, px, planned);
  const img = ctx.getImageData(0, 0, px, px);
  return { width: img.width, height: img.height, data: img.data };
}

/** Register every Flock icon the style might request. Idempotent. */
export function ensureFlockIcons(map: Pick<maplibregl.Map, 'hasImage' | 'addImage'>): void {
  for (const type of FLOCK_TYPES) {
    for (const planned of [false, true]) {
      const id = flockIconId(type, planned);
      if (map.hasImage(id)) continue;
      const img = renderIcon(type, planned);
      if (img) map.addImage(id, img, { pixelRatio: RATIO });
    }
  }
}
```

- [ ] **Step 4: Run the icon tests**

Run: `npx vitest run src/components/map/layers/flockLeakIcons.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `cones` prop to `CameraTileLayers`**

In `src/components/map/layers/CameraTileLayers.tsx`, extend the props:

```ts
interface CameraTileLayersProps {
  visible: boolean;
  /** Vector source id — must be unique per instance. */
  sourceId?: string;
  /** TileJSON URL on the active tile host (never pmtiles). The parent owns
   *  host selection, so this is required rather than defaulted here. */
  sourceUrl: string;
  /** Appended to every layer id — '' for the default instance. */
  idSuffix?: string;
  /** Attribute filter (filter tileset codes). Applied to glow/dots/points
   *  declaratively and to cone building via querySourceFeatures. */
  filter?: FilterSpecification;
  /** Build and draw direction cones. Off in the Flock Leak tab, where the
   *  swipe's `within` filter would flicker cones at the divider. */
  cones?: boolean;
}

export function CameraTileLayers({
  visible,
  sourceId = 'camera-tiles',
  sourceUrl,
  idSuffix = '',
  filter,
  cones = true,
}: CameraTileLayersProps) {
```

In `rebuildCones`, change the early-out condition and its deps:

```ts
    if (!visible || !cones || map.getZoom() < CONE_BUILD_MINZOOM) {
```

```ts
  }, [mapInstance, visible, cones, sourceId, filter]);
```

At the bottom, give the cone layers their own visibility:

```tsx
  const visibility: 'visible' | 'none' = visible ? 'visible' : 'none';
  const coneVisibility: 'visible' | 'none' = visible && cones ? 'visible' : 'none';
```

and use `layout={{ visibility: coneVisibility }}` on both cone `<Layer>`s.

- [ ] **Step 6: Add the Flock count to the map store**

In `src/store/mapStore.ts`, after `tileViewBrandStats`:

```ts
  /** Flock devices in view on the Leak tab (rendered-feature count on idle);
   *  null off the tab or below the zoom where counting is worth it. */
  tileViewFlockCount: number | null;
```

add the action type:

```ts
  setTileViewFlockCount: (count: number | null) => void;
```

initial value `tileViewFlockCount: null,` and the implementation (equality-gated):

```ts
  setTileViewFlockCount: (count) =>
    set((s) => (s.tileViewFlockCount === count ? {} : { tileViewFlockCount: count })),
```

- [ ] **Step 7: Implement the layers component**

Create `src/components/map/layers/FlockLeakLayers.tsx`:

```tsx
import { useEffect, useMemo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import {
  FLOCK_LEAK_SOURCE_ID,
  FLOCK_LEAK_SOURCE_LAYER,
  FLOCK_LEAK_MAXZOOM,
  FLOCK_LEAK_POINTS_MINZOOM,
} from '../../../services/flockLeakTilesService';
import { flockTypeExpression, flockStatusExpression } from '../../../lib/flockTypeNormalization';
import { flockLayerFilter } from '../../../utils/flockLeakFilter';
import { useFlockLeakStore } from '../../../store/flockLeakStore';
import { ensureFlockIcons } from './flockLeakIcons';

export const FLOCK_LEAK_DOTS_LAYER = 'flock-leak-dots';
export const FLOCK_LEAK_POINTS_LAYER = 'flock-leak-points';

/**
 * The leaked Flock inventory: red density dots to z10, typed icons from z9,
 * crossfading over z9 to z10 exactly like the OSM camera layers so the two
 * read as one system. Type and status filters come from flockLeakStore;
 * the swipe divider is applied imperatively by useSwipeFilters on top.
 */
function buildSpecs(filter: FilterSpecification | undefined) {
  // Generic so each spec keeps its concrete type (the symbol layer's `layout`
  // is spread below; the LayerSpecification union would lose it).
  const withFilter = <T extends maplibregl.LayerSpecification>(spec: T): T =>
    filter ? { ...spec, filter } : spec;
  const typeExpr = flockTypeExpression();
  const statusExpr = flockStatusExpression();

  const dots: maplibregl.CircleLayerSpecification = withFilter({
    id: FLOCK_LEAK_DOTS_LAYER,
    type: 'circle',
    source: FLOCK_LEAK_SOURCE_ID,
    'source-layer': FLOCK_LEAK_SOURCE_LAYER,
    maxzoom: 10,
    paint: {
      'circle-color': '#ef4444',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1.5, 7, 2.2, 8, 3.5, 9.9, 5],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 6, 0.6, 8.5, 0.75, 9.6, 0.75, 10, 0],
      'circle-stroke-width': 0,
    },
  });

  const points: maplibregl.SymbolLayerSpecification = withFilter({
    id: FLOCK_LEAK_POINTS_LAYER,
    type: 'symbol',
    source: FLOCK_LEAK_SOURCE_ID,
    'source-layer': FLOCK_LEAK_SOURCE_LAYER,
    minzoom: FLOCK_LEAK_POINTS_MINZOOM,
    layout: {
      'icon-image': ['concat', 'flock-', typeExpr, ['case', ['==', statusExpr, 'planned'], '-planned', '']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 10, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-opacity': [
        '*',
        ['interpolate', ['linear'], ['zoom'], 9, 0, 9.6, 1],
        ['case', ['==', statusExpr, 'decommissioned'], 0.35, 1],
      ],
    },
  });

  return { dots, points };
}

interface FlockLeakLayersProps {
  visible: boolean;
  /** TileJSON URL on the active tile host. */
  sourceUrl: string;
}

export function FlockLeakLayers({ visible, sourceUrl }: FlockLeakLayersProps) {
  const { current: mapInstance } = useMap();
  const types = useFlockLeakStore((s) => s.types);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const filter = useMemo(() => flockLayerFilter(types, statuses), [types, statuses]);
  const specs = useMemo(() => buildSpecs(filter), [filter]);

  // Icons live in the style; a theme switch (setStyle) drops them. Register
  // up front and again whenever the style asks for one we have not added.
  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;
    ensureFlockIcons(map);
    const onMissing = (e: { id: string }) => {
      if (e.id.startsWith('flock-')) ensureFlockIcons(map);
    };
    map.on('styleimagemissing', onMissing);
    return () => {
      map.off('styleimagemissing', onMissing);
    };
  }, [mapInstance]);

  const visibility: 'visible' | 'none' = visible ? 'visible' : 'none';

  return (
    <Source id={FLOCK_LEAK_SOURCE_ID} type="vector" url={sourceUrl} maxzoom={FLOCK_LEAK_MAXZOOM}>
      <Layer {...specs.dots} layout={{ visibility }} />
      <Layer {...specs.points} layout={{ ...specs.points.layout, visibility }} />
    </Source>
  );
}
```

- [ ] **Step 8: Implement the popup**

Create `src/components/map/FlockLeakPopup.tsx`:

```tsx
import { Popup } from 'react-map-gl/maplibre';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { FLOCK_TYPE_LABEL, FLOCK_TYPE_LONG_LABEL, FLOCK_STATUS_LABEL } from '../../lib/flockTypeNormalization';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';
import { flockNearbyHint } from '../../utils/flockNearby';
import { FLOCK_TYPE_COLOR } from './layers/flockLeakIcons';

const MAX_EXTRA_ROWS = 6;

const humanize = (key: string): string =>
  key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

/** Popup for a tapped Flock device. Rendered inside <Map>. */
export function FlockLeakPopup() {
  const sel = useFlockLeakStore((s) => s.selectedDevice);
  const setSelectedDevice = useFlockLeakStore((s) => s.setSelectedDevice);
  const view = useFlockLeakStore((s) => s.view);
  if (!sel) return null;

  const hint = flockNearbyHint({
    zoom: sel.zoom,
    type: sel.type,
    nearestMeters: sel.nearestOsmMeters,
    osmVisible: view !== 'flock',
  });
  const color = FLOCK_TYPE_COLOR[sel.type];

  return (
    <Popup
      longitude={sel.lon}
      latitude={sel.lat}
      anchor="bottom"
      onClose={() => setSelectedDevice(null)}
      closeOnClick={false}
      className="camera-popup-maplibre"
      maxWidth="280px"
    >
      <div className="min-w-[240px] p-4">
        <div className="mb-3 pb-3 border-b border-dark-600">
          <h3 className="font-display font-semibold text-white text-base">Flock {FLOCK_TYPE_LABEL[sel.type]}</h3>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
              style={{ color, backgroundColor: `${color}26` }}>
              {FLOCK_TYPE_LONG_LABEL[sel.type]}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-dark-600 text-dark-200">
              {FLOCK_STATUS_LABEL[sel.status]}
            </span>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          {sel.extra.slice(0, MAX_EXTRA_ROWS).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-dark-400">{humanize(k)}</span>
              <span className="text-dark-200 truncate max-w-[140px]" title={v}>{v}</span>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Coords</span>
            <span className="text-dark-300 font-mono">{sel.lat.toFixed(5)}, {sel.lon.toFixed(5)}</span>
          </div>
        </div>

        <p className="mt-3 pt-3 border-t border-dark-600 text-xs text-dark-400">
          Leaked inventory. Position as of {FLOCK_LEAK_SNAPSHOT_LABEL}.
        </p>
        {hint && <p className="mt-2 text-xs text-[#93CBFF]">{hint}</p>}
      </div>
    </Popup>
  );
}
```

- [ ] **Step 9: Wire the map container**

In `src/components/map/MapLibreContainer.tsx`:

Add imports (next to the other layer imports):

```ts
import { FlockLeakLayers, FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_POINTS_LAYER } from './layers/FlockLeakLayers';
import { FlockLeakPopup } from './FlockLeakPopup';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { flockLeakTileJsonUrl, FLOCK_LEAK_SOURCE_ID, FLOCK_LEAK_POINTS_MINZOOM } from '../../services/flockLeakTilesService';
import { planLeakTileError } from '../../utils/tileErrorPolicy';
import { normalizeFlockType, normalizeFlockStatus } from '../../lib/flockTypeNormalization';
import { nearestDistanceMeters, NEARBY_QUERY_PX } from '../../utils/flockNearby';
```

Add the flags after `const isMapMode = appMode === 'map';`:

```ts
  const isLeakMode = appMode === 'leak';
  const leakView = useFlockLeakStore(s => s.view);
  const leakSourceEpoch = useFlockLeakStore(s => s.sourceEpoch);
```

Change `showCameraMarkers` so the OSM layer shows in Swipe and Overlay:

```ts
  const showCameraMarkers = !isNetworkMode && !isMapModeHeatmap && (
    appMode === 'route'
    || isMapMode
    || (isLeakMode && leakView !== 'flock')
    || (isHeatmapMode && (heatmapSettings.showMarkers || zoom >= 13))
  );
```

Add the north-up lock after the `flyToCommand` effect:

```ts
  // Flock Leak: lock the map north-up so the swipe divider is a line of
  // constant longitude (see swipeFilter). Restored when leaving the tab.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded || !isLeakMode) return;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    if (map.getBearing() !== 0 || map.getPitch() !== 0) {
      map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
    }
    return () => {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enableRotation();
    };
  }, [isLeakMode, mapLoaded]);
```

Add the Flock counters next to the other tile refs and reset them:

```ts
  const leakLoadSeenRef = useRef(false);
  const leakErrorCountRef = useRef(0);
```

```ts
  useEffect(() => {
    tileLoadSeenRef.current = false;
    tileErrorCountRef.current = 0;
    filterTileLoadSeenRef.current = false;
    filterTileErrorCountRef.current = 0;
    leakLoadSeenRef.current = false;
    leakErrorCountRef.current = 0;
    setFilterTilesReady(false);
  }, [mapKey, tilesEpoch, leakSourceEpoch]);
```

In `handleTileSourceData`, before the `camera-tiles` branch:

```ts
    if (e.sourceId === FLOCK_LEAK_SOURCE_ID) {
      leakLoadSeenRef.current = true;
      useFlockLeakStore.getState().setTilesFailed(false);
      return;
    }
```

In `handleMapError`, right after `sourceId` is computed:

```ts
    if (sourceId === FLOCK_LEAK_SOURCE_ID) {
      const leakAction = planLeakTileError({
        sourceId,
        tileLevel: e?.tile != null,
        loadSeen: leakLoadSeenRef.current,
        errorCount: leakErrorCountRef.current,
      });
      if (leakAction.kind === 'count') {
        leakErrorCountRef.current += 1;
      } else if (leakAction.kind === 'fail') {
        console.warn('[MapLibre] Flock leak tiles failing; surfacing the Leak retry pill');
        useFlockLeakStore.getState().setTilesFailed(true);
      }
      return;
    }
```

In `onClick`, after `if (isNetworkMode) return;`:

```ts
    // Flock Leak: a tap on a Flock mark opens the device popup; a tap on an
    // OSM camera falls through to the camera popup below.
    if (isLeakMode) {
      const flockFeature = event.features?.find((f) => f.layer.id === FLOCK_LEAK_POINTS_LAYER);
      if (flockFeature) {
        const map = mapRef.current.getMap();
        const [lon, lat] = (flockFeature.geometry as GeoJSON.Point).coordinates;
        const props = (flockFeature.properties ?? {}) as Record<string, unknown>;
        const osmLayer = isFilterTilesMode ? 'camera-tile-points-filtered' : 'camera-tile-points';
        const { x, y } = event.point;
        const nearby = showCameraMarkers && map.getLayer(osmLayer)
          ? map
              .queryRenderedFeatures(
                [[x - NEARBY_QUERY_PX, y - NEARBY_QUERY_PX], [x + NEARBY_QUERY_PX, y + NEARBY_QUERY_PX]],
                { layers: [osmLayer] }
              )
              .map((f) => {
                const [flon, flat] = (f.geometry as GeoJSON.Point).coordinates;
                return { lon: flon, lat: flat };
              })
          : [];
        useFlockLeakStore.getState().setSelectedDevice({
          lon,
          lat,
          type: normalizeFlockType(props.type),
          status: normalizeFlockStatus(props.status),
          rawType: String(props.type ?? ''),
          rawStatus: String(props.status ?? ''),
          extra: Object.entries(props)
            .filter(([k]) => k !== 'type' && k !== 'status')
            .map(([k, v]) => [k, String(v)] as [string, string]),
          nearestOsmMeters: nearestDistanceMeters({ lon, lat }, nearby),
          zoom: map.getZoom(),
        });
        setPopupInfo(null);
        return;
      }
      useFlockLeakStore.getState().setSelectedDevice(null);
    }
```

and add `isLeakMode, showCameraMarkers` to that callback's dependency array.

Change `interactiveLayerIds`:

```ts
      interactiveLayerIds={isNetworkMode
        ? []
        : isLeakMode
          ? [
              FLOCK_LEAK_POINTS_LAYER,
              ...(showCameraMarkers ? [isFilterTilesMode ? 'camera-tile-points-filtered' : 'camera-tile-points'] : []),
            ]
          : showCameraMarkers
            ? (isTilesMode
                ? ['camera-tile-points']
                : isFilterTilesMode
                  ? ['camera-tile-points-filtered']
                  : ['unclustered-point'])
            : []}
```

In `updateVisibleCameras`, as the first thing after `const map = mapRef.current.getMap();`:

```ts
    // Flock Leak: count rendered Flock marks on idle. Below z6 the header
    // shows the snapshot total instead, so skip the (heavy) national query.
    if (useAppModeStore.getState().appMode === 'leak') {
      try {
        const z = map.getZoom();
        if (z < 6) {
          useMapStore.getState().setTileViewFlockCount(null);
        } else {
          const layer = z >= FLOCK_LEAK_POINTS_MINZOOM ? FLOCK_LEAK_POINTS_LAYER : FLOCK_LEAK_DOTS_LAYER;
          if (map.getLayer(layer)) {
            useMapStore.getState().setTileViewFlockCount(
              map.queryRenderedFeatures(undefined, { layers: [layer] }).length
            );
          }
        }
      } catch {
        // layers not ready yet
      }
    } else if (useMapStore.getState().tileViewFlockCount !== null) {
      useMapStore.getState().setTileViewFlockCount(null);
    }
```

Pass `cones={!isLeakMode}` to both `<CameraTileLayers>` instances.

Mount the Flock layers and popup after the `CameraMarkerLayers` block:

```tsx
      {/* Flock Leak: the leaked inventory, keyed by host epoch (failover
          remount) and by the store's retry epoch. Only mounted on the tab. */}
      {isLeakMode && (
        <FlockLeakLayers
          key={`flock-${tilesEpoch}-${leakSourceEpoch}`}
          sourceUrl={flockLeakTileJsonUrl()}
          visible={showCameraLayer}
        />
      )}
      {isLeakMode && <FlockLeakPopup />}
```

- [ ] **Step 10: Type-check, lint, test**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: all pass. If `map.keyboard.disableRotation` is flagged by types, cast: `(map.keyboard as unknown as { disableRotation(): void }).disableRotation()` (the method exists at runtime in MapLibre 5.15; verified 2026-09-23).

- [ ] **Step 11: Smoke it in the browser**

`npm run dev`, open `http://localhost:3000/leak?lat=29.7604&lng=-95.3698&zoom=12`. Until the real tileset is published the source 404s; confirm: no uncaught errors, the console warns once about the Flock source, and the OSM layer is hidden (Flock view). Then temporarily point `flockLeakTileJsonUrl` at the OSM camera TileJSON (`cameras-us-hourly.json`, source layer `cameras`) in a scratch edit to see red dots and icons render, tap one, confirm the popup and the hint line, then revert the scratch edit. Rotate with right-drag: the map must stay north-up; switch to Map tab: rotation works again.

- [ ] **Step 12: Commit**

```bash
git add src/components/map/layers/flockLeakIcons.ts src/components/map/layers/flockLeakIcons.test.ts src/components/map/layers/FlockLeakLayers.tsx src/components/map/FlockLeakPopup.tsx src/components/map/layers/CameraTileLayers.tsx src/store/mapStore.ts src/components/map/MapLibreContainer.tsx
git commit -m "feat(leak): Flock tile layers with runtime icons, device popup, north-up lock, counts and error handling"
```

---

### Task 9: Swipe: the imperative filter hook, the track, the view switch

**Files:**
- Create: `src/hooks/useSwipeFilters.ts`, `src/components/map/SwipeTrack.tsx`, `src/components/map/FlockViewSwitch.tsx`
- Modify: `src/components/map/MapLibreContainer.tsx` (hook wiring)
- Modify: `src/pages/MapPage.tsx` (overlays)
- Modify: `src/components/panels/MobileTabDrawer.tsx` (peek `extra`)
- Modify: `src/index.css` (track, chips, divider)

**Interfaces:**
- Consumes: Tasks 5, 6, 8.
- Produces:
  - `useSwipeFilters(mapRef: RefObject<MapRef>, enabled: boolean, targets: SwipeTargets, mapLoaded: boolean): void` with `interface SwipeTargets { osmLayerIds: string[]; osmBaseFilter?: FilterSpecification; flockLayerIds: string[]; flockBaseFilter?: FilterSpecification }`
  - `<SwipeTrack />` (renders nothing unless `view === 'swipe'`)
  - `<FlockViewSwitch className? />`

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useSwipeFilters.ts`:

```ts
import { useEffect, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { FilterSpecification } from 'maplibre-gl';
import { useFlockLeakStore } from '../store/flockLeakStore';
import { planSwipe, dividerLongitude, type SwipeLayerState } from '../utils/swipeFilter';

export interface SwipeTargets {
  osmLayerIds: string[];
  osmBaseFilter?: FilterSpecification;
  flockLayerIds: string[];
  flockBaseFilter?: FilterSpecification;
}

/** Minimum gap between filter updates during a drag (20 per second). */
const MIN_INTERVAL_MS = 50;

/**
 * Drives the Swipe view without React commits: subscribes to the store's
 * divider, coalesces updates to one per animation frame and at most 20 per
 * second, and sets `within` filters on the OSM and Flock point layers.
 * MapLibre's setFilter deep-compares, so re-applying an unchanged filter
 * (on idle, on moveend) costs nothing. On disable every layer gets its base
 * filter back. The hook never touches layer visibility: react-map-gl applies
 * the declarative `layout.visibility` during render, and a cleanup that
 * restored 'visible' would re-show the OSM layer after a switch from Swipe
 * to the Flock-only view. A side is hidden through NEVER_MATCH instead.
 */
export function useSwipeFilters(
  mapRef: RefObject<MapRef>,
  enabled: boolean,
  targets: SwipeTargets,
  mapLoaded: boolean
): void {
  const osmKey = targets.osmLayerIds.join(',');
  const flockKey = targets.flockLayerIds.join(',');
  const { osmBaseFilter, flockBaseFilter } = targets;

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded || !enabled) return;
    const osmIds = osmKey ? osmKey.split(',') : [];
    const flockIds = flockKey ? flockKey.split(',') : [];

    const applyFilter = (id: string, state: SwipeLayerState) => {
      if (!map.getLayer(id)) return;
      map.setFilter(id, state.filter ?? null, { validate: false });
    };

    const apply = (divider: number) => {
      const plan = planSwipe(divider, dividerLongitude(map, divider), {
        osm: osmBaseFilter,
        flock: flockBaseFilter,
      });
      for (const id of osmIds) applyFilter(id, plan.osm);
      for (const id of flockIds) applyFilter(id, plan.flock);
    };

    let raf = 0;
    let pending: number | null = null;
    let lastAt = 0;
    const tick = () => {
      raf = 0;
      const now = performance.now();
      if (now - lastAt < MIN_INTERVAL_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (pending !== null) {
        lastAt = now;
        apply(pending);
        pending = null;
      }
    };
    const schedule = (divider: number) => {
      pending = divider;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const unsubscribe = useFlockLeakStore.subscribe((s, prev) => {
      if (s.divider !== prev.divider) schedule(s.divider);
    });
    // Panning moves the longitude under a fixed divider; idle covers layers
    // that mount after this effect ran (setFilter dedupes unchanged filters).
    const reapply = () => apply(useFlockLeakStore.getState().divider);
    map.on('moveend', reapply);
    map.on('idle', reapply);
    apply(useFlockLeakStore.getState().divider);

    return () => {
      unsubscribe();
      map.off('moveend', reapply);
      map.off('idle', reapply);
      if (raf) cancelAnimationFrame(raf);
      const restore = (ids: string[], base: FilterSpecification | undefined) => {
        for (const id of ids) {
          if (map.getLayer(id)) map.setFilter(id, base ?? null, { validate: false });
        }
      };
      restore(osmIds, osmBaseFilter);
      restore(flockIds, flockBaseFilter);
    };
  }, [mapRef, enabled, mapLoaded, osmKey, flockKey, osmBaseFilter, flockBaseFilter]);
}
```

- [ ] **Step 2: Wire the hook in the map container**

In `src/components/map/MapLibreContainer.tsx` add imports:

```ts
import { useSwipeFilters, type SwipeTargets } from '../../hooks/useSwipeFilters';
import { flockLayerFilter } from '../../utils/flockLeakFilter';
```

After the `tileFilterExpr` memo, add:

```ts
  // Swipe targets: whichever OSM tile instance is live plus the Flock layers,
  // each with the base filter the declarative layers already carry.
  const leakTypes = useFlockLeakStore(s => s.types);
  const leakStatuses = useFlockLeakStore(s => s.statuses);
  const swipeTargets = useMemo<SwipeTargets>(() => ({
    osmLayerIds: isFilterTilesMode
      ? ['camera-tile-glow-filtered', 'camera-tile-dots-filtered', 'camera-tile-points-filtered']
      : ['camera-tile-glow', 'camera-tile-dots', 'camera-tile-points'],
    osmBaseFilter: isFilterTilesMode ? tileFilterExpr : undefined,
    flockLayerIds: [FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_POINTS_LAYER],
    flockBaseFilter: flockLayerFilter(leakTypes, leakStatuses),
  }), [isFilterTilesMode, tileFilterExpr, leakTypes, leakStatuses]);
  useSwipeFilters(mapRef, isLeakMode && leakView === 'swipe', swipeTargets, mapLoaded);
```

(`isFilterTilesMode` and `isLeakMode`/`leakView` are declared above this point in the component; if not, move this block below them.)

- [ ] **Step 3: Implement the view switch**

Create `src/components/map/FlockViewSwitch.tsx`:

```tsx
import { useFlockLeakStore, type FlockLeakView } from '../../store/flockLeakStore';

const VIEWS: Array<{ id: FlockLeakView; label: string }> = [
  { id: 'flock', label: 'Flock' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'overlay', label: 'Overlay' },
];

/** Flock / Swipe / Overlay. The one control the mobile peek carries. */
export function FlockViewSwitch({ className = '' }: { className?: string }) {
  const view = useFlockLeakStore((s) => s.view);
  const setView = useFlockLeakStore((s) => s.setView);
  return (
    <div
      role="tablist"
      aria-label="Compare view"
      className={`flex rounded-md border border-hairline overflow-hidden text-xs font-semibold ${className}`}
    >
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          onClick={() => setView(v.id)}
          className={`flex-1 px-3 py-2 min-h-9 transition-colors ${
            view === v.id ? 'bg-accent text-white' : 'text-dark-400 hover:text-white active:text-white'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement the track and divider line**

Create `src/components/map/SwipeTrack.tsx`:

```tsx
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';

/**
 * Swipe view controls, rendered over the map area. The divider line and the
 * range input follow the store without React commits (direct DOM writes from
 * a store subscription). On touch the line is not grabbable, so it never
 * fights the pan; the track above the drawer moves it. On desktop the line
 * also carries a grab handle.
 */
export function SwipeTrack() {
  const view = useFlockLeakStore((s) => s.view);
  const setDivider = useFlockLeakStore((s) => s.setDivider);
  const isMobile = useIsMobile();
  const lineRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view !== 'swipe') return;
    const paint = (d: number) => {
      if (lineRef.current) lineRef.current.style.left = `${d * 100}%`;
      const input = inputRef.current;
      if (input) {
        input.style.setProperty('--swipe-pct', `${d * 100}%`);
        if (document.activeElement !== input) input.value = String(Math.round(d * 1000));
      }
    };
    paint(useFlockLeakStore.getState().divider);
    return useFlockLeakStore.subscribe((s, prev) => {
      if (s.divider !== prev.divider) paint(s.divider);
    });
  }, [view]);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const host = lineRef.current?.parentElement;
    if (!host) return;
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => setDivider((ev.clientX - rect.left) / rect.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (view !== 'swipe') return null;

  return (
    <>
      <div
        ref={lineRef}
        className="swipe-divider absolute top-0 bottom-0 z-20 w-px bg-white/85 shadow-[0_0_8px_rgba(0,0,0,0.8)] pointer-events-none"
        style={{ left: '50%' }}
        aria-hidden="true"
      >
        {!isMobile && (
          <button
            type="button"
            aria-label="Drag to compare"
            onPointerDown={onHandlePointerDown}
            className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white text-dark-900 shadow-lg shadow-black/60 flex items-center justify-center cursor-ew-resize"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 7l-5 5 5 5V7zm8 0v10l5-5-5-5z" />
            </svg>
          </button>
        )}
      </div>
      <div className="swipe-chip swipe-chip-osm">OSM · live</div>
      <div className="swipe-chip swipe-chip-flock">Flock · {FLOCK_LEAK_SNAPSHOT_LABEL}</div>
      <div className="swipe-track">
        <span className="swipe-track-label text-[#93CBFF]">OSM</span>
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={1000}
          defaultValue={500}
          aria-label="Compare divider"
          onInput={(e) => setDivider(Number(e.currentTarget.value) / 1000)}
          className="swipe-range"
        />
        <span className="swipe-track-label text-right text-[#fca5a5]">Flock</span>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Styles**

Append to `src/index.css` (before the `@media (max-width: 1023px)` block that starts with `/* Mobile-specific styles for main map page`):

```css
/* Flock Leak swipe: track, divider chips. Desktop values; mobile below. */
.map-page .swipe-track {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 72px;
  width: min(420px, calc(100% - 32px));
  height: 44px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-radius: 12px;
  background: rgba(16, 16, 24, 0.94);
  border: 1px solid #252530;
}
.map-page .swipe-track-label {
  width: 36px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.map-page .swipe-range {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  appearance: none;
  -webkit-appearance: none;
  background: linear-gradient(90deg, #2196E8 0%, #2196E8 var(--swipe-pct, 50%), #ef4444 var(--swipe-pct, 50%), #ef4444 100%);
}
.map-page .swipe-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
  cursor: ew-resize;
}
.map-page .swipe-range::-moz-range-thumb {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.map-page .swipe-chip {
  position: absolute;
  top: 64px;
  z-index: 20;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(10, 10, 15, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.14);
  pointer-events: none;
}
.map-page .swipe-chip-osm { left: 16px; color: #93CBFF; }
.map-page .swipe-chip-flock { right: 16px; color: #fca5a5; border-color: rgba(239, 68, 68, 0.4); }
```

Inside the existing `@media (max-width: 1023px)` block, append:

```css
  .map-page .swipe-track {
    bottom: calc(var(--drawer-height, 80px) + 12px);
    width: calc(100% - 24px);
    height: 40px;
  }
  .map-page .swipe-chip { top: 52px; }
  .map-page .swipe-chip-osm { left: 12px; }
  .map-page .swipe-chip-flock { right: 56px; }
```

- [ ] **Step 6: Mount the overlays**

In `src/pages/MapPage.tsx` add imports:

```ts
import { SwipeTrack } from '@/components/map/SwipeTrack';
import { FlockViewSwitch } from '@/components/map/FlockViewSwitch';
```

Inside `<main>`, after `<MapThemeControl />`:

```tsx
            {appMode === 'leak' && <SwipeTrack />}
            {appMode === 'leak' && !isMobile && (
              <div className="absolute top-4 right-4 z-30 w-[280px]">
                <FlockViewSwitch className="bg-dark-800/95 backdrop-blur" />
              </div>
            )}
```

- [ ] **Step 7: The peek carries the switch**

In `src/components/panels/MobileTabDrawer.tsx`, import `FlockViewSwitch` from `'../map/FlockViewSwitch'` and change the `IdentityRow` `extra` prop:

```tsx
            extra={
              appMode === 'leak'
                ? <FlockViewSwitch className="mt-3" />
                : appMode === 'network'
                  ? (
                    <div className="mt-3 flex items-center justify-center gap-1 text-dark-400">
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-medium">Swipe up for details</span>
                    </div>
                  )
                  : undefined
            }
```

- [ ] **Step 8: Type-check, lint, test**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 9: Browser check on desktop and a phone-sized window**

`npm run dev`. With the scratch TileJSON swap from Task 8 Step 11 in place (so both sides have data), open `/leak?lat=29.7604&lng=-95.3698&zoom=12`, tap Swipe. Expected: divider line at center, OSM marks left, Flock marks right, chips in the top corners, the track above the drawer on a 390 px window and above the pill zone on desktop. Drag the track: the line follows, marks update within a frame or two, no console errors. Drag to each end: one side vanishes entirely. Switch to Overlay: both sides everywhere; switch to Flock: OSM hidden. Switch to the Map tab: cameras and cones render as before. Revert the scratch swap.

- [ ] **Step 10: Phone check (spec section 15)**

Run `npm run dev -- --host`, open the LAN URL on a mid-range Android and an iPhone 12 class device, tap Swipe, drag the track for ten seconds. Pass: the divider follows the thumb without visible stutter. Record the devices and the verdict in the PR description. A fail stops here (report; do not build the two-map fallback).

- [ ] **Step 11: Commit**

```bash
git add src/hooks/useSwipeFilters.ts src/components/map/SwipeTrack.tsx src/components/map/FlockViewSwitch.tsx src/components/map/MapLibreContainer.tsx src/pages/MapPage.tsx src/components/panels/MobileTabDrawer.tsx src/index.css
git commit -m "feat(leak): single-map swipe with within filters, docked track, and the Flock/Swipe/Overlay switch"
```

---

### Task 10: Type and status filters on the map, and the OSM filter on the Leak tab

**Files:**
- Create: `src/components/map/FlockFilterChips.tsx`, `src/components/map/FlockLeakFilterControl.tsx`
- Modify: `src/components/map/CameraFilterControl.tsx:476`
- Modify: `src/index.css` (control slot)

**Interfaces:**
- Consumes: Tasks 2, 6, 8 (`FLOCK_TYPE_COLOR`).
- Produces: `<TypeSwatch type />`, `<FlockFilterChips counts? />` (type row + status row, wired to the store), `<FlockLeakFilterControl />` (leak mode only).

- [ ] **Step 1: Implement the shared chips**

Create `src/components/map/FlockFilterChips.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_SELECTABLE_TYPES,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_TYPE_LABEL,
  FLOCK_STATUS_LABEL,
  type FlockDeviceType,
} from '../../lib/flockTypeNormalization';
import { FLOCK_TYPE_COLOR } from './layers/flockLeakIcons';

/** Legend and chip swatch: the same shape language as the map icons. */
export function TypeSwatch({ type, size = 8 }: { type: FlockDeviceType; size?: number }) {
  const color = FLOCK_TYPE_COLOR[type];
  const base = { width: size, height: size, display: 'inline-block', flexShrink: 0 } as const;
  switch (type) {
    case 'alpr':
      return <i style={{ ...base, background: color, borderRadius: 1 }} aria-hidden="true" />;
    case 'condor':
      return <i style={{ ...base, background: color, transform: 'rotate(45deg) scale(0.85)' }} aria-hidden="true" />;
    case 'raven':
      return <i style={{ ...base, border: `2px solid ${color}`, borderRadius: '50%', boxSizing: 'border-box' }} aria-hidden="true" />;
    case 'drone':
      return (
        <i
          style={{
            ...base,
            width: 0,
            height: 0,
            borderLeft: `${size / 2}px solid transparent`,
            borderRight: `${size / 2}px solid transparent`,
            borderBottom: `${size}px solid ${color}`,
          }}
          aria-hidden="true"
        />
      );
    default:
      return <i style={{ ...base, background: color, borderRadius: '50%' }} aria-hidden="true" />;
  }
}

function Chip({
  on,
  onClick,
  children,
  count,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
        on ? 'border-white/40 bg-white/[0.06] text-white' : 'border-hairline text-dark-400 hover:text-dark-200'
      }`}
    >
      {children}
      {count !== undefined && <span className="text-2xs text-dark-500 tabular-nums">{count.toLocaleString()}</span>}
    </button>
  );
}

interface FlockFilterChipsProps {
  /** Canonical counts from the TileJSON stats; omitted when unavailable. */
  typeCounts?: Record<FlockDeviceType, number>;
}

export function FlockFilterChips({ typeCounts }: FlockFilterChipsProps) {
  const types = useFlockLeakStore((s) => s.types);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const toggleType = useFlockLeakStore((s) => s.toggleType);
  const clearTypes = useFlockLeakStore((s) => s.clearTypes);
  const toggleStatus = useFlockLeakStore((s) => s.toggleStatus);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-2xs uppercase text-dark-500 mb-1.5">Device type</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={types.length === 0} onClick={clearTypes}>All</Chip>
          {FLOCK_SELECTABLE_TYPES.map((t) => (
            <Chip key={t} on={types.includes(t)} onClick={() => toggleType(t)} count={typeCounts?.[t]}>
              <TypeSwatch type={t} />
              {FLOCK_TYPE_LABEL[t]}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <p className="text-2xs uppercase text-dark-500 mb-1.5">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {FLOCK_SELECTABLE_STATUSES.map((s) => (
            <Chip key={s} on={statuses.includes(s)} onClick={() => toggleStatus(s)}>
              {FLOCK_STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the map control**

Create `src/components/map/FlockLeakFilterControl.tsx`:

```tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import { Filter } from 'lucide-react';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlockLeakStore, activeFlockFilterCount } from '../../store/flockLeakStore';
import { canonicalTypeCounts } from '../../lib/flockTypeNormalization';
import { FlockFilterChips } from './FlockFilterChips';

/** Flock device filters: a button in the left control column (the country
 *  switch's slot, which is hidden on this tab) opening type and status chips.
 *  Same popover idiom as BoundaryControl. Leak mode only. */
export function FlockLeakFilterControl() {
  const appMode = useAppModeStore((s) => s.appMode);
  const types = useFlockLeakStore((s) => s.types);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const stats = useFlockLeakStore((s) => s.tileJson?.stats);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const typeCounts = useMemo(() => (stats?.byType ? canonicalTypeCounts(stats.byType) : undefined), [stats]);
  const badge = activeFlockFilterCount({ types, statuses });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (appMode !== 'leak') return null;

  return (
    <div ref={panelRef} className="map-flock-filter-control absolute z-10 flex flex-col items-start">
      {open && (
        <div className="absolute z-10 bottom-full left-0 mb-3 w-64 bg-dark-800 rounded-md border border-dark-600 shadow-xl shadow-black/40">
          <div className="px-3 py-2 border-b border-dark-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Flock devices</span>
          </div>
          <div className="p-3">
            <FlockFilterChips typeCounts={typeCounts} />
            <p className="mt-3 pt-3 border-t border-dark-600 text-[11px] text-dark-500 leading-snug">
              Type and status are Flock's own labels, as of Dec 2025.
            </p>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Flock device filters"
        aria-expanded={open}
        title="Flock device filters"
        className={`filter-trigger relative z-0 w-[40px] h-[40px] flex items-center justify-center rounded-md transition-colors
          bg-dark-800 border border-dark-600
          ${open || badge > 0 ? 'text-danger' : 'text-dark-300 hover:bg-dark-700'}`}
      >
        <Filter className="w-4 h-4" />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center tabular-nums border-2 border-dark-900">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Let the OSM filter control show on the Leak tab**

In `src/components/map/CameraFilterControl.tsx` line 476, change:

```ts
  if (appMode !== 'map') return null;
```

to:

```ts
  // Map and Flock Leak: on the Leak tab the OSM filters narrow the OSM side of
  // the compare (for example, OSM cameras tagged Flock).
  if (appMode !== 'map' && appMode !== 'leak') return null;
```

- [ ] **Step 4: Control slot CSS**

In `src/index.css`, after the `.map-page .map-filter-control` desktop rule add:

```css
/* Flock Leak device filters take the country button's slot (hidden on that tab) */
.map-page .map-flock-filter-control {
  bottom: 72px;
  left: 16px;
}
```

and inside the `@media (max-width: 1023px)` block, after the `.map-page .map-filter-control .filter-trigger` rule:

```css
  .map-page .map-flock-filter-control {
    bottom: calc(var(--drawer-height, 80px) + 76px);
    left: 12px;
  }
  .map-page .map-flock-filter-control .filter-trigger {
    width: 38px;
    height: 38px;
  }
```

- [ ] **Step 5: Mount it**

In `src/pages/MapPage.tsx` import `FlockLeakFilterControl` from `'@/components/map/FlockLeakFilterControl'` and add, next to `<CameraFilterControl />`:

```tsx
            {appMode === 'leak' && <FlockLeakFilterControl />}
```

- [ ] **Step 6: Type-check, lint, test, browser**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: pass. In the browser on `/leak`: two buttons in the left column (Flock filters above, OSM filters below), the Flock badge reads 1 by default, toggling Planned adds a chip state and the badge drops to 0 once all three statuses are on, toggling Condor narrows the marks (with the scratch data swap from Task 8 the chips still work against the OSM attributes, all of which normalize to `other`, so expect the map to empty when only ALPR is selected; that is the normalizer doing its job on non-Flock data).

- [ ] **Step 7: Commit**

```bash
git add src/components/map/FlockFilterChips.tsx src/components/map/FlockLeakFilterControl.tsx src/components/map/CameraFilterControl.tsx src/index.css src/pages/MapPage.tsx
git commit -m "feat(leak): device type and status filters on the map; OSM filters available on the Leak tab"
```

---

### Task 11: Panels, drawer sheet, header count, status pill

**Files:**
- Create: `src/components/panels/FlockLeakPanelContent.tsx`, `src/components/panels/FlockLeakPanel.tsx`, `src/components/map/FlockHeaderCount.tsx`, `src/components/map/FlockLeakStatusPill.tsx`, `src/utils/flockHeaderCount.ts`
- Test: `src/utils/flockHeaderCount.test.ts`
- Modify: `src/pages/MapPage.tsx` (panel, pill, header count, TileJSON load), `src/components/panels/MobileTabDrawer.tsx` (full sheet), `src/components/panels/index.ts`

**Interfaces:**
- Consumes: Tasks 6, 9, 10.
- Produces:
  - `FLOCK_LEAK_COPY` (every string from spec section 9)
  - `<FlockLeakPanelContent showViewSwitch? showFilters? />`, `<FlockLeakPanel />` (desktop)
  - `formatFlockHeaderCount(input: { zoom: number; view: FlockLeakView; total: number | null; flockCount: number | null; osmCount: number | null }): string`, `<FlockHeaderCount />`
  - `<FlockLeakStatusPill />`

- [ ] **Step 1: Write the failing header count tests**

Create `src/utils/flockHeaderCount.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatFlockHeaderCount } from './flockHeaderCount';

describe('formatFlockHeaderCount', () => {
  it('shows the snapshot total below z6 when known', () => {
    expect(formatFlockHeaderCount({ zoom: 4, view: 'flock', total: 84120, flockCount: null, osmCount: null }))
      .toBe('84,120 Flock devices');
  });

  it('shows the in-view Flock count in Flock view', () => {
    expect(formatFlockHeaderCount({ zoom: 12, view: 'flock', total: 84120, flockCount: 38, osmCount: 31 }))
      .toBe('38 Flock in view');
  });

  it('shows both counts in Swipe and Overlay', () => {
    expect(formatFlockHeaderCount({ zoom: 12, view: 'swipe', total: null, flockCount: 38, osmCount: 31 }))
      .toBe('31 OSM · 38 Flock in view');
    expect(formatFlockHeaderCount({ zoom: 12, view: 'overlay', total: null, flockCount: 1200, osmCount: 900 }))
      .toBe('900 OSM · 1,200 Flock in view');
  });

  it('uses an ellipsis while a count is unknown', () => {
    expect(formatFlockHeaderCount({ zoom: 12, view: 'flock', total: null, flockCount: null, osmCount: null }))
      .toBe('… Flock in view');
    expect(formatFlockHeaderCount({ zoom: 12, view: 'swipe', total: null, flockCount: 5, osmCount: null }))
      .toBe('… OSM · 5 Flock in view');
  });

  it('falls back to in-view wording below z6 when the total is unknown', () => {
    expect(formatFlockHeaderCount({ zoom: 4, view: 'flock', total: null, flockCount: null, osmCount: null }))
      .toBe('… Flock in view');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/flockHeaderCount.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the formatter and the header count**

Create `src/utils/flockHeaderCount.ts`:

```ts
import type { FlockLeakView } from '../store/flockLeakStore';

const n = (v: number | null): string => (v === null ? '…' : v.toLocaleString());

/** Mobile header line on the Leak tab (spec section 7). */
export function formatFlockHeaderCount(input: {
  zoom: number;
  view: FlockLeakView;
  total: number | null;
  flockCount: number | null;
  osmCount: number | null;
}): string {
  if (input.zoom < 6 && input.total !== null) return `${input.total.toLocaleString()} Flock devices`;
  if (input.view === 'flock') return `${n(input.flockCount)} Flock in view`;
  return `${n(input.osmCount)} OSM · ${n(input.flockCount)} Flock in view`;
}
```

Create `src/components/map/FlockHeaderCount.tsx`:

```tsx
import { useMapStore } from '../../store';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { formatFlockHeaderCount } from '../../utils/flockHeaderCount';

/** Leak-tab counterpart of HeaderCameraCount. Idle-driven counts only. */
export function FlockHeaderCount({ className = '' }: { className?: string }) {
  const zoom = useMapStore((s) => s.zoom);
  const flockCount = useMapStore((s) => s.tileViewFlockCount);
  const osmCount = useMapStore((s) => s.tileViewCameraCount);
  const view = useFlockLeakStore((s) => s.view);
  const total = useFlockLeakStore((s) => s.tileJson?.stats?.total ?? null);
  return (
    <span className={`text-xs text-dark-400 tabular-nums ${className}`}>
      {formatFlockHeaderCount({ zoom, view, total, flockCount, osmCount })}
    </span>
  );
}
```

- [ ] **Step 4: Run the formatter tests**

Run: `npx vitest run src/utils/flockHeaderCount.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the shared panel content**

Create `src/components/panels/FlockLeakPanelContent.tsx`:

```tsx
import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { FLOCK_LEAK_STORY_URL } from '../../services/flockLeakTilesService';
import { canonicalTypeCounts, FLOCK_SELECTABLE_TYPES, FLOCK_TYPE_LABEL } from '../../lib/flockTypeNormalization';
import { FlockFilterChips, TypeSwatch } from '../map/FlockFilterChips';
import { FlockViewSwitch } from '../map/FlockViewSwitch';

/** Every user-facing string on the tab (spec section 9). No em dashes. */
export const FLOCK_LEAK_COPY = {
  title: 'Flock Leak',
  subtitle: 'Leaked Flock device inventory, December 2025',
  peek: "Flock's own device list, leaked Dec 2025.",
  osmTitle: 'OpenStreetMap',
  osm: 'Crowdsourced by volunteers. Updated hourly. Can be incomplete or mis-tagged.',
  flockTitle: 'Flock leak',
  flock: "Flock's own inventory, exposed by a security researcher. Snapshot from December 2025. Never updated.",
  warning: 'Nine months separate these datasets. A device on one side and not the other proves nothing. Verify in person before editing OSM.',
  about: "This data comes from a security researcher's disclosure of Flock Safety's internal device inventory, published at flocksurveillance.org. DeFlock is not affiliated with Flock Safety.",
  aboutLink: 'Read the story',
  cta: 'Found a camera that is not on OSM? Verify it in person, then add it with the DeFlock app.',
  ctaButton: 'Download the DeFlock App',
  pillError: 'Flock data unavailable. Tap to retry.',
  pillLoading: 'Loading Flock data',
} as const;

function OsmDot() {
  return <span className="w-2.5 h-2.5 rounded-full bg-[#2196E8] border border-[#93CBFF] shadow-[0_0_6px_rgba(77,166,255,0.6)] inline-block flex-shrink-0" aria-hidden="true" />;
}

function FlockSquare() {
  return <span className="w-2.5 h-2.5 rounded-[1px] bg-danger border border-white/70 inline-block flex-shrink-0" aria-hidden="true" />;
}

export function FlockLeakLegend() {
  return (
    <div className="space-y-1.5 text-xs text-dark-300">
      <div className="flex items-center gap-2"><OsmDot /><span>OSM camera (crowdsourced, live)</span></div>
      <div className="flex items-center gap-3 flex-wrap">
        {FLOCK_SELECTABLE_TYPES.map((t) => (
          <span key={t} className="flex items-center gap-1.5"><TypeSwatch type={t} />Flock {FLOCK_TYPE_LABEL[t]}</span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 border border-dashed border-danger inline-block" aria-hidden="true" />Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-danger/35 inline-block" aria-hidden="true" />Decommissioned
        </span>
      </div>
    </div>
  );
}

interface FlockLeakPanelContentProps {
  showViewSwitch?: boolean;
  showFilters?: boolean;
}

/** Shared by the desktop panel and the mobile full sheet. */
export function FlockLeakPanelContent({ showViewSwitch = false, showFilters = false }: FlockLeakPanelContentProps) {
  const stats = useFlockLeakStore((s) => s.tileJson?.stats);
  const typeCounts = useMemo(() => (stats?.byType ? canonicalTypeCounts(stats.byType) : undefined), [stats]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-hairline bg-dark-800/60">
          <span className="mt-1"><OsmDot /></span>
          <div>
            <p className="text-sm font-semibold text-white">{FLOCK_LEAK_COPY.osmTitle}</p>
            <p className="text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.osm}</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-hairline bg-dark-800/60">
          <span className="mt-1"><FlockSquare /></span>
          <div>
            <p className="text-sm font-semibold text-white">{FLOCK_LEAK_COPY.flockTitle}</p>
            <p className="text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.flock}</p>
          </div>
        </div>
      </div>

      {showViewSwitch && <FlockViewSwitch />}

      {showFilters && <FlockFilterChips typeCounts={typeCounts} />}

      <FlockLeakLegend />

      <div className="p-3 rounded-lg border border-danger/30 bg-danger/[0.08]">
        <p className="text-xs text-dark-200 leading-relaxed">{FLOCK_LEAK_COPY.warning}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.about}</p>
        <a
          href={FLOCK_LEAK_STORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          {FLOCK_LEAK_COPY.aboutLink}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>

      <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 space-y-3">
        <p className="text-xs text-dark-300 leading-relaxed">{FLOCK_LEAK_COPY.cta}</p>
        <a
          href="https://deflock.org/app"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center px-4 py-2.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          {FLOCK_LEAK_COPY.ctaButton}
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement the desktop panel**

Create `src/components/panels/FlockLeakPanel.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Radar } from 'lucide-react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { FlockLeakPanelContent, FLOCK_LEAK_COPY } from './FlockLeakPanelContent';

/** Desktop side panel for the Flock Leak tab (MapPage mounts it only above lg). */
export function FlockLeakPanel() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const total = useFlockLeakStore((s) => s.tileJson?.stats?.total ?? null);

  useEffect(() => {
    const timer = setTimeout(() => setHasAnimated(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <div
        className={`h-full border-r border-dark-700/50 bg-dark-900 flex flex-col transition-all duration-300 ease-out overflow-hidden ${
          hasAnimated ? '' : 'opacity-0 -translate-x-4'
        }`}
        style={{ width: isCollapsed ? 0 : 400, minWidth: isCollapsed ? 0 : 400 }}
      >
        <div className="flex-shrink-0 px-6 py-5 border-b border-dark-700/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-danger/10 border border-danger/35 flex items-center justify-center flex-shrink-0">
              <Radar className="w-[18px] h-[18px] text-danger" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{FLOCK_LEAK_COPY.title}</h2>
              <p className="text-xs text-dark-400">
                {FLOCK_LEAK_COPY.subtitle}
                {total !== null && <> · {total.toLocaleString()} devices</>}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <FlockLeakPanelContent showViewSwitch showFilters />
        </div>

        <div className="flex-shrink-0 px-6 py-3 border-t border-dark-700/50 bg-dark-800/50">
          <p className="text-[10px] text-dark-500 text-center">
            Maps by{' '}
            <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
          </p>
        </div>
      </div>

      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute top-1/2 -translate-y-1/2 z-20 w-6 h-16 bg-dark-800 border border-dark-700/50 rounded-r-lg flex items-center justify-center hover:bg-dark-700 transition-colors"
        style={{ left: isCollapsed ? 0 : 400 }}
        aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4 text-dark-400" /> : <ChevronLeft className="w-4 h-4 text-dark-400" />}
      </button>
    </>
  );
}
```

Add to `src/components/panels/index.ts`:

```ts
export { FlockLeakPanel } from './FlockLeakPanel';
export { FlockLeakPanelContent } from './FlockLeakPanelContent';
```

- [ ] **Step 7: Implement the status pill**

Create `src/components/map/FlockLeakStatusPill.tsx`:

```tsx
import { StatusPill } from '@/components/common/StatusPill';
import { useFlockLeakStore } from '@/store/flockLeakStore';
import { FLOCK_LEAK_COPY } from '@/components/panels/FlockLeakPanelContent';

/** Leak-tab pill: TileJSON or tile failure is a tap-to-retry, never a blank map. */
export function FlockLeakStatusPill() {
  const loadPhase = useFlockLeakStore((s) => s.loadPhase);
  const tilesFailed = useFlockLeakStore((s) => s.tilesFailed);
  const retry = useFlockLeakStore((s) => s.retry);

  if (loadPhase === 'error' || tilesFailed) {
    return <StatusPill loading={false} text="" error={FLOCK_LEAK_COPY.pillError} onRetry={retry} />;
  }
  return <StatusPill loading={loadPhase === 'loading'} text={FLOCK_LEAK_COPY.pillLoading} />;
}
```

- [ ] **Step 8: Wire the page**

In `src/pages/MapPage.tsx`:

Imports:

```ts
import { FlockLeakPanel } from '@/components/panels/FlockLeakPanel';
import { FlockLeakStatusPill } from '@/components/map/FlockLeakStatusPill';
import { FlockHeaderCount } from '@/components/map/FlockHeaderCount';
import { useFlockLeakStore } from '@/store/flockLeakStore';
```

Load the TileJSON whenever the tab is active (one place, covers embed mode too). Add after `useUrlSync();`:

```ts
  // Flock Leak: the TileJSON carries the snapshot stats the header and chips
  // show. Loaded once per session; retry lives in the store.
  useEffect(() => {
    if (appMode === 'leak') void useFlockLeakStore.getState().ensureTileJsonLoaded();
  }, [appMode]);
```

Header count: change the mobile count line to:

```tsx
                {appMode === 'leak'
                  ? <FlockHeaderCount />
                  : appMode !== 'explore' && appMode !== 'network' && <HeaderCameraCount />}
```

Desktop panel, after the Explore line:

```tsx
          {!isMobile && appMode === 'leak' && <FlockLeakPanel />}
```

Pill, next to the Network pill:

```tsx
            {appMode === 'leak' && <FlockLeakStatusPill />}
```

- [ ] **Step 9: Wire the drawer's full sheet**

In `src/components/panels/MobileTabDrawer.tsx` import `FlockLeakPanelContent` from `'./FlockLeakPanelContent'` and add a case to `renderTabContent` before `/* ---------- NETWORK ---------- */`:

```tsx
      /* ---------- FLOCK LEAK ---------- */
      case 'leak':
        return (
          <div className="pb-8">
            <FlockLeakPanelContent />
            <DrawerFooter />
          </div>
        );
```

- [ ] **Step 10: Type-check, lint, test, browser**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: pass. Browser: desktop `/leak` shows the panel with provenance rows, the switch, chips, legend, warning, about link and CTA; the pill reads "Flock data unavailable. Tap to retry." while the tileset is unpublished; the mobile header reads "… Flock in view" at z12 and the full sheet shows the same content without the switch or chips. Confirm the peek is still 180 px tall: in DevTools, the `[role="dialog"]` height at peek equals the Network tab's.

- [ ] **Step 11: Commit**

```bash
git add src/components/panels/FlockLeakPanelContent.tsx src/components/panels/FlockLeakPanel.tsx src/components/panels/index.ts src/components/map/FlockHeaderCount.tsx src/components/map/FlockLeakStatusPill.tsx src/utils/flockHeaderCount.ts src/utils/flockHeaderCount.test.ts src/pages/MapPage.tsx src/components/panels/MobileTabDrawer.tsx
git commit -m "feat(leak): desktop panel, drawer sheet, header counts, and the retry pill"
```

---

### Task 12: Documentation, browser checks, performance gate

**Files:**
- Modify: `CLAUDE.md` (App Modes, Critical Files, State, Directory, Data Sources)
- Create: `.superpowers/check-flock-leak.mjs`, `.superpowers/drag-perf-leak.mjs` (gitignored)

**Interfaces:**
- Consumes: everything above.
- Produces: docs matching the code; a repeatable browser check; a perf number against the 2026-07-18 baselines.

- [ ] **Step 1: Update CLAUDE.md**

App Modes: change to `The map has 5 modes` and add after Timeline:

```
- **Flock Leak**: the leaked Flock device inventory (Dec 2025 snapshot) next to OSM, with Flock / Swipe / Overlay views on one map (`src/store/flockLeakStore.ts`, `src/hooks/useSwipeFilters.ts`)
```

Critical Files: add rows for `src/services/flockLeakTilesService.ts` (Flock TileJSON URL and loader, never fails the app over), `src/store/flockLeakStore.ts` (view, divider, filters, TileJSON stats), `src/hooks/useSwipeFilters.ts` (imperative `within` filters for the swipe, throttled to 20 per second), `src/components/map/layers/FlockLeakLayers.tsx` (dots and runtime icons).

State Management: add `- \`flockLeakStore\`: Leak tab view, swipe divider, type/status filters, TileJSON stats, tile failure flag`.

Directory Structure: add `FlockLeakLayers` to the layers line, `FlockLeakPanel` to panels, `flockLeakTilesService` to services, and `flockTypeNormalization` under `lib/`.

Data Sources: add

```
- **Flock Leak Tiles**: `<TILES_HOST>/flock-leak.json` TileJSON (source layer `devices`, `type` and `status` at every zoom, richer attributes from z9, `stats` totals). Same hosts as the camera tiles; a missing file shows a retry pill on the Leak tab and never fails the app over.
```

Also add a line under Map Rendering: `In leak mode the map is locked north-up and cones are off (CameraTileLayers cones={false}); the swipe divider is applied imperatively by useSwipeFilters, not through React props.`

- [ ] **Step 2: Write the browser check**

Create `.superpowers/check-flock-leak.mjs`:

```js
// Flock Leak tab checks. Usage: APP=http://localhost:3000 node .superpowers/check-flock-leak.mjs
import { chromium } from 'playwright';
const APP = process.env.APP || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
const browser = await chromium.launch();

// Desktop
const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
d.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await d.goto(`${APP}/leak?lat=29.7604&lng=-95.3698&zoom=12`, { waitUntil: 'domcontentloaded' });
await d.waitForFunction(() => !!window.__deflockMap && window.__deflockMap.loaded(), null, { timeout: 60000 });
await d.waitForTimeout(3000);
check('desktop nav shows Flock Leak selected', await d.locator('nav[aria-label="App modes"] button[aria-current="page"]').innerText() === 'Flock Leak');
check('desktop panel renders the warning', await d.getByText('Nine months separate these datasets').isVisible());
check('desktop rotation locked', await d.evaluate(() => !window.__deflockMap.dragRotate.isEnabled()));
await d.getByRole('tab', { name: 'Swipe' }).first().click();
await d.waitForTimeout(500);
const line = d.locator('.swipe-divider');
check('swipe divider visible', await line.isVisible());
const before = await line.evaluate((el) => el.style.left);
await d.locator('.swipe-range').fill('200');
await d.waitForTimeout(300);
const after = await line.evaluate((el) => el.style.left);
check('track moves the divider', before !== after && after === '20%', `${before} -> ${after}`);
check('OSM layer got a within filter', await d.evaluate(() => JSON.stringify(window.__deflockMap.getFilter('camera-tile-points') ?? []).includes('within')));
await d.getByRole('tab', { name: 'Flock' }).first().click();
await d.waitForTimeout(500);
check('leaving swipe restores the OSM filter', await d.evaluate(() => !JSON.stringify(window.__deflockMap.getFilter('camera-tile-points') ?? []).includes('within')));
await d.locator('nav[aria-label="App modes"] button', { hasText: 'Map' }).click();
await d.waitForTimeout(800);
check('map tab re-enables rotation', await d.evaluate(() => window.__deflockMap.dragRotate.isEnabled()));
check('map tab shows cones layer', await d.evaluate(() => window.__deflockMap.getLayoutProperty('camera-tile-cones', 'visibility') !== 'none'));
check('no page errors', errors.length === 0, errors.join(' | '));
await d.screenshot({ path: '.superpowers/flock-leak-desktop.png' });

// Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await m.goto(`${APP}/leak?lat=29.7604&lng=-95.3698&zoom=12`, { waitUntil: 'domcontentloaded' });
await m.locator('[role="dialog"]').first().waitFor({ timeout: 30000 });
await m.waitForTimeout(3000);
const tabs = await m.locator('[role="dialog"] button').filter({ hasText: /^(Map|Route|Timeline|Leak|Network)$/ }).allInnerTexts();
check('mobile drawer has five tabs incl. Leak', tabs.length === 5 && tabs.includes('Leak'), tabs.join(','));
const sheetHeight = (await m.locator('[role="dialog"]').first().boundingBox()).height;
check('peek height is 180', Math.abs(sheetHeight - 180) <= 2, String(sheetHeight));
check('peek carries the view switch', await m.locator('[role="dialog"] [role="tablist"][aria-label="Compare view"]').isVisible());
await m.locator('[role="dialog"]').getByRole('tab', { name: 'Swipe' }).click();
await m.waitForTimeout(500);
check('mobile track above the sheet', await m.locator('.swipe-track').isVisible());
check('mobile has no divider grab handle', (await m.locator('.swipe-divider button').count()) === 0);
await m.screenshot({ path: '.superpowers/flock-leak-mobile-swipe.png' });
await m.locator('.map-flock-filter-control .filter-trigger').click();
await m.waitForTimeout(300);
check('filter popover opens', await m.getByText('Type and status are Flock').isVisible());
await m.screenshot({ path: '.superpowers/flock-leak-mobile-filters.png' });

await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
```

- [ ] **Step 3: Run it**

`npm run dev` in one terminal, then:

Run: `node .superpowers/check-flock-leak.mjs`
Expected: every line `PASS`. Inspect the three screenshots against the approved mockups (`.superpowers/brainstorm/34894-1790199822/content/slim-peek-small-phone.html`).

- [ ] **Step 4: Performance gate**

Copy the drag harness and point it at the Leak tab in Swipe:

```bash
cp .superpowers/drag-perf.mjs .superpowers/drag-perf-leak.mjs
```

In the copy, change `SCENARIOS` to:

```js
const SCENARIOS = [
  { name: 'leak swipe city (z12, Houston)', url: `${APP}/leak?lat=29.7604&lng=-95.3698&zoom=12` },
];
```

and, inside `settle()` after the wait, add a click on the Swipe tab:

```js
  await page.getByRole('tab', { name: 'Swipe' }).first().click();
  await page.waitForTimeout(1000);
```

The harness defaults to `http://localhost:3001`; either set `APP` in the copy to your dev port or start the dev server with `npm run dev -- --port 3001`.

Run: `node .superpowers/drag-perf-leak.mjs leak-swipe 4 mobile`
Expected: `p95` and `reactCommits` at or below the Map-tab city scenario from the 2026-07-18 baselines (see the drag-perf memory note); `reactCommits` for a map pan in Swipe must be 0 beyond the count consumers, since the hook drives filters outside React. Record the numbers in the PR description.

- [ ] **Step 5: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "docs: Flock Leak tab in CLAUDE.md"
```

- [ ] **Step 6: Open the PR**

Body: link the spec, the spike result (Task 1), the phone verdict (Task 9 Step 10), the check-script output (Step 3), the perf numbers (Step 4), the three screenshots, and the two open items from the spec (real `type`/`status` vocabulary once the tileset exists; backup host publishing `flock-leak.json`).
