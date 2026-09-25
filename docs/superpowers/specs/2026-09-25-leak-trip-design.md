# Leak tab trip and phone search pill: Design

**Date:** 2026-09-25
**Status:** Draft for review
**Area:** Leak tab on phones (trip mode), phone search on every tab that shows it
**Builds on:** `2026-09-23-flock-leak-tab-design.md` (Leak tab, device selection, phone device peek), `2026-07-17-uniform-peek-system-design.md` (drawer peeks, `--drawer-height`)
**Mockups (live app, 390 and 360 px):** https://claude.ai/artifact/Fpt8qfxaCBiPJQ6Du8xfb9

## Problem

People want to drive out and check whether devices in Flock's leaked records are really there. Today that means copying coordinates out of device cards one at a time. There is no way to pick several devices and get a drive that visits them in a sensible order.

Separately, the phone search bar takes the top 104 px of the map on every tab that shows it (a 54 px field with a 12 px gap under the 38 px header), plus an arrow button that repeats the keyboard's Search key.

## Decisions (from mockup review, 2026-09-25)

- The trip lives on the **Leak tab** only. Stops are Flock leak devices.
- **Entry is a Trip button** in the left map column. One tap opens trip mode. Starting from the tapped device's card was mocked and rejected ("I dont love the activation step").
- **In trip mode a tap on a device adds or removes it.** There is no card or popup per stop.
- **At most 10 stops**, shown as "N of 10 stops". This is the Google Maps limit: 9 waypoints plus a destination.
- **Export is a Google Maps directions link.** The app puts the stops in order itself, because Google keeps the order it is given.
- **Stops are labeled with Flock's own device `name`** (for example "#28 Jefferson St EB from I-45"). No reverse geocoding is needed.
- **Phone search becomes a Search pill** at the top left that opens today's bar. A header icon was mocked and rejected as "way too hidden". A slim bar, a bar that shrinks after the first pan, and search inside the drawer were also mocked, and the user picked the pill.

## Proposed defaults (confirm in review)

1. Trip mode works in both Leak views (Flock's records, and Compare with OSM). Flock records with no OSM camera beside them are the ones most worth checking.
2. The Search pill replaces the bar on phones for Map, Timeline, Leak and Network. Route keeps `FloatingRouteCard`, and desktop keeps its search box.
3. **Done** leaves trip mode and keeps the stops. The Trip button then shows the stop count. **Clear** empties the trip.
4. Stops survive a reload (`localStorage`). A phone may reload the tab after the user switches to Google Maps and back.
5. Entering trip mode asks for location once, so the order can start from where the user is. The position stays on the device and is never put in the link. If location is denied, the order starts at one end of the shortest path.
6. Trip mode is phones only in this version (below the `lg` breakpoint).
7. The link opens Google's directions preview, not navigation (no `dir_action=navigate`), so the driver sees the route before starting.

## Goals

- From the Leak tab on a phone: Trip, then taps on up to 10 devices, then one button opens the drive in Google Maps.
- No new chrome while browsing: one map button, and nothing else until it is tapped.
- Search stays obvious (a labeled pill) while giving the top of the map back.
- The map feels exactly as smooth in trip mode as outside it.

## Non-goals

- Camera-avoidance routing for the trip, in-app navigation, or drive-time optimization. The order is shortest straight-line distance.
- Other exports (Apple Maps, GPX).
- Recording whether a device was found. Verification happens outside the app.
- A desktop trip UI.
- Trips on other tabs, or OSM cameras as stops.

## Design

### 1. Trip state: `src/store/tripStore.ts`

A Zustand store, following the existing store pattern:

- `active: boolean`: trip mode is open.
- `stops: TripStop[]`: at most 10, in the order they were added.
- `order: string[]`: stop keys in driving order, recomputed by the actions.
- `origin: { lat: number; lon: number } | null`: the device position, when known.
- `locationStatus: 'idle' | 'pending' | 'granted' | 'denied' | 'unavailable'`.
- Actions: `open()`, `close()`, `toggleStop(stop)`, `removeStop(key)`, `clear()`, `setOrigin(pos)`, `setLocationStatus(status)`.

```ts
interface TripStop {
  key: string;        // `${lat},${lon}` of the exact source coordinate
  lat: number;        // exact source coordinate (FlockSelection.lat/lon)
  lon: number;
  markLat: number;    // drawn (tile-quantized) position, where the chip sits
  markLon: number;
  name: string;       // lead device's name
  type: string;       // lead device's type, e.g. "Falcon"
  deviceCount: number; // devices at this coordinate
}
```

**One stop per coordinate.** The Leak tab already resolves a tap to every device at one exact coordinate (`resolveFlockClick`, `MapLibreContainer.tsx:1051-1114`). A stack of devices on one pole is one place to drive to, so it is one stop. The lead device (first in `devices`, with components last) supplies `name` and `type`.

`toggleStop` removes the stop if its key is already present. Otherwise it adds the stop when there are fewer than 10, and does nothing at 10. Every change recomputes `order` from `origin` and `stops`. The recompute runs on taps only, never in a map move handler.

Persistence: `stops` are written to `localStorage` under `deflock:trip:v1` on every change and read on store creation. Reads and writes are wrapped in try/catch, and bad data falls back to an empty trip. `active`, `origin` and `locationStatus` are not persisted.

### 2. Ordering: `src/utils/tripOrder.ts` (pure)

`orderStops(origin: LatLon | null, stops: LatLon[]): number[]` returns indices in driving order.

- The distance is `haversineDistance` from `src/utils/geo.ts:89`.
- It is exact Held-Karp over subsets. At 10 stops that is about 100k steps, well under a millisecond.
- With an origin, it finds the shortest open path starting at the origin.
- Without one, it finds the shortest open path from any start.
- Ties break by the lowest index, so the result is deterministic.
- 0 or 1 stops return trivially.

### 3. Export: `src/utils/googleMapsTripUrl.ts` (pure)

`googleMapsTripUrl(ordered: LatLon[]): string | null`:

- 0 stops returns `null`.
- The last stop is the `destination`. The others, in order, are `waypoints` joined with `|`.
- `travelmode=driving`. There is no `origin`, so Google starts from the phone's location.
- Coordinates use 6 decimals.
- It is built with `URLSearchParams` on `https://www.google.com/maps/dir/?api=1`.

The button is a plain `<a href target="_blank" rel="noopener noreferrer">`, the same pattern as the Street View link in `FlockLeakPopup.tsx:122-133`. On phones with the Google Maps app, the link opens the app. Without the app it opens the mobile site, which Google limits to 3 waypoints (4 stops). The site cannot detect the app, so the cap stays at 10.

### 4. Location

`open()` asks for the position once with `navigator.geolocation.getCurrentPosition` (`enableHighAccuracy: false`, `maximumAge: 60000`, `timeout: 8000`).

- **Success:** `setOrigin`, which reorders. A small location dot is drawn at the origin.
- **Denied, error or timeout:** the order runs with no origin, and the list footnote says the order starts at stop 1.
- It is not asked again during that visit.

The position never leaves the device. The link has no `origin` parameter.

### 5. Tap handling in trip mode (`MapLibreContainer.tsx`)

In the leak branch of `onClick` (1149-1158), when `tripStore.active`:

- Resolve the tap exactly as `resolveFlockClick` does today, with the ±12 px box, `nearestCoordinateGroup` and `groupDevicesAtCoordinate`. Then call `toggleStop` with the resolved group instead of `setSelection`.
  - Extract the shared resolution into a function that returns the group without side effects, so both paths use it.
- **Below z9** the tap hits only the dots layer, which has no id, name or exact coordinate. Those taps do nothing, and the trip bar hint says to zoom in (see section 7).
- A tap on empty map does nothing. It does not clear anything.
- In Compare view, taps on OSM camera points do nothing (no camera popup).
- **Double-tap guard:** ignore a second tap within 400 ms, reusing the `lastPickTimeRef` pattern (1164-1168). Also turn off `doubleClickZoom` while trip mode is active, the same way location picking does (1222-1230). Without both, a double-tap would add a stop and then remove it.

Entering trip mode calls `useFlockLeakStore.getState().setSelection(null)`, so no device card or selection ring is left over.

### 6. Map marks: `src/components/map/TripMarks.tsx`

This component is mounted in the map on the Leak tab when there is at least one stop and trip mode is active.

- **Numbered chips.** A react-map-gl `<Marker>` per stop at `markLon`/`markLat`, `anchor="center"`, `pointerEvents: 'none'`. This is the same technique as the phone selection ring (`FlockLeakPopup.tsx:151-160`).
  - Each chip is 24 px, white, with dark tabular numerals and a 2 px dark ring.
  - DOM markers need no glyphs and always sit above the canvas, so they do not join the Flock `layersToRaise` ordering. MapLibre repositions them during gestures without React commits.
- **Connector.** A GeoJSON `line` layer from the origin (when known) through the stops in order: white, 1.5 px, opacity 0.55, dasharray [2, 2].
  - It sits under the Flock marks, which already raise themselves above other layers.
  - It is a straight schematic line, not the road route.
- **Origin dot.** A `<Marker>` at the origin when known: blue dot, white ring, soft halo.

When trip mode is closed (after Done), the chips and connector are hidden. The Trip button carries the count instead.

### 7. Trip bar: `MobileTabDrawer.tsx`

When `tripStore.active`, the drawer shows the trip in the same `BottomSheet`. The header (which holds the tab row) becomes the trip peek, and the full-sheet content becomes the stop list. The tabs are hidden until Done.

**Peek** (`TripPeek`):
- Row 1: micro-label `Trip`, then `N of 10` and `stops`, with `Done` on the right.
- Row 2: the hint, which depends on the state:
  - Below z9: "Zoom in to tap devices."
  - 0 stops: "Tap devices to add stops."
  - 1 to 9 stops: "Tap devices to add or remove stops."
  - 10 stops: "Trip is full. Remove a stop to add another."
- Row 3: a full-width `Open in Google Maps` bar (accent fill, external-arrow icon). It is dimmed and inert at 0 stops.
- The peek height is its own constant (`TRIP_PEEK_HEIGHT`, about 132, tuned in the browser). `drawerRestHeight` uses it while the trip is active, so `--drawer-height` (337-340) and every control that reads it follow.
- The zoom hint reads a boolean `zoom >= 9` through an equality-gated selector. It changes when a gesture ends, not during it.

**Full sheet** (`TripSheet`, swipe up):
- A header with the same count, plus `Clear` and `Done`.
- One row per stop in driving order: a number chip, the device name (one line, truncated), and a second line with the type plus "· N devices here" for stacks. A remove button (✕) sits on the right.
- Footnote:
  - With location: "Starts from your location, in the shortest order. Opening the trip sends these stops to Google."
  - Without location: "Starts at stop 1, in the shortest order. Opening the trip sends these stops to Google."
- The same `Open in Google Maps` bar.

The existing effects that raise the sheet to peek on mode entry and on selection (236-243, 254-260) must also rest it at the trip peek when trip mode opens.

### 8. Map chrome in trip mode

**Hidden:**
- Legend (`FlockLegendControl`) and the Flock filter (`FlockLeakFilterControl`)
- The OSM filter (`CameraFilterControl`) in Compare view
- The theme toggle (`MapThemeControl`)
- The Trip button itself

**Kept:** the header with its count and Share, the Search pill, the locate button, and the attribution.

Each hidden control reads `tripStore.active` and returns null. That is the same way `CameraFilterControl` already hides on the Flock view (393, 484).

### 9. Trip button: `src/components/map/TripControl.tsx`

- Rendered in `MapPage.tsx` next to the other Leak controls (421-424), on the Leak tab, below `lg` only.
- It matches the Legend and Flock buttons: 38 px on phones, an icon above an 8 px uppercase caption `Trip`. The icon is lucide `Route`.
- When trip mode is closed and there are stops, a white count badge sits on the top-right corner, like the Flock filter's badge.
- Tap calls `open()`.

**Slot.** Trip takes the bottom slot of the left column, nearest the thumb, as mocked. The Leak slots above it each move up one step (46 px) on phones:

| Phone slot, `calc(var(--drawer-height) + X)` | Flock view | Compare view |
|---|---|---|
| Trip (`.map-trip-control`) | +30 | +30 |
| OSM filter | hidden | +76 |
| Flock filter | +76 | +122 |
| Legend | +122 | +168 |

This is new mobile rules in `index.css` next to 493-525, scoped by a `.leak-trip-slot` class that `MapPage` puts on the map page on the Leak tab below `lg`. Desktop offsets (407-428) do not change.

### 10. Search pill: `MapSearch.tsx`

Below `lg`, `MapSearch` gets a `collapsed` state, which starts true.

- **Collapsed:** a pill at the same anchor (`top-3 left-3`, width fits the content, 42 px tall). It has the search icon and the word `Search`, the input's background, border and radius, and a soft shadow. `aria-label="Search places"`.
- **Tapping the pill** expands to today's full-width bar and focuses the input, so the keyboard opens in the same gesture (focus must happen inside the tap handler for iOS).
- **Collapses** on picking a result, on the ✕, on Escape, and on blur while the input is empty.
- On phones the arrow submit button becomes that ✕. The keyboard's Search key submits (`enterKeyHint="search"`).
- Desktop rendering is unchanged.

It renders wherever `MapSearch` renders today (`MapPage.tsx:408`): Map, Timeline, Leak and Network. Route uses `FloatingRouteCard` and does not change.

In trip mode the pill stays, so the user can jump to another town while planning.

### 11. Leaving the Leak tab

`endVisit` (`flockLeakStore.ts:138`) also calls `tripStore.close()`. The stops are kept.

Trip mode cannot be entered on desktop. If the viewport crosses to `lg` while trip mode is active, it closes.

## Copy

These strings follow the no-dash, plain-statement rule:

- Controls and labels: `Trip`, `N of 10`, `stops`, `Done`, `Clear`, `Open in Google Maps`, `Search`.
- The four hint states and the two footnotes are listed in section 7.

## Performance

- Map move handlers gain no work.
- Store writes happen only on taps and on Done, Clear and remove.
- The zoom hint re-renders only when crossing z9, after the gesture ends.
- There are 10 DOM markers at most, and MapLibre moves them without React.

The drag-perf harness (`.superpowers/drag-perf.mjs`) must still show 0 to 1 React commits per drag with 10 stops in trip mode.

## Edge cases

- **A stop's device gets filtered out or the view switches:** the stop keeps its own coordinate and name, and its chip still shows.
- **The tile host fails over and the sources remount:** trip state lives in the store and is unaffected.
- **The theme changes (`setStyle`):** the connector is a react-map-gl `<Source>`/`<Layer>`, which re-adds itself. The chips are DOM markers.
- **Browser back or forward leaves the Leak tab while trip mode is active:** `endVisit` closes it.
- **Very long device names:** truncated with an ellipsis in the list. The peek never shows names.
- **Stored stops that are stale after a data refresh:** they still point at real coordinates and names from the export, so they are harmless.

## Verification

**Unit tests** (Vitest, colocated `*.test.ts`, node environment):
- `tripOrder`: 0, 1 and 2 stops; a known optimum on a small grid; with and without an origin; deterministic ties; 10 stops finishing in under 20 ms.
- `googleMapsTripUrl`: 0, 1 and 10 stops; waypoint order; coordinate precision; length under 2,048 characters at 10 stops.
- `tripStore`:
  - toggling a stop on and off
  - the cap at 10
  - stacked devices becoming one key
  - reordering when the origin arrives
  - persistence round trip and corrupt-storage fallback
  - a `_resetTripStoreForTests` hook, following the `flockLeakStore.test.ts` pattern

**Browser checks** (Playwright at phone 390 and small 360, extending `.superpowers/ux-audit` or the project verify skill):
- Trip opens at 0 of 10.
- Tapping 4 devices shows chips 1 to 4 and "4 of 10". Tapping one again removes it.
- A double-tap does not toggle twice.
- The cap holds at 10.
- Below z9 the hint says to zoom in.
- The list shows device names.
- The button's `href` matches `googleMapsTripUrl` for the shown order.
- Done shows the badge. Reopening restores the stops.
- The pill expands, focuses and collapses on Map, Timeline, Leak and Network.
- Desktop screenshots are unchanged.

**Build and lint:** `npm run build` passes, and lint shows no new problems against the baseline.

**Drag perf:** see Performance.

## Rollout

Two independent slices, in this order:

1. **Search pill:** `MapSearch.tsx` only. It is useful on its own and touches every tab.
2. **Trip:**
   - store, ordering and URL, with tests
   - the Trip button and slot CSS
   - marks
   - drawer
   - tap routing
   - CLAUDE.md: the Leak tab notes, `tripStore` in the store list, and the new files in Critical Files

## Files touched (anticipated)

**New:**
- `src/store/tripStore.ts` and `.test.ts`
- `src/utils/tripOrder.ts` and `.test.ts`
- `src/utils/googleMapsTripUrl.ts` and `.test.ts`
- `src/components/map/TripControl.tsx`
- `src/components/map/TripMarks.tsx`
- `src/components/panels/TripPeek.tsx`
- `src/components/panels/TripSheet.tsx`

**Modified:**
- `src/components/map/MapLibreContainer.tsx`: the trip branch in `onClick`, a side-effect-free group resolver, `doubleClickZoom`, and mounting `TripMarks`
- `src/components/panels/MobileTabDrawer.tsx`: the trip header and content, and `TRIP_PEEK_HEIGHT`
- `src/pages/MapPage.tsx`: mounting `TripControl` and the `.leak-trip-slot` class
- `src/components/map/MapSearch.tsx`: the pill state
- `src/components/map/FlockLegendControl.tsx`, `FlockLeakFilterControl.tsx`, `CameraFilterControl.tsx` and `MapThemeControl.tsx`: hide in trip mode
- `src/store/flockLeakStore.ts`: `endVisit` closes the trip
- `src/index.css`: the Trip slot and the shifted Leak slots on phones
- `CLAUDE.md`
