import { useRef, useCallback, useEffect, useState, useMemo, memo, useImperativeHandle, forwardRef } from 'react';
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
import { useDensityStore } from '../../store/densityStore';
import type { DensityFeatureProperties } from '../../types';

import type { ALPRCamera, Location } from '../../types';

// Expose map ready state to parent components
export interface MapLibreViewHandle {
  isMarkersReady: boolean;
  forceRemount: () => void;
}

import { layers as pmLayers, namedFlavor } from '@protomaps/basemaps';

const TILES_URL = 'https://tiles.dontgetflocked.com';

// Map our style IDs to Protomaps flavor names (must match R2 sprites at /sprites/v4/{flavor})
const FLAVOR_MAP: Record<MapTileStyleId, string> = {
  'dark':               'dark',
  'dark-nolabels':      'dark',
  'light':              'light',
  'light-nolabels':     'light',
  'white':              'white',
  'white-nolabels':     'white',
  'black':              'black',
  'black-nolabels':     'black',
  'grayscale':          'grayscale',
  'grayscale-nolabels': 'grayscale',
};


function buildMapStyle(tileStyleId: MapTileStyleId): maplibregl.StyleSpecification {
  const flavorName = FLAVOR_MAP[tileStyleId];
  const isNoLabels = tileStyleId.endsWith('-nolabels');

  let mapLayers = pmLayers('protomaps', namedFlavor(flavorName), { lang: 'en' });

  if (isNoLabels) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapLayers = mapLayers.filter((l: any) => l.type !== 'symbol');
  }

  return {
    version: 8,
    glyphs: `${TILES_URL}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${TILES_URL}/sprites/v4/${flavorName}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `${TILES_URL}/planet.json`,
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
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [cursor, setCursor] = useState<string>('');
  const lastFlyToRef = useRef<number>(0);
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
  const getCamerasInBounds = useCameraStore(s => s.getCamerasInBounds);
  const dataVersion = useCameraStore(s => s.dataVersion);
  const appMode = useAppModeStore(s => s.appMode);
  const mapVisualization = useAppModeStore(s => s.mapVisualization);
  const heatmapSettings = useAppModeStore(s => s.heatmapSettings);
  const dotDensitySettings = useAppModeStore(s => s.dotDensitySettings);
  const mapTileStyle = useAppModeStore(s => s.mapTileStyle);
  const isTimelineActive = appMode === 'explore';
  const mapStyle = useMemo(() => buildMapStyle(mapTileStyle), [mapTileStyle]);
  const isExploreMode = appMode === 'explore';
  const isDensityMode = appMode === 'density';
  const isNetworkMode = appMode === 'network';
  const isMapMode = appMode === 'map';
  const mapModeViz = useMapModeStore(s => s.visualization);
  const activeView = useMapModeStore(s => s.activeView);
  const setActiveView = useMapModeStore(s => s.setActiveView);
  const isHeatmapMode = isExploreMode && mapVisualization === 'heatmap';
  const isDotsMode = isExploreMode && mapVisualization === 'dots';
  // Only render camera markers + direction cones when needed.
  // In map-mode auto, both heatmap & markers are mounted — crossfade opacity handles
  // the transition seamlessly. For explicit heatmap/clusters/individual selections,
  // only the chosen layer is shown so they never overlap.
  // In explore mode, auto-show markers when zoomed past 13 (heatmap crossfades out 13-14),
  // or when the user explicitly toggles "Show Markers" at any zoom.
  // In density mode, hide camera markers entirely to keep choropleth clean.
  const isMapModeAuto = isMapMode && mapModeViz === 'auto';
  const showCameraMarkers = !isNetworkMode && !isDensityMode && (
    appMode === 'route'
    || isMapModeAuto
    || (isMapMode && activeView !== 'heatmap')
    || (isHeatmapMode && (heatmapSettings.showMarkers || zoom >= 13))
    || (isDotsMode && (dotDensitySettings.showMarkers || zoom >= 13))
  );
  // Expose handle to parent
  useImperativeHandle(ref, () => ({
    isMarkersReady: markersReady,
    forceRemount: () => forceUpdate(n => n + 1),
  }), [markersReady]);
  const { origin, destination, normalRoute, avoidanceRoute, activeRoute, pickingLocation, setPickedLocation, cancelPickingLocation } = useRouteStore();

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
    const bounds = map.getBounds();
    
    // Get visible cameras for bounds update (count is now shown in MapPage header)
    getCamerasInBounds(
      bounds.getNorth(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getWest()
    );
  }, [getCamerasInBounds]);

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
  
  // Notify parent when markers are ready
  useEffect(() => {
    onMarkersReady?.(markersReady);
  }, [markersReady, onMarkersReady]);

  // --- Timeline filter handler (imperative setFilter, no GeoJSON rebuild) ---
  const TIMELINE_LAYERS = useMemo(() => ['unclustered-point', 'unclustered-glow', 'pulse-ring-outer', 'pulse-ring-inner'], []);
  // Cache the last cutoff to skip redundant setFilter calls (same date = same filter).
  // With 71 Protomaps vector layers, every setFilter triggers an expensive render cycle.
  const lastCutoffRef = useRef<number>(0);

  const handleTimelineTick = useCallback((dateStr: string) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Read viz state imperatively (no dependency needed — keeps callback stable)
    const { mapVisualization, appMode, heatmapSettings, dotDensitySettings } = useAppModeStore.getState();
    const isExplore = appMode === 'explore';
    const isHeatmap = isExplore && mapVisualization === 'heatmap';
    const isDots = isExplore && mapVisualization === 'dots';
    const markersVisible = !isExplore
      || (isHeatmap && heatmapSettings.showMarkers)
      || (isDots && dotDensitySettings.showMarkers);

    // If date is at or past the max camera date, clear filters (every point passes)
    const { timelineMaxDay } = useCameraStore.getState();
    if (dateStr >= timelineMaxDay) {
      if (lastCutoffRef.current === Infinity) return; // already cleared
      lastCutoffRef.current = Infinity;
      if (markersVisible) {
        const defaultUnclustered: maplibregl.FilterSpecification = ['!', ['has', 'point_count']];
        for (const layerId of TIMELINE_LAYERS) {
          if (map.getLayer(layerId)) map.setFilter(layerId, defaultUnclustered, { validate: false });
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

    // Only filter layers that are actually visible — avoids expensive
    // Supercluster re-evaluation on hidden clustered layers
    if (markersVisible) {
      const timelineFilter: maplibregl.FilterSpecification = [
        'all',
        ['!', ['has', 'point_count']],
        vizFilter,
      ];
      for (const layerId of TIMELINE_LAYERS) {
        if (map.getLayer(layerId)) map.setFilter(layerId, timelineFilter, { validate: false });
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
        const defaultFilter: maplibregl.FilterSpecification = ['!', ['has', 'point_count']];
        for (const layerId of TIMELINE_LAYERS) {
          if (map.getLayer(layerId)) map.setFilter(layerId, defaultFilter);
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
  }, [mapLoaded, isTimelineActive, handleTimelineTick]);

  // Symbol layer visibility is controlled entirely by the labels toggle
  // (mapTileStyle nolabels variants filter them out in buildMapStyle).
  // No need to programmatically hide them per mode — the 13 symbol layers
  // have negligible GPU cost and hiding them confused users entering via /timeline.

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



  // Handle map move - batch center, zoom, and bounds in a single store update
  const onMove = useCallback((evt: ViewStateChangeEvent) => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
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

    updateVisibleCameras();
  }, [setViewState, updateVisibleCameras]);

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

  // Handle cluster click - zoom in or pick location
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

    const clusterId = feature.properties?.cluster_id;
    
    if (clusterId) {
      // It's a cluster - zoom into it
      const map = mapRef.current.getMap();
      const source = map.getSource('cameras') as maplibregl.GeoJSONSource;
      
      source.getClusterExpansionZoom(clusterId).then((zoomLevel: number) => {
        const geometry = feature.geometry as GeoJSON.Point;
        map.easeTo({
          center: geometry.coordinates as [number, number],
          zoom: zoomLevel,
          duration: 500,
        });
      }).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[MapLibre] Cluster expansion failed:', error);
        }
      });
    } else {
      // It's an unclustered point - show popup
      const props = feature.properties;
      if (props) {
        const camera: ALPRCamera = {
          osmId: props.osmId,
          osmType: props.osmType as 'node' | 'way',
          lat: props.lat,
          lon: props.lon,
          operator: props.operator || undefined,
          brand: props.brand || undefined,
          direction: props.direction ?? undefined,
          directionCardinal: props.directionCardinal || undefined,
          surveillanceZone: props.surveillanceZone || undefined,
          mountType: props.mountType || undefined,
          ref: props.ref || undefined,
          startDate: props.startDate || undefined,
        };
        
        setPopupInfo({
          longitude: props.lon,
          latitude: props.lat,
          camera,
        });
      }
    }
  }, [pickingLocation, setPickedLocation, isDensityMode, isNetworkMode]);

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

      mapRef.current.fitBounds(
        [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
        { padding: 80, duration: 1000 }
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
      onMove={onMove}
      onLoad={onLoad}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      cursor={cursor}
      interactiveLayerIds={isNetworkMode
        ? []
        : isDensityMode
          ? ['density-states-fill', 'density-counties-fill', 'density-states-extrusion', 'density-counties-extrusion']
          : showCameraMarkers
            ? (isMapMode && activeView === 'individual')
              ? ['unclustered-point']
              : ['clusters', 'unclustered-point']
            : []}
      attributionControl={{}}
      // Removed reuseMaps to avoid stale reused instances
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <GeolocateControl position="bottom-right" />

      {/* Explore visualization layers */}
      {isHeatmapMode && <HeatmapLayers />}
      {isMapMode && <HeatmapLayers visible={mapModeViz === 'auto' || activeView === 'heatmap'} />}
      {isDotsMode && <DotDensityLayers />}
      {isDensityMode && <DensityLayers />}
      {isNetworkMode && <NetworkLayers />}
      {isMapMode && <BoundaryOverlayLayers />}


      {/* Direction cones + Camera markers — always mounted, visibility toggled.
          In map-mode auto, crossfadeZoom makes markers fade in at zoom 9-11
          while the heatmap fades out 9-14, giving a seamless GPU-driven transition. */}
      <CameraMarkerLayers
        cameras={cameraSource}
        visible={showCameraMarkers}
        clustered={isMapModeAuto ? false : (!isMapMode || activeView !== 'individual')}
        mapLoaded={mapLoaded}
        mapRef={mapRef}
        crossfadeZoom={isMapModeAuto ? 9 : undefined}
      />

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
          {/* Privacy route - solid blue (rendered first/underneath) */}
          <Layer
            id="route-line-privacy"
            type="line"
            filter={['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'type'], 'avoidance']]}
            paint={{
              'line-color': '#0080BC', // Blue for privacy route
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

      {/* Camera count is now shown in the header on mobile and CameraStats on desktop */}
      
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
                Tap to set {pickingLocation === 'origin' ? 'start' : 'destination'}
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

// Popup content component - Dark theme
function CameraPopupContent({ camera }: { camera: ALPRCamera }) {
  const osmUrl = `https://www.openstreetmap.org/${camera.osmType}/${camera.osmId}`;

  return (
    <div className="min-w-[220px] p-4">
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-dark-600">
        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
          <svg
            className="w-5 h-5 text-accent"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </div>
        <div>
          <h3 className="font-display font-semibold text-white text-sm">ALPR Camera</h3>
          <p className="text-xs text-dark-400">ID: {camera.osmId}</p>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {camera.operator && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Operator</span>
            <span className="text-white font-medium truncate max-w-[120px]">{camera.operator}</span>
          </div>
        )}

        {camera.brand && (
          <div className="flex justify-between gap-4">
            <span className="text-dark-400">Brand</span>
            <span className="text-dark-200 truncate max-w-[120px]">{camera.brand}</span>
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

