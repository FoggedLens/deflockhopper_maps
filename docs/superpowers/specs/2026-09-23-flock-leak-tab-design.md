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

> **Superseded on 2026-09-23** by `2026-09-23-flock-inventory-v2-contract.md` (binding, supplied by the
> data pipeline owner). Where this section and the contract differ, the contract wins: the TileJSON is
> the fixed URL `https://tiles.dontgetflocked.com/flock-inventory-v2.json`, the source layer is
> `cameras`, every zoom carries integer `g` / `s` / `q` codes and full device records exist only from
> z9, totals come from the contract's tables rather than a `stats` block, and `q > 0` records are
> hidden by default. The original text is kept below for the record.


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

## 18. Amendments, 2026-09-24

Approved from live Houston screenshots (`.superpowers/brainstorm/65345-1790265802/content/`
in the flock-leak worktree). Where these differ from sections 3, 4, 5 and 13, this section wins.

- **Compare defaults (supersedes "nothing is auto-filtered" in Goal and section 5).** The
  Flock landing view still shows every device. The first move from Flock into Swipe or
  Overlay in a tab visit seeds both sides: Flock groups to plate readers, OSM brand to
  Flock Safety (other OSM facets kept). After that the filters are the user's. Leaving the
  tab restores both sides' filters to what they were on entry and lands the next visit on
  Flock, so the shared OSM filter never follows the user to the Map tab.
- **Compare marks (supersedes section 4 for Swipe and Overlay).** From z9 the Flock layer
  draws the OSM lens family in red instead of the group icons. Overlay: a hollow red ring
  (r 4.3 to 7.5, stroke to 2.5 px), so a blue OSM dot inside a red ring reads as "both".
  Swipe: the filled lens (glow, dark core, light ring) at full opacity. Planned is a dashed
  red ring icon; decommissioned is the same mark at 35%. These marks are for plate
  readers. Any other group the user turns on keeps its own group icon: hollow in Overlay
  (Raven keeps its center dot), filled in Swipe, dashed when planned.
- **One mark language (supersedes section 4 entirely).** The Flock landing view draws
  the same filled marks as Swipe: the red lens for plate readers and the filled group
  icons for the rest, so Flock and Swipe are one picture and Overlay is its hollow twin.
  There is no separate landing icon for plate readers; chips and legend show a round red
  lens. Colors and shapes for the other groups are still open.
- **Cones (supersedes section 3 and 13).** OSM direction cones are on in Swipe and Overlay.
  The clipped-overlay swipe removed the `within` flicker that had them off. The Flock side
  never gets cones: the v2 contract's `rotationAngle` is the housing mount angle, not a
  heading. The legend says so.
- **Filter buttons.** On the Leak tab the two map filter buttons carry captions, OSM and
  Flock, so each says which side it narrows.
- **Layer order.** The Flock marks always draw above the OSM layers. The filtered OSM
  tileset mounts lazily on the session's first filter, which in Overlay is the compare
  seed, so it would otherwise cover the rings; the Flock layer component re-raises its
  layers on `styledata` (`layersToRaise`).

## 19. Amendments, 2026-09-24 (cleanup): no swipe, compare is a layer switch

The user asked for the tab to be cleaned up on GIS grounds, for the sidebar to explain the
data with links to the researcher's work, and whether the slider is needed. Where this
section differs from sections 3, 5, 7, 8, 9 and 18, this section wins.

- **The swipe is removed.** A swipe is juxtaposition with a movable seam (Gleicher's
  comparison taxonomy: juxtaposition, superposition, explicit encoding). It suits layers
  that cover every pixel, such as imagery or before/after rasters, where both sides show
  the same place. Camera points are sparse: the left half shows OSM for some streets and
  the right half shows Flock for other streets, so no location is ever in both datasets
  at once and the comparison has to happen in the viewer's memory while dragging. The
  question the tab answers ("is this camera on both maps?") is a superposition question,
  and Overlay already answers it at a glance. The swipe also cost two extra MapLibre
  instances, a docked track, two chips and lifted controls on phones. Deleted:
  `SwipeTrack`, `SwipeOverlayMaps`, `swipeFilter` (its `combineFilters` moved to
  `flockLeakFilter`), the divider in the store, the north-up lock, the swipe CSS and the
  `--swipe-track-height` offsets.
- **Compare is a layer, not a mode.** `FlockLeakView` is `'flock' | 'overlay'`. The
  Flock / Swipe / Overlay tabs are replaced by one switch, "Compare with OSM cameras"
  (`FlockCompareToggle` in the mobile peek; the OSM row of the panel's layer list on
  desktop and in the sheet). The compare seed (section 18) now runs on the first switch-on
  per visit. The floating view switch on the desktop map is gone; the desktop Flock
  filter button on the map is gone too (the panel carries those filters). Mobile keeps it.
- **Key.** While comparing, the panel shows a key drawn with the map's own marks
  (`FlockLeakMarks.tsx`): on both maps, only in Flock's records, only on OSM. The mobile
  peek swaps its one-liner for the same key in short form, so the peek always says what
  is on the map.
- **Panel order.** What it is, where it came from (with the researcher named), links to
  his work, the two layers with their provenance, filters (desktop) or legend (mobile),
  the caveat, the app CTA, the credit. No stacked cards, no red warning box.
- **Researcher links** (`FLOCK_LEAK_LINKS`): the research paper
  (flocksurveillance.org/formal-research-paper.html), the full table
  (flocksurveillance.org/table.html) and the site. The popup links "View in table" to his
  table filtered to the exact coordinate (`table.html?lat==<lat>&lon==<lon>`, the same
  query his own map builds; verified to return the device) and to Street View.
- **Credit.** His paper is CC BY 4.0 ("use with credit"). The panel, the popup and the map
  attribution ("Flock records via Joshua Michael") name him. No license is claimed for
  the records themselves.
- **Provenance copy** follows his paper: on December 14, 2025 he retrieved 335,701 device
  and deployment records from Flock's production environment through a credential flaw
  he had reported to Flock on November 13, 2025.
- **Chip counts** follow the status selection (`cleanPointsFor`), so a chip states what the
  map draws. The suspect note gives the real number (23,794 flagged records).
- **Nearby hint.** "Nothing on OSM within 50 m" became "No OSM camera shown within 50 m",
  because the search covers only the OSM cameras on screen and the compare seed filters
  them to Flock Safety.
- **Palette.** Video, Wing and Trailer were three near-identical oranges. Wing is now pink
  (`#f472b6`, hollow square) and Trailer slate (`#cbd5e1`, pill). Every group differs from
  the others in hue and shape, and none uses the OSM blue.

## 20. Amendments, 2026-09-24 (desktop feedback round)

From the user's review of section 19 on desktop. Where this differs from section 19, this
section wins.

- **Map legend with the compare switch** (`FlockMapLegend`, desktop, top right). It lists
  only what the map draws (the device classes and statuses the filters leave on) in the
  mark style in use (filled, or hollow while comparing), then the switch "Compare with
  OSM cameras", then while comparing one line for the overlap ("Blue dot in a red ring:
  on both maps") and, while the compare seed holds, what the seed narrowed. Each mark is
  named once. A single status shows as text ("In service only"), not a repeated mark.
  The side panel's layer list and key are gone (the user found them duplicative); the
  mobile peek keeps its switch and short key.
- **Panel order:** explainer and links, then "Filter Flock's records", then the caveat and
  CTA, then a note on what is not drawn and the credit. The mobile sheet shows the same
  content, filters included.
- **Flock filter button back on the desktop map**, next to the OSM one, so both datasets
  are filtered from the same place. The panel keeps its chips too.
- **Suspect-records switch removed.** It changed nothing visible in most views (unknown
  status records never passed the status filter; fixtures, placeholder stacks and
  non-North-America records are elsewhere). `q > 0` is never drawn; the panel says
  "Not on the map: 23,794 records ...".
- **Defaults:** every status is on (in service, planned, decommissioned). Turning the
  comparison on also narrows statuses to in service (`LEAK_COMPARE_FLOCK_STATUSES`): a
  planned or removed device missing from OSM is not a gap. Leaving the tab restores both.
- **Device classes** (`FLOCK_DEVICE_CLASSES`): ALPR, Video, Wing, Raven, Drones, Other.
  Group 4 is only ever `raven`, so it is named Raven. Mobile trailers (146 devices, 5 in
  service) fold into Other with components: a legend class that rare costs more to read
  than it tells, and the block-shaped trailer mark is gone. The popup still names the
  exact type.
- **Stacks.** A Falcon and its Picard compute box share a coordinate. The Other class now
  draws on its own layer (`flock-leak-minor`) beneath the plate readers, at 0.8 icon size,
  so the lens covers it. The Flock view's planned plate reader (`flock-planned-lens-{theme}`)
  has an opaque core in the basemap's ground color (sampled: dark `#1f1f1f`, light
  `#e2dfda`), so it still reads as an open dashed ring but hides what is beneath. Overlay
  keeps the see-through ring so OSM dots show inside.
- **Swatches match the map.** Legend and chip marks render from `drawFlockIcon` (the code
  that registers the map icons), plate readers from the SVG lens and ring.
- **Popup:** single device titled by its type ("Falcon", "Plate reader"); stacks titled
  "N devices on one spot" with only the lead device's detail rows; the mount angle row is
  gone (the contract calls it a housing angle, and the researcher's table has it); no fixed
  anchor, so MapLibre picks the side with room.
- **Tab icon:** `DatabaseZap` (an exposed dataset) replaces `Radar`.

## 21. Amendments, 2026-09-24 (switch in the panel, legend behind a button)

The user rejected section 20's map legend: a switch bolted onto a legend is odd, and when
the compare seed narrowed the view to plate readers the list shrank to one row, so the
legend looked like it disappeared. Where this differs from section 20, this section wins.

- **The compare switch is the first thing in the side panel** (and the mobile sheet), the
  one emphasized element on the tab: a blue-bordered block with the overlap mark as its
  icon, "Compare with OSM cameras", one line on what it does, and a large switch. While
  on, the key sits directly under it (on both maps, only in Flock's records, only on
  OSM) with the note on what the compare seed narrowed. The mobile peek keeps its own
  switch and short key.
- **The legend is a button** ("Legend", `FlockLegendControl`) in the map's left control
  column, in the Map tab's layers slot above the Flock and OSM filter buttons, opening a
  popover like the filters. It always lists every device type and status, in the map's
  current mark style; entries the filters hide are dimmed, never removed, so the list
  never changes length. It does not repeat the compare key.
- `FlockMapLegend` is deleted.

## 22. Amendments, 2026-09-24 (compare keeps every status; decommissioned is gray)

User's call. Where this differs from sections 18 to 21, this section wins.

- Turning the comparison on seeds statuses to all three (in service, planned,
  decommissioned); only the device type (plate readers) and the OSM brand narrow. A
  narrower status selection made before comparing is reset to the full set.
- Decommissioned devices are gray (`FLOCK_DECOMMISSIONED_COLOR`: core `#4b5563`, ring and
  line `#9ca3af`) at full opacity instead of the dimmed mark: gray lens without glow in the
  Flock view, gray ring while comparing, gray variants of every other group's icon
  (`flock-g{g}[-hollow]-decom`), gray density dots below z10, and gray swatches in the
  legend and status chips. The 35% dimming helper (`zoomOpacityByStatus`) is gone.
