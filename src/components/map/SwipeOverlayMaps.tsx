import { useEffect, useRef, useState, type RefObject } from 'react';
import Map, { type MapRef } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { swipeClipInsets } from '../../utils/swipeFilter';
import { tilesTransformRequest } from '../../services/cameraTilesService';
import { CameraTileLayers } from './layers/CameraTileLayers';
import { FlockLeakLayers } from './layers/FlockLeakLayers';

/** No basemap, no background: the overlay draws only its point layers. */
const EMPTY_STYLE: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [] };

interface SwipeOverlayMapsProps {
  mainMapRef: RefObject<MapRef>;
  osmRef: RefObject<MapRef>;
  flockRef: RefObject<MapRef>;
  osmSourceUrl: string;
  osmFilter?: FilterSpecification;
  flockSourceUrl: string;
  initialCenter: { lng: number; lat: number };
  initialZoom: number;
}

/**
 * The Swipe view: two transparent, non-interactive maps over the basemap,
 * one with the OSM camera layer and one with the Flock layer, locked to the
 * main map's camera on every move and clipped by CSS to their side of the
 * divider. The divider paints from a store subscription with direct DOM
 * writes, so a drag never touches React or MapLibre.
 */
export function SwipeOverlayMaps({
  mainMapRef,
  osmRef,
  flockRef,
  osmSourceUrl,
  osmFilter,
  flockSourceUrl,
  initialCenter,
  initialZoom,
}: SwipeOverlayMapsProps) {
  const osmWrap = useRef<HTMLDivElement>(null);
  const flockWrap = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(0);

  // Clip from the store, no commits.
  useEffect(() => {
    const paint = (d: number) => {
      const { osm, flock } = swipeClipInsets(d);
      if (osmWrap.current) osmWrap.current.style.clipPath = osm;
      if (flockWrap.current) flockWrap.current.style.clipPath = flock;
    };
    paint(useFlockLeakStore.getState().divider);
    return useFlockLeakStore.subscribe((s, prev) => {
      if (s.divider !== prev.divider) paint(s.divider);
    });
  }, []);

  // Camera lock: follow the main map on every move (and once on mount).
  useEffect(() => {
    const main = mainMapRef.current?.getMap();
    if (!main) return;
    const sync = () => {
      const center = main.getCenter();
      const zoom = main.getZoom();
      const bearing = main.getBearing();
      const pitch = main.getPitch();
      for (const ref of [osmRef, flockRef]) {
        const m = ref.current?.getMap();
        if (m) m.jumpTo({ center, zoom, bearing, pitch });
      }
    };
    main.on('move', sync);
    sync();
    return () => {
      main.off('move', sync);
    };
  }, [mainMapRef, osmRef, flockRef, loaded]);

  const common = {
    initialViewState: { longitude: initialCenter.lng, latitude: initialCenter.lat, zoom: initialZoom, bearing: 0, pitch: 0 },
    style: { width: '100%', height: '100%', background: 'transparent' },
    mapStyle: EMPTY_STYLE,
    interactive: false,
    attributionControl: false,
    transformRequest: tilesTransformRequest,
    onLoad: () => setLoaded((n) => n + 1),
  } as const;

  return (
    <>
      <div ref={osmWrap} className="swipe-overlay absolute inset-0 pointer-events-none" aria-hidden="true">
        <Map ref={osmRef} {...common}>
          <CameraTileLayers sourceUrl={osmSourceUrl} filter={osmFilter} visible cones={false} />
        </Map>
      </div>
      <div ref={flockWrap} className="swipe-overlay absolute inset-0 pointer-events-none" aria-hidden="true">
        <Map ref={flockRef} {...common}>
          <FlockLeakLayers sourceUrl={flockSourceUrl} visible />
        </Map>
      </div>
    </>
  );
}
