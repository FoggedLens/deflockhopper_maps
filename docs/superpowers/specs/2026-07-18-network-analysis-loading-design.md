# Network & Analysis Slow-Connection Loading — Design

> **Superseded 2026-09-10:** the two network files are no longer bundled in `/public/`. They are fetched from `https://deflockdata.dontgetflocked.com/` (weekly publish, `VITE_NETWORK_DATA_BASE` override); see `src/services/networkDataService.ts`. Paths quoted below are historical.

**Date:** 2026-07-18
**Status:** Approved (user opted for "feedback + progressive loading", visuals aligned with the existing pill/skeleton language from the 2026-07-18 loading-states refresh)

## Problem

Network mode downloads ~9 MB of JSON (6 MB `sharing-network-adjacency.json` + 3 MB
`sharing-network-nodes.geojson`) and Analysis downloads ~3 MB (2.7 MB
`counties-metrics.geojson` + 260 KB `states-metrics.geojson`). On slow connections:

- **Network, mobile:** the map area shows nothing at all while loading (the
  `NetworkAgencyCount` card is `hidden lg:block`), and the bottom-sheet header reads
  "0 agencies".
- **Network, desktop:** a spinner in the count card and a panel skeleton, but no
  progress indication for a multi-MB transfer, and nothing renders until *both*
  files land even though dots only need nodes.
- **Analysis:** in-panel skeleton only; the map stays an empty basemap until both
  levels finish, even though the default County level is 10x the size of States.

## Principle

Reuse the established loading language (floating pill over the map, in-panel
skeletons, tap-to-retry) and commit each file as it arrives so slow connections see
content as early as possible. No new visual vocabulary.

## Design

### 1. Shared progress pill

- Extract the presentational shell of `LoadingPill` (`src/components/common/LoadingPill.tsx`)
  into a reusable component: positioning (`bottom-[calc(var(--drawer-height,80px)+12px)]`
  / `lg:bottom-6`, centered), spinner, delayed appearance via `useDelayedFlag`, error
  variant with tap-to-retry, optional trailing progress text.
- The camera `LoadingPill` keeps its exact current behavior (including the
  "N cameras ready" flash), rendered through the shared shell.
- New thin wrappers: `NetworkLoadingPill` and `DensityLoadingPill`, wired to their
  stores, mounted from `MapPage` when `appMode` is `network` / `density`. They render
  on both mobile and desktop.
- Progress text: `readBodyWithProgress` (`src/services/cameraDataService.ts`) only
  yields a determinate percent when Content-Length is present and no
  Content-Encoding is set. Cloudflare compresses these JSON responses, so the pill
  shows a percent when determinate and otherwise the decompressed bytes received so
  far ("2.1 MB"). The progress callback is extended (or paralleled) to report loaded
  bytes alongside percent.
- Co-occurrence with the camera pill is not possible in practice (Network/Analysis
  are US-only, tiles-rendered modes where `needsGeojson` is false), so both pills
  share the same anchor position without a stacking rule.

### 2. Network mode: progressive load + feedback

- `networkStore.loadNetworkData` fetches nodes and adjacency in parallel but commits
  independently: as soon as nodes parse, `nodesMap`/`nodesArray` are set and
  `loadPhase` moves to `ready`; a new `adjacencyReady: boolean` flips when
  adjacency (and `reverseAdjacency`) commit.
- `NetworkLayers` dots render from `nodesArray` immediately (no change needed; it
  already reads the store).
- Pill copy: "Loading agencies…" (+ bytes/percent) while nodes stream, then
  "Loading connections…" while only adjacency remains. Hidden once both are in.
- Selecting a node before `adjacencyReady`: `setSelectedNodeId` stores the selection;
  arcs compute as empty. When adjacency commits, arcs for the current selection are
  recomputed in the same store update. `NetworkPanelContent` shows a small
  "Loading connections…" line (Skeleton or muted text row) in place of the
  connection tabs while `adjacencyReady` is false.
- `NetworkPanelContent` gates on nodes-ready instead of full `loadPhase === 'ready'`
  (identical in the new semantics, since `ready` now means nodes-ready).
- Mobile: the drawer (`MobileTabDrawer`) already renders identity peeks without
  raw counts, and `NetworkPanel`'s BottomSheet branch is dead code (desktop-only
  mount), so no header copy change is needed; the pill provides mobile feedback.
- Byte-progress state in the store: `downloadProgress: { percent: number | null;
  loadedBytes: number } | null` covering the phase currently streaming.

### 3. Analysis mode: progressive load + interim states layer

- `densityStore.loadAllLevels` fires both fetches in parallel and commits each level
  as it arrives (`statesData`, `countiesData` set independently). `loadPhase` moves
  to `ready` when states commit (panel controls become interactive); a derived
  "counties pending" condition is simply `countiesData === null` while fetching.
- Interim layer: when the active level is `county` but `countiesData` is still null
  and `statesData` is available, `DensityLayers` shows the states choropleth
  (visibility toggle only; same metric, colors, and legend). When counties commit,
  visibility swaps to the county layer. Reads as detail sharpening, not a mode change.
- Pill copy: "Loading regions…" while states stream (brief), then
  "Loading county detail…" (+ bytes/percent) while counties stream and the active
  level is `county`. If the user switches to States level, the pill hides once
  states are in (counties continue silently in the background).
- Per-level progress requires `loadDensityData` (`src/services/densityDataService.ts`)
  to accept an `onProgress` callback and read the body via `readBodyWithProgress`
  instead of `response.json()`.
- Mobile sheet header keeps its existing "Loading..." subtitle.

### 4. Error handling

- Existing in-panel error cards with Retry stay unchanged in both panels.
- The pills additionally render the shared error variant ("Couldn't load network
  data. Tap to retry." / "Couldn't load analysis data. Tap to retry."), wired to the
  stores' retry actions. Partial failure (one file fails after the other committed)
  surfaces the same way; retry only refetches what's missing (both services already
  cache/dedupe).

### 5. Copy

All new user-facing strings are plain declarative statements without em dashes:
"Loading agencies…", "Loading connections…", "Loading regions…",
"Loading county detail…", "Couldn't load network data. Tap to retry.",
"Couldn't load analysis data. Tap to retry."

## Testing

- Verify with Chrome DevTools throttling (Slow 3G) via the project verify skill:
  - Network mode: dots appear before arcs are possible; pill shows both phases;
    selecting a node mid-load fills in connections when adjacency lands.
  - Analysis mode: states choropleth appears quickly under default County level,
    swaps to counties when ready; pill phases match.
  - Mobile viewport: pills visible above the drawer; sheet headers show loading copy.
  - Error paths: block a URL in DevTools, confirm pill error + retry works.
- `npm run build` and `npm run lint` clean (zero new lint findings per shared-tree
  convention).

## Out of scope

- Camera GeoJSON loading (covered by the 2026-07-18 loading-states refresh).
- Reducing payload sizes (tiling/compressing the network data is a future project).
- Boot splash / full-screen loader behavior.
