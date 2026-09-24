# Flock device inventory tileset: data contract (v2)

**Status:** Binding. Supplied by the data pipeline owner on 2026-09-23. Build against it; do not ask for changes to it. It supersedes section 2 of `2026-09-23-flock-leak-tab-design.md` wherever the two differ.

---

A vector tileset of **Flock Safety's own device inventory** is published and verified: every row of Flock's December 14, 2025 device export, with every value. It's a second camera-like layer for the same map as the existing OSM/DeFlock camera tiles. **Colors, styling and the filter UI haven't been decided yet.** Use a placeholder palette from the app's existing theme, and keep the code-to-color mapping in one easy-to-change place.

## Source

| | |
|---|---|
| TileJSON (always load through this) | `https://tiles.dontgetflocked.com/flock-inventory-v2.json` |
| Tiles (for reference only; don't hardcode) | `https://tiles.dontgetflocked.com/flock-inventory-v2/{z}/{x}/{y}.mvt` |
| Source-layer | `cameras` (same name as the OSM tiles, but a separate source; always pair it with this source's id) |
| Geometry | Points |
| Zooms | minzoom 0, maxzoom 14; MapLibre overzooms past 14 |
| Caching | `Cache-Control: public, max-age=604800` (7 days); CORS `*` |
| Data date | A single snapshot of Flock's December 14, 2025 export. It isn't updated; a newer export would ship under a new name. |

There's also an older `flock-inventory.json` (v1: merged points, no names). **Don't use it.**

## Two kinds of feature, split by zoom

| Zooms | One feature per | Properties |
|---|---|---|
| **0–8** (national/regional) | location + status + quality: devices at the exact same spot with the same status merge into one point | `g`, `s`, `q` only |
| **9–14** (detail) | **device**: every one of 335,701 devices is its own point | `id`, `g`, `s`, `q`, `type`, `name`, `created`, `features`, `active`, `rotationAngle` (only when the source has one), `lat`, `lon` |

Every feature is present at every zoom in its range, with no clustering and no dropping.
- **Coloring and filtering by `g`, `s` and `q`** work at every zoom.
- **Names, popups and device lists** work from zoom 9 up.
- **At zoom 8 and below**, a click can only report group, status and quality; show something like "zoom in for details".

## Properties

| Property | Zooms | Type | Meaning |
|---|---|---|---|
| `g` | all | int 1–8 | Device group (table below). The color and filter key. At 0–8 it's the group of the point's main device. |
| `s` | all | int 1–4 | Status: **1** in service · **2** planned · **3** decommissioned · **4** unknown |
| `q` | all | int 0–4 | Record quality. **0** clean · **1** unknown status · **2** factory/test fixture · **3** placeholder location (10 or more devices on one coordinate, e.g. Flock facilities) · **4** outside North America. **Hide `q > 0` by default** at every zoom; offer a "show suspect records" toggle if you like. |
| `id` | 9+ | int | Flock's `OBJECTID`, unique per device. The identity key: use it for `promoteId`. |
| `type` | 9+ | string | Flock product type, e.g. `falcon`, `picard`, `droneDockingStation` |
| `name` | 9+ | string | The device name exactly as Flock stored it, e.g. `DS#008 - San Francisco PD - Dock 3`. Trailing spaces included, so trim for display. |
| `created` | 9+ | string | Record creation timestamp, exactly as stored, e.g. `2025-11-10T06:07:48.053000+00:00`. **138,180 devices (132,544 of them clean) share `2024-03-26T18:02:45.611000+00:00`**, the date the records were imported. Show those as "on or before Mar 26, 2024". |
| `features` | 9+ | string | Comma-separated capabilities, exactly as stored; **may be `""`**. Values: `livestream`, `lpr`, `readsLicensePlates`, `replay`, `supportsFreeFormSearchPeople`, `supportsVehicleDescriptionAlerts`. |
| `active` | 9+ | int 0/1 | Flock's separate `active` flag. It's not the same as status; `s` is the lifecycle field. |
| `rotationAngle` | 9+ | number | Present only when the source has one (about 55% of devices). It records **how the housing is mounted, not where the camera points** (it matches the road only ~10% of the time). **Don't draw direction cones from it**; show it as a raw value at most. |
| `lat`, `lon` | 9+ | number | The exact source coordinates. Use these for display, Street View links and grouping. The tile geometry is quantized to about 0.3 m, and one bogus source longitude of 180 is drawn at −180. |

**Not available anywhere:** operator/agency, external/network/parent IDs. Flock's export had those columns blank in every row; show them as "redacted in this export" if the design calls for it. Agency often appears inside `name` (for example "San Francisco PD").

### Device groups (`g`)

| `g` | Group | `type` values | Clean national points (`q=0`): in service / planned / decommissioned |
|---|---|---|---|
| 1 | Plate readers | falcon, falconHighway, falconFlex, sparrow, lprTrailer | 117,959 / 39,701 / 18,196 |
| 2 | Video / PTZ cameras | condor, picardPtz | 5,505 / 6,860 / 1,283 |
| 3 | Third-party cameras (Wing) | wing, wingUbiuia, wingGateway, wingApi, external | 24,762 / 498 / 5,787 |
| 4 | Audio sensors (Raven, gunshot/audio detection) | raven | 14,905 / 6,429 / 4,961 |
| 5 | Drones | drone, droneDockingStation, droneControllerBox, droneRadar | 57 / 259 / 5 |
| 6 | Mobile trailers | trailer, picardTrailer | 5 / 131 / 10 |
| 7 | Components / other | picard, avicore, talkDown, backhaulBox, multiEvidenceDevice, owl, automotus | 347 / 518 / 1,328 |
| 8 | Factory / test fixtures | factoryFixture | always `q = 2` |

`type` values are Flock's internal product names. Map them to friendly labels in one table in the app (for example `droneDockingStation` → "Drone Dock", `picard` → "Picard"). The group labels above are the coarse layer.

**Totals, if the UI shows numbers:**
- **Devices:** 335,701 devices = 311,907 clean + 23,794 flagged.
- **National points:** 250,868, of which 249,506 are clean.
- **Clean national points by status:** 163,540 in service / 54,396 planned / 31,570 decommissioned.
- **Quoting "335k devices" (as Flock-watching sites do):** say that it includes planned, decommissioned and flagged records.

## Building the per-device popup (zoom 9+)

Devices that share a coordinate are separate features at the **exact same `lat`/`lon`**; one pole can hold a plate reader plus its `picard` compute box, for example. To build the popup:

1. On click, `queryRenderedFeatures` around the point, dedup by `id` (see gotchas), and group by `lat`,`lon`. That group is "N devices at this exact coordinate".
2. Count `type` within the group for the "2 Drone Dock · 2 Picard" line.
3. List each device with its `name`, `type` and status, and link "Open in table" by `id`.
4. For spread-out markers, fan the group's features out client-side (a spiderfy offset per index). The data places them all on one coordinate.
5. Main marker: when a group has a non-component device (`g != 7`), lead with it; a `picard` sharing a spot is typically that device's compute box, not a separate roadside sensor.

## Expressions

```js
// default filter: clean records only (every zoom)
['==', ['get', 'q'], 0]

// color (placeholder palette; mapping TBD)
'circle-color': ['match', ['get', 'g'], 1, C1, 2, C2, 3, C3, 4, C4, 5, C5, 6, C6, 7, C7, 8, C8, FALLBACK]

// group + status filter (no tile refetch)
['all', ['==', ['get', 'q'], 0], ['in', ['get', 'g'], ['literal', [1, 3]]], ['in', ['get', 's'], ['literal', [1]]]]

// capability filter (zoom 9+ only; comma-wrap so tokens match exactly)
['in', ',readsLicensePlates,', ['concat', ',', ['coalesce', ['get', 'features'], ''], ',']]

// draw in-service above planned above decommissioned where points coincide
'circle-sort-key': ['-', 5, ['get', 's']]
```

Use `promoteId: { cameras: 'id' }` for feature-state (hover). It only takes effect from zoom 9, because the 0–8 points have no `id`.

## Gotchas

- **Tile-border duplicates:** a point sitting exactly on a tile border is present in both neighbouring tiles (about 170 at z14, under 0.1%). Dedup query results by `id` at zoom 9+, and don't count rendered features for totals; use the numbers above.
- **Stacked points:** at the close zooms, many devices share an exact coordinate. At 0–8, one location can hold up to three points with different statuses, plus a flagged point.
- **Placeholder stacks (`q = 3`):** hundreds of devices share one coordinate at Flock facilities. With the default `q = 0` filter they never show. If you expose flagged records, expect big stacks there.
- **Not related to the OSM layer:** many physical cameras appear in both. No matching between the two has been done, so keep them as separate toggles.
- **Weight:**
  - The US-wide view at zoom 4 is about 576 KB for this layer, against ~275 KB for the OSM layer.
  - Close-zoom tiles are larger now that they carry full records: ~17 KB for a dense San Francisco z12 tile.
  - Add the source lazily, or keep it at `visibility: none` until the user turns it on.
- **Names are free text from Flock.** Some describe indoor or private-property locations, and some contain internal IP addresses. Render them as plain text (no HTML).

## Acceptance checks

- Layer off: no requests to `flock-inventory-v2*`.
- On, zoom 3 over the US: clean points render, colored by `g`. Changing group or status filters updates instantly with **no** new tile requests (check the devtools network tab).
- Zoom 14 at 37.77946, −122.50264 (San Francisco): clicking the spot shows **4 devices at this exact coordinate**, "2 Drone Dock · 2 Picard", and the names `DS#008 - San Francisco PD - Dock 3`, `DS#009 …`, `P#008 …`, `P#009 …`, with status Planned and created Nov 10, 2025. A separate `D#009 - San Francisco PD - M4TD` drone point sits a few meters away.
- The "show suspect records" toggle, if built, reveals `q > 0` points (for example the large stacks at Flock's Atlanta facilities); with it off they're gone at every zoom.
- Existing OSM camera layers are unaffected. No console errors or expression warnings at any zoom, including 0–8 where most properties are absent.

## Verified on 2026-09-23 (frontend side)

`GET https://tiles.dontgetflocked.com/flock-inventory-v2.json` returned 200 (26 KB) with `access-control-allow-origin: *` and `cache-control: public, max-age=604800`; `vector_layers[0].id === 'cameras'` with the twelve fields above; `tilestats.layers[0].count === 4272918`; a z4 tile was 1.2 MB and a San Francisco z12 tile 29 KB on the wire. The primary host (`deflock.dontgetflocked.com`) does not serve this file, so the app loads it from the fixed URL above, never from the active tile host.
