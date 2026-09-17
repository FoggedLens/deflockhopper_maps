import { useRef, useCallback, useEffect, useState, useMemo, memo, useImperativeHandle, forwardRef } from 'react';
import { md5 } from 'js-md5';
import Map, { 
  Source, 
  Layer, 
  Popup,
  NavigationControl,
  useControl,
  type MapRef,
  type ViewStateChangeEvent,
  type MapLayerMouseEvent
} from 'react-map-gl/maplibre';

// @vis.gl/react-maplibre's GeolocateControl only patches _setupUI for Strict Mode reuse,
// but misses _finishSetupUI (the async half that adds the click listener). In Strict Mode
// this runs twice, registering two listeners: the second immediately cancels the first.
// Fix: also guard _finishSetupUI with the same _setup flag MapLibre sets after first run.
function GeolocateControl({ position }: { position: string }) {
  useControl(
    ({ mapLib }) => {
      const gc = new (mapLib as typeof maplibregl).GeolocateControl({ trackUserLocation: true });
      const origSetupUI = gc._setupUI;
      const origFinishSetupUI = (gc as unknown as { _finishSetupUI: (s: boolean) => void })._finishSetupUI;
      gc._setupUI = () => {
        if (!gc._container.hasChildNodes()) origSetupUI();
      };
      (gc as unknown as { _finishSetupUI: (s: boolean) => void })._finishSetupUI = (supported) => {
        if (!(gc as unknown as { _setup: boolean })._setup) origFinishSetupUI(supported);
      };
      return gc;
    },
    { position: position as 'bottom-right' },
  );
  return null;
}
// Attribution renders as a plain single-line credit flush in the bottom-left
// corner (styled in index.css) — non-compact so it never collapses into the
// (i) toggle or floats mid-stack among the map buttons.
function AttributionCtl({ position }: { position: 'bottom-left' | 'bottom-right' }) {
  useControl(
    ({ mapLib }) => new (mapLib as typeof maplibregl).AttributionControl({ compact: false }),
    { position },
  );
  return null;
}
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapStore, useCameraStore, useRouteStore, useAppModeStore } from '../../store';
import type { MapTileStyleId } from '../../store/appModeStore';
import { useMapModeStore, getActiveViewForZoom } from '../../store/mapModeStore';
import { HeatmapLayers } from './layers/HeatmapLayers';
import { DotDensityLayers } from './layers/DotDensityLayers';
import { DensityLayers } from './layers/DensityLayers';
import { NetworkLayers } from './layers/NetworkLayers';
import { CameraMarkerLayers } from './layers/CameraMarkerLayers';
import { BoundaryOverlayLayers } from './layers/BoundaryOverlayLayers';
import { CameraTileLayers } from './layers/CameraTileLayers';
import { useCameraRenderMode } from '../../hooks/useCameraRenderMode';
import { ensureCameraIndex, getCameraIndex, countInBounds, tallyInBounds, deriveBrandStats, brandStatsEqual } from '../../services/cameraIndexService';
import { MOBILE_BREAKPOINT } from '../../hooks/useIsMobile';
import { useDensityStore } from '../../store/densityStore';
import type { DensityFeatureProperties } from '../../types';

import type { ALPRCamera, Location } from '../../types';

// Expose map ready state to parent components
export interface MapLibreViewHandle {
  isMarkersReady: boolean;
  forceRemount: () => void;
}

import { layers as pmLayers, namedFlavor } from '@protomaps/basemaps';
import { CAMERA_POINTS_MINZOOM, cameraTileJsonUrl, cameraFilterTileJsonUrl, tilesTransformRequest } from '../../services/cameraTilesService';
import { useTilesHostStore, failoverTilesHost } from '../../store/tilesHostStore';
import { planTileError } from '../../utils/tileErrorPolicy';
import { isMapRevealReady } from '../../utils/mapReveal';
import { useCameraTileJson } from '../../hooks/useCameraTileJson';
import { loadStateGeometry } from '../../services/stateFilterService';
import { buildCameraTileFilter } from '../../utils/cameraTileFilter';

// Both tile paths (default + filtered) render the same points layer shape;
// accept either id so click handling doesn't need to know which instance is
// currently mounted/interactive.
const CAMERA_POINT_LAYER_IDS = ['camera-tile-points', 'camera-tile-points-filtered'];

// Map our style IDs to Protomaps flavor names (must match R2 sprites at /sprites/v4/{flavor})
const FLAVOR_MAP: Record<MapTileStyleId, string> = {
  dark: 'dark',
  light: 'light',
};


// Everything the basemap needs comes from the active tile host (tilesHostStore):
// a failover rebuilds the style on the backup host and MapLibre swaps sources.
function buildMapStyle(tileStyleId: MapTileStyleId, tilesHost: string): maplibregl.StyleSpecification {
  const flavorName = FLAVOR_MAP[tileStyleId];
  const mapLayers = pmLayers('protomaps', namedFlavor(flavorName), { lang: 'en' });

  return {
    version: 8,
    glyphs: `${tilesHost}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${tilesHost}/sprites/v4/${flavorName}`,
    sources: {
      protomaps: {
        type: 'vector',
        // TileJSON → per-tile /planet/{z}/{x}/{y}.mvt URLs (edge-cacheable,
        // URL-keyed). The tile template is always read from the TileJSON.
        url: `${tilesHost}/planet.json`,
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: mapLayers as maplibregl.LayerSpecification[],
  };
}

// Convert cameras to GeoJSON - optimized with pre-allocated array
function camerasToGeoJSON(cameras: ALPRCamera[]): GeoJSON.FeatureCollection {
  // Pre-allocate array for better performance with large camera sets
  const features = new Array(cameras.length);
  for (let i = 0; i < cameras.length; i++) {
    const camera = cameras[i];
    features[i] = {
      type: 'Feature' as const,
      id: camera.osmId,
      geometry: {
        type: 'Point' as const,
        coordinates: [camera.lon, camera.lat],
      },
      properties: {
        osmId: camera.osmId,
        osmType: camera.osmType,
        operator: camera.operator || '',
        brand: camera.brand || '',
        direction: camera.direction ?? null,
        directionCardinal: camera.directionCardinal || '',
        surveillanceZone: camera.surveillanceZone || '',
        mountType: camera.mountType || '',
        ref: camera.ref || '',
        startDate: camera.startDate || '',
        lat: camera.lat,
        lon: camera.lon,
        ts: camera.osmTimestamp ? new Date(camera.osmTimestamp).getTime() : 0,
      },
    };
  }
  return { type: 'FeatureCollection', features };
}

interface PopupInfo {
  longitude: number;
  latitude: number;
  camera: ALPRCamera;
}

// Watchdog retry delays (ms) - progressively longer backoffs
const WATCHDOG_DELAYS = [50, 150, 500, 1000];
const MAX_WATCHDOG_RETRIES = WATCHDOG_DELAYS.length;

interface MapLibreViewProps {
  onMarkersReady?: (ready: boolean) => void;
  mapKey?: number;
}

export const MapLibreView = forwardRef<MapLibreViewHandle, MapLibreViewProps>(
  function MapLibreView({ onMarkersReady, mapKey }, ref) {
  const mapRef = useRef<MapRef>(null);

  const attribPosition = 'bottom-left' as const;
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [cursor, setCursor] = useState<string>('');
  const lastFlyToRef = useRef<number>(0);
  // Last tile-count query result — lets updateVisibleCameras skip the
  // expensive re-query when a huge count can't have visibly changed.
  const lastTileCountRef = useRef<{ zoom: number; count: number } | null>(null);
  // Throttle stamp for the live per-tick index count during gestures
  const liveCountAtRef = useRef(0);
  const lastPickTimeRef = useRef(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [markersReady, setMarkersReady] = useState(false);
  const sourceDataVersion = useRef(0);
  const geojsonDataRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const latestDataVersionRef = useRef(0);
  const watchdogRetryCount = useRef(0);
  const [, forceUpdate] = useState(0);
  
  // Use selectors to avoid re-rendering on unrelated store changes
  const center = useMapStore(s => s.center);
  const zoom = useMapStore(s => s.zoom);
  const showCameraLayer = useMapStore(s => s.showCameraLayer);
  const flyToCommand = useMapStore(s => s.flyToCommand);
  // Actions are stable references — safe to grab once
  const { setViewState, setBounds, clearFlyToCommand } = useMapStore.getState();
  const filteredCameras = useCameraStore(s => s.filteredCameras);
  const cameras = useCameraStore(s => s.cameras);
  const country = useCameraStore(s => s.country);
  const getCamerasInBounds = useCameraStore(s => s.getCamerasInBounds);
  const dataVersion = useCameraStore(s => s.dataVersion);
  const tilesFailed = useCameraStore(s => s.tilesFailed);
  const appMode = useAppModeStore(s => s.appMode);
  const mapVisualization = useAppModeStore(s => s.mapVisualization);
  const heatmapSettings = useAppModeStore(s => s.heatmapSettings);
  const mapTileStyle = useAppModeStore(s => s.mapTileStyle);
  const isTimelineActive = appMode === 'explore';
  // Active tile host + its epoch: a failover rebuilds the basemap style and
  // remounts the keyed camera/boundary sources against the backup host.
  const tilesHost = useTilesHostStore(s => s.host);
  const tilesEpoch = useTilesHostStore(s => s.epoch);
  const cameraTileJson = useCameraTileJson(country);
  const mapStyle = useMemo(() => buildMapStyle(mapTileStyle, tilesHost), [mapTileStyle, tilesHost]);
  const isExploreMode = appMode === 'explore';
  const isDensityMode = appMode === 'density';
  const isNetworkMode = appMode === 'network';
  const isMapMode = appMode === 'map';
  const mapModeViz = useMapModeStore(s => s.visualization);
  const setActiveView = useMapModeStore(s => s.setActiveView);
  const isHeatmapMode = isExploreMode && mapVisualization === 'heatmap';
  const isDotsMode = isExploreMode && mapVisualization === 'dots';
  const { renderMode } = useCameraRenderMode();
  const isTilesMode = renderMode === 'tiles';
  const isFilterTilesMode = renderMode === 'filter-tiles';

  // Once a filter has been used, keep the filtered source mounted for the
  // session (visibility toggles instead) so its tiles stay cached. Never
  // mounted for users who never filter — zero filter-tileset bytes for them.
  const [filterLayersMounted, setFilterLayersMounted] = useState(false);
  // Build-pinned filter TileJSON from the camera TileJSON when the host names
  // one (coherent with the manifest by construction); the alias otherwise.
  // Part of the filtered source's key, so a late resolution remounts it.
  const filterSourceUrl = cameraTileJson?.filter_tilejson ?? cameraFilterTileJsonUrl(country);
  useEffect(() => {
    if (isFilterTilesMode) setFilterLayersMounted(true);
  }, [isFilterTilesMode]);

  // First successful load of the filtered source this map instance. Until
  // then the default tile layers stay visible under the filtered ones, so
  // activating a filter never blanks the camera layer while filter tiles
  // stream in (and if the filter source is unhealthy, the map stays populated
  // for the whole error window before the geojson fallback kicks in).
  const [filterTilesReady, setFilterTilesReady] = useState(false);

  const manifest = useCameraStore((s) => s.manifest);
  const cameraFilters = useCameraStore((s) => s.filters);
  // State-filter boundary polygon — loaded lazily; the filter expression
  // matches nothing until it arrives (usually a one-time local fetch).
  const [stateGeom, setStateGeom] = useState<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(null);
  const stateCode = cameraFilters.state ?? null;
  useEffect(() => {
    if (!stateCode) {
      setStateGeom(null);
      return;
    }
    let cancelled = false;
    void loadStateGeometry(stateCode).then((f) => {
      if (!cancelled) setStateGeom(f ? f.geometry : null);
    });
    return () => { cancelled = true; };
  }, [stateCode]);

  const tileFilterExpr = useMemo(
    () => (manifest ? buildCameraTileFilter(cameraFilters, manifest, stateGeom) : undefined),
    [cameraFilters, manifest, stateGeom]
  );
  // Only render camera markers + direction cones when needed.
  // Map-mode auto no longer crossfades heatmap→markers; heatmap is only shown
  // when explicitly selected (isMapModeHeatmap below).
  // In heatmap explore, auto-show markers when zoomed past 13 (heatmap crossfades out 13-14),
  // or when the user explicitly toggles "Show Markers" at any zoom.
  // In density mode, hide camera markers entirely to keep choropleth clean.
  // Timeline (dots) never shows markers: the dot layer carries every zoom, and the
  // markers it used to stack on top were never date-filtered past z13.
  const isMapModeHeatmap = isMapMode && mapModeViz === 'heatmap';
  const showCameraMarkers = !isNetworkMode && !isDensityMode && !isMapModeHeatmap && (
    appMode === 'route'
    || isMapMode
    || (isHeatmapMode && (heatmapSettings.showMarkers || zoom >= 13))
  );
  // Expose handle to parent
  // The reveal the page acts on: basemap loaded AND camera source loaded (or
  // the camera source gave up — the retry pill carries that). See mapReveal.
  const revealReady = isMapRevealReady({ cameraSourceReady: markersReady, mapLoaded, tilesFailed });

  useImperativeHandle(ref, () => ({
    isMarkersReady: revealReady,
    forceRemount: () => forceUpdate(n => n + 1),
  }), [revealReady]);
  const { origin, destination, normalRoute, avoidanceRoute, activeRoute, pickingLocation, pickingSequence, setPickedLocation, cancelPickingLocation } = useRouteStore();

  // Handle flyTo commands from store
  useEffect(() => {
    if (!mapRef.current || !flyToCommand) return;
    if (flyToCommand.timestamp <= lastFlyToRef.current) return;
    
    lastFlyToRef.current = flyToCommand.timestamp;
    
    const map = mapRef.current.getMap();
    map.flyTo({
      center: [flyToCommand.center[1], flyToCommand.center[0]], // [lon, lat]
      zoom: flyToCommand.zoom ?? zoom,
      duration: 1500,
      essential: true,
    });
    
    clearFlyToCommand();
  }, [flyToCommand, clearFlyToCommand, zoom]);

  // Update visible camera count based on viewport
  const updateVisibleCameras = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();

    // Unfiltered tiles mode counts from the positions index when it has
    // loaded: exact at every zoom, sub-millisecond, and immune to the
    // tile-load races the query path fights below.
    if (renderMode === 'tiles') {
      const idx = getCameraIndex(country);
      if (idx) {
        const b = map.getBounds();
        const tally = tallyInBounds(idx, {
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        });
        const store = useMapStore.getState();
        store.setTileViewCameraCount(tally.total);
        // Equality-gated: idle fires after every tile load/repaint, and an
        // ungated write of a fresh object re-rendered the panel + strip on
        // each one. Identical stats must never cause a React commit.
        const stats = deriveBrandStats(tally, idx.brands);
        if (!brandStatsEqual(stats, store.tileViewBrandStats)) {
          store.setTileViewBrandStats(stats);
        }
        return;
      }
    }

    if (renderMode === 'tiles' || renderMode === 'filter-tiles') {
      // Exact viewport count, straight from the rendered tiles — no dedup.
      //
      // Dedup used to be the whole game here, and it was the bug. The old key
      // was osmId when present, else lng/lat; low-zoom tiles carry no
      // attributes (metadata starts at z9) so it fell back to
      // coordinates. Tile geometry is quantised (~600m per unit at z4), so
      // distinct cameras share a key and were merged away: 99k in view were
      // reported as ~64.6k, a 35% undercount.
      //
      // No dedup is needed, because neither source of duplication survives:
      //  - Tile buffers repeat neighbours' features, but MapLibre clips each
      //    query to the tile's own bounds, so a buffer copy is never returned.
      //  - The dots (z0–10) and points (z9+) layers OVERLAP on [9, 10), and
      //    queryRenderedFeatures ignores paint opacity — querying both there
      //    returns every camera twice. Querying the single layer that covers
      //    this zoom yields each camera exactly once.
      //
      // Verified against the dataset: z4 +0.21%, z9 −0.03%, z10.5 +2.0%. The
      // small excess is real — a camera whose dot overlaps the viewport edge is
      // in view — and grows with dot radius at high zoom.
      try {
        // Fallback path: filter-tiles mode, or plain tiles before the
        // positions index loads (or when its artifact is unavailable).
        // Zoomed out, the query itself is the jank: deserializing ~112k
        // rendered features blocked the main thread ~280ms per gesture at
        // 6x throttle (measured 2026-07-18), landing mid-drag during rapid
        // panning. When the last count was huge and zoom hasn't moved,
        // panning can't visibly change a six-digit count — keep it.
        const zoomNow = map.getZoom();
        const last = lastTileCountRef.current;
        if (last && last.count > 30000 && Math.abs(zoomNow - last.zoom) < 0.5) {
          return;
        }
        const suffix = renderMode === 'filter-tiles' ? '-filtered' : '';
        const layerForZoom = zoomNow >= CAMERA_POINTS_MINZOOM
          ? `camera-tile-points${suffix}`
          : `camera-tile-dots${suffix}`;
        const feats = map.queryRenderedFeatures(undefined, { layers: [layerForZoom] });
        lastTileCountRef.current = { zoom: zoomNow, count: feats.length };
        useMapStore.getState().setTileViewCameraCount(feats.length);
        // Query counts carry no brand data; hide the breakdown.
        useMapStore.getState().setTileViewBrandStats(null);
      } catch {
        // layers not ready yet
      }
      return;
    }

    useMapStore.getState().setTileViewCameraCount(null);
    useMapStore.getState().setTileViewBrandStats(null);
    const bounds = map.getBounds();
    getCamerasInBounds(
      bounds.getNorth(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getWest()
    );
  }, [getCamerasInBounds, renderMode, country]);

  // Load the positions index in the background once the map is up — boot
  // never waits on it; until it resolves the query fallback above serves.
  useEffect(() => {
    if (!mapLoaded) return;
    // Once the index is in, counting is sub-millisecond — so recount on
    // EVERY map idle, persistently. One-shot corrections proved flaky: a
    // count taken during boot (query fallback against half-loaded tiles,
    // or bounds read mid-init) could stick for the whole session when no
    // later trigger fired. A persistent idle recount makes the displayed
    // value self-healing regardless of what any transient wrote.
    let attached: { map: maplibregl.Map; fn: () => void } | null = null;
    const kick = () => {
      void ensureCameraIndex(country).then((idx) => {
        if (!idx) return;
        updateVisibleCameras();
        const map = mapRef.current?.getMap();
        if (map && !attached) {
          attached = { map, fn: () => updateVisibleCameras() };
          map.on('idle', attached.fn);
        }
      });
    };
    const ric = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(kick, { timeout: 5000 })
      : window.setTimeout(kick, 2000);
    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(ric as number);
      else window.clearTimeout(ric as number);
      if (attached) attached.map.off('idle', attached.fn);
    };
  }, [mapLoaded, country, updateVisibleCameras]);

  // Filter changes re-render tiles without a camera move — refresh the
  // viewport count once the map has settled on the new filter. Also covers
  // renderMode flipping back to plain 'tiles' (e.g. Reset): the effect below
  // that calls updateVisibleCameras on renderMode change fires immediately,
  // often before the newly-visible tile layer has actually painted, so its
  // query can read 0. This idle-triggered refresh corrects that once the map
  // settles, without requiring a user pan/zoom. Also re-fires when
  // filterTilesReady flips: during warmup the -filtered layer may be
  // partially painted, so the count taken right as it finishes loading can
  // still be off — the map may already be idle by then, so a dep-driven
  // re-run (not just the idle listener) is needed to correct it.
  useEffect(() => {
    if (!(isFilterTilesMode || isTilesMode) || !mapRef.current) return;
    // Filter/mode changes alter what's rendered at the same zoom — any
    // cached count is wrong now, so the skip heuristic must not keep it.
    lastTileCountRef.current = null;
    const map = mapRef.current.getMap();
    const onIdle = () => updateVisibleCameras();
    map.once('idle', onIdle);
    return () => { map.off('idle', onIdle); };
  }, [isFilterTilesMode, isTilesMode, tileFilterExpr, filterTilesReady, updateVisibleCameras]);

  // moveend's count query races tile loading — a flyTo (e.g. search jump)
  // lands and counts before the destination's tiles arrive, reading a stale 0
  // that nothing corrects until the next gesture (verified: search-fly to
  // Houston held "0 cameras in view" through 9s of idle; a 10px nudge read
  // 1,583). Counting again on the next idle picks up the settled tiles.
  const handleMoveEnd = useCallback((evt: ViewStateChangeEvent) => {
    const map = mapRef.current?.getMap();

    // Mirror the settled viewport into the store once per gesture (URL sync,
    // header counts, legacy-map link). Per-tick writes lived in onMove and
    // re-rendered every subscriber each frame; nothing needs live values.
    if (map) {
      const bounds = map.getBounds();
      setViewState(
        [evt.viewState.latitude, evt.viewState.longitude],
        evt.viewState.zoom,
        {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
      );
    }

    // Count once on the next idle only. The old immediate query here was
    // always followed by the idle one (see comment above), so it double-paid
    // — at national zoom that's ~112k features deserialized twice per
    // gesture, blocking the main thread mid-wiggle on mobile-class CPUs.
    if (!map) return;
    map.off('idle', updateVisibleCameras);
    map.once('idle', updateVisibleCameras);
  }, [setViewState, updateVisibleCameras]);

  // Derive camera source outside the memo so reference equality works across tab switches.
  // When no filters are applied, cameras === filteredCameras (same ref), so switching
  // isTimelineActive won't change cameraSource and the memo below won't recompute.
  const cameraSource = isTimelineActive ? cameras : filteredCameras;

  // Convert cameras to GeoJSON - memoized to prevent unnecessary recalculations
  // During timeline mode, load ALL cameras once and control visibility via map.setFilter()
  const geojsonData = useMemo(
    () => {
      if (!showCameraLayer) return camerasToGeoJSON([]);
      return camerasToGeoJSON(cameraSource);
    },
    [showCameraLayer, cameraSource]
  );
  
  // Keep refs updated with latest data for use in event handlers
  // This ensures the onLoad/idle handlers have access to the most recent data
  useEffect(() => {
    geojsonDataRef.current = geojsonData;
    latestDataVersionRef.current = dataVersion;
  }, [geojsonData, dataVersion]);
  
  // Notify parent when the map may reveal. A camera-tile failure with the
  // basemap up still reveals (rule in mapReveal): the retry pill carries the
  // failure instead of a spinner forever. GeoJSON is never loaded on that path.
  useEffect(() => {
    onMarkersReady?.(revealReady);
  }, [revealReady, onMarkersReady]);

  // --- Timeline filter handler (imperative setFilter, no GeoJSON rebuild) ---
  const TIMELINE_LAYERS = useMemo(() => ['unclustered-point', 'cameras-dots-lowzoom'], []);
  // Cache the last cutoff to skip redundant setFilter calls (same date = same filter).
  // With 71 Protomaps vector layers, every setFilter triggers an expensive render cycle.
  const lastCutoffRef = useRef<number>(0);

  const handleTimelineTick = useCallback((dateStr: string) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Read viz state imperatively (no dependency needed — keeps callback stable)
    const { mapVisualization, appMode, heatmapSettings } = useAppModeStore.getState();
    const isExplore = appMode === 'explore';
    const isHeatmap = isExplore && mapVisualization === 'heatmap';
    const isDots = isExplore && mapVisualization === 'dots';
    // Timeline (dots) no longer mounts CameraMarkerLayers at all.
    const markersVisible = !isExplore || (isHeatmap && heatmapSettings.showMarkers);

    // If date is at or past the max camera date, clear filters (every point passes)
    const { timelineMaxDay } = useCameraStore.getState();
    if (dateStr >= timelineMaxDay) {
      if (lastCutoffRef.current === Infinity) return; // already cleared
      lastCutoffRef.current = Infinity;
      if (markersVisible) {
        for (const layerId of TIMELINE_LAYERS) {
          if (map.getLayer(layerId)) map.setFilter(layerId, null, { validate: false });
        }
        if (map.getLayer('direction-cones')) map.setFilter('direction-cones', null, { validate: false });
        if (map.getLayer('direction-cones-outline')) map.setFilter('direction-cones-outline', null, { validate: false });
      }
      if (isHeatmap && map.getLayer('heatmap-layer')) map.setFilter('heatmap-layer', null, { validate: false });
      if (isDots && map.getLayer('dot-density-layer')) map.setFilter('dot-density-layer', null, { validate: false });
      return;
    }

    const parts = dateStr.split('-').map(Number);
    const [year, month, day] = parts;
    const cutoffMs = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

    // Skip if cutoff hasn't changed — avoids triggering a 71-layer render cycle
    if (cutoffMs === lastCutoffRef.current) return;
    lastCutoffRef.current = cutoffMs;

    // Simplified filter: ts=0 (no-date cameras) is always <= any valid cutoffMs,
    // so a single comparison replaces the previous 3-operation ['any',['==',0],['<=']] chain.
    // Evaluated 78K times per tick — this matters.
    const vizFilter: maplibregl.FilterSpecification = ['<=', ['get', 'ts'], cutoffMs];

    // Only filter layers that are actually visible — avoids an unnecessary
    // render cycle on layers nobody can see
    if (markersVisible) {
      for (const layerId of TIMELINE_LAYERS) {
        if (map.getLayer(layerId)) map.setFilter(layerId, vizFilter, { validate: false });
      }
      if (map.getLayer('direction-cones')) map.setFilter('direction-cones', vizFilter, { validate: false });
      if (map.getLayer('direction-cones-outline')) map.setFilter('direction-cones-outline', vizFilter, { validate: false });
    }
    if (isHeatmap && map.getLayer('heatmap-layer')) map.setFilter('heatmap-layer', vizFilter, { validate: false });
    if (isDots && map.getLayer('dot-density-layer')) map.setFilter('dot-density-layer', vizFilter, { validate: false });

  }, [TIMELINE_LAYERS]);

  // Register/unregister timeline tick callback
  useEffect(() => {
    if (isTimelineActive) {
      useMapStore.getState().setTimelineTickCallback(handleTimelineTick);
    } else {
      useMapStore.getState().setTimelineTickCallback(null);
      lastCutoffRef.current = 0; // Reset so next enable re-applies filters
      // Restore default filters when timeline is disabled
      const map = mapRef.current?.getMap();
      if (map && map.isStyleLoaded()) {
        for (const layerId of TIMELINE_LAYERS) {
          if (map.getLayer(layerId)) map.setFilter(layerId, null);
        }
        if (map.getLayer('direction-cones')) map.setFilter('direction-cones', null);
        if (map.getLayer('direction-cones-outline')) map.setFilter('direction-cones-outline', null);

      }
    }
    return () => useMapStore.getState().setTimelineTickCallback(null);
  }, [isTimelineActive, handleTimelineTick, TIMELINE_LAYERS]);

  // Apply initial filter when timeline enables and map is ready.
  // The dot-density-layer (cameras-dots source) may not be ready when this first
  // fires — react-map-gl defers addSource/addLayer and the 62K-feature GeoJSON
  // needs to be tiled by MapLibre's web worker. Listen for the source to finish
  // loading, then re-apply the current filter and force a repaint so the dots
  // become visible without requiring a user zoom interaction.
  useEffect(() => {
    if (!mapLoaded || !isTimelineActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    // CameraMarkerLayers unmounts on a viz switch into/out of Timeline (dots),
    // and its date filter is imperative-only (no layer spec carries one) — so
    // remounting recreates unfiltered layers. isTimelineActive stays true across
    // a heatmap<->dots switch and handleTimelineTick is stable, so without the
    // reset below the same-date guard (`cutoffMs === lastCutoffRef.current`)
    // would skip re-applying the filter and leave every camera/cone showing.
    lastCutoffRef.current = 0;

    const { currentDate } = useAppModeStore.getState().timelineSettings;
    handleTimelineTick(currentDate);

    const onDotsSourceReady = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId === 'cameras-dots' && e.isSourceLoaded) {
        const { currentDate: cur } = useAppModeStore.getState().timelineSettings;
        handleTimelineTick(cur);
        map.triggerRepaint();
        map.off('sourcedata', onDotsSourceReady);
      }
    };
    map.on('sourcedata', onDotsSourceReady);

    return () => { map.off('sourcedata', onDotsSourceReady); };
    // mapVisualization is a trigger-only dep: it re-fires this effect on a
    // heatmap<->dots switch so the filter is re-applied. It is intentionally
    // unused in the body — do not remove it, or dots<->heatmap re-filtering breaks.
  }, [mapLoaded, isTimelineActive, handleTimelineTick, mapVisualization]);

  // Symbol (label) layers are always visible in both themes. No need to
  // programmatically hide them per mode — the 13 symbol layers have
  // negligible GPU cost and hiding them confused users entering via /timeline.

  // Update visible cameras when camera data changes
  useEffect(() => {
    if (cameras.length > 0) {
      updateVisibleCameras();
    }
  }, [cameras.length, updateVisibleCameras]);

  // Deterministic data pipeline with watchdog
  // Ensures data is applied when map style is ready, with retries and observability
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    
    const map = mapRef.current.getMap();
    const currentData = geojsonDataRef.current;
    const currentVersion = latestDataVersionRef.current;
    
    // Skip if no data to apply
    if (currentData.features.length === 0) {
      if (import.meta.env.DEV) {
        console.log('[MapLibre] No camera data to apply yet');
      }
      return;
    }
    
    let isCleanedUp = false;
    let watchdogTimeoutId: ReturnType<typeof setTimeout>;
    
    // Function to apply data to source with verification
    const applyDataToSource = (): boolean => {
      if (isCleanedUp) return false;
      if (sourceDataVersion.current === currentVersion) return true;
      
      // Check if style is loaded first
      if (!map.isStyleLoaded()) {
        if (import.meta.env.DEV) {
          console.log('[MapLibre] Waiting for style to load...');
        }
        return false;
      }
      
      const source = map.getSource('cameras') as maplibregl.GeoJSONSource | undefined;
      
      if (!source) {
        if (import.meta.env.DEV) {
          console.log('[MapLibre] Source not ready yet');
        }
        return false;
      }
      
      try {
        source.setData(currentData);
        sourceDataVersion.current = currentVersion;
        
        if (import.meta.env.DEV) {
          console.log(`[MapLibre] ✓ Source data applied: ${currentData.features.length} cameras (v${currentVersion})`);
        }
        
        // Verify layer exists after applying data
        const layer = map.getLayer('unclustered-point');
        if (layer) {
          setMarkersReady(true);
          watchdogRetryCount.current = 0;
          
          if (import.meta.env.DEV) {
            // Count rendered features after a brief delay for clustering
            setTimeout(() => {
              if (isCleanedUp) return;
              try {
                const features = map.querySourceFeatures('cameras');
                console.log(`[MapLibre] Rendered features count: ${features.length}`);
                if (features.length === 0 && currentData.features.length > 0) {
                  console.warn('[MapLibre] ⚠ Zero features rendered despite having camera data');
                }
              } catch { /* ignore query errors */ }
            }, 200);
          }
          return true;
        } else {
          if (import.meta.env.DEV) {
            console.log('[MapLibre] Layer not ready yet, will retry');
          }
          return false;
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn('[MapLibre] Failed to apply source data:', e);
        }
        return false;
      }
    };
    
    // Watchdog: retry with exponential backoff
    const startWatchdog = (retryIndex: number) => {
      if (isCleanedUp || retryIndex >= MAX_WATCHDOG_RETRIES) {
        if (retryIndex >= MAX_WATCHDOG_RETRIES && import.meta.env.DEV) {
          console.warn(`[MapLibre] ⚠ Watchdog exhausted after ${MAX_WATCHDOG_RETRIES} retries`);
          watchdogRetryCount.current = MAX_WATCHDOG_RETRIES;
        }
        return;
      }
      
      watchdogTimeoutId = setTimeout(() => {
        if (isCleanedUp) return;
        
        if (!applyDataToSource()) {
          watchdogRetryCount.current = retryIndex + 1;
          if (import.meta.env.DEV) {
            console.log(`[MapLibre] Watchdog retry ${retryIndex + 1}/${MAX_WATCHDOG_RETRIES} in ${WATCHDOG_DELAYS[retryIndex]}ms`);
          }
          startWatchdog(retryIndex + 1);
        }
      }, WATCHDOG_DELAYS[retryIndex]);
    };
    
    // Handle style ready events
    const handleStyleData = () => {
      if (isCleanedUp) return;
      
      if (map.isStyleLoaded()) {
        if (import.meta.env.DEV) {
          console.log('[MapLibre] Style loaded, applying data...');
        }
        if (!applyDataToSource()) {
          startWatchdog(0);
        }
      }
    };
    
    // Try immediately
    if (applyDataToSource()) {
      return;
    }
    
    // Register for style events
    map.on('styledata', handleStyleData);
    
    // Also listen for source being added
    const handleSourceData = (e: maplibregl.MapSourceDataEvent) => {
      if (isCleanedUp) return;
      if (e.sourceId === 'cameras' && e.isSourceLoaded) {
        if (import.meta.env.DEV) {
          console.log('[MapLibre] Camera source loaded, verifying...');
        }
        applyDataToSource();
      }
    };
    map.on('sourcedata', handleSourceData);
    
    // Start watchdog as fallback
    startWatchdog(0);
    
    return () => {
      isCleanedUp = true;
      if (watchdogTimeoutId) clearTimeout(watchdogTimeoutId);
      map.off('styledata', handleStyleData);
      map.off('sourcedata', handleSourceData);
    };
  }, [mapLoaded, dataVersion, geojsonData]);

  // Tiles mode readiness: first successful camera-tiles load ⇒ camera source
  // ready. Repeated failures before any load ⇒ flip tilesFailed (retry pill).
  //
  // The reveal itself (revealReady) additionally waits for `mapLoaded` — the
  // map's `load` event, i.e. the first visually complete render including
  // every basemap tile in view. Approved 2026-09-10, reversing the earlier
  // camera-first reveal: that one let the loading indicator leave while the
  // basemap was still filling in behind the dots, which read as the map being
  // stuck. These two handlers are passed to <Map> so MapLibre binds them at
  // map creation (react-map-gl reads the callback from props at dispatch
  // time) — no sourcedata/error can slip through before we attach.
  const tileLoadSeenRef = useRef(false);
  const tileErrorCountRef = useRef(0);
  const filterTileLoadSeenRef = useRef(false);
  const filterTileErrorCountRef = useRef(0);

  // Fresh map instance per remount (mapKey bumps on retry) or fresh sources
  // per tile-host failover (tilesEpoch) ⇒ fresh counters.
  useEffect(() => {
    tileLoadSeenRef.current = false;
    tileErrorCountRef.current = 0;
    filterTileLoadSeenRef.current = false;
    filterTileErrorCountRef.current = 0;
    setFilterTilesReady(false);
  }, [mapKey, tilesEpoch]);

  // A remount is a NEW map instance: its load and camera-source flags start
  // over, so the page hides the map again until the new instance is ready
  // and every mapLoaded-keyed effect re-attaches to the new map. Without this
  // the stale true flags never re-fire the ready callback after a retry.
  useEffect(() => {
    setMapLoaded(false);
    setMarkersReady(false);
  }, [mapKey]);

  const handleTileSourceData = useCallback((e: maplibregl.MapSourceDataEvent) => {
    if (!e.isSourceLoaded) return;
    if (e.sourceId === 'camera-tiles') {
      tileLoadSeenRef.current = true;
      if (renderMode === 'tiles') setMarkersReady(true);
      return;
    }
    if (e.sourceId === 'camera-tiles-filtered') {
      filterTileLoadSeenRef.current = true;
      setFilterTilesReady(true);
      if (renderMode === 'filter-tiles') setMarkersReady(true);
    }
  }, [renderMode]);

  // Tile-source errors. A TileJSON failure, or the third pre-load tile failure
  // on a camera source, fails the app over to the backup host while on primary
  // (the epoch bump remounts every tile source); the same failures on backup
  // surface the retry pill. Rules live in tileErrorPolicy. Host state is read
  // at dispatch time, never captured, so the handler is never stale.
  const handleMapError = useCallback((e: maplibregl.ErrorEvent & { sourceId?: string; tile?: unknown }) => {
    const sourceId = e?.sourceId ?? (e as { source?: { id?: string } })?.source?.id;
    const isFilter = sourceId === 'camera-tiles-filtered';
    const action = planTileError({
      sourceId,
      // MapLibre attaches the tile to per-tile failures; a TileJSON failure has none.
      tileLevel: e?.tile != null,
      loadSeen: isFilter ? filterTileLoadSeenRef.current : tileLoadSeenRef.current,
      errorCount: isFilter ? filterTileErrorCountRef.current : tileErrorCountRef.current,
      onBackup: useTilesHostStore.getState().hostId === 'backup',
    });
    switch (action.kind) {
      case 'count':
        if (isFilter) filterTileErrorCountRef.current += 1;
        else tileErrorCountRef.current += 1;
        return;
      case 'failover':
        failoverTilesHost(action.reason);
        return;
      case 'fail':
        if (action.source === 'filter') {
          console.warn('[MapLibre] Filter tiles failing on the backup host; showing all cameras unfiltered');
          useCameraStore.getState().setFilterTilesFailed(true);
        } else {
          console.warn('[MapLibre] Camera tiles failing on the backup host; surfacing the retry pill');
          useCameraStore.getState().setTilesFailed(true);
        }
        return;
      default:
        return;
    }
  }, []);

  // Handle map move - batch center, zoom, and bounds in a single store update
  const onMove = useCallback(() => {
    // Live in-view count while the camera moves — index counting is
    // sub-millisecond, so the counter tracks the gesture like the old
    // geojson grid did. Throttled to ~8Hz: only the two small count
    // consumers re-render, never the map tree.
    //
    // Count ONLY on the gesture path. countInBounds sums interior cells in
    // O(1); the per-brand tally iterates every member (~117k at national
    // zoom) and allocates, so brand stats are computed exclusively in the
    // idle recount — the breakdown lags the gesture by design, never
    // costs it.
    if (renderMode === 'tiles') {
      const idx = getCameraIndex(country);
      const now = performance.now();
      if (idx && now - liveCountAtRef.current > 120) {
        liveCountAtRef.current = now;
        const map = mapRef.current?.getMap();
        if (map) {
          const b = map.getBounds();
          useMapStore.getState().setTileViewCameraCount(countInBounds(idx, {
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          }));
        }
      }
    }

    // The store viewport mirror moved to onMoveEnd: the map is uncontrolled
    // (initialViewState), so nothing consumes live per-tick values, and a
    // setViewState per onMove tick re-rendered every mapStore subscriber on
    // every frame of a drag (measured ~120 React commits per one-second
    // gesture — the drag hitching on mid-tier devices).
    //
    // Both tile modes' viewport count is derived from queryRenderedFeatures,
    // which is too hot to run on every onMove tick — it runs once per gesture
    // via onMoveEnd instead (filter-tiles also gets an idle-triggered refresh
    // on filter change, see the effect above).
    if (renderMode === 'geojson') {
      updateVisibleCameras();
    }
  }, [updateVisibleCameras, renderMode, country]);

  // Handle map load
  const onLoad = useCallback(() => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const bounds = map.getBounds();
      setBounds({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
      
      if (import.meta.env.DEV) {
        console.log('[MapLibre] Map loaded, waiting for style...');
      }
      
      // Wait for style to be fully loaded before marking map as loaded
      // This ensures the deterministic pipeline has a ready map
      const checkStyleAndFinish = () => {
        if (map.isStyleLoaded()) {
          if (import.meta.env.DEV) {
            console.log('[MapLibre] Style loaded, map ready');
          }
          
          // Mark map as loaded - enables deterministic source updates
          setMapLoaded(true);

          // Initial visible camera count
          updateVisibleCameras();
        } else {
          // Wait for style to load
          map.once('styledata', checkStyleAndFinish);
        }
      };
      
      checkStyleAndFinish();
    }
  }, [setBounds, updateVisibleCameras]);

  // Handle map clicks - density feature selection, location picking, or
  // camera marker click to open its popup
  const onClick = useCallback(async (event: MapLayerMouseEvent) => {
    if (!mapRef.current) return;

    // Network mode: deck.gl handles clicks via its own pickable layers
    if (isNetworkMode) return;

    // Density mode: select clicked feature
    // MapLibre serializes GeoJSON properties to strings in event features,
    // so we must parse numeric fields back to numbers.
    if (isDensityMode) {
      const feature = event.features?.[0];
      const p = feature?.properties;
      if (p?.GEOID) {
        const parsed: DensityFeatureProperties = {
          GEOID: String(p.GEOID),
          name: String(p.name),
          level: String(p.level) as 'state' | 'county',
          stateCode: Number(p.stateCode),
          population: Number(p.population),
          roadMiles: Number(p.roadMiles),
          cameraCount: Number(p.cameraCount),
          camerasPerCapita: Number(p.camerasPerCapita),
          camerasPerRoadMile: Number(p.camerasPerRoadMile),
          rankPerCapita: Number(p.rankPerCapita),
          rankPerRoadMile: Number(p.rankPerRoadMile),
          percentilePerCapita: Number(p.percentilePerCapita),
          percentilePerRoadMile: Number(p.percentilePerRoadMile),
        };
        useDensityStore.getState().setSelectedFeature(parsed);
      } else {
        // Clicked empty area — clear selection
        useDensityStore.getState().setSelectedFeature(null);
      }
      return;
    }

    // If in location picking mode (for route origin/destination), handle click
    if (pickingLocation) {
      // Ignore taps while the camera is animating or gliding (accidental picks)
      if (event.target.isMoving()) return;
      // Debounce: a fast double-tap fires two click events even with
      // double-tap zoom disabled — ignore the second pick.
      const now = Date.now();
      if (now - lastPickTimeRef.current < 400) return;
      lastPickTimeRef.current = now;
      const { lng, lat } = event.lngLat;
      
      // Create location with coordinates first
      const location: Location = {
        lat,
        lon: lng,
        name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        address: 'Map location',
      };
      
      // Set the location immediately for responsiveness
      setPickedLocation(location);
      return;
    }

    const feature = event.features?.[0];
    if (!feature) return;

    // Tile paths (default + filtered) share this handler — guard so a stray
    // feature from a non-camera interactive layer is never parsed as one.
    if ((isTilesMode || isFilterTilesMode) && !CAMERA_POINT_LAYER_IDS.includes(feature.layer.id)) {
      return;
    }

    const props = feature.properties;
    if (!props || props.osmId == null) return;

    const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates;
    const camera: ALPRCamera = {
      osmId: Number(props.osmId),
      osmType: (props.osmType as 'node' | 'way') || 'node',
      lat: props.lat ?? lat,
      lon: props.lon ?? lon,
      operator: props.operator || undefined,
      brand: props.brand || undefined,
      direction: props.direction ?? undefined,
      directionCardinal: props.directionCardinal || undefined,
      surveillanceZone: props.surveillanceZone || undefined,
      mountType: props.mountType || undefined,
      ref: props.ref || undefined,
      startDate: props.startDate || undefined,
      wikimediaCommons: props.wikimediaCommons || undefined,
    };

    setPopupInfo({
      longitude: camera.lon,
      latitude: camera.lat,
      camera,
    });
  }, [pickingLocation, setPickedLocation, isDensityMode, isNetworkMode, isTilesMode, isFilterTilesMode]);

  // Cursor handling - crosshair when adding waypoints or picking location
  const onMouseEnter = useCallback((e: MapLayerMouseEvent) => {
    if (pickingLocation) return; // Keep crosshair when picking
    setCursor('pointer');
    // Density hover
    if (isDensityMode && e.features?.[0]?.properties?.GEOID) {
      useDensityStore.getState().setHoveredFeatureId(String(e.features[0].properties.GEOID));
    }
  }, [pickingLocation, isDensityMode]);

  const onMouseLeave = useCallback(() => {
    if (isDensityMode) {
      useDensityStore.getState().setHoveredFeatureId(null);
    }
    if (pickingLocation) {
      setCursor('crosshair');
    } else {
      setCursor('');
    }
  }, [pickingLocation, isDensityMode]);
  
  // Set crosshair cursor when in picking mode
  useEffect(() => {
    if (pickingLocation) {
      setCursor('crosshair');
    } else {
      setCursor('');
    }
  }, [pickingLocation]);

  // While picking, disable double-tap zoom so a double-tap doesn't lurch the
  // camera; the pick debounce in onClick handles the duplicate click events
  // a double-tap still fires.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (pickingLocation) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [pickingLocation]);

  // Escape exits the picking sequence (keeps endpoints picked so far)
  useEffect(() => {
    if (!pickingLocation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPickingLocation();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickingLocation, cancelPickingLocation]);

  // MapLibre 5.15 ends a mouse drag only on an element-scoped mouseup — its
  // window-level mouseup is not wired to dragEnd and it takes no pointer
  // capture — so releasing the button over the side panel left the gesture
  // armed: no dragend/moveend ever fired and the map kept panning with the
  // button up. Forward off-map releases to the canvas so the drag ends.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const container = map.getContainer();
    let dragging = false;
    const onStart = () => { dragging = true; };
    const onEnd = () => { dragging = false; };
    const forwardRelease = (e: MouseEvent) => {
      if (!dragging || container.contains(e.target as Node)) return;
      map.getCanvas().dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: e.button,
        buttons: 0,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
      }));
    };
    map.on('dragstart', onStart);
    map.on('dragend', onEnd);
    map.on('rotatestart', onStart);
    map.on('rotateend', onEnd);
    window.addEventListener('mouseup', forwardRelease, true);
    return () => {
      map.off('dragstart', onStart);
      map.off('dragend', onEnd);
      map.off('rotatestart', onStart);
      map.off('rotateend', onEnd);
      window.removeEventListener('mouseup', forwardRelease, true);
    };
  }, [mapLoaded]);

  // Auto mode: update activeView based on zoom level
  useEffect(() => {
    if (!mapLoaded || !isMapMode || mapModeViz !== 'auto') return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    // Set initial activeView from current zoom
    setActiveView(getActiveViewForZoom(map.getZoom()));

    const handleZoomEnd = () => {
      setActiveView(getActiveViewForZoom(map.getZoom()));
    };

    map.on('zoomend', handleZoomEnd);
    return () => {
      map.off('zoomend', handleZoomEnd);
    };
  }, [mapLoaded, isMapMode, mapModeViz, setActiveView]);

  // One-shot fitBounds command (e.g. framing a state filter). Also keyed on
  // mapLoaded: a deep link can issue the command before the map instance
  // exists — the command stays queued until the map is ready to consume it.
  const fitBoundsCommand = useMapStore(s => s.fitBoundsCommand);
  useEffect(() => {
    if (!fitBoundsCommand || !mapRef.current || !mapLoaded) return;
    mapRef.current.fitBounds(
      [
        [fitBoundsCommand.west, fitBoundsCommand.south],
        [fitBoundsCommand.east, fitBoundsCommand.north],
      ],
      { padding: 60, duration: 1200 }
    );
    useMapStore.getState().clearFitBoundsCommand();
  }, [fitBoundsCommand, mapLoaded]);

  // Fit to route bounds when routes change
  useEffect(() => {
    if (!mapRef.current) return;
    
    const route = activeRoute === 'avoidance' ? avoidanceRoute : normalRoute;
    if (route && route.geometry.length > 0) {
      const coords = route.geometry.map(([lat, lon]) => [lon, lat] as [number, number]);
      const bounds = coords.reduce(
        (acc, coord) => ({
          minLng: Math.min(acc.minLng, coord[0]),
          maxLng: Math.max(acc.maxLng, coord[0]),
          minLat: Math.min(acc.minLat, coord[1]),
          maxLat: Math.max(acc.maxLat, coord[1]),
        }),
        { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity }
      );

      // On mobile the results scoreboard is pinned across the top of the map
      // and the tab drawer rests across the bottom. A uniform inset would
      // center the route in the whole viewport, tucking its middle behind
      // them — so pad the fit to the actual free band: clear the measured
      // scoreboard up top and the drawer's resting height below. Desktop
      // (results live in the side panel, not over the map) keeps the uniform
      // inset.
      let padding: number | { top: number; bottom: number; left: number; right: number } = 80;
      if (window.innerWidth < MOBILE_BREAKPOINT && useAppModeStore.getState().appMode === 'route') {
        const mapPage = document.querySelector<HTMLElement>('.map-page');
        const drawerHeight = mapPage
          ? parseFloat(getComputedStyle(mapPage).getPropertyValue('--drawer-height')) || 0
          : 0;
        const scoreboard = document.querySelector<HTMLElement>('[data-route-scoreboard]');
        const container = mapRef.current.getContainer();
        const topInset = scoreboard && container
          ? scoreboard.getBoundingClientRect().bottom - container.getBoundingClientRect().top + 16
          : 130;
        padding = {
          top: Math.round(topInset),
          bottom: Math.round(drawerHeight) + 24,
          left: 36,
          right: 36,
        };
      }

      mapRef.current.fitBounds(
        [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
        { padding, duration: 1000 }
      );
    }
  }, [normalRoute, avoidanceRoute, activeRoute]);

  // Build route GeoJSON - memoized since route changes are infrequent
  const routeGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = [];
    
    // Add inactive route first (renders below)
    if (normalRoute && activeRoute === 'avoidance') {
      features.push({
        type: 'Feature',
        properties: { type: 'normal', active: false },
        geometry: {
          type: 'LineString',
          coordinates: normalRoute.geometry.map(([lat, lon]) => [lon, lat]),
        },
      });
    }
    if (avoidanceRoute && activeRoute === 'normal') {
      features.push({
        type: 'Feature',
        properties: { type: 'avoidance', active: false },
        geometry: {
          type: 'LineString',
          coordinates: avoidanceRoute.geometry.map(([lat, lon]) => [lon, lat]),
        },
      });
    }

    // Add active route on top
    if (activeRoute === 'normal' && normalRoute) {
      features.push({
        type: 'Feature',
        properties: { type: 'normal', active: true },
        geometry: {
          type: 'LineString',
          coordinates: normalRoute.geometry.map(([lat, lon]) => [lon, lat]),
        },
      });
    }
    if (activeRoute === 'avoidance' && avoidanceRoute) {
      features.push({
        type: 'Feature',
        properties: { type: 'avoidance', active: true },
        geometry: {
          type: 'LineString',
          coordinates: avoidanceRoute.geometry.map(([lat, lon]) => [lon, lat]),
        },
      });
    }

    // Add origin/destination markers
    // Show markers from route if available, otherwise from store origin/destination
    const route = activeRoute === 'avoidance' ? avoidanceRoute : normalRoute;
    const originLocation = route?.origin || origin;
    const destinationLocation = route?.destination || destination;
    
    if (originLocation) {
      features.push({
        type: 'Feature',
        properties: { markerType: 'origin', name: originLocation.name || 'Start' },
        geometry: {
          type: 'Point',
          coordinates: [originLocation.lon, originLocation.lat],
        },
      });
    }
    if (destinationLocation) {
      features.push({
        type: 'Feature',
        properties: { markerType: 'destination', name: destinationLocation.name || 'End' },
        geometry: {
          type: 'Point',
          coordinates: [destinationLocation.lon, destinationLocation.lat],
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [normalRoute, avoidanceRoute, activeRoute, origin, destination]);

  // Memoize popup content to prevent re-renders
  const MemoizedCameraPopupContent = useMemo(() => memo(CameraPopupContent), []);

  const hasRoutes = normalRoute || avoidanceRoute;
  
  // Separate GeoJSON for location markers (shown even without routes)
  const locationMarkersGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = [];
    
    // Only show standalone markers when there's no route yet
    if (!normalRoute && !avoidanceRoute) {
      if (origin) {
        features.push({
          type: 'Feature',
          properties: { markerType: 'origin', name: origin.name || 'Start' },
          geometry: {
            type: 'Point',
            coordinates: [origin.lon, origin.lat],
          },
        });
      }
      if (destination) {
        features.push({
          type: 'Feature',
          properties: { markerType: 'destination', name: destination.name || 'End' },
          geometry: {
            type: 'Point',
            coordinates: [destination.lon, destination.lat],
          },
        });
      }
    }
    
    return { type: 'FeatureCollection', features };
  }, [origin, destination, normalRoute, avoidanceRoute]);

  return (
    <Map
      key={mapKey} // Unique key forces remount when data version changes after errors
      ref={mapRef}
      initialViewState={{
        longitude: center[1],
        latitude: center[0],
        zoom: zoom,
      }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={mapStyle}
      // Alias TileJSON docs revalidate on reload; tile URLs stay immutably cached.
      transformRequest={tilesTransformRequest}
      onMove={onMove}
      onMoveEnd={handleMoveEnd}
      onLoad={onLoad}
      // Bound at map creation — camera-tile readiness must not wait for `load`.
      onSourceData={handleTileSourceData}
      onError={handleMapError}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      cursor={cursor}
      interactiveLayerIds={isNetworkMode
        ? []
        : isDensityMode
          ? ['density-states-fill', 'density-counties-fill', 'density-states-extrusion', 'density-counties-extrusion']
          : showCameraMarkers
            ? (isTilesMode
                ? ['camera-tile-points']
                : isFilterTilesMode
                  ? ['camera-tile-points-filtered']
                  : ['unclustered-point'])
            : []}
      attributionControl={false}
      // Removed reuseMaps to avoid stale reused instances
    >
      <NavigationControl position="bottom-right" showCompass />
      <GeolocateControl position="bottom-right" />
      <AttributionCtl key={attribPosition} position={attribPosition} />

      {/* Explore visualization layers */}
      {isHeatmapMode && <HeatmapLayers />}
      {isMapMode && <HeatmapLayers visible={mapModeViz === 'heatmap'} />}
      {isDotsMode && <DotDensityLayers />}
      {isDensityMode && <DensityLayers />}
      {isNetworkMode && <NetworkLayers />}
      {isMapMode && <BoundaryOverlayLayers />}

      {/* Camera tiles — the default rendering path. Always mounted; hidden
          when the geojson path (filters/timeline/heatmap) is active. Kept
          visible through filter-tiles warmup (until filterTilesReady) so the
          camera layer never blanks while the filtered source streams in.
          Keyed by country so a switch remounts source + layers cleanly on the
          other country's tileset, and by tile-host epoch so a failover remounts
          them against the backup host. */}
      <CameraTileLayers
        key={`${country}-${tilesEpoch}`}
        sourceUrl={cameraTileJsonUrl(country)}
        visible={
          (isTilesMode || (isFilterTilesMode && !filterTilesReady)) &&
          showCameraMarkers && showCameraLayer
        }
      />
      {/* Filtered camera tiles — mounted the first time a filter is applied this
          session and left mounted (visibility toggles) so its tiles stay cached.
          Users who never filter never mount this source. */}
      {filterLayersMounted && (
        <CameraTileLayers
          key={`filtered-${country}-${tilesEpoch}-${filterSourceUrl}`}
          visible={isFilterTilesMode && showCameraMarkers && showCameraLayer}
          sourceId="camera-tiles-filtered"
          sourceUrl={filterSourceUrl}
          idSuffix="-filtered"
          filter={tileFilterExpr}
        />
      )}

      {/* Legacy GeoJSON camera layers — empty until the dataset lazily loads;
          becomes the active path for filters/heatmap/Canada.
          Unmounted entirely in Timeline: `visible` only toggles layout visibility,
          so a mounted instance still builds a 114k-feature source plus a cone
          polygon per camera that Timeline would never draw.
          Stays hidden during filter-tiles rendering to prevent double markers. */}
      {!isDotsMode && (
        <CameraMarkerLayers
          cameras={cameraSource}
          visible={renderMode === 'geojson' && showCameraMarkers}
          mapLoaded={mapLoaded}
          mapRef={mapRef}
        />
      )}

      {/* Routes (only in route mode) */}
      {appMode === 'route' && hasRoutes && (
        <Source id="routes" type="geojson" data={routeGeoJSON}>
          {/* Privacy route outline */}
          <Layer
            id="route-outline-privacy"
            type="line"
            filter={['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'type'], 'avoidance']]}
            paint={{
              'line-color': '#000000',
              'line-width': 9,
              'line-opacity': 0.3,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
          {/* Privacy route - solid green (rendered first/underneath) */}
          <Layer
            id="route-line-privacy"
            type="line"
            filter={['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'type'], 'avoidance']]}
            paint={{
              'line-color': '#22c55e', // Green: must not blend into the blue camera dots
              'line-width': 6,
              'line-opacity': 0.95,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
          {/* Direct route outline */}
          <Layer
            id="route-outline-direct"
            type="line"
            filter={['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'type'], 'normal']]}
            paint={{
              'line-color': '#000000',
              'line-width': 8,
              'line-opacity': 0.25,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
          {/* Direct route - dashed orange (rendered on top so overlap is visible) */}
          <Layer
            id="route-line-direct"
            type="line"
            filter={['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'type'], 'normal']]}
            paint={{
              'line-color': '#f97316', // Bright orange for direct route
              'line-width': 5,
              'line-opacity': 0.95,
              'line-dasharray': [2, 1.5], // Dashed pattern to show overlap
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
          {/* Origin marker */}
          <Layer
            id="route-origin"
            type="circle"
            filter={['==', ['get', 'markerType'], 'origin']}
            paint={{
              'circle-radius': 10,
              'circle-color': '#22c55e',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            }}
          />
          {/* Destination marker */}
          <Layer
            id="route-destination"
            type="circle"
            filter={['==', ['get', 'markerType'], 'destination']}
            paint={{
              'circle-radius': 10,
              'circle-color': '#4DA6FF',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            }}
          />
        </Source>
      )}

      {/* Standalone location markers (shown before route is calculated, route mode only) */}
      {appMode === 'route' && (origin || destination) && !normalRoute && !avoidanceRoute && (
        <Source id="location-markers" type="geojson" data={locationMarkersGeoJSON}>
          {/* Origin marker */}
          <Layer
            id="location-origin"
            type="circle"
            filter={['==', ['get', 'markerType'], 'origin']}
            paint={{
              'circle-radius': 12,
              'circle-color': '#22c55e',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            }}
          />
          {/* Origin inner dot */}
          <Layer
            id="location-origin-inner"
            type="circle"
            filter={['==', ['get', 'markerType'], 'origin']}
            paint={{
              'circle-radius': 5,
              'circle-color': '#ffffff',
            }}
          />
          {/* Destination marker */}
          <Layer
            id="location-destination"
            type="circle"
            filter={['==', ['get', 'markerType'], 'destination']}
            paint={{
              'circle-radius': 12,
              'circle-color': '#4DA6FF',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            }}
          />
          {/* Destination inner dot */}
          <Layer
            id="location-destination-inner"
            type="circle"
            filter={['==', ['get', 'markerType'], 'destination']}
            paint={{
              'circle-radius': 5,
              'circle-color': '#ffffff',
            }}
          />
        </Source>
      )}

      {/* Popup */}
      {popupInfo && (
        <Popup
          longitude={popupInfo.longitude}
          latitude={popupInfo.latitude}
          anchor="bottom"
          onClose={() => setPopupInfo(null)}
          closeOnClick={false}
          className="camera-popup-maplibre"
          maxWidth="280px"
        >
          <MemoizedCameraPopupContent camera={popupInfo.camera} />
        </Popup>
      )}

      {/* Location picking mode indicator */}
      {pickingLocation && (
        <div className="absolute inset-0 z-40 pointer-events-none">
          {/* Subtle overlay */}
          <div className="absolute inset-0 bg-dark-900/10" />

          {/* Banner - bottom on mobile, top on desktop */}
          <div className="absolute bottom-24 lg:bottom-auto lg:top-4 left-1/2 -translate-x-1/2 pointer-events-auto w-[calc(100%-2rem)] max-w-sm">
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-md border ${
              pickingLocation === 'origin'
                ? 'bg-success/95 border-success/40'
                : 'bg-danger/95 border-danger/40'
            }`}>
              {/* Icon */}
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                {pickingLocation === 'origin' ? (
                  <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                  </svg>
                )}
              </div>

              {/* Text */}
              <p className="text-white font-medium text-sm flex-1">
                {pickingSequence === 'full'
                  ? pickingLocation === 'origin'
                    ? 'Step 1 of 2 — Tap the map to set your start'
                    : 'Step 2 of 2 — Now tap your destination'
                  : `Tap the map to set your ${pickingLocation === 'origin' ? 'start' : 'destination'}`}
              </p>

              {/* Cancel button */}
              <button
                onClick={() => cancelPickingLocation()}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
                title="Cancel"
              >
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          </div>

        </div>
      )}
      
    </Map>
  );
});

// Module-level vendor image cache — fetched once, reused across all popup instances
let vendorCachePromise: Promise<Array<{ fullName: string; urls: Array<{ url: string }> }>> | null = null;

function getVendorImageUrl(brand: string): Promise<string | null> {
  if (!vendorCachePromise) {
    vendorCachePromise = fetch('https://cms.deflock.me/items/lprVendors')
      .then(r => r.ok ? r.json() : { data: [] })
      .then((json: { data: Array<{ fullName: string; urls: Array<{ url: string }> }> }) => json.data)
      .catch(() => []);
  }
  return vendorCachePromise.then(vendors => {
    const vendor = vendors.find(v => v.fullName === brand);
    return vendor?.urls?.[0]?.url ?? null;
  });
}

function wikimediaImageUrl(tag: string): string {
  const clean = tag.replace(/^File:/, '').replace(/ /g, '_');
  const hash = md5(clean) as string;
  const encoded = encodeURIComponent(clean);
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash[0]}/${hash.slice(0, 2)}/${encoded}/300px-${encoded}`;
}

// Popup content component - Dark theme
function CameraPopupContent({ camera }: { camera: ALPRCamera }) {
  const osmUrl = `https://www.openstreetmap.org/${camera.osmType}/${camera.osmId}`;

  const wikiImageUrl = camera.wikimediaCommons ? wikimediaImageUrl(camera.wikimediaCommons) : null;
  const [imageUrl, setImageUrl] = useState<string | null>(wikiImageUrl);

  useEffect(() => {
    if (wikiImageUrl || !camera.brand) return;
    getVendorImageUrl(camera.brand).then(url => setImageUrl(url));
  }, [camera.brand, camera.wikimediaCommons]);

  return (
    <div className="min-w-[260px] p-4">
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-dark-600">
        <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0">
          {imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block w-full h-full" title="View example photo">
              <img src={imageUrl} alt={camera.brand ?? 'ALPR camera'} className="w-full h-full object-cover" />
            </a>
          ) : (
            <div className="w-full h-full bg-accent/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </div>
          )}
        </div>
        <div>
          <h3 className="font-display font-semibold text-white text-base">ALPR Camera</h3>
          <p className="text-xs text-dark-400">ID: {camera.osmId}</p>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {camera.operator && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Operated by</span>
            <span className="text-white font-medium truncate max-w-[120px]">{camera.operator}</span>
          </div>
        )}

        {camera.brand && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Made by</span>
            <span className="text-dark-200 truncate max-w-[140px]">{camera.brand}</span>
          </div>
        )}

        {camera.directionCardinal && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Direction</span>
            <span className="text-dark-200">{camera.directionCardinal}</span>
          </div>
        )}

        {camera.surveillanceZone && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Zone</span>
            <span className="text-dark-200 capitalize">{camera.surveillanceZone}</span>
          </div>
        )}

        {camera.mountType && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Mount</span>
            <span className="text-dark-200 capitalize">{camera.mountType.replace('_', ' ')}</span>
          </div>
        )}

        <div className="flex justify-between gap-4">
          <span className="text-dark-400">Coords</span>
          <span className="text-dark-300 font-mono text-xs">
            {camera.lat.toFixed(5)}, {camera.lon.toFixed(5)}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mt-4 pt-3 border-t border-dark-600">
        <a
          href={osmUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 px-3 py-2 text-xs text-center bg-dark-600 hover:bg-dark-500 text-dark-200 rounded-lg transition-colors font-medium"
        >
          View OSM
        </a>
      </div>
    </div>
  );
}

