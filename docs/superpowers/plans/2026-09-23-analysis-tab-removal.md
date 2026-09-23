# Analysis Tab Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Analysis (choropleth density) mode entirely so its tab slot is free for the Flock Leak tab, with old `/analysis` links landing on the Map tab.

**Architecture:** The `density` app mode is wired into five places (mode store, URL vocabulary, page header, mobile drawer, map container) and owned by ~10 density-only files plus 3 MB of GeoJSON in `public/geo/`. Consumers are unwired first, in an order that keeps `tsc` green at every commit, then the density-only files and the unused `d3-contour` dependency are deleted.

**Tech Stack:** React 18, TypeScript, Zustand, Vite, vitest. `npm run build` runs `tsc -b`, which is the type gate.

**Spec:** `docs/superpowers/specs/2026-09-23-flock-leak-tab-design.md`, section 10 ("Analysis (density) removal") and section 1 (URL aliases).

## Global Constraints

- "Dot density" (the Explore timeline's dots layer, `DotDensityLayers`, `DotDensityControls`, `dotDensitySettings`) is a different feature and is **untouched**. Only the choropleth "Analysis" mode goes.
- `/analysis` and `?mode=density` must resolve to the `map` mode. No 404, no redirect config needed (the SPA handles unknown paths).
- Every commit must pass `npx tsc -b --noEmit`, `npm run lint` (zero new warnings), and `npm test`.
- Work on the shared checkout: commit only the files each task names. Do not switch branches.
- No em dashes in any user-facing string you write.

## Review Focus

1. A deep link to `/analysis?lat=29.76&lng=-95.36&zoom=12` must open the Map tab at that viewport, not reset the viewport. Pinned in Task 3's URL tests.
2. `?mode=density` on `/` must open the Map tab. Pinned in Task 3's URL tests.
3. The mobile drawer must show four tabs (Map, Route, Timeline, Network) with no empty slot and the peek height rules unchanged. Pinned by Task 4's Playwright check.
4. Leaving the Map tab for Timeline and back must not throw from a stale `density` case in the drawer's `renderTabContent` switch. Covered by the `tsc` exhaustiveness on `AppMode` in Task 3.
5. `useDensityStore` must not be reachable from any barrel export, or a later import would silently re-add dead code. Pinned by Task 3's grep step.

---

### Task 1: Unwire density from the map container

**Files:**
- Modify: `src/components/map/MapLibreContainer.tsx:53-63` (imports), `:212` (mode flag), `:269-277` (`showCameraMarkers`), `:970-1087` (click, hover, leave handlers), `:1384-1395` (`interactiveLayerIds`), `:1406` (`<DensityLayers />`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MapLibreContainer` with no reference to `density`, `useDensityStore`, `DensityLayers`, or `DensityFeatureProperties`. `AppMode` still contains `'density'` after this task; that is removed in Task 3.

- [ ] **Step 1: Remove the density imports**

In `src/components/map/MapLibreContainer.tsx`, delete these three lines (keep `DotDensityLayers`):

```ts
import { DensityLayers } from './layers/DensityLayers';
import { useDensityStore } from '../../store/densityStore';
import type { DensityFeatureProperties } from '../../types';
```

- [ ] **Step 2: Remove the mode flag and the marker gate**

Delete the line:

```ts
  const isDensityMode = appMode === 'density';
```

Change the `showCameraMarkers` block from:

```ts
  // In density mode, hide camera markers entirely to keep choropleth clean.
  // Timeline (dots) never shows markers: the dot layer carries every zoom, and the
  // markers it used to stack on top were never date-filtered past z13.
  const isMapModeHeatmap = isMapMode && mapModeViz === 'heatmap';
  const showCameraMarkers = !isNetworkMode && !isDensityMode && !isMapModeHeatmap && (
```

to:

```ts
  // Timeline (dots) never shows markers: the dot layer carries every zoom, and the
  // markers it used to stack on top were never date-filtered past z13.
  const isMapModeHeatmap = isMapMode && mapModeViz === 'heatmap';
  const showCameraMarkers = !isNetworkMode && !isMapModeHeatmap && (
```

- [ ] **Step 3: Remove the density branch from `onClick`**

Replace the block that starts with `// Density mode: select clicked feature` and ends with the `return;` after `setSelectedFeature(null)` (about 30 lines) so the handler reads:

```ts
  // Handle map clicks - location picking, or camera marker click to open its popup
  const onClick = useCallback(async (event: MapLayerMouseEvent) => {
    if (!mapRef.current) return;

    // Network mode: deck.gl handles clicks via its own pickable layers
    if (isNetworkMode) return;

    // If in location picking mode (for route origin/destination), handle click
    if (pickingLocation) {
```

and change its dependency array from:

```ts
  }, [pickingLocation, setPickedLocation, isDensityMode, isNetworkMode, isTilesMode, isFilterTilesMode]);
```

to:

```ts
  }, [pickingLocation, setPickedLocation, isNetworkMode, isTilesMode, isFilterTilesMode]);
```

- [ ] **Step 4: Remove the density hover handlers**

Replace `onMouseEnter` and `onMouseLeave` with:

```ts
  // Cursor handling - crosshair when adding waypoints or picking location
  const onMouseEnter = useCallback(() => {
    if (pickingLocation) return; // Keep crosshair when picking
    setCursor('pointer');
  }, [pickingLocation]);

  const onMouseLeave = useCallback(() => {
    if (pickingLocation) {
      setCursor('crosshair');
    } else {
      setCursor('');
    }
  }, [pickingLocation]);
```

`MapLayerMouseEvent` stays imported because `onClick` still uses it.

- [ ] **Step 5: Remove the density interactive layers and the layer component**

Change `interactiveLayerIds` from:

```ts
      interactiveLayerIds={isNetworkMode
        ? []
        : isDensityMode
          ? ['density-states-fill', 'density-counties-fill', 'density-states-extrusion', 'density-counties-extrusion']
          : showCameraMarkers
```

to:

```ts
      interactiveLayerIds={isNetworkMode
        ? []
        : showCameraMarkers
```

and fix the closing indentation so the ternary still reads:

```ts
      interactiveLayerIds={isNetworkMode
        ? []
        : showCameraMarkers
          ? (isTilesMode
              ? ['camera-tile-points']
              : isFilterTilesMode
                ? ['camera-tile-points-filtered']
                : ['unclustered-point'])
          : []}
```

Delete the line:

```tsx
      {isDensityMode && <DensityLayers />}
```

- [ ] **Step 6: Type-check, lint, test**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: all pass. If `tsc` reports `isDensityMode` anywhere, you missed a reference; search the file for `Density` and remove it (except `DotDensityLayers` and the comment about `dot-density-layer`).

- [ ] **Step 7: Commit**

```bash
git add src/components/map/MapLibreContainer.tsx
git commit -m "refactor: unwire density mode from the map container"
```

---

### Task 2: Unwire density from the mobile drawer

**Files:**
- Modify: `src/components/panels/MobileTabDrawer.tsx:3` (import), `:18-22` (imports), `:36-42` (TABS), `:73-78` (PEEK), `:85` (PEEK_MODES), `:113-125` (`DensityPeekLegend`), `:198-201` (store), `:225-229` (load effect), `:258-265` (selection effect), `:276-277` (skeleton flag), `:349-359` (peek height), `:455-470` (peek render), `:557-611` (full sheet case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MobileTabDrawer` with four tabs and no `density` references. `PEEK` and `PEEK_MODES` cover `route`, `explore`, `network`.

- [ ] **Step 1: Remove the imports**

Delete these lines:

```ts
import { useDensityStore } from '../../store/densityStore';
import { DensityControls } from '../../modes/density/DensityControls';
import { DensityLegend } from '../../modes/density/DensityLegend';
import { DensityFeatureStats } from '../../modes/density/DensityFeatureStats';
import { DENSITY_COLOR_RAMPS } from '../map/layers/DensityLayers';
```

In the lucide import, remove `BarChart3` only if it is no longer used after this task (it is used by the `PEEK` type annotation `Icon: typeof BarChart3`; replace that annotation with `typeof Navigation2` and then drop `BarChart3`).

- [ ] **Step 2: Remove the tab, the peek identity, and the peek mode**

Change `TABS` to:

```ts
const TABS: TabDef[] = [
  { mode: 'map', label: 'Map' },
  { mode: 'route', label: 'Route' },
  { mode: 'explore', label: 'Timeline' },
  { mode: 'network', label: 'Network' },
];
```

Change `PEEK` to:

```ts
const PEEK: Partial<Record<AppMode, { title: string; desc: string; Icon: typeof Navigation2 }>> = {
  // route renders the FlockHopper start ad instead of IdentityRow; entry kept so the peek effects treat route as peekable
  route:   { title: 'Route', desc: 'Set a start and destination to see ALPR exposure along your route — and safer alternatives.', Icon: Navigation2 },
  explore: { title: 'Timeline', desc: 'Watch the ALPR camera network grow as volunteers documented it on OpenStreetMap.', Icon: History },
  network: { title: 'Flock Sharing Network', desc: 'Law enforcement agencies sharing Flock ALPR data with each other, as publicly disclosed. Tap an agency to trace its connections.', Icon: Share2 },
};
```

Change `PEEK_MODES` to:

```ts
const PEEK_MODES: ReadonlySet<AppMode> = new Set(['route', 'explore', 'network']);
```

Update the comment above `UNIFORM_PEEK_HEIGHT` to read `switching among Route/Timeline/Network`.

- [ ] **Step 3: Delete `DensityPeekLegend`**

Remove the whole `DensityPeekLegend` function (the block that begins with the comment `/** Slim gradient legend inside the Analysis peek`).

- [ ] **Step 4: Remove the density store usage and effects**

Delete:

```ts
  // Density store
  const { loadPhase: densityLoadPhase, loadAllLevels: loadDensity, retryLoad: retryDensity, error: densityError } = useDensityStore();
  const selectedDensityFeature = useDensityStore(s => s.selectedFeature);
  const setSelectedDensityFeature = useDensityStore(s => s.setSelectedFeature);
```

Change the load effect to:

```ts
  /* ---- load data on mode switch ---- */
  useEffect(() => {
    if (appMode === 'network') loadNetworkData();
  }, [appMode, loadNetworkData]);
```

Delete the whole effect that begins with the comment `// Tapping a region on the map surfaces its stats at the detail peek.` (it ends with `}, [selectedDensityFeature, appMode]);`).

Update the comment on the network selection effect from `same contract as the Analysis-region effect above` to `only ever raises the sheet, never lowers a full one`.

Delete:

```ts
  const densityIsLoading = densityLoadPhase === 'fetching';
  const showDensitySkeleton = useDelayedFlag(densityIsLoading);
```

`useDelayedFlag` stays imported (still used for `showExploreSkeleton`).

- [ ] **Step 5: Simplify the peek height**

Replace the block from `// A selected Analysis region raises the peek` through `const drawerRestHeight = ...` with:

```ts
  // Resting height feeds --drawer-height so map controls/attribution ride
  // above the sheet. Parked at the peek height while 'full' (controls are
  // behind the sheet then anyway; jumping them to 85vh would look broken).
  const peekHeightForMode = PEEK_MODES.has(appMode) ? UNIFORM_PEEK_HEIGHT : minimizedHeight;
  const drawerRestHeight = snapPoint === 'minimized' ? minimizedHeight : peekHeightForMode;
```

- [ ] **Step 6: Simplify the peek render**

In the `headerContent` JSX, the chain that begins `appMode === 'route' ? (` currently has an `isDensityDetail` branch and a `density` case in the `IdentityRow` `extra` prop. Replace the whole chain so it reads:

```tsx
      {appMode !== 'explore' && snapPoint === 'peek' && (
        appMode === 'route' ? (
          hasRoutes ? (
            <div className="mt-3 animate-fade-in">
              <FlockHopperCTA variant="start" />
            </div>
          ) : (
            // Optically centered in the peek's content region (no floating gap)
            <div className="mt-6 animate-fade-in">
              <FlockHopperCTA variant="banner" />
            </div>
          )
        ) : appMode === 'network' && selectedNode ? (
          <NetworkPeekSummary
            onExpand={handleExpandSheet}
            onClear={() => setSelectedNodeId(null)}
          />
        ) : (
          <IdentityRow
            mode={appMode}
            onExpand={handleExpandSheet}
            extra={
              appMode === 'network'
                ? (
                  <div className="mt-3 flex items-center justify-center gap-1 text-dark-400">
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-medium">Swipe up for details</span>
                  </div>
                )
                : undefined
            }
          />
        )
      )}
```

- [ ] **Step 7: Remove the full-sheet case**

In `renderTabContent`, delete the entire `case 'density':` block (from the `/* ---------- DENSITY (Analysis) ---------- */` comment to the closing `);` before `/* ---------- NETWORK ---------- */`).

- [ ] **Step 8: Type-check, lint, test**

Run: `npx tsc -b --noEmit && npm run lint && npm test`
Expected: all pass. Search the file for `ensity` and confirm the only hits are `DotDensityControls`.

- [ ] **Step 9: Commit**

```bash
git add src/components/panels/MobileTabDrawer.tsx
git commit -m "refactor: drop the Analysis tab from the mobile drawer"
```

---

### Task 3: Remove the `density` mode, delete its files, drop the unused dependency

**Files:**
- Modify: `src/store/appModeStore.ts:4-20, 52-59, 97-98, 152-156`
- Modify: `src/store/index.ts:6-7`
- Modify: `src/types/index.ts:4`
- Modify: `src/utils/urlState.ts:23-47`
- Modify: `src/utils/urlState.test.ts:15, 28, 134, 167`
- Modify: `src/services/cameraDataService.ts:120`
- Modify: `src/pages/MapPage.tsx:6, 10, 13, 32, 44, 320, 343, 394, 400-404`
- Modify: `src/components/map/layers/NetworkLayers.tsx:365` (comment only)
- Modify: `package.json:45, 60` (remove `d3-contour` and `@types/d3-contour`), `package-lock.json` (via npm)
- Delete: `src/types/density.ts`, `src/components/panels/DensityPanel.tsx`, `src/components/map/DensityLegendBar.tsx`, `src/components/map/DensityLoadingPill.tsx`, `src/components/map/layers/DensityLayers.tsx`, `src/modes/density/DensityControls.tsx`, `src/modes/density/DensityFeatureInfo.tsx`, `src/modes/density/DensityFeaturePopup.tsx`, `src/modes/density/DensityFeatureStats.tsx`, `src/modes/density/DensityLegend.tsx`, `src/services/densityDataService.ts`, `src/store/densityStore.ts`, `src/store/densityStore.test.ts`, `public/geo/states-metrics.geojson`, `public/geo/counties-metrics.geojson`

This task is one commit on purpose: the density-only files import the types removed from `appModeStore`, and the page and barrels import the density-only files, so neither half compiles without the other.

**Interfaces:**
- Consumes: Tasks 1 and 2 (no other importers of the density files remain).
- Produces: `AppMode = 'map' | 'route' | 'explore' | 'network'`. `MODE_PATHS` has no `density` key. `parseAppUrl('/analysis', '')` returns mode `map`. No `density` module in the tree.

- [ ] **Step 1: Write the failing URL tests**

In `src/utils/urlState.test.ts`, change the parametrized path table entry:

```ts
    ['/analysis', 'density'],
```

to:

```ts
    ['/analysis', 'map'],
```

Change:

```ts
    expect(parseAppUrl('/map', '?mode=density').mode).toBe('density');
```

to:

```ts
    expect(parseAppUrl('/map', '?mode=density').mode).toBe('map');
```

Add a new test inside the first `describe` block:

```ts
  it('keeps the viewport of an old /analysis link while landing on map', () => {
    const parsed = parseAppUrl('/analysis', '?lat=29.76&lng=-95.36&zoom=12');
    expect(parsed.mode).toBe('map');
    expect(parsed.viewport).toEqual({ lat: 29.76, lng: -95.36, zoom: 12 });
  });
```

Remove the `['density', '/analysis'],` row from the `buildAppUrl` path table, and change the round-trip loop to:

```ts
    for (const mode of ['map', 'route', 'explore', 'network'] as const) {
```

- [ ] **Step 2: Run the URL tests to verify they fail**

Run: `npx vitest run src/utils/urlState.test.ts`
Expected: FAIL on `/analysis parses as map` and on the `?mode=density` assertion (they still resolve to `density`).

- [ ] **Step 3: Remove `density` from the URL vocabulary**

In `src/utils/urlState.ts`, change the three tables to:

```ts
/** Canonical pathname per app mode — the only URL↔mode vocabulary. */
export const MODE_PATHS: Record<AppMode, string> = {
  map: '/',
  route: '/route',
  explore: '/timeline',
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
  '/network': 'network',
};

const LEGACY_MODE_PARAM: Record<string, AppMode | undefined> = {
  route: 'route',
  explore: 'explore',
  network: 'network',
};
```

- [ ] **Step 4: Remove `density` from the mode store**

In `src/store/appModeStore.ts`:

Change the mode union:

```ts
export type AppMode = 'map' | 'route' | 'explore' | 'network';
```

Delete these type declarations and the `DensitySettings` interface:

```ts
export type DensityLevel = 'state' | 'county';
export type DensityMetric = 'perCapita' | 'perRoadMile';
export type DensityViewMode = '2d' | '3d';
export type DensityColorScheme = 'warm' | 'inferno' | 'viridis' | 'magma';
export type DensityHeightScale = 'sqrt' | 'log' | 'linear';

export interface DensitySettings {
  level: DensityLevel;
  metric: DensityMetric;
  viewMode: DensityViewMode;
  opacity: number;
  colorScheme: DensityColorScheme;
  heightScale: DensityHeightScale;
}
```

Delete `DEFAULT_DENSITY_SETTINGS` (the whole constant).

In `AppModeState`, delete:

```ts
  densitySettings: DensitySettings;
  updateDensitySettings: (settings: Partial<DensitySettings>) => void;
```

In the store body, delete:

```ts
  densitySettings: DEFAULT_DENSITY_SETTINGS,
  updateDensitySettings: (settings) =>
    set((state) => ({
      densitySettings: { ...state.densitySettings, ...settings },
    })),
```

- [ ] **Step 5: Fix the barrels**

`src/store/index.ts`: change the type export line to

```ts
export type { AppMode, ExploreFeature, HeatmapSettings, ColorSchemeId, MapVisualizationType } from './appModeStore';
```

and delete `export { useDensityStore } from './densityStore';`.

`src/types/index.ts`: delete `export * from './density';`, then delete the file `src/types/density.ts`:

```bash
git rm src/types/density.ts
```

- [ ] **Step 6: Drop `density` from the US-only set**

In `src/services/cameraDataService.ts`:

```ts
const US_ONLY_MODES = new Set(['route', 'network']);
```

- [ ] **Step 7: Unwire the page**

In `src/pages/MapPage.tsx`, delete these imports:

```ts
import { DensityPanel } from '@/components/panels/DensityPanel';
import { DensityLegendBar } from '@/components/map/DensityLegendBar';
import { DensityLoadingPill } from '@/components/map/DensityLoadingPill';
import { DensityFeaturePopup } from '@/modes/density/DensityFeaturePopup';
```

Remove `BarChart3` from the lucide import. Change `MODE_LABELS` to:

```ts
const MODE_LABELS: Record<AppMode, { icon: typeof Route; label: string }> = {
  map: { icon: MapIcon, label: 'Map' },
  route: { icon: Route, label: 'Route' },
  explore: { icon: Compass, label: 'Timeline' },
  network: { icon: Network, label: 'Network' },
};
```

Change the mobile header count line and its comment to:

```tsx
              {/* Mobile: live count + share. No count on Timeline/Network — "in view"
                  ignores the timeline date, and Network shows agencies. */}
              <div className="lg:hidden flex items-center gap-2 h-full">
                {appMode !== 'explore' && appMode !== 'network' && <HeaderCameraCount />}
```

Delete the line `{!isMobile && appMode === 'density' && <DensityPanel />}`.

Delete the line `{appMode === 'density' && <DensityLoadingPill />}`.

Delete the two blocks:

```tsx
            {/* Density feature popup — floating stats card */}
            {appMode === 'density' && <DensityFeaturePopup />}

            {/* Density legend bar — horizontal bottom overlay */}
            {appMode === 'density' && <DensityLegendBar />}
```

Update the comments that mention Analysis: the country-switch comment becomes `Hidden on Route/Network.`, the camera-count comment becomes `Timeline's count ignores the scrubbed date.`, and the legend comment becomes `(explore legend lives in side panel)`. Also update the US-only bounce comment near the top from `US-only modes (Route/Analysis/Network)` to `US-only modes (Route/Network)`.

- [ ] **Step 8: Delete the density-only files**

```bash
git rm src/components/panels/DensityPanel.tsx \
  src/components/map/DensityLegendBar.tsx \
  src/components/map/DensityLoadingPill.tsx \
  src/components/map/layers/DensityLayers.tsx \
  src/modes/density/DensityControls.tsx \
  src/modes/density/DensityFeatureInfo.tsx \
  src/modes/density/DensityFeaturePopup.tsx \
  src/modes/density/DensityFeatureStats.tsx \
  src/modes/density/DensityLegend.tsx \
  src/services/densityDataService.ts \
  src/store/densityStore.ts \
  src/store/densityStore.test.ts \
  public/geo/states-metrics.geojson \
  public/geo/counties-metrics.geojson
rmdir src/modes/density public/geo 2>/dev/null || true
```

- [ ] **Step 9: Confirm nothing imports them**

Run:

```bash
grep -rn "densityStore\|DensityLayers\|DensityPanel\|densityDataService\|modes/density\|types/density\|DensityLegendBar\|DensityLoadingPill\|useDensityStore\|DensitySettings" src
```

Expected: no output. Any hit is a missed consumer; remove it.

- [ ] **Step 10: Fix the stale comment in NetworkLayers**

In `src/components/map/layers/NetworkLayers.tsx` line 365, change:

```ts
  // any prior pitch animation (e.g. from DensityLayers cleanup) has settled.
```

to:

```ts
  // any prior pitch animation has settled.
```

- [ ] **Step 11: Remove the unused dependency**

`d3-contour` has no importer in `src/` (verified 2026-09-23 with `grep -rn "from 'd3" src`).

```bash
npm uninstall d3-contour @types/d3-contour
```

Then confirm `vite.config.ts` does not name `d3` in `manualChunks` (it does not as of 2026-09-23; if it does, remove that clause).

- [ ] **Step 12: Run the URL tests to verify they pass**

Run: `npx vitest run src/utils/urlState.test.ts`
Expected: PASS.

- [ ] **Step 13: Type-check, lint, full tests, build**

Run: `npx tsc -b --noEmit && npm run lint && npm test && npm run build`
Expected: all pass. If `tsc` names a file that still mentions `density`, it is a missed consumer from Step 9.

- [ ] **Step 14: Commit**

```bash
git add -A src/store/appModeStore.ts src/store/index.ts src/types/index.ts src/types/density.ts src/utils/urlState.ts src/utils/urlState.test.ts src/services/cameraDataService.ts src/pages/MapPage.tsx src/components/panels/DensityPanel.tsx src/components/map/DensityLegendBar.tsx src/components/map/DensityLoadingPill.tsx src/components/map/layers/DensityLayers.tsx src/modes/density src/services/densityDataService.ts src/store/densityStore.ts src/store/densityStore.test.ts public/geo src/components/map/layers/NetworkLayers.tsx package.json package-lock.json
git commit -m "refactor: remove the Analysis (density) mode and its data; /analysis lands on map"
```

---

### Task 4: Documentation and a browser smoke check

**Files:**
- Modify: `CLAUDE.md:60-65, 77, 97, 108-123, 144, 156`
- Create: `.superpowers/check-analysis-removed.mjs` (gitignored harness script)

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: docs that match the code; a repeatable smoke check.

- [ ] **Step 1: Update CLAUDE.md**

In the App Modes section, change the intro to `The map has 4 modes, selectable via the header tabs:` and delete the `**Density (Analysis)**` bullet. In Critical Files, delete the `densityDataService.ts` row. In State Management, delete the `densityStore` bullet. In Directory Structure, remove `DensityLayers,` from the layers line, `DensityPanel,` from the panels line, `density` from the modes line, `densityDataService,` from the services line, and `density,` from the types line. In Map Rendering, remove `DensityLayers, ` from the list. In Data Sources, delete the `**Density Data**` bullet.

- [ ] **Step 2: Write the smoke check**

Create `.superpowers/check-analysis-removed.mjs`:

```js
// Smoke check: /analysis lands on the Map tab and the drawer shows four tabs.
// Usage: APP=http://localhost:3000 node .superpowers/check-analysis-removed.mjs
import { chromium } from 'playwright';
const APP = process.env.APP || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);

const browser = await chromium.launch();

// Desktop: old link lands on map with its viewport intact
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desktop.goto(`${APP}/analysis?lat=29.7604&lng=-95.3698&zoom=12`, { waitUntil: 'domcontentloaded' });
await desktop.waitForTimeout(4000);
const url = new URL(desktop.url());
check('desktop /analysis rewrites to /', url.pathname === '/', url.pathname);
check('desktop viewport kept', url.searchParams.get('zoom') === '12.00', url.search);
const tabs = await desktop.locator('nav[aria-label="App modes"] button').allInnerTexts();
check('desktop nav has no Analysis', !tabs.some(t => /analysis/i.test(t)), tabs.join(','));
check('desktop nav has 4 tabs', tabs.length === 4, String(tabs.length));

// Mobile: four tabs in the drawer
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await mobile.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
await mobile.locator('[role="dialog"]').first().waitFor({ timeout: 30000 });
await mobile.waitForTimeout(2000);
const mobileTabs = await mobile.locator('[role="dialog"] button').filter({ hasText: /^(Map|Route|Timeline|Network|Analysis)$/i }).allInnerTexts();
check('mobile drawer has 4 tabs', mobileTabs.length === 4 && !mobileTabs.some(t => /analysis/i.test(t)), mobileTabs.join(','));
await mobile.screenshot({ path: '.superpowers/analysis-removed-mobile.png' });

await browser.close();
console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
```

- [ ] **Step 3: Run it against the dev server**

In one terminal: `npm run dev` (port 3000). In another:

Run: `node .superpowers/check-analysis-removed.mjs`
Expected: five `PASS` lines. Look at `.superpowers/analysis-removed-mobile.png` and confirm the tab row reads Map, Route, Timeline, Network with even spacing.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: remove the Analysis mode from CLAUDE.md"
```

The harness script lives under `.superpowers/`, which is gitignored, and stays for reuse.
