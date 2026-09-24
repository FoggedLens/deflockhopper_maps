import { useEffect, useMemo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import {
  FLOCK_LEAK_SOURCE_ID,
  FLOCK_LEAK_SOURCE_LAYER,
  FLOCK_LEAK_MAXZOOM,
  FLOCK_LEAK_POINTS_MINZOOM,
} from '../../../services/flockLeakTilesService';
import { flockLayerFilter } from '../../../utils/flockLeakFilter';
import { useFlockLeakStore } from '../../../store/flockLeakStore';
import { FLOCK_GROUPS } from '../../../lib/flockInventory';
import { ensureFlockIcons, FLOCK_GROUP_COLOR } from './flockLeakIcons';

export const FLOCK_LEAK_DOTS_LAYER = 'flock-leak-dots';
export const FLOCK_LEAK_POINTS_LAYER = 'flock-leak-points';

/** ['match', ['get','g'], 1, C1, ..., FALLBACK] from the one color table. */
const groupColorExpression = (): unknown[] => [
  'match',
  ['get', 'g'],
  ...FLOCK_GROUPS.flatMap((g) => [g, FLOCK_GROUP_COLOR[g]]),
  '#9ca3af',
];

/** In service above planned above decommissioned where points coincide. */
const STATUS_SORT_KEY = ['-', 5, ['coalesce', ['get', 's'], 4]];

const IS_DECOMMISSIONED = ['==', ['coalesce', ['get', 's'], 4], 3];

/**
 * A zoom-ramped opacity, halved for decommissioned devices (q=3 dimming).
 * MapLibre allows only one zoom-based `step`/`interpolate` subexpression
 * anywhere in an expression tree — not one, but two, even split across
 * `case` branches. Multiplying an interpolate's result by a `case` (the
 * spec's literal expression) trips the same rule from the other side. Both
 * shapes are rejected at style-validation time with no thrown exception,
 * so the layer silently never gets added. The fix: a SINGLE top-level
 * interpolate over zoom, whose per-stop output is a feature-data `case`
 * (data-driven stop values are fine; it's a second zoom curve that isn't).
 */
function zoomOpacityByStatus(stops: number[], decommissionedScale: number): unknown[] {
  const args: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (let i = 0; i < stops.length; i += 2) {
    args.push(stops[i], ['case', IS_DECOMMISSIONED, stops[i + 1] * decommissionedScale, stops[i + 1]]);
  }
  return args;
}

/**
 * The leaked Flock inventory: colored density dots to z10 (one point per
 * location + status + quality in the tiles), typed icons from z9 (one point
 * per device), crossfading over z9 to z10 like the OSM camera layers.
 * Filters come from flockLeakStore; the swipe divider is applied
 * imperatively by useSwipeFilters on top.
 */
function buildSpecs(filter: FilterSpecification | undefined) {
  const withFilter = <T extends maplibregl.LayerSpecification>(spec: T): T =>
    filter ? { ...spec, filter } : spec;

  const dots: maplibregl.CircleLayerSpecification = withFilter({
    id: FLOCK_LEAK_DOTS_LAYER,
    type: 'circle',
    source: FLOCK_LEAK_SOURCE_ID,
    'source-layer': FLOCK_LEAK_SOURCE_LAYER,
    maxzoom: 10,
    layout: {
      'circle-sort-key': STATUS_SORT_KEY as never,
    },
    paint: {
      'circle-color': groupColorExpression() as never,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1.5, 7, 2.2, 8, 3.5, 9.9, 5],
      'circle-opacity': zoomOpacityByStatus([0, 0.5, 6, 0.6, 8.5, 0.75, 9.6, 0.75, 10, 0], 0.5) as never,
      'circle-stroke-width': 0,
    },
  });

  const points: maplibregl.SymbolLayerSpecification = withFilter({
    id: FLOCK_LEAK_POINTS_LAYER,
    type: 'symbol',
    source: FLOCK_LEAK_SOURCE_ID,
    'source-layer': FLOCK_LEAK_SOURCE_LAYER,
    minzoom: FLOCK_LEAK_POINTS_MINZOOM,
    layout: {
      'icon-image': [
        'concat',
        'flock-g',
        ['to-string', ['coalesce', ['get', 'g'], 7]],
        ['case', ['==', ['coalesce', ['get', 's'], 4], 2], '-planned', ''],
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 10, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': STATUS_SORT_KEY as never,
    },
    paint: {
      'icon-opacity': zoomOpacityByStatus([9, 0, 9.6, 1], 0.35) as never,
    },
  });

  return { dots, points };
}

interface FlockLeakLayersProps {
  visible: boolean;
  /** The fixed flock-inventory-v2 TileJSON URL. */
  sourceUrl: string;
}

export function FlockLeakLayers({ visible, sourceUrl }: FlockLeakLayersProps) {
  const { current: mapInstance } = useMap();
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const filter = useMemo(() => flockLayerFilter(groups, statuses, showSuspect), [groups, statuses, showSuspect]);
  const specs = useMemo(() => buildSpecs(filter), [filter]);

  // Icons live in the style; a theme switch (setStyle) drops them. Register
  // up front and again whenever the style asks for one we have not added.
  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;
    ensureFlockIcons(map);
    const onMissing = (e: { id: string }) => {
      if (e.id.startsWith('flock-')) ensureFlockIcons(map);
    };
    map.on('styleimagemissing', onMissing);
    return () => {
      map.off('styleimagemissing', onMissing);
    };
  }, [mapInstance]);

  const visibility: 'visible' | 'none' = visible ? 'visible' : 'none';

  return (
    <Source
      id={FLOCK_LEAK_SOURCE_ID}
      type="vector"
      url={sourceUrl}
      maxzoom={FLOCK_LEAK_MAXZOOM}
      promoteId={{ [FLOCK_LEAK_SOURCE_LAYER]: 'id' }}
    >
      <Layer {...specs.dots} layout={{ ...specs.dots.layout, visibility }} />
      <Layer {...specs.points} layout={{ ...specs.points.layout, visibility }} />
    </Source>
  );
}
