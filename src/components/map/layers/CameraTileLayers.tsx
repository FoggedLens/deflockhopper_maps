import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import {
  CAMERA_TILES_SOURCE_LAYER,
  CAMERA_TILES_MAXZOOM,
  CAMERA_POINTS_MINZOOM,
} from '../../../services/cameraTilesService';
import { createDirectionCone, parseDirections } from './cameraGeometry';
import { CAMERA_POINT_FILL } from './cameraColors';
import { useAppModeStore } from '../../../store';

/** Zoom where cones start being built (slightly before their minzoom 10). */
const CONE_BUILD_MINZOOM = 9.5;
const CONE_FEATURE_CAP = 4000;
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Camera rendering straight from vector tiles — no client-side dataset.
 * Three zoom bands, one source:
 *  z0–9:  density dots (tiny, semi-transparent; overlaps read as density)
 *  z9–10: dots crossfade out, full camera points fade in
 *  z10+:  direction cones (built client-side from tile attributes)
 *
 * The hourly archives carry full attributes from z9, so the identity handoff
 * (points, popups, cones) starts two zooms earlier than the original z11–12
 * design — approved from the 2026-07-18 side-by-side prototype.
 *
 * A zoom-scaled glow underlies both marks from z8 up. It carries the visual
 * mass continuously through the z9–10 handoff, so the dot→point swap reads as
 * a zoom rather than a pop. Starts at z8 (not z0): blurred circles are
 * fill-rate bound, and glowing ~114k features at country zoom would blob
 * dense metros into featureless mass.
 */
function buildLayerSpecs(
  sourceId: string,
  idSuffix: string,
  filter: FilterSpecification | undefined,
  pointFill: string
) {
  const withFilter = (spec: maplibregl.LayerSpecification) =>
    filter ? { ...spec, filter } : spec;

  const glowLayer: maplibregl.LayerSpecification = withFilter({
    id: `camera-tile-glow${idSuffix}`,
    type: 'circle',
    source: sourceId,
    'source-layer': CAMERA_TILES_SOURCE_LAYER,
    minzoom: 8,
    paint: {
      'circle-color': '#4DA6FF',
      // Held subtle through z9–11.5: thousands of overlapping translucent
      // halos re-composite every frame while zooming over a dense metro, and
      // the resulting shimmer was measured identically on the tile and
      // geojson paths (2026-07-18) — it scales with halo coverage, not data
      // source. Blooms to the full master r=16 by z12, where markers have
      // separated and the field renders clean.
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        8, 2,
        9, 5,
        10, 9,
        11, 10,
        12, 16,
      ],
      // Low in the dense band, then up to the full master-strength halo
      // (0.4) at z12 — the bright glow is the signature DeFlock look,
      // restored 2026-07-18.
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        8, 0,
        9, 0.15,
        11, 0.15,
        12, 0.4,
      ],
      'circle-blur': 0.5,
      'circle-stroke-width': 0,
    },
  });

  const dotLayer: maplibregl.LayerSpecification = withFilter({
    id: `camera-tile-dots${idSuffix}`,
    type: 'circle',
    source: sourceId,
    'source-layer': CAMERA_TILES_SOURCE_LAYER,
    maxzoom: 10,
    paint: {
      'circle-color': '#4DA6FF',
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        0, 1,
        4, 1.5,
        7, 2.2,
        8, 3.5,
        9.9, 5,
      ],
      // Holds full strength until the points layer has fully faded in (z9.6),
      // THEN drops out. Fading both marks simultaneously leaves every mark
      // ~30% transparent mid-band — the basemap's olive land bleeds through
      // the cyan and the whole metro reads as murky green during the handoff.
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.5,
        6, 0.6,
        8.5, 0.75,
        9.6, 0.75,
        10, 0,
      ],
      'circle-stroke-width': 0,
    },
  });

  const pointLayer: maplibregl.LayerSpecification = withFilter({
    id: `camera-tile-points${idSuffix}`,
    type: 'circle',
    source: sourceId,
    'source-layer': CAMERA_TILES_SOURCE_LAYER,
    // Shared with the viewport count, which queries dots below this zoom and
    // points at/above it — the two layers overlap on [9, 10).
    minzoom: CAMERA_POINTS_MINZOOM,
    paint: {
      // Staggered handoff: the point fades in FIRST (z9–9.6, below) in the
      // dots' blue at near-dot size, THEN the hue deepens and the ring widens
      // together over z9.6–10.4. Sequencing the ramps keeps any single wheel
      // kick from moving opacity, hue, ring, and glow all at once — the
      // everything-at-once version read as a jarring pop. The settled fill is
      // theme-keyed (see cameraColors.ts) so the dot reads the same blue on
      // both basemaps.
      'circle-color': ['interpolate', ['linear'], ['zoom'], 9.6, '#4DA6FF', 10.4, pointFill],
      // Enters at exactly the dot's z9 radius (4.3) and grows into r=6, which
      // it holds past z10. The stroke widens 0→2 on the later z9.6–10.4 leg
      // (with the hue morph above): at full width from the start it would
      // bolt 2px of outer radius on the instant the point appears, which is
      // a pop of its own.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4.3, 10, 6],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9.6, 0, 10.4, 2],
      // Light near-white ring on a dark fill — the signature master look
      // (glow + dark core + bright ring), restored 2026-07-18.
      'circle-stroke-color': '#93CBFF',
      // Fully opaque by z9.6 — the dots above hold 0.75 until then, so the
      // combined mark never goes translucent enough for the basemap to bleed
      // through mid-handoff (the "green murk" failure mode).
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 9.6, 1],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 9.6, 1],
    },
  });

  const coneLayer: maplibregl.LayerSpecification = {
    id: `camera-tile-cones${idSuffix}`,
    type: 'fill',
    source: `camera-tile-cones${idSuffix}`,
    minzoom: 10,
    paint: { 'fill-color': '#4DA6FF', 'fill-opacity': 0.35 },
  };

  const coneOutlineLayer: maplibregl.LayerSpecification = {
    id: `camera-tile-cones-outline${idSuffix}`,
    type: 'line',
    source: `camera-tile-cones${idSuffix}`,
    minzoom: 10,
    paint: { 'line-color': '#0080BC', 'line-width': 2, 'line-opacity': 0.7 },
  };

  return { glowLayer, dotLayer, pointLayer, coneLayer, coneOutlineLayer };
}

interface CameraTileLayersProps {
  visible: boolean;
  /** Vector source id — must be unique per instance. */
  sourceId?: string;
  /** TileJSON URL on the active tile host (never pmtiles). The parent owns
   *  host selection, so this is required rather than defaulted here. */
  sourceUrl: string;
  /** Appended to every layer id — '' for the default instance. */
  idSuffix?: string;
  /** Attribute filter (filter tileset codes). Applied to glow/dots/points
   *  declaratively and to cone building via querySourceFeatures. */
  filter?: FilterSpecification;
}

export function CameraTileLayers({
  visible,
  sourceId = 'camera-tiles',
  sourceUrl,
  idSuffix = '',
  filter,
}: CameraTileLayersProps) {
  const { current: mapInstance } = useMap();
  const [conesData, setConesData] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);
  const debounceRef = useRef<number | null>(null);
  const mapTileStyle = useAppModeStore((s) => s.mapTileStyle);

  const specs = useMemo(
    () => buildLayerSpecs(sourceId, idSuffix, filter, CAMERA_POINT_FILL[mapTileStyle]),
    [sourceId, idSuffix, filter, mapTileStyle]
  );

  const rebuildCones = useCallback(() => {
    const map = mapInstance?.getMap();
    if (!map) return;
    if (!visible || map.getZoom() < CONE_BUILD_MINZOOM) {
      setConesData(prev => (prev.features.length === 0 ? prev : EMPTY_FC));
      return;
    }
    if (!map.getSource(sourceId)) return;

    const rendered = map.querySourceFeatures(sourceId, {
      sourceLayer: CAMERA_TILES_SOURCE_LAYER,
      filter,
    });

    // Dedupe by osmId (present at z9+) — zero-buffer tiles shouldn't duplicate
    // features, but querySourceFeatures can still return one per tile+zoom copy
    const seen = new Set<number>();
    const features: GeoJSON.Feature[] = [];
    for (const f of rendered) {
      const props = f.properties;
      if (!props || props.osmId == null || seen.has(props.osmId)) continue;
      seen.add(props.osmId);
      const bearings = parseDirections(
        props.direction as number | undefined,
        props.directions
      );
      if (bearings.length === 0) continue;
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
      for (const bearing of bearings) {
        features.push(createDirectionCone(lon, lat, bearing));
        if (features.length >= CONE_FEATURE_CAP) break;
      }
      if (features.length >= CONE_FEATURE_CAP) break;
    }
    setConesData({ type: 'FeatureCollection', features });
  }, [mapInstance, visible, sourceId, filter]);

  // Rebuild cones when tiles finish loading or the camera stops moving
  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;

    const schedule = () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(rebuildCones, 200);
    };
    const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId === sourceId && e.isSourceLoaded) schedule();
    };

    map.on('moveend', schedule);
    map.on('sourcedata', onSourceData);
    schedule();

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      map.off('moveend', schedule);
      map.off('sourcedata', onSourceData);
    };
  }, [mapInstance, rebuildCones, sourceId]);

  const visibility: 'visible' | 'none' = visible ? 'visible' : 'none';

  return (
    <>
      <Source id={sourceId} type="vector" url={sourceUrl} maxzoom={CAMERA_TILES_MAXZOOM}>
        {/* Glow first — document order is paint order, and it must sit beneath both marks */}
        <Layer {...specs.glowLayer} layout={{ visibility }} />
        <Layer {...specs.dotLayer} layout={{ visibility }} />
        <Layer {...specs.pointLayer} layout={{ visibility }} />
      </Source>
      <Source id={`camera-tile-cones${idSuffix}`} type="geojson" data={conesData}>
        {/* Anchored beneath the glow so cones never cover the camera marks */}
        <Layer {...specs.coneLayer} beforeId={`camera-tile-glow${idSuffix}`} layout={{ visibility }} />
        <Layer {...specs.coneOutlineLayer} beforeId={`camera-tile-glow${idSuffix}`} layout={{ visibility }} />
      </Source>
    </>
  );
}
