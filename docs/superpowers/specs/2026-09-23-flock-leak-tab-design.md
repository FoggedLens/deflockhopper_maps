# Flock Leak tab: Design

**Date:** 2026-09-23
**Status:** Draft, pending review

## Problem

A security researcher (Joshua Michael, flocksurveillance.org) published Flock Safety's
internal device inventory after finding a hard-coded ArcGIS key in Flock's public JS
bundles. The snapshot is from December 2025. DeFlock wants to show it on the map next to
the crowdsourced OSM camera data, with the provenance of each dataset impossible to miss,
so the public can see the scale and mappers can see where OSM is behind or wrong.

The Analysis (density) tab is being retired; its data will return later as a layer on
the Map tab (separate work). Its slot in the tab bar goes to the new tab.

Approved visually on 2026-09-23 through the brainstorm mockups in
`.superpowers/brainstorm/34894-1790199822/content/` (slim-peek-small-phone.html is the
final mobile layout; default-view-and-marks.html is the mark language).

## Goal

- Landing view: every device in the leak, one color, so the scale lands first.
- Compare against OSM two ways on one map: a swipe divider for the story, an overlay for
  street-level work. No second map, no second basemap.
- Filters are the user's. Nothing is auto-filtered when comparing, because the
  interesting cases (OSM says ALPR, Flock says Condor) only show when nothing is hidden.
- Provenance and the nine-month gap are stated in the tab identity, the panel, the popup,
  and the legend. Copy is short and declarative, no em dashes.
- Mobile first: 80% of visitors. The drawer peek stays at the uniform 180 px and feels
  like every other tab.

## Non-goals

- No precomputed OSM match flag per device (decided: the nine-month gap would make it
  misleading).
- No two-map swipe. If the single-map swipe fails its phone spike (section 15), that is
  the fallback, and it needs its own approval.
- No Canada support (US only, like Route and Network).
- Moving density data onto the Map tab is separate work.

## 1. Naming, mode, URL

- App mode id: `leak`. Desktop tab label "Flock Leak". Mobile tab label "Leak".
- Canonical path `/leak`. Accept `/flock-leak` as an input alias.
- `/analysis` and `?mode=density` map to `map` so old links land on the Map tab.
- US only: `leak` joins `US_ONLY_MODES`; Canada bounces to Map like Route and Network.
- SEO: title "Leaked Flock Camera Locations | DeFlock Maps", description "Flock Safety's
  leaked device inventory (December 2025) next to the crowdsourced OSM camera map."

## 2. Data contract: the Flock tileset

Built outside this repo on the same pipeline as the camera tiles. The app expects:

- TileJSON at `<TILES_HOST>/flock-leak.json` on the primary host, mirrored on the backup
  host so failover keeps the tab alive. Tile URLs always come from the TileJSON.
- Source layer `devices`, minzoom 0, maxzoom 14, point features.
- Attributes at every zoom: `type` (Flock's device label), `status` (Flock's status
  label). Richer attributes only from z9: passed straight through to the popup (agency,
  install date, name, id, whatever the build keeps).
- TileJSON extras, all read by the client and all optional except `stats.total`:

  ```json
  "snapshot": "2025-12",
  "source_url": "https://flocksurveillance.org",
  "stats": { "total": 84120, "byType": { "...": 0 }, "byStatus": { "...": 0 } }
  ```

- No `lon` attribute is needed. The swipe uses geometry (section 3).

Client-side normalization (`src/lib/flockTypeNormalization.ts`, same shape as
`brandNormalization.ts`): raw `type` maps to `alpr | condor | raven | drone | other`, raw
`status` maps to `active | planned | decommissioned | unknown`. The tables are filled from
the distinct values in the first real build; unknown values fall into `other` / `unknown`
and render, never vanish.

## 3. Views: Flock, Swipe, Overlay

One map, one basemap. A three-way switch in `flockLeakStore.view`, default `flock`.

- **Flock.** Flock layers visible, OSM camera layers hidden.
- **Overlay.** Both visible everywhere.
- **Swipe.** Both visible, each cut at a divider. Divider position `flockLeakStore.divider`
  in 0..1 of the map width, default 0.5. Left of the divider shows OSM, right shows Flock.

Swipe mechanics (`src/utils/swipeFilter.ts`, pure):

- The map locks north-up while in `leak` mode (bearing set to 0, rotation gestures
  disabled, restored on exit). With no rotation the divider is a line of constant
  longitude, so each side is a rectangle.
- Each side is a `['within', rectangle]` filter, combined with any existing layer filter
  via `['all', ...]`. `within` is in the installed MapLibre 5.15 and needs no attributes.
- Changing a filter reloads only that source's tiles from cached tile data (no network,
  no basemap work; the old marks stay on screen until the new ones land). Updates are
  rAF-coalesced and capped at 20 per second during a drag, with one final update on
  release.
- At the extremes (divider at 0 or 1) the hidden side gets a filter no feature
  passes instead of a degenerate polygon. The swipe never writes layer
  visibility; that stays declarative (amended 2026-09-23 during pre-flight:
  a restored `visible` on leaving Swipe would fight the Flock-only view).
- Direction cones (client-built polygons) are hidden in Swipe and Overlay. `within` needs
  every vertex inside, so cones at the divider would flicker, and they are a Map-tab
  identity feature that adds nothing here. Cones stay off in Flock view too (OSM hidden).

Controls:

- Mobile: the divider is a thin line. It is moved by a horizontal track docked above the
  drawer (`SwipeTrack`), labeled OSM on the left and Flock on the right, only rendered in
  Swipe. The line itself is not grabbable on touch, so it never fights the pan.
- Desktop: the same track sits at the bottom of the map area, and the line has a grab
  handle at mid-height for mouse drags.
- Chips at the top corners of the map in Swipe: "OSM · live" (left), "Flock · Dec 2025"
  (right).

## 4. Mark language (`FlockLeakLayers`)

- z0 to 9: one circle layer, small red dots (`#ef4444`), opacity ramp like the OSM density
  dots. One color at national zoom for impact; type is not encoded here.
- z9 and up: one symbol layer with SDF icons generated at runtime on a canvas and
  registered with `map.addImage(..., { sdf: true })`, so no sprite rebuild. Icon by
  normalized type, color by type, `icon-allow-overlap` and `icon-ignore-placement` on:

  | Type   | Shape            | Color     |
  |--------|------------------|-----------|
  | alpr   | square           | `#ef4444` |
  | condor | diamond          | `#f59e0b` |
  | raven  | ring with dot    | `#a78bfa` |
  | drone  | triangle         | `#34d399` |
  | other  | small circle     | `#9ca3af` |

- Status: `active` solid; `planned` the hollow dashed variant of the same shape (a second
  set of SDF images); `decommissioned` the solid shape at 35% opacity; `unknown` solid.
- Handoff over z9 to 10 mirrors the OSM dots-to-points crossfade so the two layers feel
  like one system. OSM keeps its blue dot; the two are never the same hue.
- Legend rows (panel and full sheet): OSM camera (crowdsourced, live); Flock ALPR, Condor,
  Raven, Drone; Planned, Decommissioned.

## 5. Filters

- Type: All, ALPR, Condor, Raven, Drone (chip row; `other` is included in All and has no
  chip). Multi-select; All clears.
- Status: Active, Planned, Decommissioned. Default Active only.
- Both become a layer filter on the Flock layers (`['all', typeExpr, statusExpr, swipeExpr]`).
- Mobile: behind the map's filter button (same slot the Map tab's OSM filter uses), in a
  popover, badge = active filter count where the Active-only default counts as 1.
  Fine print in the popover: "Type and status are Flock's own labels, as of Dec 2025."
- Desktop: in the side panel, with counts from `stats` next to each chip.
- The existing OSM filter control (brand, operator, state) keeps working on the OSM side
  in Swipe and Overlay, so "OSM cameras tagged Flock" is already one filter away.

## 6. Device popup (`FlockLeakPopup`)

Click a Flock mark at z9+:

- Title "Flock {Type label}". Tags: long type name ("PTZ video camera") and status.
- Passed-through attributes as label/value rows when present.
- Line: "Leaked inventory. Position as of Dec 2025."
- Nearby OSM hint, computed on click only: query rendered OSM point features in a 40 px
  box around the click, take the nearest, and if within 50 m show
  "OSM has a camera {n} m from here." When the Flock type is not ALPR add
  "Could be a mis-tag. Verify in person." When nothing is within 50 m show
  "Nothing on OSM within 50 m. Verify in person before adding it." Only at z10+ where OSM
  renders points; below that the hint is omitted.

OSM camera clicks keep the existing popup. `interactiveLayerIds` in `leak` mode lists the
Flock symbol layer plus the OSM point layer when OSM is visible.

## 7. Mobile drawer (`MobileTabDrawer`)

- Tab row: Map, Route, Timeline, Leak, Network.
- Peek (uniform 180 px, unchanged number): identity row (red-tinted icon box, title
  "Flock Leak", one line "Flock's own device list, leaked Dec 2025.") and the view switch
  as the one control. Nothing else.
- Full sheet: provenance card (two rows), the nine-month warning, legend, about card with
  the story link and the not-affiliated line, mapping CTA, footer. No view switch (it is
  in the peek). Filters are on the map button, not in the sheet.
- `SwipeTrack` docks above the sheet at peek height; hidden at full.
- Header count (`HeaderCameraCount`) in `leak` mode: "{n} Flock devices" (from
  `stats.total`) below z6; from z6 "{n} Flock in view", and "{n} OSM · {m} Flock in view"
  in Swipe and Overlay. Counts update on idle only, same mechanism as the OSM count.

## 8. Desktop panel (`FlockLeakPanel`, 400 px like the others)

Top to bottom: title and subtitle ("Leaked Flock device inventory, December 2025"),
provenance card, view switch, type chips with counts, status chips, legend, nine-month
warning, about card, mapping CTA, footer. The view switch also floats on the map so it is
reachable with the panel collapsed.

## 9. Copy (all strings, final unless review changes them)

- Peek line: "Flock's own device list, leaked Dec 2025."
- Provenance, OSM: "Crowdsourced by volunteers. Updated hourly. Can be incomplete or
  mis-tagged."
- Provenance, Flock: "Flock's own inventory, exposed by a security researcher. Snapshot
  from December 2025. Never updated."
- Warning: "Nine months separate these datasets. A device on one side and not the other
  proves nothing. Verify in person before editing OSM."
- About: "This data comes from a security researcher's disclosure of Flock Safety's
  internal device inventory, published at flocksurveillance.org. DeFlock is not
  affiliated with Flock Safety." Link: "Read the story".
- Mapping CTA: "Found a camera that is not on OSM? Verify it in person, then add it with
  the DeFlock app." Button: "Download the DeFlock App".
- Status pill: "Flock data unavailable" with "Retry".
- View switch: "Flock", "Swipe", "Overlay". Track labels: "OSM", "Flock".

## 10. Analysis (density) removal

Remove the choropleth feature entirely. Dot density (Explore timeline) is a different
feature and is untouched.

Delete: `src/components/panels/DensityPanel.tsx`, `src/components/map/DensityLegendBar.tsx`,
`src/components/map/DensityLoadingPill.tsx`, `src/components/map/layers/DensityLayers.tsx`,
`src/modes/density/*`, `src/services/densityDataService.ts`, `src/store/densityStore.ts`
and its test, `src/types/density.ts`, `public/geo/counties-metrics.geojson`.
`public/geo/states-metrics.geojson` stays: the state filter fetches it.

Edit: `appModeStore` (drop `density` mode, `DensitySettings` and defaults), `urlState`
(drop the mode, keep `/analysis` and `density` as aliases for `map`), `cameraDataService`
(`US_ONLY_MODES`), `MapPage`, `MobileTabDrawer`, `MapLibreContainer` (mode flags,
interactive layers, click and hover branches, pitch reset), `types/index.ts`,
`store/index.ts`, `public/_redirects` if it names `/analysis`, `CLAUDE.md`.

## 11. State and files

New store `src/store/flockLeakStore.ts`: `view`, `divider`, `typeFilter`, `statusFilter`,
`tileJson` (with `stats`), `loadPhase`, `error`, `selectedDevice`, and actions. All writes
equality-gated; `divider` is the only value written during a gesture.

New: `src/services/flockLeakTilesService.ts` (TileJSON URL on the active host, loader,
same failover contract as the camera TileJSON), `src/utils/swipeFilter.ts`,
`src/lib/flockTypeNormalization.ts`, `src/components/map/layers/FlockLeakLayers.tsx`,
`src/components/map/FlockLeakPopup.tsx`, `src/components/map/FlockLeakFilterControl.tsx`,
`src/components/map/SwipeTrack.tsx`, `src/components/map/FlockLeakStatusPill.tsx`,
`src/components/panels/FlockLeakPanel.tsx`, `src/components/panels/FlockLeakPanelContent.tsx`.

Edited: `appModeStore`, `urlState` and test, `cameraDataService`, `MapPage`,
`MobileTabDrawer`, `MapLibreContainer`, `CameraTileLayers` (accepts an extra filter
expression and a `cones` flag), `HeaderCameraCount`, `Seo` usage, `CLAUDE.md`.

## 12. Error handling and failover

- Flock TileJSON fetch failure or tile error threshold: status pill on the map
  ("Flock data unavailable", Retry), OSM side unaffected. Retry refetches the TileJSON
  and remounts the Flock source.
- Tile host failover remounts the Flock source against the backup host (epoch-keyed,
  like the camera tiles). If the backup lacks the file the pill shows; the tab does not
  block the app.
- Missing `stats`: header shows in-view counts only; chip counts are hidden.

## 13. Performance rules

- Gesture path: the swipe drag writes only `divider` to the store; layer filter updates
  are throttled as in section 3; no React commits per pointer move beyond the track knob.
- Counts, chip counts, and the popup hint never run on move; counts on idle, hint on click.
- Symbol layers use allow-overlap so MapLibre skips collision work.
- Cones are off in this tab.
- Verified with the existing drag-perf harness (`.superpowers/drag-perf.mjs`) on the Leak
  tab in Swipe: p95 and `reactCommits` within the 2026-07-18 baselines for the Map tab.

## 14. Testing

Unit (vitest):

- `swipeFilter`: rectangle from a divider longitude for each side; extremes yield
  visibility changes, not polygons; combination with an existing filter.
- `flockTypeNormalization`: known labels, unknown labels, empty.
- `urlState`: `/leak` round trip, `/flock-leak` and `/analysis` aliases,
  `?mode=density` legacy.
- `appModeStore` and `cameraDataService`: `leak` is US-only.
- `flockLeakStore`: view switch, filters, divider equality gating, stats parsing.

Integration (Playwright, existing `.superpowers` harness):

- Mobile peek height on the Leak tab equals the other content tabs.
- Dragging the swipe track moves the divider and does not pan the map.
- Filter popover toggles change the rendered feature count.
- Screenshots at phone and desktop for approval before merge.

## 15. Prerequisite spike

Before implementation: a one-hour phone spike of the single-map swipe (two point tile
sources, `within` filters, 20 updates per second). Pass: the divider follows the thumb
with no visible stutter on a mid-range Android and an iPhone 12 class device. Fail: stop
and bring the two-map clip back for a separate decision.

## 16. Open items

- The real `type` and `status` vocabularies, once the first build exists.
- Confirm the backup host will publish `flock-leak.json`.
- Whether the popup's nearby-OSM hint should ship in v1 or wait. Spec includes it.

## 17. Delivery

Two PRs, in this order, each independently shippable:

1. Analysis removal (section 10). Small, mechanical, unblocks the tab slot.
2. Flock Leak tab (everything else), gated on the spike in section 15 and on the first
   real tile build for the normalization tables.
