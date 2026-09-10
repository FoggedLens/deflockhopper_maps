import { Fragment, useEffect, useRef } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { useAppModeStore } from '../../../store';
import { useBoundaryStore, type BoundaryInfo } from '../../../store/boundaryStore';
import type { MapTileStyleId } from '../../../store/appModeStore';
import { useTilesHostStore } from '../../../store/tilesHostStore';
import {
  boundaryTileJsonUrl,
  BOUNDARY_TILES_MAXZOOM,
  BOUNDARY_LEVEL_MINZOOM,
  BOUNDARY_PROMOTE_ID,
  BOUNDARY_LEVELS,
  type BoundaryLevel,
} from '../../../services/boundaryTilesService';

/** Anchor: keep boundaries beneath the camera marks (glow is the lowest
 *  camera layer, always mounted in map mode). Cameras stay on top. */
const CAMERA_BOTTOM_LAYER = 'camera-tile-glow';

const SOURCE_ID = 'boundaries-us';

/** Line color/width/opacity per level, keyed by basemap theme so outlines
 *  read as subtle context on both grounds. Larger areas get bolder lines. */
const LINE_STYLE: Record<
  BoundaryLevel,
  { color: Record<MapTileStyleId, string>; width: number; opacity: number }
> = {
  states: {
    color: { dark: '#cbd5e1', light: '#334155' },
    width: 2,
    opacity: 0.75,
  },
  counties: {
    color: { dark: '#94a3b8', light: '#475569' },
    width: 1.2,
    opacity: 0.6,
  },
  municipalities: {
    color: { dark: '#94a3b8', light: '#64748b' },
    width: 0.8,
    opacity: 0.5,
  },
};

/** Subtle fill; lifts on hover so the pointed-at shape reads clearly. */
const FILL_OPACITY = 0.07;
const FILL_OPACITY_HOVER = 0.22;

/** Highlight color for the hovered outline — neutral, so it never reads as a
 *  camera (which are blue). */
const HOVER_LINE: Record<MapTileStyleId, string> = {
  dark: '#ffffff',
  light: '#0f172a',
};

const FILL_LAYER_IDS = BOUNDARY_LEVELS.map((l) => `boundary-${l}-fill`);
const levelFromLayerId = (id: string): BoundaryLevel | null => {
  const m = /^boundary-(states|counties|municipalities)-fill$/.exec(id);
  return m ? (m[1] as BoundaryLevel) : null;
};

/** Build the identity card fields from a tile feature's properties. */
function toInfo(level: BoundaryLevel, props: Record<string, unknown>): BoundaryInfo {
  const s = (v: unknown) => (v == null ? undefined : String(v));
  if (level === 'states') return { level, name: s(props.name) ?? '', abbrev: s(props.abbrev) };
  if (level === 'counties') return { level, name: s(props.name) ?? '', state: s(props.state) };
  return {
    level,
    name: s(props.name) ?? '',
    type: s(props.type),
    county: props.county == null ? null : String(props.county),
    state: s(props.state),
  };
}

export function BoundaryOverlayLayers() {
  const { current: mapRef } = useMap();
  const levels = useBoundaryStore((s) => s.levels);
  const anyOn = useBoundaryStore((s) => s.anyOn);
  const theme = useAppModeStore((s) => s.mapTileStyle);
  // Remount the source against the backup host after a tile-host failover.
  const tilesEpoch = useTilesHostStore((s) => s.epoch);

  // Track the currently-hovered feature so we can clear its highlight state.
  const hovered = useRef<{ level: BoundaryLevel; id: string | number } | null>(null);

  // Hover highlight + hover/click identification. Uses feature-state (promoteId
  // makes fips the feature id) and layer-scoped map events so nothing else in
  // the map wiring has to change.
  useEffect(() => {
    const mapgl = mapRef?.getMap();
    if (!mapgl || !anyOn) return;

    const { setHoverInfo, setSelected } = useBoundaryStore.getState();

    const clearHover = () => {
      if (hovered.current) {
        try {
          mapgl.setFeatureState(
            { source: SOURCE_ID, sourceLayer: hovered.current.level, id: hovered.current.id },
            { hover: false },
          );
        } catch { /* source/layer may be gone */ }
        hovered.current = null;
      }
      setHoverInfo(null);
    };

    const onMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const level = f && levelFromLayerId(f.layer.id);
      const id = f?.id ?? (f?.properties?.fips as string | undefined);
      if (!f || !level || id == null) return;
      if (hovered.current && hovered.current.level === level && hovered.current.id === id) return;
      // Clear the previous highlight, set the new one.
      if (hovered.current) {
        try {
          mapgl.setFeatureState(
            { source: SOURCE_ID, sourceLayer: hovered.current.level, id: hovered.current.id },
            { hover: false },
          );
        } catch { /* not ready */ }
      }
      hovered.current = { level, id };
      try {
        mapgl.setFeatureState({ source: SOURCE_ID, sourceLayer: level, id }, { hover: true });
      } catch { /* not ready */ }
      setHoverInfo(toInfo(level, f.properties ?? {}));
    };

    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const level = f && levelFromLayerId(f.layer.id);
      if (!f || !level) return;
      setSelected(toInfo(level, f.properties ?? {}));
    };

    mapgl.on('mousemove', FILL_LAYER_IDS, onMove);
    mapgl.on('mouseleave', FILL_LAYER_IDS, clearHover);
    mapgl.on('click', FILL_LAYER_IDS, onClick);
    return () => {
      clearHover();
      mapgl.off('mousemove', FILL_LAYER_IDS, onMove);
      mapgl.off('mouseleave', FILL_LAYER_IDS, clearHover);
      mapgl.off('click', FILL_LAYER_IDS, onClick);
    };
  }, [mapRef, anyOn]);

  // No level on → don't mount the source at all (zero tile requests).
  if (!anyOn) return null;

  return (
    <Source
      key={tilesEpoch}
      id={SOURCE_ID}
      type="vector"
      url={boundaryTileJsonUrl()}
      maxzoom={BOUNDARY_TILES_MAXZOOM}
      promoteId={BOUNDARY_PROMOTE_ID}
    >
      {BOUNDARY_LEVELS.map((level) => {
        const visibility: 'visible' | 'none' = levels[level] ? 'visible' : 'none';
        const line = LINE_STYLE[level];
        const minzoom = BOUNDARY_LEVEL_MINZOOM[level];
        return (
          <Fragment key={level}>
            <Layer
              id={`boundary-${level}-fill`}
              type="fill"
              source={SOURCE_ID}
              source-layer={level}
              minzoom={minzoom}
              beforeId={CAMERA_BOTTOM_LAYER}
              layout={{ visibility }}
              paint={{
                'fill-color': line.color[theme],
                'fill-opacity': [
                  'case',
                  ['boolean', ['feature-state', 'hover'], false],
                  FILL_OPACITY_HOVER,
                  FILL_OPACITY,
                ],
              }}
            />
            <Layer
              id={`boundary-${level}-line`}
              type="line"
              source={SOURCE_ID}
              source-layer={level}
              minzoom={minzoom}
              beforeId={CAMERA_BOTTOM_LAYER}
              layout={{ visibility }}
              paint={{
                'line-color': [
                  'case',
                  ['boolean', ['feature-state', 'hover'], false],
                  HOVER_LINE[theme],
                  line.color[theme],
                ],
                'line-width': [
                  'case',
                  ['boolean', ['feature-state', 'hover'], false],
                  line.width + 1.5,
                  line.width,
                ],
                'line-opacity': [
                  'case',
                  ['boolean', ['feature-state', 'hover'], false],
                  1,
                  line.opacity,
                ],
              }}
            />
          </Fragment>
        );
      })}
    </Source>
  );
}
