# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeFlock Maps is a fork of FlockHopper, hosted at `maps.deflock.org`. It is a privacy-focused map application that visualizes ALPR camera locations across the United States and calculates alternative routes that minimize camera exposure. This fork is maintained by DeFlock, the organization that maps ALPR cameras.

## Commands

```bash
npm run dev       # Start development server (port 3000)
npm run build     # TypeScript check + Vite production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

## Architecture

### Tech Stack
- React 18 + TypeScript + Vite
- Zustand for state management
- MapLibre GL + react-map-gl for maps
- Deck.gl for advanced visualization layers
- Tailwind CSS for styling
- Framer Motion for animations
- Turf.js for geospatial processing
- Protomaps for vector tile basemaps
- FlockHopper Routing API (`api.dontgetflocked.com`) for routing
- Cloudflare Workers for data API (`data.dontgetflocked.com`)

### Key Data Flow

1. **Camera Rendering**: Default path renders straight from per-country hourly
   vector tilesets addressed by TileJSON (`<TILES_HOST>/cameras-{us,ca}-hourly.json`,
   source-layer `cameras`, attributes at z9+, zero tile buffer) — no dataset
   download, no pmtiles protocol (byte-range requests never edge-cache). Both
   US and Canada use tiles; the full GeoJSON (`cameraStore`) loads lazily only
   when Explore/timeline or heatmap need per-camera attributes at all zooms,
   or as the filter fallback (`useCameraRenderMode` decides which path is
   visible). The dots→points handoff runs over z9–10 (approved 2026-07-18);
   cones from z10. Filter tilesets + manifests are per-country and
   build-paired (`cameras-{us,ca}-hourly-filter.json`,
   `cameras-{us,ca}-hourly-manifest.json`); the primary host's camera TileJSON
   names build-pinned copies (`manifest`, `filter_tilejson`, `index_bin`,
   `index_json`) which are preferred over the aliases.

   **Tile hosts** (`src/store/tilesHostStore.ts`): PRIMARY
   `deflock.dontgetflocked.com` (Hetzner origin behind Cloudflare), BACKUP
   `tiles.dontgetflocked.com` (old Worker + R2). Every tile URL is built from
   the active host. A TileJSON fetch failure, or the existing pre-load camera
   tile error threshold, or the 15s map-init deadline, fails over to BACKUP
   once per page load and remounts the tile sources (epoch-keyed); the choice
   is never persisted, so every page load retries PRIMARY.

2. **Route Calculation** (`src/services/apiClient.ts`): Calls `api.dontgetflocked.com/api/v1/route` with origin, destination, and options. API handles all camera-aware routing. Returns both normal and avoidance routes with comparison metrics.

### App Modes

The map has 4 modes, selectable via the header tabs:
- **Route**: Camera-avoidance route planning
- **Explore**: Dot density visualization with timeline playback
- **Density (Analysis)**: Choropleth density analysis by state/county/tract
- **Network**: Sharing network visualization between agencies

### Critical Files

| File | Purpose |
|------|---------|
| `src/services/apiClient.ts` | API client — calls FlockHopper routing API |
| `src/services/routingConfig.ts` | Visualization constants for camera cones on map |
| `src/services/cameraDataService.ts` | Camera data fetching and processing |
| `src/services/cameraTilesService.ts` | Camera TileJSON URLs on the active host, TileJSON catalog loader, MapLibre transformRequest |
| `src/store/tilesHostStore.ts` | PRIMARY/BACKUP tile host selection + failover epoch |
| `src/utils/tileErrorPolicy.ts` | Pure rules: which MapLibre source errors fail over vs. surface the retry pill |
| `src/services/boundaryDataService.ts` | Boundary geometry data loading |
| `src/services/densityDataService.ts` | Density visualization data loading |
| `src/hooks/useCameraRenderMode.ts` | Decides tiles vs. GeoJSON camera rendering path |
| `src/store/cameraStore.ts` | Camera data management + spatial grid indexing |
| `src/store/routeStore.ts` | Route calculation state and UI state |
| `src/store/mapModeStore.ts` | Map style/mode management |
| `src/pages/MapPage.tsx` | Main application page container |
| `src/components/map/MapLibreContainer.tsx` | Map rendering, camera markers, route layers |
| `src/components/map/layers/CameraTileLayers.tsx` | Default camera rendering — dots/points/cones from the camera vector tiles |
| `src/components/panels/MapPanel.tsx` | Main panel container component |
| `src/components/panels/TabbedPanel.tsx` | Tab navigation for mode panels |

### State Management Pattern

Zustand stores expose both state and actions. Key stores:
- `cameraStore`: Camera data, spatial grid, loading phases
- `routeStore`: Route calculation, active route display, UI state
- `customRouteStore`: Multi-leg waypoint routing
- `mapStore`: Map bounds/viewport
- `mapModeStore`: Map style and base layer mode
- `appModeStore`: Current app mode, visualization settings
- `densityStore`: Density visualization data
- `networkStore`: Sharing network data (fetched from the deflock-data CDN, plus optional `meta` provenance)

### Directory Structure

```
src/
├── components/
│   ├── common/     # ErrorBoundary, LoadingSpinner, BottomSheet, Seo, LegacyMapLink
│   ├── inputs/     # AddressSearch autocomplete
│   ├── map/        # MapLibreContainer, MapSearch, CameraStats, MapLoadingScreen
│   │   └── layers/ # CameraTileLayers (default), CameraMarkerLayers (lazy),
│   │               # DensityLayers, DotDensityLayers, HeatmapLayers,
│   │               # NetworkLayers, BoundaryOverlayLayers
│   ├── panels/     # MapPanel, TabbedPanel, RoutePanel, ExplorePanel,
│   │               # DensityPanel, NetworkPanel, CustomRoutePanel,
│   │               # MobileTabDrawer, RouteComparison
│   └── ui/         # Shadcn components (button, input)
├── hooks/          # useCameraRenderMode, useEmbedMode
├── lib/            # Utility helpers (cn)
├── modes/          # Visualization modes (heatmap, timeline, dots, density)
├── pages/          # MapPage, NotFound
├── services/       # apiClient, cameraDataService, cameraTilesService,
│                   # boundaryDataService, densityDataService, geocodingService,
│                   # gpxService, zipCodeService, routingConfig, performanceLogger
├── store/          # Zustand stores
├── types/          # TypeScript definitions (camera, density, route, map)
└── utils/          # geo, polyline, formatting
```

## Configuration

Found in .env file. Environment variables are prefixed with `VITE_` for Vite to expose them to the frontend.

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | FlockHopper routing API URL |
| `VITE_TILES_URL` | Legacy, unused — tile hosts are fixed in `src/store/tilesHostStore.ts` |
| `VITE_DATA_API_URL` | Cloudflare Worker data API URL |
| `VITE_PERF_LOGGING` | Enable performance logging |
| `VITE_NETWORK_DATA_BASE` | Sharing-network data base URL (default `https://deflockdata.dontgetflocked.com`); point at a local copy or staging bucket |
## Important Patterns

### Spatial Optimization
The spatial grid (0.5° cells) is critical for performance. Always use `getCamerasInBounds()` or `getCamerasInBoundsFromGrid()` rather than filtering the full camera array.

### Map Rendering
`MapLibreContainer.tsx` is the main map component. Map layers are organized into dedicated components under `src/components/map/layers/` — CameraTileLayers (default vector-tile rendering), CameraMarkerLayers (lazy GeoJSON path for filters/timeline/heatmap/Canada), DensityLayers, DotDensityLayers, HeatmapLayers, NetworkLayers, and BoundaryOverlayLayers. `useCameraRenderMode` (`src/hooks/`) decides which camera layer is active.

### Code Splitting
Vite splits bundles by vendor: react-vendor, map-vendor, motion, geo-utils, state, deck-vendor. MapPage uses React lazy loading with Suspense. Path alias `@/` maps to `src/`.

## Data Sources

- **Camera Tiles**: `<TILES_HOST>/cameras-{us,ca}-hourly.json` TileJSON (+ `-filter` companions, `-manifest.json` dictionaries, `-index.{bin,json}` counters) — hourly MVT tilesets; tile URLs always come from the TileJSON. Hosts: primary `deflock.dontgetflocked.com`, backup `tiles.dontgetflocked.com` (see Key Data Flow)
- **Camera Data (attributes)**: `data.dontgetflocked.com/cameras.geojson.gz` — lazy-loaded for filters/timeline/heatmap/Canada; ~114k (July 2026) cameras
- **ZIP Codes**: `/public/zipcodes-us.json` — local lookup, no API needed
- **Map Tiles**: Protomaps basemap via `<TILES_HOST>/planet.json` (+ `/fonts`, `/sprites`); `boundaries-us.json` for the boundary overlay
- **Geocoding**: Nominatim (OSM) with Photon fallback
- **Density Data**: GeoJSON files in `/public/geo/` (states-metrics, counties-metrics)
- **Network Data**: `deflockdata.dontgetflocked.com/sharing-network-{nodes.geojson,adjacency.json,meta.json}` — published every Monday by the deflock-data repo (schema frozen by the publisher, gzip-stored, CORS `*`, 1h cache, no edge cache). Base URL overridable with `VITE_NETWORK_DATA_BASE` (`src/services/networkDataService.ts`). Nothing is bundled in `/public/` any more, so the site cannot fall back to stale data.

## Deployment

Hosted on Cloudflare Pages. `_headers` and `_redirects` files in `/public/` configure caching and routing. The `worker/` directory contains a Cloudflare Worker that serves the data API (`data.dontgetflocked.com`).
