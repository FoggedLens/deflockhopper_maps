# Flock Leak Tab Implementation Plan, part 2 (v2 data contract)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Flock Leak tab against the published `flock-inventory-v2` tileset: rework the three data modules built on the assumed schema, then the layers, popup, swipe, filters, panels, and acceptance checks.

**Architecture:** Tasks 1 to 7 of `2026-09-23-flock-leak-tab.md` are done (spike, mode plumbing, store, swipe geometry, error rule, service, normalization). The real contract keys everything on integer `g` / `s` / `q` at every zoom and carries full records only from z9, lives at one fixed URL, and publishes its totals in a document rather than the tiles. Task 8 replaces the assumed-schema modules in place (same file names where the API survives, one module renamed) so Tasks 9 to 13 build on the real shape. Everything else in the original plan's architecture stands: one map, imperative `within` swipe, declarative visibility, tab-scoped source.

**Tech Stack:** unchanged: React 18, TypeScript, Zustand 5, MapLibre GL 5.15 (`promoteId`, `circle-sort-key`, `symbol-sort-key`), react-map-gl 8, Tailwind, vitest 4 (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-flock-leak-tab-design.md` for the UX, and `docs/superpowers/specs/2026-09-23-flock-inventory-v2-contract.md` (binding) for the data. Where the two differ on data, the contract wins.

## Global Constraints

- TileJSON is always `https://tiles.dontgetflocked.com/flock-inventory-v2.json` (fixed; not derived from the active tile host). Source layer `cameras`, paired with source id `flock-leak-tiles`. Never use `flock-inventory.json` (v1).
- Properties at every zoom: `g` (1..8), `s` (1..4), `q` (0..4). From z9 also `id`, `type`, `name`, `created`, `features`, `active`, `rotationAngle` (optional), `lat`, `lon`. Expressions must tolerate the z0..8 absence of the z9+ fields (no console warnings).
- Default filter hides `q > 0` at every zoom; a "Show suspect records" switch reveals them. Default status selection is In service only (`s = 1`).
- `promoteId: { cameras: 'id' }` on the source. Dedup query results by `id` at z9+. Never count rendered features for totals: totals come from `FLOCK_INVENTORY` constants copied from the contract.
- Draw in-service above planned above decommissioned where points coincide: `['-', 5, ['get', 's']]` as the sort key.
- `rotationAngle` is never drawn as a direction cone. Names render as plain text. The 2024-03-26 import sentinel renders as "On or before Mar 26, 2024".
- Group and status filter changes update instantly with no new tile requests (layer filters only; the source is never remounted for a filter change).
- With the tab inactive, no request to `flock-inventory-v2*` is made (the source mounts only in `leak` mode).
- Placeholder palette: every code-to-color and code-to-shape mapping lives in one table (`FLOCK_GROUP_COLOR`, `FLOCK_GROUP_SHAPE` in `flockLeakIcons.ts`).
- Gesture path rules, copy rules (no em dashes), the uniform 180 px peek, US-only gating, and the commit gates (`npx tsc -b --noEmit && npm run lint && npm test`, zero new lint warnings) all carry over from the original plan. Commit only the files a task names. Commit trailer is `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A z0..8 click (no `id`, `name`, `type`) must open a popup that reports group, status, quality and says to zoom in, never a blank or a thrown expression. Pinned in Task 9's low-zoom selection branch and Task 13's z3 click check.
2. Four devices at one coordinate must produce one popup listing four devices with a type-count line, not four popups or one device. Pinned in Task 8's `groupDevicesAtCoordinate` tests and Task 13's San Francisco check.
3. Toggling a group chip must not trigger a tile request. Pinned in Task 13's network-count check.
4. Turning "Show suspect records" on must reveal `q > 0` stacks and off must hide them at every zoom. Pinned in Task 8's `flockLayerFilter` tests and Task 13's check.
5. The Map tab must make no request to the leak tileset. Pinned in Task 13's "layer off" check.

---

### Task 8: Rework the data modules to the v2 contract

**Files:**
- Delete: `src/lib/flockTypeNormalization.ts`, `src/lib/flockTypeNormalization.test.ts`
- Create: `src/lib/flockInventory.ts`, `src/lib/flockInventory.test.ts`
- Modify: `src/services/flockLeakTilesService.ts`, `src/services/flockLeakTilesService.test.ts`
- Modify: `src/utils/flockLeakFilter.ts`, `src/utils/flockLeakFilter.test.ts`
- Modify: `src/store/flockLeakStore.ts`, `src/store/flockLeakStore.test.ts`, `src/store/index.ts`

**Interfaces:**
- Consumes: `combineFilters` (`src/utils/swipeFilter.ts`), `clampDivider`.
- Produces (`flockInventory.ts`):
  - `type FlockGroup = 1|2|3|4|5|6|7|8`, `type FlockStatus = 1|2|3|4`, `type FlockQuality = 0|1|2|3|4`
  - `FLOCK_GROUPS`, `FLOCK_SELECTABLE_GROUPS` (1..7), `FLOCK_SELECTABLE_STATUSES` ([1, 2, 3])
  - `FLOCK_GROUP_LABEL`, `FLOCK_GROUP_SHORT`, `FLOCK_STATUS_LABEL`, `FLOCK_QUALITY_LABEL`, `FLOCK_TYPE_LABEL`, `FLOCK_FEATURE_LABEL`
  - `parseGroup(raw): FlockGroup | null`, `parseStatus(raw): FlockStatus | null`, `parseQuality(raw): FlockQuality | null`
  - `flockTypeLabel(raw): string`, `formatCreated(raw): string | null`, `parseFeatures(raw): string[]`
  - `interface FlockDeviceRecord { id: number; g: FlockGroup; s: FlockStatus; q: FlockQuality; type: string; name: string; created: string; features: string[]; active: boolean; rotationAngle: number | null; lat: number; lon: number }`
  - `parseDeviceRecord(props: Record<string, unknown>): FlockDeviceRecord | null` (null when `id`, `lat`, `lon`, `g`, `s`, `q` are missing or invalid)
  - `groupDevicesAtCoordinate(records: FlockDeviceRecord[], lat: number, lon: number): FlockDeviceRecord[]` (dedup by id, same exact coordinate, non-component devices first)
  - `typeCountLine(records: FlockDeviceRecord[]): string` (e.g. `2 Drone Dock · 2 Picard`)
  - `FLOCK_INVENTORY` totals constant, `FLOCK_IMPORT_SENTINEL`
- Produces (`flockLeakTilesService.ts`): `FLOCK_LEAK_TILEJSON_URL`, `flockLeakTileJsonUrl()` (returns the constant), `FLOCK_LEAK_SOURCE_LAYER = 'cameras'`, `FLOCK_LEAK_SNAPSHOT_LABEL = 'Dec 14, 2025'`, `FlockLeakTileJson { tiles: string[]; name?: string; description?: string }`, `loadFlockLeakTileJson()`. `FLOCK_LEAK_SOURCE_ID`, `FLOCK_LEAK_MAXZOOM`, `FLOCK_LEAK_POINTS_MINZOOM`, `FLOCK_LEAK_STORY_URL` unchanged.
- Produces (`flockLeakFilter.ts`): `flockLayerFilter(groups: FlockGroup[], statuses: FlockStatus[], showSuspect: boolean): FilterSpecification | undefined`.
- Produces (`flockLeakStore.ts`): state `groups: FlockGroup[]` (empty = all), `statuses: FlockStatus[]` (default `[1]`), `showSuspect: boolean` (false), `selection: FlockSelection | null`; actions `toggleGroup`, `clearGroups`, `toggleStatus`, `setShowSuspect`, `setSelection`; `interface FlockSelection { lon: number; lat: number; zoom: number; g: FlockGroup | null; s: FlockStatus | null; q: FlockQuality | null; devices: FlockDeviceRecord[]; nearestOsmMeters: number | null }`; `activeFlockFilterCount({ groups, statuses, showSuspect })`. `view`, `divider`, `tileJson`, `loadPhase`, `error`, `tilesFailed`, `sourceEpoch`, `setView`, `setDivider`, `setTilesFailed`, `ensureTileJsonLoaded`, `retry`, `_resetFlockLeakStoreForTests`, `DEFAULT_FLOCK_STATUSES` keep their names.

- [ ] **Step 1: Write the failing inventory tests**

Create `src/lib/flockInventory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  FLOCK_GROUPS,
  FLOCK_SELECTABLE_GROUPS,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_GROUP_LABEL,
  FLOCK_TYPE_LABEL,
  FLOCK_INVENTORY,
  FLOCK_IMPORT_SENTINEL,
  parseGroup,
  parseStatus,
  parseQuality,
  flockTypeLabel,
  formatCreated,
  parseFeatures,
  parseDeviceRecord,
  groupDevicesAtCoordinate,
  typeCountLine,
} from './flockInventory';

describe('codes', () => {
  it('parses valid codes and rejects everything else', () => {
    expect(parseGroup(1)).toBe(1);
    expect(parseGroup('3')).toBe(3);
    expect(parseGroup(8)).toBe(8);
    expect(parseGroup(9)).toBeNull();
    expect(parseGroup(0)).toBeNull();
    expect(parseGroup(undefined)).toBeNull();
    expect(parseStatus(4)).toBe(4);
    expect(parseStatus(5)).toBeNull();
    expect(parseQuality(0)).toBe(0);
    expect(parseQuality(4)).toBe(4);
    expect(parseQuality(-1)).toBeNull();
    expect(parseQuality('x')).toBeNull();
  });

  it('group 8 is never selectable; statuses 1..3 are', () => {
    expect(FLOCK_GROUPS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(FLOCK_SELECTABLE_GROUPS).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(FLOCK_SELECTABLE_STATUSES).toEqual([1, 2, 3]);
    for (const g of FLOCK_GROUPS) expect(FLOCK_GROUP_LABEL[g].length).toBeGreaterThan(0);
  });
});

describe('type labels', () => {
  it('covers every type the contract lists', () => {
    const contractTypes = [
      'falcon', 'falconHighway', 'falconFlex', 'sparrow', 'lprTrailer',
      'condor', 'picardPtz',
      'wing', 'wingUbiuia', 'wingGateway', 'wingApi', 'external',
      'raven',
      'drone', 'droneDockingStation', 'droneControllerBox', 'droneRadar',
      'trailer', 'picardTrailer',
      'picard', 'avicore', 'talkDown', 'backhaulBox', 'multiEvidenceDevice', 'owl', 'automotus',
      'factoryFixture',
    ];
    for (const t of contractTypes) expect(FLOCK_TYPE_LABEL[t], t).toBeTruthy();
    expect(flockTypeLabel('droneDockingStation')).toBe('Drone Dock');
    expect(flockTypeLabel('picard')).toBe('Picard');
  });

  it('falls back to the trimmed raw value, or a placeholder when empty', () => {
    expect(flockTypeLabel('newThing ')).toBe('newThing');
    expect(flockTypeLabel('')).toBe('Unknown type');
    expect(flockTypeLabel(undefined)).toBe('Unknown type');
  });
});

describe('formatCreated', () => {
  it('renders the import sentinel as an upper bound', () => {
    expect(formatCreated(FLOCK_IMPORT_SENTINEL)).toBe('On or before Mar 26, 2024');
  });

  it('renders a normal timestamp as a date', () => {
    expect(formatCreated('2025-11-10T06:07:48.053000+00:00')).toBe('Nov 10, 2025');
  });

  it('returns null for garbage', () => {
    expect(formatCreated('')).toBeNull();
    expect(formatCreated(undefined)).toBeNull();
    expect(formatCreated('not a date')).toBeNull();
  });
});

describe('parseFeatures', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseFeatures('lpr,readsLicensePlates')).toEqual(['lpr', 'readsLicensePlates']);
    expect(parseFeatures(' replay , livestream ')).toEqual(['replay', 'livestream']);
    expect(parseFeatures('')).toEqual([]);
    expect(parseFeatures(undefined)).toEqual([]);
  });
});

const rec = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, g: 5, s: 2, q: 0, type: 'droneDockingStation', name: 'DS#008 - San Francisco PD - Dock 3 ',
  created: '2025-11-10T06:07:48.053000+00:00', features: '', active: 0, lat: 37.77946, lon: -122.50264,
  ...over,
});

describe('parseDeviceRecord', () => {
  it('parses a full z9+ record and trims the name', () => {
    const r = parseDeviceRecord(rec());
    expect(r).not.toBeNull();
    expect(r!.name).toBe('DS#008 - San Francisco PD - Dock 3');
    expect(r!.g).toBe(5);
    expect(r!.active).toBe(false);
    expect(r!.rotationAngle).toBeNull();
    expect(r!.features).toEqual([]);
  });

  it('keeps rotationAngle only when present and numeric', () => {
    expect(parseDeviceRecord(rec({ rotationAngle: 90 }))!.rotationAngle).toBe(90);
    expect(parseDeviceRecord(rec({ rotationAngle: 'x' }))!.rotationAngle).toBeNull();
  });

  it('returns null without an identity or a coordinate (z0..8 features)', () => {
    expect(parseDeviceRecord({ g: 1, s: 1, q: 0 })).toBeNull();
    expect(parseDeviceRecord(rec({ id: undefined }))).toBeNull();
    expect(parseDeviceRecord(rec({ lat: undefined }))).toBeNull();
    expect(parseDeviceRecord(rec({ g: 42 }))).toBeNull();
  });
});

describe('groupDevicesAtCoordinate and typeCountLine', () => {
  const at = (id: number, type: string, g: number, lat = 37.77946, lon = -122.50264) =>
    parseDeviceRecord(rec({ id, type, g, lat, lon }))!;

  it('keeps only devices at the exact coordinate, dedups by id, leads with non-components', () => {
    const rows = [
      at(9, 'picard', 7), at(8, 'picard', 7), at(1, 'droneDockingStation', 5), at(2, 'droneDockingStation', 5),
      at(2, 'droneDockingStation', 5), // tile-border duplicate
      at(3, 'drone', 5, 37.7795, -122.5026), // a few meters away
    ];
    const group = groupDevicesAtCoordinate(rows, 37.77946, -122.50264);
    expect(group.map((d) => d.id)).toEqual([1, 2, 9, 8]);
  });

  it('counts types in label order of first appearance', () => {
    const group = [at(1, 'droneDockingStation', 5), at(2, 'droneDockingStation', 5), at(8, 'picard', 7), at(9, 'picard', 7)];
    expect(typeCountLine(group)).toBe('2 Drone Dock · 2 Picard');
    expect(typeCountLine([at(1, 'falcon', 1)])).toBe('1 Falcon');
    expect(typeCountLine([])).toBe('');
  });
});

describe('FLOCK_INVENTORY totals', () => {
  it('are internally consistent with the contract', () => {
    expect(FLOCK_INVENTORY.devices).toBe(FLOCK_INVENTORY.devicesClean + FLOCK_INVENTORY.devicesFlagged);
    const s = FLOCK_INVENTORY.cleanByStatus;
    expect(s.inService + s.planned + s.decommissioned).toBe(FLOCK_INVENTORY.nationalPointsClean);
    const byGroup = Object.values(FLOCK_INVENTORY.cleanByGroup).reduce((a, [i, p, d]) => a + i + p + d, 0);
    expect(byGroup).toBe(FLOCK_INVENTORY.nationalPointsClean);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/flockInventory.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the inventory module**

Create `src/lib/flockInventory.ts`:

```ts
/**
 * The leaked Flock device inventory (flock-inventory-v2): codes, labels,
 * totals and record parsing. The tiles carry integer codes at every zoom
 * and full records from z9; everything display-facing maps through here.
 * Contract: docs/superpowers/specs/2026-09-23-flock-inventory-v2-contract.md
 */
export type FlockGroup = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type FlockStatus = 1 | 2 | 3 | 4;
export type FlockQuality = 0 | 1 | 2 | 3 | 4;

export const FLOCK_GROUPS: readonly FlockGroup[] = [1, 2, 3, 4, 5, 6, 7, 8];
/** Group 8 (factory fixtures) is always q = 2, so it is never a chip. */
export const FLOCK_SELECTABLE_GROUPS: readonly FlockGroup[] = [1, 2, 3, 4, 5, 6, 7];
export const FLOCK_SELECTABLE_STATUSES: readonly FlockStatus[] = [1, 2, 3];

export const FLOCK_GROUP_LABEL: Record<FlockGroup, string> = {
  1: 'Plate readers',
  2: 'Video and PTZ cameras',
  3: 'Third-party cameras',
  4: 'Audio sensors',
  5: 'Drones',
  6: 'Mobile trailers',
  7: 'Components and other',
  8: 'Factory fixtures',
};

/** Chip and legend labels. */
export const FLOCK_GROUP_SHORT: Record<FlockGroup, string> = {
  1: 'ALPR',
  2: 'Video',
  3: 'Wing',
  4: 'Audio',
  5: 'Drone',
  6: 'Trailer',
  7: 'Other',
  8: 'Fixture',
};

export const FLOCK_STATUS_LABEL: Record<FlockStatus, string> = {
  1: 'In service',
  2: 'Planned',
  3: 'Decommissioned',
  4: 'Unknown',
};

export const FLOCK_QUALITY_LABEL: Record<FlockQuality, string> = {
  0: 'Clean',
  1: 'Unknown status',
  2: 'Factory or test fixture',
  3: 'Placeholder location',
  4: 'Outside North America',
};

/** Flock's internal product names to friendly labels. One table, on purpose. */
export const FLOCK_TYPE_LABEL: Record<string, string> = {
  falcon: 'Falcon',
  falconHighway: 'Falcon Highway',
  falconFlex: 'Falcon Flex',
  sparrow: 'Sparrow',
  lprTrailer: 'LPR Trailer',
  condor: 'Condor',
  picardPtz: 'Picard PTZ',
  wing: 'Wing',
  wingUbiuia: 'Wing Ubiquia',
  wingGateway: 'Wing Gateway',
  wingApi: 'Wing API',
  external: 'External camera',
  raven: 'Raven',
  drone: 'Drone',
  droneDockingStation: 'Drone Dock',
  droneControllerBox: 'Drone Controller',
  droneRadar: 'Drone Radar',
  trailer: 'Trailer',
  picardTrailer: 'Picard Trailer',
  picard: 'Picard',
  avicore: 'Avicore',
  talkDown: 'Talk Down',
  backhaulBox: 'Backhaul Box',
  multiEvidenceDevice: 'Multi-Evidence Device',
  owl: 'Owl',
  automotus: 'Automotus',
  factoryFixture: 'Factory fixture',
};

export const FLOCK_FEATURE_LABEL: Record<string, string> = {
  livestream: 'Live stream',
  lpr: 'LPR',
  readsLicensePlates: 'Reads plates',
  replay: 'Replay',
  supportsFreeFormSearchPeople: 'People search',
  supportsVehicleDescriptionAlerts: 'Vehicle description alerts',
};

/** Records imported in bulk carry this creation stamp; it is an upper bound. */
export const FLOCK_IMPORT_SENTINEL = '2024-03-26T18:02:45.611000+00:00';

/** Totals from the contract. The tiles never carry totals and rendered
 *  features must not be counted for them (tile-border duplicates). */
export const FLOCK_INVENTORY = {
  snapshotIso: '2025-12-14',
  snapshotLabel: 'Dec 14, 2025',
  devices: 335_701,
  devicesClean: 311_907,
  devicesFlagged: 23_794,
  nationalPoints: 250_868,
  nationalPointsClean: 249_506,
  cleanByStatus: { inService: 163_540, planned: 54_396, decommissioned: 31_570 },
  /** Clean national points per group: [in service, planned, decommissioned]. */
  cleanByGroup: {
    1: [117_959, 39_701, 18_196],
    2: [5_505, 6_860, 1_283],
    3: [24_762, 498, 5_787],
    4: [14_905, 6_429, 4_961],
    5: [57, 259, 5],
    6: [5, 131, 10],
    7: [347, 518, 1_328],
  } as Record<Exclude<FlockGroup, 8>, readonly [number, number, number]>,
} as const;

function parseCode<T extends number>(raw: unknown, allowed: readonly T[]): T | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return (allowed as readonly number[]).includes(n) ? (n as T) : null;
}

export const parseGroup = (raw: unknown): FlockGroup | null => parseCode(raw, FLOCK_GROUPS);
export const parseStatus = (raw: unknown): FlockStatus | null => parseCode(raw, [1, 2, 3, 4] as const);
export const parseQuality = (raw: unknown): FlockQuality | null => parseCode(raw, [0, 1, 2, 3, 4] as const);

export function flockTypeLabel(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return 'Unknown type';
  return FLOCK_TYPE_LABEL[t] ?? t;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 10, 2025", or the import upper bound, or null for garbage. */
export function formatCreated(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw === FLOCK_IMPORT_SENTINEL) return 'On or before Mar 26, 2024';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export function parseFeatures(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface FlockDeviceRecord {
  id: number;
  g: FlockGroup;
  s: FlockStatus;
  q: FlockQuality;
  type: string;
  name: string;
  created: string;
  features: string[];
  active: boolean;
  rotationAngle: number | null;
  lat: number;
  lon: number;
}

/** A z9+ feature's properties as a device record; null for anything short of one. */
export function parseDeviceRecord(props: Record<string, unknown>): FlockDeviceRecord | null {
  const id = typeof props.id === 'number' ? props.id : Number(props.id);
  const g = parseGroup(props.g);
  const s = parseStatus(props.s);
  const q = parseQuality(props.q);
  const lat = typeof props.lat === 'number' ? props.lat : NaN;
  const lon = typeof props.lon === 'number' ? props.lon : NaN;
  if (!Number.isFinite(id) || g === null || s === null || q === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return {
    id,
    g,
    s,
    q,
    type: typeof props.type === 'string' ? props.type.trim() : '',
    name: typeof props.name === 'string' ? props.name.trim() : '',
    created: typeof props.created === 'string' ? props.created : '',
    features: parseFeatures(props.features),
    active: props.active === 1 || props.active === '1' || props.active === true,
    rotationAngle: typeof props.rotationAngle === 'number' && Number.isFinite(props.rotationAngle) ? props.rotationAngle : null,
    lat,
    lon,
  };
}

/** Devices at exactly this coordinate, deduped by id (tile-border copies),
 *  non-component devices first so a pole's sensor leads its compute box. */
export function groupDevicesAtCoordinate(records: FlockDeviceRecord[], lat: number, lon: number): FlockDeviceRecord[] {
  const seen = new Set<number>();
  const out: FlockDeviceRecord[] = [];
  for (const r of records) {
    if (r.lat !== lat || r.lon !== lon || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  const lead = out.filter((r) => r.g !== 7);
  const rest = out.filter((r) => r.g === 7);
  return [...lead, ...rest];
}

/** "2 Drone Dock · 2 Picard", in order of first appearance. */
export function typeCountLine(records: FlockDeviceRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    const label = flockTypeLabel(r.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(' · ');
}
```

- [ ] **Step 4: Run the inventory tests**

Run: `npx vitest run src/lib/flockInventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Rework the service to the fixed URL and the real layer**

Replace `src/services/flockLeakTilesService.ts` with:

```ts
/**
 * The leaked Flock device inventory tileset (flock-inventory-v2, the
 * December 14, 2025 export). Unlike the camera tiles it lives at ONE fixed
 * URL, not on whichever tile host is active, and a failure here never fails
 * the app over: a missing leak file must not degrade the Map tab.
 * Contract: docs/superpowers/specs/2026-09-23-flock-inventory-v2-contract.md
 */
export const FLOCK_LEAK_SOURCE_ID = 'flock-leak-tiles';
export const FLOCK_LEAK_SOURCE_LAYER = 'cameras';
export const FLOCK_LEAK_MAXZOOM = 14;
/** Full device records start here; below it the tiles carry merged points. */
export const FLOCK_LEAK_POINTS_MINZOOM = 9;
export const FLOCK_LEAK_SNAPSHOT_LABEL = 'Dec 14, 2025';
export const FLOCK_LEAK_STORY_URL = 'https://flocksurveillance.org';
export const FLOCK_LEAK_TILEJSON_URL = 'https://tiles.dontgetflocked.com/flock-inventory-v2.json';

/** Kept as a function so callers read like the camera tile URLs. */
export const flockLeakTileJsonUrl = (): string => FLOCK_LEAK_TILEJSON_URL;

export interface FlockLeakTileJson {
  tiles: string[];
  name?: string;
  description?: string;
}

const _cache = new Map<string, Promise<FlockLeakTileJson | null>>();

/**
 * Fetch the TileJSON. Resolves null when missing or unusable; never throws,
 * never fails the app over. Successes are cached; failures are not.
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
      if (typeof data.name === 'string') doc.name = data.name;
      if (typeof data.description === 'string') doc.description = data.description;
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

Replace `src/services/flockLeakTilesService.test.ts` with:

```ts
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
```

- [ ] **Step 6: Rework the filter builder**

Replace `src/utils/flockLeakFilter.ts` with:

```ts
import type { FilterSpecification } from 'maplibre-gl';
import { FLOCK_SELECTABLE_STATUSES, type FlockGroup, type FlockStatus } from '../lib/flockInventory';
import { combineFilters } from './swipeFilter';

/**
 * Layer filter for the Flock layers from the chips. Works at every zoom
 * because g, s and q are present on every feature. Never triggers a tile
 * request: it is a layer filter over tiles already loaded.
 *
 * - quality: q must be 0 unless suspect records are shown
 * - groups: empty means all
 * - statuses: all three selectable statuses on means no status clause
 */
export function flockLayerFilter(
  groups: FlockGroup[],
  statuses: FlockStatus[],
  showSuspect: boolean
): FilterSpecification | undefined {
  const quality = showSuspect ? undefined : (['==', ['get', 'q'], 0] as unknown as FilterSpecification);
  const group =
    groups.length > 0 ? (['in', ['get', 'g'], ['literal', groups]] as unknown as FilterSpecification) : undefined;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((s) => statuses.includes(s));
  const status = allStatuses
    ? undefined
    : (['in', ['get', 's'], ['literal', statuses]] as unknown as FilterSpecification);
  return combineFilters(quality, group, status);
}
```

Replace `src/utils/flockLeakFilter.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { flockLayerFilter } from './flockLeakFilter';

function passes(filter: unknown, properties: Record<string, unknown>): boolean {
  if (filter === undefined) return true;
  const parsed = createExpression(filter as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return Boolean(parsed.value.evaluate({ zoom: 4 }, { type: 1, properties, geometry: null } as never));
}

describe('flockLayerFilter', () => {
  it('default (clean, in service) at a national zoom with only g/s/q present', () => {
    const f = flockLayerFilter([], [1], false);
    expect(passes(f, { g: 1, s: 1, q: 0 })).toBe(true);
    expect(passes(f, { g: 1, s: 2, q: 0 })).toBe(false);
    expect(passes(f, { g: 1, s: 1, q: 3 })).toBe(false);
  });

  it('is undefined only when suspect records are shown, every status is on and no group is picked', () => {
    expect(flockLayerFilter([], [1, 2, 3], true)).toBeUndefined();
    expect(flockLayerFilter([], [1, 2, 3], false)).toEqual(['==', ['get', 'q'], 0]);
  });

  it('shows suspect records when asked', () => {
    const f = flockLayerFilter([], [1, 2, 3], true);
    expect(passes(f, { g: 8, s: 1, q: 2 })).toBe(true);
    expect(passes(f, { g: 1, s: 4, q: 1 })).toBe(true);
  });

  it('filters by group', () => {
    const f = flockLayerFilter([1, 3], [1, 2, 3], false);
    expect(passes(f, { g: 1, s: 1, q: 0 })).toBe(true);
    expect(passes(f, { g: 3, s: 3, q: 0 })).toBe(true);
    expect(passes(f, { g: 2, s: 1, q: 0 })).toBe(false);
  });

  it('combines group and status', () => {
    const f = flockLayerFilter([5], [2], false);
    expect(passes(f, { g: 5, s: 2, q: 0 })).toBe(true);
    expect(passes(f, { g: 5, s: 1, q: 0 })).toBe(false);
    expect(passes(f, { g: 1, s: 2, q: 0 })).toBe(false);
  });

  it('matches the contract example shape', () => {
    expect(flockLayerFilter([1, 3], [1], false)).toEqual([
      'all',
      ['==', ['get', 'q'], 0],
      ['in', ['get', 'g'], ['literal', [1, 3]]],
      ['in', ['get', 's'], ['literal', [1]]],
    ]);
  });
});
```

- [ ] **Step 7: Rework the store**

In `src/store/flockLeakStore.ts`:

Replace the import of `flockTypeNormalization` with:

```ts
import {
  FLOCK_SELECTABLE_STATUSES,
  type FlockGroup,
  type FlockStatus,
  type FlockQuality,
  type FlockDeviceRecord,
} from '../lib/flockInventory';
```

Replace the `FlockDeviceSelection` interface with:

```ts
/** What a tap on the Flock layer resolved to. Below z9 the tiles carry only
 *  codes, so `devices` is empty and g/s/q describe the merged point. */
export interface FlockSelection {
  lon: number;
  lat: number;
  zoom: number;
  g: FlockGroup | null;
  s: FlockStatus | null;
  q: FlockQuality | null;
  /** Devices at exactly this coordinate (z9+), deduped by id, lead device first. */
  devices: FlockDeviceRecord[];
  /** Nearest rendered OSM camera at click time; null when none or OSM hidden. */
  nearestOsmMeters: number | null;
}
```

Change `DEFAULT_FLOCK_STATUSES` to:

```ts
export const DEFAULT_FLOCK_STATUSES: readonly FlockStatus[] = [1];
```

In the state interface replace `types`, `statuses`, `selectedDevice` and the related actions with:

```ts
  /** Empty means every selectable group. */
  groups: FlockGroup[];
  statuses: FlockStatus[];
  /** Reveal q > 0 records (unknown status, fixtures, placeholder stacks, outside NA). */
  showSuspect: boolean;
  selection: FlockSelection | null;

  toggleGroup: (group: FlockGroup) => void;
  clearGroups: () => void;
  toggleStatus: (status: FlockStatus) => void;
  setShowSuspect: (show: boolean) => void;
  setSelection: (selection: FlockSelection | null) => void;
```

In `INITIAL` replace `types`, `statuses`, `selectedDevice` with:

```ts
  groups: [] as FlockGroup[],
  statuses: [...DEFAULT_FLOCK_STATUSES],
  showSuspect: false,
  selection: null as FlockSelection | null,
```

Replace the `toggleType`, `clearTypes`, `toggleStatus`, `setSelectedDevice` implementations with:

```ts
  toggleGroup: (group) =>
    set((s) => ({
      groups: s.groups.includes(group) ? s.groups.filter((g) => g !== group) : [...s.groups, group],
    })),
  clearGroups: () => {
    if (get().groups.length > 0) set({ groups: [] });
  },
  toggleStatus: (status) =>
    set((s) => ({
      statuses: s.statuses.includes(status)
        ? s.statuses.filter((x) => x !== status)
        : [...s.statuses, status],
    })),
  setShowSuspect: (showSuspect) => {
    if (get().showSuspect !== showSuspect) set({ showSuspect });
  },
  setSelection: (selection) => set({ selection }),
```

Replace `activeFlockFilterCount` with:

```ts
/** Badge count for the filter button. The In-service-only default is a
 *  filter the user can see (Planned and Decommissioned are hidden), so it
 *  counts; so does revealing suspect records. */
export function activeFlockFilterCount(s: {
  groups: FlockGroup[];
  statuses: FlockStatus[];
  showSuspect: boolean;
}): number {
  const groupActive = s.groups.length > 0 ? 1 : 0;
  const allStatuses = FLOCK_SELECTABLE_STATUSES.every((x) => s.statuses.includes(x));
  return groupActive + (allStatuses ? 0 : 1) + (s.showSuspect ? 1 : 0);
}
```

Fix the test reset:

```ts
export function _resetFlockLeakStoreForTests(): void {
  // Fresh arrays every time: INITIAL's arrays must never be shared across resets.
  useFlockLeakStore.setState({ ...INITIAL, statuses: [...DEFAULT_FLOCK_STATUSES], groups: [] });
}
```

In `src/store/index.ts` change the type re-export to:

```ts
export type { FlockLeakView, FlockSelection } from './flockLeakStore';
```

Update `src/store/flockLeakStore.test.ts`: in `defaults` assert `groups` `[]`, `statuses` `[1]`, `showSuspect` `false`; replace the `filters` describe with:

```ts
describe('filters', () => {
  it('toggles groups and clears back to all', () => {
    const s = useFlockLeakStore.getState();
    s.toggleGroup(2);
    s.toggleGroup(1);
    expect(useFlockLeakStore.getState().groups).toEqual([2, 1]);
    s.toggleGroup(2);
    expect(useFlockLeakStore.getState().groups).toEqual([1]);
    s.clearGroups();
    expect(useFlockLeakStore.getState().groups).toEqual([]);
  });

  it('toggles statuses and the suspect switch', () => {
    useFlockLeakStore.getState().toggleStatus(2);
    expect(useFlockLeakStore.getState().statuses).toEqual([1, 2]);
    useFlockLeakStore.getState().toggleStatus(1);
    expect(useFlockLeakStore.getState().statuses).toEqual([2]);
    const before = useFlockLeakStore.getState();
    useFlockLeakStore.getState().setShowSuspect(false);
    expect(useFlockLeakStore.getState()).toBe(before);
    useFlockLeakStore.getState().setShowSuspect(true);
    expect(useFlockLeakStore.getState().showSuspect).toBe(true);
  });

  it('counts the In-service-only default as one filter, all statuses as none, suspect as one', () => {
    expect(activeFlockFilterCount({ groups: [], statuses: [1], showSuspect: false })).toBe(1);
    expect(activeFlockFilterCount({ groups: [], statuses: [1, 2, 3], showSuspect: false })).toBe(0);
    expect(activeFlockFilterCount({ groups: [1], statuses: [1, 2, 3], showSuspect: false })).toBe(1);
    expect(activeFlockFilterCount({ groups: [1], statuses: [1], showSuspect: true })).toBe(3);
  });
});
```

and in the `ensureTileJsonLoaded` describe replace `stats: { total: 5 }` documents with `{ tiles: ['x'], name: 'v2' }` and assert `s.tileJson?.name).toBe('v2')`.

- [ ] **Step 8: Delete the old normalization module and run everything**

```bash
git rm src/lib/flockTypeNormalization.ts src/lib/flockTypeNormalization.test.ts
```

Run: `grep -rn "flockTypeNormalization\|FlockDeviceType\|FlockDeviceStatus\|selectedDevice\|toggleType\|clearTypes" src` → must print nothing.

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A src/lib/flockInventory.ts src/lib/flockInventory.test.ts src/lib/flockTypeNormalization.ts src/lib/flockTypeNormalization.test.ts src/services/flockLeakTilesService.ts src/services/flockLeakTilesService.test.ts src/utils/flockLeakFilter.ts src/utils/flockLeakFilter.test.ts src/store/flockLeakStore.ts src/store/flockLeakStore.test.ts src/store/index.ts
git commit -m "refactor(leak): rework the data modules to the flock-inventory-v2 contract"
```

---

### Task 9: Flock layers, runtime icons, map wiring, and the coincident-device popup

**Files:**
- Create: `src/components/map/layers/flockLeakIcons.ts`, `src/components/map/layers/flockLeakIcons.test.ts`, `src/components/map/layers/FlockLeakLayers.tsx`, `src/components/map/FlockLeakPopup.tsx`
- Modify: `src/components/map/layers/CameraTileLayers.tsx` (`cones` prop), `src/store/mapStore.ts` (`tileViewFlockCount`), `src/components/map/MapLibreContainer.tsx`

**Interfaces:**
- Consumes: Task 8; `planLeakTileError` (Task 4); `nearestDistanceMeters`, `NEARBY_QUERY_PX` (Task 5); `useFlockLeakStore`.
- Produces: `FLOCK_GROUP_COLOR`, `FLOCK_GROUP_SHAPE`, `flockIconId(g, planned)`, `FLOCK_ICON_IDS`, `ensureFlockIcons(map)`; `FLOCK_LEAK_DOTS_LAYER = 'flock-leak-dots'`, `FLOCK_LEAK_POINTS_LAYER = 'flock-leak-points'`, `<FlockLeakLayers visible sourceUrl />`; `<FlockLeakPopup />`; `mapStore.tileViewFlockCount` + setter; `CameraTileLayers` `cones?: boolean`.

- [ ] **Step 1: Write the failing icon tests**

Create `src/components/map/layers/flockLeakIcons.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flockIconId, ensureFlockIcons, FLOCK_GROUP_COLOR, FLOCK_GROUP_SHAPE, FLOCK_ICON_IDS } from './flockLeakIcons';
import { FLOCK_GROUPS } from '../../../lib/flockInventory';

describe('flockIconId', () => {
  it('names solid and planned variants per group', () => {
    expect(flockIconId(1, false)).toBe('flock-g1');
    expect(flockIconId(5, true)).toBe('flock-g5-planned');
  });

  it('lists every group in both variants with a color and a shape', () => {
    expect(FLOCK_ICON_IDS).toHaveLength(FLOCK_GROUPS.length * 2);
    for (const g of FLOCK_GROUPS) {
      expect(FLOCK_GROUP_COLOR[g]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(FLOCK_GROUP_SHAPE[g]).toBeTruthy();
    }
  });
});

describe('ensureFlockIcons', () => {
  const ctx = {
    clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    arc: () => {}, rect: () => {}, roundRect: () => {}, fill: () => {}, stroke: () => {}, setLineDash: () => {}, save: () => {}, restore: () => {},
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
    const map = { hasImage: (id: string) => id === 'flock-g1', addImage: (id: string) => { added.push(id); } };
    ensureFlockIcons(map as never);
    expect(added).not.toContain('flock-g1');
    expect(added).toContain('flock-g1-planned');
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
import { FLOCK_GROUPS, type FlockGroup } from '../../../lib/flockInventory';

/**
 * Flock device marks by group, drawn on a canvas at runtime and registered
 * as map images (no sprite rebuild). Placeholder palette from the theme:
 * colors and shapes are decided elsewhere later; change them HERE only.
 * Planned (s = 2) is the same shape as a dashed outline; decommissioned is
 * the solid mark at reduced opacity (a paint property, not an image).
 */
export const FLOCK_GROUP_COLOR: Record<FlockGroup, string> = {
  1: '#ef4444', // plate readers
  2: '#f59e0b', // video / PTZ
  3: '#fb923c', // third-party cameras (Wing)
  4: '#a78bfa', // audio sensors
  5: '#34d399', // drones
  6: '#e5a04d', // mobile trailers
  7: '#9ca3af', // components / other
  8: '#6b7280', // factory fixtures (q = 2, hidden by default)
};

export type FlockShape = 'square' | 'diamond' | 'hollow-square' | 'ring' | 'triangle' | 'pill' | 'dot' | 'cross';

export const FLOCK_GROUP_SHAPE: Record<FlockGroup, FlockShape> = {
  1: 'square',
  2: 'diamond',
  3: 'hollow-square',
  4: 'ring',
  5: 'triangle',
  6: 'pill',
  7: 'dot',
  8: 'cross',
};

/** Logical pixel size of a mark at icon-size 1. */
export const FLOCK_ICON_PX = 14;
const PAD = 4;
const RATIO = 2;

export const flockIconId = (g: FlockGroup, planned: boolean): string =>
  `flock-g${g}${planned ? '-planned' : ''}`;

export const FLOCK_ICON_IDS: readonly string[] = FLOCK_GROUPS.flatMap((g) => [
  flockIconId(g, false),
  flockIconId(g, true),
]);

export function drawFlockIcon(ctx: CanvasRenderingContext2D, g: FlockGroup, size: number, planned: boolean): void {
  const color = FLOCK_GROUP_COLOR[g];
  const shape = FLOCK_GROUP_SHAPE[g];
  const c = size / 2;
  const r = size * 0.36;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'square':
    case 'hollow-square':
      ctx.rect(c - r, c - r, r * 2, r * 2);
      break;
    case 'diamond':
      ctx.moveTo(c, c - r * 1.15);
      ctx.lineTo(c + r * 1.15, c);
      ctx.lineTo(c, c + r * 1.15);
      ctx.lineTo(c - r * 1.15, c);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(c, c - r * 1.2);
      ctx.lineTo(c + r * 1.15, c + r * 0.9);
      ctx.lineTo(c - r * 1.15, c + r * 0.9);
      ctx.closePath();
      break;
    case 'pill':
      ctx.rect(c - r * 1.25, c - r * 0.6, r * 2.5, r * 1.2);
      break;
    case 'cross':
      ctx.moveTo(c - r, c - r);
      ctx.lineTo(c + r, c + r);
      ctx.moveTo(c + r, c - r);
      ctx.lineTo(c - r, c + r);
      break;
    case 'ring':
    case 'dot':
      ctx.arc(c, c, shape === 'dot' ? r * 0.7 : r, 0, Math.PI * 2);
      break;
  }
  const outlineOnly = planned || shape === 'hollow-square' || shape === 'ring' || shape === 'cross';
  if (outlineOnly) {
    if (planned) ctx.setLineDash([size * 0.14, size * 0.1]);
    ctx.lineWidth = size * 0.13;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (shape === 'ring' && !planned) {
      ctx.beginPath();
      ctx.arc(c, c, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }
  ctx.restore();
}

function renderIcon(g: FlockGroup, planned: boolean): { width: number; height: number; data: Uint8ClampedArray } | null {
  const px = (FLOCK_ICON_PX + PAD * 2) * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, px, px);
  drawFlockIcon(ctx, g, px, planned);
  const img = ctx.getImageData(0, 0, px, px);
  return { width: img.width, height: img.height, data: img.data };
}

/** Register every Flock icon the style might request. Idempotent. */
export function ensureFlockIcons(map: Pick<maplibregl.Map, 'hasImage' | 'addImage'>): void {
  for (const g of FLOCK_GROUPS) {
    for (const planned of [false, true]) {
      const id = flockIconId(g, planned);
      if (map.hasImage(id)) continue;
      const img = renderIcon(g, planned);
      if (img) map.addImage(id, img, { pixelRatio: RATIO });
    }
  }
}
```

- [ ] **Step 4: Run the icon tests**

Run: `npx vitest run src/components/map/layers/flockLeakIcons.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `cones` prop to `CameraTileLayers`**

In `src/components/map/layers/CameraTileLayers.tsx`, add to the props interface:

```ts
  /** Build and draw direction cones. Off in the Flock Leak tab, where the
   *  swipe's `within` filter would flicker cones at the divider. */
  cones?: boolean;
```

default it in the destructuring (`cones = true`), change the early-out in `rebuildCones` to `if (!visible || !cones || map.getZoom() < CONE_BUILD_MINZOOM) {` and add `cones` to that callback's dependency array, and give the two cone `<Layer>`s `layout={{ visibility: coneVisibility }}` where:

```ts
  const coneVisibility: 'visible' | 'none' = visible && cones ? 'visible' : 'none';
```

- [ ] **Step 6: Add the Flock count to the map store**

In `src/store/mapStore.ts` add after `tileViewBrandStats`:

```ts
  /** Flock devices in view on the Leak tab (rendered features deduped by id,
   *  z9 and up); null off the tab or below z9, where the header shows totals. */
  tileViewFlockCount: number | null;
```

the action type `setTileViewFlockCount: (count: number | null) => void;`, the initial `tileViewFlockCount: null,`, and the equality-gated implementation:

```ts
  setTileViewFlockCount: (count) =>
    set((s) => (s.tileViewFlockCount === count ? {} : { tileViewFlockCount: count })),
```

- [ ] **Step 7: Implement the layers**

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
import { flockLayerFilter } from '../../../utils/flockLeakFilter';
import { useFlockLeakStore } from '../../../store/flockLeakStore';
import { FLOCK_GROUPS } from '../../../lib/flockInventory';
import { ensureFlockIcons, FLOCK_GROUP_COLOR } from './flockLeakIcons';

export const FLOCK_LEAK_DOTS_LAYER = 'flock-leak-dots';
export const FLOCK_LEAK_POINTS_LAYER = 'flock-leak-points';

/** ['match', ['get','g'], 1, C1, ..., FALLBACK] from the one color table. */
const groupColorExpression = (): unknown[] => [
  'match',
  ['get', 'g'],
  ...FLOCK_GROUPS.flatMap((g) => [g, FLOCK_GROUP_COLOR[g]]),
  '#9ca3af',
];

/** In service above planned above decommissioned where points coincide. */
const STATUS_SORT_KEY = ['-', 5, ['coalesce', ['get', 's'], 4]];

/**
 * The leaked Flock inventory: colored density dots to z10 (one point per
 * location + status + quality in the tiles), typed icons from z9 (one point
 * per device), crossfading over z9 to z10 like the OSM camera layers.
 * Filters come from flockLeakStore; the swipe divider is applied
 * imperatively by useSwipeFilters on top.
 */
function buildSpecs(filter: FilterSpecification | undefined) {
  const withFilter = <T extends maplibregl.LayerSpecification>(spec: T): T =>
    filter ? { ...spec, filter } : spec;

  const dots: maplibregl.CircleLayerSpecification = withFilter({
    id: FLOCK_LEAK_DOTS_LAYER,
    type: 'circle',
    source: FLOCK_LEAK_SOURCE_ID,
    'source-layer': FLOCK_LEAK_SOURCE_LAYER,
    maxzoom: 10,
    layout: {
      'circle-sort-key': STATUS_SORT_KEY as never,
    },
    paint: {
      'circle-color': groupColorExpression() as never,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1.5, 7, 2.2, 8, 3.5, 9.9, 5],
      'circle-opacity': [
        '*',
        ['interpolate', ['linear'], ['zoom'], 0, 0.5, 6, 0.6, 8.5, 0.75, 9.6, 0.75, 10, 0],
        ['case', ['==', ['coalesce', ['get', 's'], 4], 3], 0.5, 1],
      ],
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
      'icon-image': [
        'concat',
        'flock-g',
        ['to-string', ['coalesce', ['get', 'g'], 7]],
        ['case', ['==', ['coalesce', ['get', 's'], 4], 2], '-planned', ''],
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 10, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': STATUS_SORT_KEY as never,
    },
    paint: {
      'icon-opacity': [
        '*',
        ['interpolate', ['linear'], ['zoom'], 9, 0, 9.6, 1],
        ['case', ['==', ['coalesce', ['get', 's'], 4], 3], 0.35, 1],
      ],
    },
  });

  return { dots, points };
}

interface FlockLeakLayersProps {
  visible: boolean;
  /** The fixed flock-inventory-v2 TileJSON URL. */
  sourceUrl: string;
}

export function FlockLeakLayers({ visible, sourceUrl }: FlockLeakLayersProps) {
  const { current: mapInstance } = useMap();
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const filter = useMemo(() => flockLayerFilter(groups, statuses, showSuspect), [groups, statuses, showSuspect]);
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
    <Source
      id={FLOCK_LEAK_SOURCE_ID}
      type="vector"
      url={sourceUrl}
      maxzoom={FLOCK_LEAK_MAXZOOM}
      promoteId={{ [FLOCK_LEAK_SOURCE_LAYER]: 'id' }}
    >
      <Layer {...specs.dots} layout={{ ...specs.dots.layout, visibility }} />
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
import {
  FLOCK_GROUP_LABEL,
  FLOCK_STATUS_LABEL,
  FLOCK_QUALITY_LABEL,
  FLOCK_FEATURE_LABEL,
  flockTypeLabel,
  formatCreated,
  typeCountLine,
  type FlockDeviceRecord,
} from '../../lib/flockInventory';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';
import { flockNearbyHint } from '../../utils/flockNearby';
import { FLOCK_GROUP_COLOR } from './layers/flockLeakIcons';

const MAX_DEVICES = 8;

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-dark-600 text-dark-200"
      style={color ? { color, backgroundColor: `${color}26` } : undefined}
    >
      {children}
    </span>
  );
}

function DeviceRow({ d }: { d: FlockDeviceRecord }) {
  const created = formatCreated(d.created);
  return (
    <li className="py-2 border-t border-dark-600 first:border-t-0 first:pt-0">
      <p className="text-xs text-white font-medium break-words">{d.name || flockTypeLabel(d.type)}</p>
      <div className="flex flex-wrap gap-1 mt-1">
        <Tag color={FLOCK_GROUP_COLOR[d.g]}>{flockTypeLabel(d.type)}</Tag>
        <Tag>{FLOCK_STATUS_LABEL[d.s]}</Tag>
        {d.q !== 0 && <Tag>{FLOCK_QUALITY_LABEL[d.q]}</Tag>}
      </div>
      <dl className="mt-1.5 space-y-0.5 text-[11px]">
        {created && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Created</dt><dd className="text-dark-200">{created}</dd></div>
        )}
        {d.features.length > 0 && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Capabilities</dt><dd className="text-dark-200 text-right">{d.features.map((f) => FLOCK_FEATURE_LABEL[f] ?? f).join(', ')}</dd></div>
        )}
        {d.rotationAngle !== null && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Mount angle</dt><dd className="text-dark-200">{Math.round(d.rotationAngle)}°</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt className="text-dark-400">Flock ID</dt><dd className="text-dark-300 font-mono">{d.id}</dd></div>
      </dl>
    </li>
  );
}

/** Popup for a tap on the Flock layer. Rendered inside <Map>. */
export function FlockLeakPopup() {
  const sel = useFlockLeakStore((s) => s.selection);
  const setSelection = useFlockLeakStore((s) => s.setSelection);
  const view = useFlockLeakStore((s) => s.view);
  if (!sel) return null;

  const lead = sel.devices[0];
  const hint = flockNearbyHint({
    zoom: sel.zoom,
    type: lead && lead.g === 1 ? 'alpr' : 'other',
    nearestMeters: sel.nearestOsmMeters,
    osmVisible: view !== 'flock',
  });
  const color = sel.g ? FLOCK_GROUP_COLOR[sel.g] : undefined;

  return (
    <Popup
      longitude={sel.lon}
      latitude={sel.lat}
      anchor="bottom"
      onClose={() => setSelection(null)}
      closeOnClick={false}
      className="camera-popup-maplibre"
      maxWidth="300px"
    >
      <div className="min-w-[250px] max-w-[290px] p-4">
        {sel.devices.length === 0 ? (
          <>
            <h3 className="font-display font-semibold text-white text-base">
              Flock {sel.g ? FLOCK_GROUP_LABEL[sel.g].toLowerCase() : 'device'}
            </h3>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {sel.s && <Tag color={color}>{FLOCK_STATUS_LABEL[sel.s]}</Tag>}
              {sel.q !== null && sel.q !== 0 && <Tag>{FLOCK_QUALITY_LABEL[sel.q]}</Tag>}
            </div>
            <p className="mt-3 text-xs text-dark-300">Zoom in for device names and details.</p>
          </>
        ) : (
          <>
            <h3 className="font-display font-semibold text-white text-base">
              {sel.devices.length === 1 ? '1 device here' : `${sel.devices.length} devices at this exact coordinate`}
            </h3>
            {sel.devices.length > 1 && <p className="text-xs text-dark-400 mt-0.5">{typeCountLine(sel.devices)}</p>}
            <ul className="mt-3 max-h-64 overflow-y-auto">
              {sel.devices.slice(0, MAX_DEVICES).map((d) => <DeviceRow key={d.id} d={d} />)}
            </ul>
            {sel.devices.length > MAX_DEVICES && (
              <p className="text-[11px] text-dark-400 mt-1">and {sel.devices.length - MAX_DEVICES} more at this spot</p>
            )}
          </>
        )}
        <p className="mt-3 pt-3 border-t border-dark-600 text-xs text-dark-400">
          Leaked inventory. Position as of {FLOCK_LEAK_SNAPSHOT_LABEL}. Agency fields were blank in the export.
        </p>
        {hint && <p className="mt-2 text-xs text-[#93CBFF]">{hint}</p>}
      </div>
    </Popup>
  );
}
```

`flockNearbyHint` still takes the original `type: 'alpr' | ...` shape from Task 5; a group-1 device passes `'alpr'`, everything else `'other'`, so the mis-tag note appears only when the Flock device is not a plate reader.

- [ ] **Step 9: Wire the map container**

In `src/components/map/MapLibreContainer.tsx`:

Imports:

```ts
import { FlockLeakLayers, FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_POINTS_LAYER } from './layers/FlockLeakLayers';
import { FlockLeakPopup } from './FlockLeakPopup';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { flockLeakTileJsonUrl, FLOCK_LEAK_SOURCE_ID, FLOCK_LEAK_POINTS_MINZOOM } from '../../services/flockLeakTilesService';
import { planLeakTileError } from '../../utils/tileErrorPolicy';
import { parseGroup, parseStatus, parseQuality, parseDeviceRecord, groupDevicesAtCoordinate } from '../../lib/flockInventory';
import { nearestDistanceMeters, NEARBY_QUERY_PX } from '../../utils/flockNearby';
```

Flags after `const isMapMode = appMode === 'map';`:

```ts
  const isLeakMode = appMode === 'leak';
  const leakView = useFlockLeakStore(s => s.view);
  const leakSourceEpoch = useFlockLeakStore(s => s.sourceEpoch);
```

`showCameraMarkers` gains `|| (isLeakMode && leakView !== 'flock')` inside its parenthesized alternatives.

North-up lock after the `flyToCommand` effect:

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

Counters next to the other tile refs, reset with them (add `leakSourceEpoch` to that effect's deps):

```ts
  const leakLoadSeenRef = useRef(false);
  const leakErrorCountRef = useRef(0);
```

```ts
    leakLoadSeenRef.current = false;
    leakErrorCountRef.current = 0;
```

In `handleTileSourceData`, first:

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
    // Flock Leak: a tap on a Flock mark resolves to the devices at that exact
    // coordinate (z9+) or the merged point's codes (below z9). A tap on an
    // OSM camera falls through to the camera popup below.
    if (isLeakMode) {
      const flockFeature = event.features?.find(
        (f) => f.layer.id === FLOCK_LEAK_POINTS_LAYER || f.layer.id === FLOCK_LEAK_DOTS_LAYER
      );
      if (flockFeature) {
        const map = mapRef.current.getMap();
        const zoom = map.getZoom();
        const props = (flockFeature.properties ?? {}) as Record<string, unknown>;
        const [flon, flat] = (flockFeature.geometry as GeoJSON.Point).coordinates;
        const { x, y } = event.point;
        const box: [[number, number], [number, number]] = [[x - 12, y - 12], [x + 12, y + 12]];

        let devices: ReturnType<typeof parseDeviceRecord>[] = [];
        let lon = flon;
        let lat = flat;
        if (zoom >= FLOCK_LEAK_POINTS_MINZOOM && map.getLayer(FLOCK_LEAK_POINTS_LAYER)) {
          const clicked = parseDeviceRecord(props);
          const nearby = map
            .queryRenderedFeatures(box, { layers: [FLOCK_LEAK_POINTS_LAYER] })
            .map((f) => parseDeviceRecord((f.properties ?? {}) as Record<string, unknown>))
            .filter((r): r is NonNullable<typeof r> => r !== null);
          if (clicked) {
            lon = clicked.lon;
            lat = clicked.lat;
            devices = groupDevicesAtCoordinate(nearby, clicked.lat, clicked.lon);
          }
        }

        const osmLayer = isFilterTilesMode ? 'camera-tile-points-filtered' : 'camera-tile-points';
        const osmNearby = showCameraMarkers && map.getLayer(osmLayer)
          ? map
              .queryRenderedFeatures(
                [[x - NEARBY_QUERY_PX, y - NEARBY_QUERY_PX], [x + NEARBY_QUERY_PX, y + NEARBY_QUERY_PX]],
                { layers: [osmLayer] }
              )
              .map((f) => {
                const [olon, olat] = (f.geometry as GeoJSON.Point).coordinates;
                return { lon: olon, lat: olat };
              })
          : [];

        useFlockLeakStore.getState().setSelection({
          lon,
          lat,
          zoom,
          g: parseGroup(props.g),
          s: parseStatus(props.s),
          q: parseQuality(props.q),
          devices: devices.filter((d): d is NonNullable<typeof d> => d !== null),
          nearestOsmMeters: nearestDistanceMeters({ lon, lat }, osmNearby),
        });
        setPopupInfo(null);
        return;
      }
      useFlockLeakStore.getState().setSelection(null);
    }
```

Add `isLeakMode, showCameraMarkers` to that callback's dependencies.

`interactiveLayerIds`:

```ts
      interactiveLayerIds={isNetworkMode
        ? []
        : isLeakMode
          ? [
              FLOCK_LEAK_POINTS_LAYER,
              FLOCK_LEAK_DOTS_LAYER,
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

In `updateVisibleCameras`, first thing after `const map = mapRef.current.getMap();`:

```ts
    // Flock Leak: count devices in view from z9 (deduped by id, since a
    // point on a tile border is in both tiles). Below z9 the header shows
    // the snapshot totals, so no national-zoom query runs.
    if (useAppModeStore.getState().appMode === 'leak') {
      try {
        if (map.getZoom() < FLOCK_LEAK_POINTS_MINZOOM || !map.getLayer(FLOCK_LEAK_POINTS_LAYER)) {
          useMapStore.getState().setTileViewFlockCount(null);
        } else {
          const ids = new Set<number>();
          for (const f of map.queryRenderedFeatures(undefined, { layers: [FLOCK_LEAK_POINTS_LAYER] })) {
            const id = f.properties?.id;
            if (typeof id === 'number') ids.add(id);
          }
          useMapStore.getState().setTileViewFlockCount(ids.size);
        }
      } catch {
        // layers not ready yet
      }
    } else if (useMapStore.getState().tileViewFlockCount !== null) {
      useMapStore.getState().setTileViewFlockCount(null);
    }
```

Pass `cones={!isLeakMode}` to both `<CameraTileLayers>` instances. Mount after the `CameraMarkerLayers` block:

```tsx
      {/* Flock Leak: the leaked inventory. Only mounted on the tab, so the
          Map tab never requests it; keyed by the store's retry epoch. */}
      {isLeakMode && (
        <FlockLeakLayers
          key={`flock-${leakSourceEpoch}`}
          sourceUrl={flockLeakTileJsonUrl()}
          visible={showCameraLayer}
        />
      )}
      {isLeakMode && <FlockLeakPopup />}
```

- [ ] **Step 10: Type-check, lint, test**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: all pass. If `map.keyboard.disableRotation` is flagged by types, cast: `(map.keyboard as unknown as { disableRotation(): void }).disableRotation()` (the method exists at runtime; verified). If react-map-gl's `Source` rejects `promoteId` in its typings, pass it through a spread: `{...({ promoteId: { cameras: 'id' } } as object)}`.

- [ ] **Step 11: Browser check**

`npm run dev` on a free port; open `/leak?lat=39.5&lng=-98&zoom=3`: colored points across the US within a few seconds, no console warnings. Open `/leak?lat=37.77946&lng=-122.50264&zoom=14`, click the stacked marker: the popup reads "4 devices at this exact coordinate", "2 Drone Dock · 2 Picard", names beginning `DS#008 - San Francisco PD - Dock 3`, status Planned, created Nov 10, 2025. Click a point at z3: popup shows group and status and "Zoom in for device names and details." Right-drag: no rotation. Switch to the Map tab: rotation returns, cones return, and the network panel shows no `flock-inventory-v2` request.

- [ ] **Step 12: Commit**

```bash
git add src/components/map/layers/flockLeakIcons.ts src/components/map/layers/flockLeakIcons.test.ts src/components/map/layers/FlockLeakLayers.tsx src/components/map/FlockLeakPopup.tsx src/components/map/layers/CameraTileLayers.tsx src/store/mapStore.ts src/components/map/MapLibreContainer.tsx
git commit -m "feat(leak): flock-inventory-v2 layers with group icons, coincident-device popup, north-up lock, counts and error handling"
```

---

### Task 10: Swipe: the imperative filter hook, the track, the view switch

Identical to Task 9 of `2026-09-23-flock-leak-tab.md` (hook, `SwipeTrack`, `FlockViewSwitch`, CSS, `MapPage` overlays, drawer peek `extra`) with one substitution in the map container wiring: the Flock base filter is

```ts
  const leakGroups = useFlockLeakStore(s => s.groups);
  const leakStatuses = useFlockLeakStore(s => s.statuses);
  const leakShowSuspect = useFlockLeakStore(s => s.showSuspect);
  const swipeTargets = useMemo<SwipeTargets>(() => ({
    osmLayerIds: isFilterTilesMode
      ? ['camera-tile-glow-filtered', 'camera-tile-dots-filtered', 'camera-tile-points-filtered']
      : ['camera-tile-glow', 'camera-tile-dots', 'camera-tile-points'],
    osmBaseFilter: isFilterTilesMode ? tileFilterExpr : undefined,
    flockLayerIds: [FLOCK_LEAK_DOTS_LAYER, FLOCK_LEAK_POINTS_LAYER],
    flockBaseFilter: flockLayerFilter(leakGroups, leakStatuses, leakShowSuspect),
  }), [isFilterTilesMode, tileFilterExpr, leakGroups, leakStatuses, leakShowSuspect]);
  useSwipeFilters(mapRef, isLeakMode && leakView === 'swipe', swipeTargets, mapLoaded);
```

and the swipe chip reads `Flock · Dec 14, 2025` (it uses `FLOCK_LEAK_SNAPSHOT_LABEL`, so no code change). Follow that task's steps and commit message verbatim otherwise, including the phone check.

---

### Task 11: Group and status filters on the map, suspect toggle, OSM filter on the Leak tab

**Files:**
- Create: `src/components/map/FlockFilterChips.tsx`, `src/components/map/FlockLeakFilterControl.tsx`
- Modify: `src/components/map/CameraFilterControl.tsx:476`, `src/index.css`, `src/pages/MapPage.tsx`

**Interfaces:**
- Consumes: Task 8 (`FLOCK_SELECTABLE_GROUPS`, `FLOCK_SELECTABLE_STATUSES`, labels, `FLOCK_INVENTORY`, store actions), Task 9 (`FLOCK_GROUP_COLOR`, `FLOCK_GROUP_SHAPE`).
- Produces: `<GroupSwatch g />`, `<FlockFilterChips showCounts? />`, `<FlockLeakFilterControl />`.

- [ ] **Step 1: Shared chips**

Create `src/components/map/FlockFilterChips.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_SELECTABLE_GROUPS,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_GROUP_SHORT,
  FLOCK_STATUS_LABEL,
  FLOCK_INVENTORY,
  type FlockGroup,
} from '../../lib/flockInventory';
import { FLOCK_GROUP_COLOR, FLOCK_GROUP_SHAPE } from './layers/flockLeakIcons';

/** Legend and chip swatch: the same shape language as the map icons. */
export function GroupSwatch({ g, size = 8 }: { g: FlockGroup; size?: number }) {
  const color = FLOCK_GROUP_COLOR[g];
  const base = { width: size, height: size, display: 'inline-block', flexShrink: 0 } as const;
  switch (FLOCK_GROUP_SHAPE[g]) {
    case 'square':
      return <i style={{ ...base, background: color, borderRadius: 1 }} aria-hidden="true" />;
    case 'diamond':
      return <i style={{ ...base, background: color, transform: 'rotate(45deg) scale(0.85)' }} aria-hidden="true" />;
    case 'hollow-square':
      return <i style={{ ...base, border: `2px solid ${color}`, boxSizing: 'border-box' }} aria-hidden="true" />;
    case 'ring':
      return <i style={{ ...base, border: `2px solid ${color}`, borderRadius: '50%', boxSizing: 'border-box' }} aria-hidden="true" />;
    case 'triangle':
      return (
        <i
          style={{ ...base, width: 0, height: 0, borderLeft: `${size / 2}px solid transparent`, borderRight: `${size / 2}px solid transparent`, borderBottom: `${size}px solid ${color}` }}
          aria-hidden="true"
        />
      );
    case 'pill':
      return <i style={{ ...base, width: size * 1.6, height: size * 0.7, background: color, borderRadius: size }} aria-hidden="true" />;
    case 'cross':
      return <i style={{ ...base, color, fontSize: size * 1.4, lineHeight: `${size}px`, width: 'auto' }} aria-hidden="true">×</i>;
    default:
      return <i style={{ ...base, background: color, borderRadius: '50%' }} aria-hidden="true" />;
  }
}

function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
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

/** Clean national points in the group across the three lifecycle statuses. */
const groupTotal = (g: FlockGroup): number | undefined => {
  const row = FLOCK_INVENTORY.cleanByGroup[g as Exclude<FlockGroup, 8>];
  return row ? row[0] + row[1] + row[2] : undefined;
};

export function FlockFilterChips({ showCounts = false }: { showCounts?: boolean }) {
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const toggleGroup = useFlockLeakStore((s) => s.toggleGroup);
  const clearGroups = useFlockLeakStore((s) => s.clearGroups);
  const toggleStatus = useFlockLeakStore((s) => s.toggleStatus);
  const setShowSuspect = useFlockLeakStore((s) => s.setShowSuspect);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-2xs uppercase text-dark-500 mb-1.5">Device group</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={groups.length === 0} onClick={clearGroups}>All</Chip>
          {FLOCK_SELECTABLE_GROUPS.map((g) => (
            <Chip key={g} on={groups.includes(g)} onClick={() => toggleGroup(g)} count={showCounts ? groupTotal(g) : undefined}>
              <GroupSwatch g={g} />
              {FLOCK_GROUP_SHORT[g]}
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
      <button
        role="switch"
        aria-checked={showSuspect}
        onClick={() => setShowSuspect(!showSuspect)}
        className="w-full flex items-center justify-between py-1.5 text-left"
      >
        <span className="text-xs text-dark-300">Show suspect records</span>
        <span className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${showSuspect ? 'bg-danger' : 'bg-dark-600'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showSuspect ? 'translate-x-4' : 'translate-x-0'}`} />
        </span>
      </button>
      <p className="text-[11px] text-dark-500 leading-snug">
        Suspect records: unknown status, factory fixtures, placeholder locations with many devices on one point, and devices outside North America.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: The map control**

Create `src/components/map/FlockLeakFilterControl.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlockLeakStore, activeFlockFilterCount } from '../../store/flockLeakStore';
import { FlockFilterChips } from './FlockFilterChips';

/** Flock device filters: a button in the left control column (the country
 *  switch's slot, hidden on this tab) opening group and status chips and
 *  the suspect switch. Same popover idiom as BoundaryControl. Leak mode only. */
export function FlockLeakFilterControl() {
  const appMode = useAppModeStore((s) => s.appMode);
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const badge = activeFlockFilterCount({ groups, statuses, showSuspect });

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
        <div className="absolute z-10 bottom-full left-0 mb-3 w-72 bg-dark-800 rounded-md border border-dark-600 shadow-xl shadow-black/40">
          <div className="px-3 py-2 border-b border-dark-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Flock devices</span>
          </div>
          <div className="p-3">
            <FlockFilterChips />
            <p className="mt-3 pt-3 border-t border-dark-600 text-[11px] text-dark-500 leading-snug">
              Group and status are Flock's own labels, as of Dec 14, 2025.
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

- [ ] **Step 3: OSM filter on the Leak tab, CSS slot, mount**

In `src/components/map/CameraFilterControl.tsx` change `if (appMode !== 'map') return null;` to:

```ts
  // Map and Flock Leak: on the Leak tab the OSM filters narrow the OSM side of
  // the compare (for example, OSM cameras tagged Flock).
  if (appMode !== 'map' && appMode !== 'leak') return null;
```

In `src/index.css`, after the `.map-page .map-filter-control` desktop rule:

```css
/* Flock Leak device filters take the country button's slot (hidden on that tab) */
.map-page .map-flock-filter-control {
  bottom: 72px;
  left: 16px;
}
```

and inside the `@media (max-width: 1023px)` block after `.map-page .map-filter-control .filter-trigger`:

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

In `src/pages/MapPage.tsx` import `FlockLeakFilterControl` and add next to `<CameraFilterControl />`:

```tsx
            {appMode === 'leak' && <FlockLeakFilterControl />}
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -b --noEmit && npm run lint && npm test`. In the browser on `/leak` at z3: open the Flock filter, toggle ALPR off and on, toggle Planned: the map updates instantly and the devtools network tab shows no new `flock-inventory-v2` tile requests. Turn on "Show suspect records": large stacks appear (Atlanta); off: gone.

```bash
git add src/components/map/FlockFilterChips.tsx src/components/map/FlockLeakFilterControl.tsx src/components/map/CameraFilterControl.tsx src/index.css src/pages/MapPage.tsx
git commit -m "feat(leak): group and status filters with a suspect-records switch; OSM filters on the Leak tab"
```

---

### Task 12: Panels, drawer sheet, header count, status pill

Follow Task 11 of `2026-09-23-flock-leak-tab.md` with these substitutions:

- `FLOCK_LEAK_COPY` values:
  - `subtitle`: `Leaked Flock device inventory, December 14, 2025`
  - `peek`: `Flock's own device list, leaked Dec 2025.` (unchanged)
  - `flock`: `Flock's own device inventory, exported December 14, 2025 and published by a security researcher. Snapshot only, never updated. Agency fields were blank in the export.`
  - `totals`: `335,701 devices in the export, including planned, decommissioned and flagged records. 163,540 clean locations in service.`
  - everything else unchanged.
- The legend lists the seven selectable groups with `GroupSwatch` and `FLOCK_GROUP_SHORT`, then Planned (dashed) and Decommissioned (dimmed). Import `GroupSwatch` from `../map/FlockFilterChips`.
- `FlockLeakPanelContent` shows `<FlockFilterChips showCounts />` when `showFilters` is true, and a `totals` paragraph under the provenance cards.
- `FlockLeakPanel`'s subtitle line uses `FLOCK_INVENTORY.devices.toLocaleString()` devices instead of `tileJson.stats`.
- `formatFlockHeaderCount` (and its tests): below z9 with no count, `${FLOCK_INVENTORY.devices.toLocaleString()} Flock devices` in Flock view; in Swipe/Overlay below z9, `${osm} OSM · 335,701 Flock`; from z9, the in-view wording as before. Replace the `total` input with `hasTotalsZoom: boolean` (zoom below `FLOCK_LEAK_POINTS_MINZOOM`) and take the constant from `FLOCK_INVENTORY`. Test rows adjust accordingly (`84,120` becomes `335,701`).
- Drawer `case 'leak'` and the `MapPage` `ensureTileJsonLoaded` effect, pill, panel mount: unchanged.

Commit message: `feat(leak): desktop panel, drawer sheet, header counts, and the retry pill (v2 totals)`.

---

### Task 13: Documentation, acceptance checks, performance gate

**Files:**
- Modify: `CLAUDE.md`
- Create: `.superpowers/check-flock-leak.mjs`, `.superpowers/drag-perf-leak.mjs` (gitignored)

- [ ] **Step 1: CLAUDE.md**

As Task 12 Step 1 of the original plan, with the Data Sources bullet replaced by:

```
- **Flock Leak Tiles**: `https://tiles.dontgetflocked.com/flock-inventory-v2.json` (fixed URL, not host-dependent; source layer `cameras`; `g`/`s`/`q` codes at every zoom, full device records from z9; 7-day cache). Contract: `docs/superpowers/specs/2026-09-23-flock-inventory-v2-contract.md`. Totals come from `FLOCK_INVENTORY` in `src/lib/flockInventory.ts`, never from rendered features. A failure shows a retry pill on the Leak tab and never fails the app over.
```

- [ ] **Step 2: Acceptance checks (the contract's list, plus the tab's)**

Create `.superpowers/check-flock-leak.mjs`:

```js
// Flock Leak acceptance checks. Usage: APP=http://localhost:3000 node .superpowers/check-flock-leak.mjs
import { chromium } from 'playwright';
const APP = process.env.APP || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
const browser = await chromium.launch();
const mapReady = (page) => page.waitForFunction(() => !!window.__deflockMap && window.__deflockMap.loaded(), null, { timeout: 60000 });
const idle = (page) => page.evaluate(() => new Promise((r) => { const m = window.__deflockMap; if (m.loaded() && !m.isMoving()) r(); m.once('idle', r); }));

// 1. Layer off: the Map tab never requests the leak tileset
const off = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const offReqs = [];
off.on('request', (r) => { if (r.url().includes('flock-inventory-v2')) offReqs.push(r.url()); });
await off.goto(`${APP}/?lat=39.5&lng=-98&zoom=3`, { waitUntil: 'domcontentloaded' });
await mapReady(off); await off.waitForTimeout(4000);
check('map tab makes no flock-inventory-v2 request', offReqs.length === 0, String(offReqs.length));

// 2. On at z3: points render; filter changes cause no tile requests
const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
d.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
d.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const tileReqs = [];
d.on('request', (r) => { if (/flock-inventory-v2\/\d+\/\d+\/\d+\.mvt/.test(r.url())) tileReqs.push(r.url()); });
await d.goto(`${APP}/leak?lat=39.5&lng=-98&zoom=3`, { waitUntil: 'domcontentloaded' });
await mapReady(d); await d.waitForTimeout(6000); await idle(d);
const rendered = await d.evaluate(() => window.__deflockMap.queryRenderedFeatures(undefined, { layers: ['flock-leak-dots'] }).length);
check('z3 renders clean points', rendered > 1000, String(rendered));
const before = tileReqs.length;
await d.locator('.map-flock-filter-control .filter-trigger').click();
await d.getByRole('checkbox', { name: /ALPR/ }).click();
await d.waitForTimeout(800); await idle(d);
const afterGroup = await d.evaluate(() => window.__deflockMap.queryRenderedFeatures(undefined, { layers: ['flock-leak-dots'] }).length);
await d.getByRole('checkbox', { name: 'Planned' }).click();
await d.waitForTimeout(800); await idle(d);
check('group filter changes rendered count', afterGroup !== rendered, `${rendered} -> ${afterGroup}`);
check('filter changes made no tile requests', tileReqs.length === before, `${before} -> ${tileReqs.length}`);
await d.getByRole('switch', { name: 'Show suspect records' }).click();
await d.waitForTimeout(800); await idle(d);
const suspectOn = await d.evaluate(() => window.__deflockMap.queryRenderedFeatures(undefined, { layers: ['flock-leak-dots'], filter: ['>', ['get', 'q'], 0] }).length);
await d.getByRole('switch', { name: 'Show suspect records' }).click();
await d.waitForTimeout(800); await idle(d);
const suspectOff = await d.evaluate(() => window.__deflockMap.queryRenderedFeatures(undefined, { layers: ['flock-leak-dots'], filter: ['>', ['get', 'q'], 0] }).length);
check('suspect toggle reveals and hides q>0', suspectOn > 0 && suspectOff === 0, `${suspectOn} / ${suspectOff}`);
await d.keyboard.press('Escape');
check('no console errors or warnings at z3', errors.length === 0, errors.slice(0, 3).join(' | '));
await d.screenshot({ path: '.superpowers/flock-leak-desktop-z3.png' });

// 3. San Francisco: four devices at one coordinate
await d.goto(`${APP}/leak?lat=37.77946&lng=-122.50264&zoom=14`, { waitUntil: 'domcontentloaded' });
await mapReady(d); await d.waitForTimeout(5000); await idle(d);
await d.getByRole('switch', { name: 'Show suspect records' }).count(); // no-op guard
await d.getByRole('checkbox', { name: 'Planned' }).click().catch(() => {}); // ensure planned shown
const pt = await d.evaluate(() => { const p = window.__deflockMap.project([-122.50264, 37.77946]); return { x: p.x, y: p.y }; });
const canvas = await d.locator('.maplibregl-canvas').boundingBox();
await d.mouse.click(canvas.x + pt.x, canvas.y + pt.y);
await d.waitForTimeout(800);
const popup = await d.locator('.maplibregl-popup').innerText().catch(() => '');
check('SF popup: 4 devices at this exact coordinate', popup.includes('4 devices at this exact coordinate'), popup.slice(0, 120));
check('SF popup: type count line', popup.includes('2 Drone Dock · 2 Picard'));
check('SF popup: names', popup.includes('DS#008 - San Francisco PD - Dock 3') && popup.includes('P#008'));
check('SF popup: planned, created Nov 10, 2025', popup.includes('Planned') && popup.includes('Nov 10, 2025'));
await d.screenshot({ path: '.superpowers/flock-leak-desktop-sf.png' });

// 4. Swipe and OSM restore
await d.getByRole('tab', { name: 'Swipe' }).first().click();
await d.waitForTimeout(500);
await d.locator('.swipe-range').fill('200');
await d.waitForTimeout(300);
check('swipe applies within filter to OSM', await d.evaluate(() => JSON.stringify(window.__deflockMap.getFilter('camera-tile-points') ?? []).includes('within')));
await d.getByRole('tab', { name: 'Flock' }).first().click();
await d.waitForTimeout(500);
check('leaving swipe restores the OSM filter', await d.evaluate(() => !JSON.stringify(window.__deflockMap.getFilter('camera-tile-points') ?? []).includes('within')));
check('leak tab locks rotation', await d.evaluate(() => !window.__deflockMap.dragRotate.isEnabled()));
await d.locator('nav[aria-label="App modes"] button', { hasText: 'Map' }).click();
await d.waitForTimeout(800);
check('map tab re-enables rotation', await d.evaluate(() => window.__deflockMap.dragRotate.isEnabled()));

// 5. Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await m.goto(`${APP}/leak?lat=37.77946&lng=-122.50264&zoom=12`, { waitUntil: 'domcontentloaded' });
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

await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
```

- [ ] **Step 3: Run it**

Run: `APP=http://localhost:3000 node .superpowers/check-flock-leak.mjs` (or your dev port)
Expected: every line PASS. The San Francisco check depends on Planned being shown (the default hides it); the script toggles Planned on before clicking. Inspect the three screenshots against the approved mockups in `.superpowers/brainstorm/34894-1790199822/content/`.

- [ ] **Step 4: Performance gate and phone check**

As Task 12 Step 4 of the original plan (`drag-perf-leak.mjs` on the Leak tab in Swipe, `APP` set to the dev port), plus the phone check from Task 10. Record the numbers and the verdict in the PR description.

- [ ] **Step 5: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "docs: Flock Leak tab and the flock-inventory-v2 contract in CLAUDE.md"
```

- [ ] **Step 6: PR body**

Link both specs and the contract, the spike result, the phone verdict, the check output, the perf numbers, the screenshots, and the open items: colors and shapes are placeholders pending a design pass (`FLOCK_GROUP_COLOR`, `FLOCK_GROUP_SHAPE`); no "Open in table" link because no table URL exists yet; no spiderfy fan-out for coincident markers (the popup lists them instead).
