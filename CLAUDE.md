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

1. **Camera Data Loading**: `PreloadManager` starts background fetch → `cameraStore` loads camera data → builds spatial grid (0.5° cells) for O(1) lookups

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
| `src/services/boundaryDataService.ts` | Boundary geometry data loading |
| `src/services/densityDataService.ts` | Density visualization data loading |
| `src/store/cameraStore.ts` | Camera data management + spatial grid indexing |
| `src/store/routeStore.ts` | Route calculation state and UI state |
| `src/store/mapModeStore.ts` | Map style/mode management |
| `src/pages/MapPage.tsx` | Main application page container |
| `src/components/map/MapLibreContainer.tsx` | Map rendering, camera markers, route layers |
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
- `networkStore`: Sharing network data

### Directory Structure

```
src/
├── components/
│   ├── common/     # ErrorBoundary, LoadingSpinner, BottomSheet, Seo, LegacyMapLink
│   ├── inputs/     # AddressSearch autocomplete
│   ├── map/        # MapLibreContainer, MapSearch, CameraStats, MapLoadingScreen
│   │   └── layers/ # CameraMarkerLayers, DensityLayers, DotDensityLayers,
│   │               # HeatmapLayers, NetworkLayers, BoundaryOverlayLayers
│   ├── panels/     # MapPanel, TabbedPanel, RoutePanel, ExplorePanel,
│   │               # DensityPanel, NetworkPanel, CustomRoutePanel,
│   │               # MobileTabDrawer, MobileRoutePreview, RouteComparison
│   └── ui/         # Shadcn components (button, input)
├── lib/            # Utility helpers (cn)
├── modes/          # Visualization modes (heatmap, timeline, dots, density)
├── pages/          # MapPage, NotFound
├── services/       # apiClient, cameraDataService, boundaryDataService,
│                   # densityDataService, geocodingService, gpxService,
│                   # zipCodeService, routingConfig, performanceLogger
├── store/          # Zustand stores
├── types/          # TypeScript definitions (camera, density, route, map)
└── utils/          # geo, polyline, formatting
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | FlockHopper routing API URL | `https://api.dontgetflocked.com` |
| `VITE_TILES_URL` | Protomaps vector tile server URL | `https://tiles.dontgetflocked.com` |
| `VITE_DATA_API_URL` | Cloudflare Worker data API URL | `https://data.dontgetflocked.com` |
| `VITE_PERF_LOGGING` | Enable performance logging | `false` |

## Important Patterns

### Spatial Optimization
The spatial grid (0.5° cells) is critical for performance. Always use `getCamerasInBounds()` or `getCamerasInBoundsFromGrid()` rather than filtering the full camera array.

### Map Rendering
`MapLibreContainer.tsx` is the main map component. Map layers are organized into dedicated components under `src/components/map/layers/` — CameraMarkerLayers, DensityLayers, DotDensityLayers, HeatmapLayers, NetworkLayers, and BoundaryOverlayLayers.

### Code Splitting
Vite splits bundles by vendor: react-vendor, map-vendor, motion, geo-utils, state, deck-vendor. MapPage uses React lazy loading with Suspense. Path alias `@/` maps to `src/`.

## Data Sources

- **Camera Data**: `/public/cameras-us.json.gz` — fetched and decompressed via `cameraDataService`
- **ZIP Codes**: `/public/zipcodes-us.json` — local lookup, no API needed
- **Map Tiles**: Protomaps vector tiles via `VITE_TILES_URL`
- **Geocoding**: Nominatim (OSM) with Photon fallback
- **Density Data**: GeoJSON files in `/public/geo/` (states-metrics, counties-metrics)
- **Network Data**: `/public/sharing-network-adjacency.json` and `/public/sharing-network-nodes.geojson`

## Deployment

Hosted on Cloudflare Pages. `_headers` and `_redirects` files in `/public/` configure caching and routing. The `worker/` directory contains a Cloudflare Worker that serves the data API (`data.dontgetflocked.com`).
