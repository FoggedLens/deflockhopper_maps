import { useEffect, useMemo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import {
  FLOCK_LEAK_SOURCE_ID,
  FLOCK_LEAK_SOURCE_LAYER,
  FLOCK_LEAK_MAXZOOM,
} from '../../../services/flockLeakTilesService';
import { flockLayerFilter } from '../../../utils/flockLeakFilter';
import { useFlockLeakStore } from '../../../store/flockLeakStore';
import { FLOCK_GROUPS } from '../../../lib/flockInventory';
import { ensureFlockIcons, FLOCK_GROUP_COLOR } from './flockLeakIcons';
import { zoomOpacityByStatus } from './flockLeakStyle';
import { buildFlockMarkSpecs, FLOCK_STATUS_SORT_KEY, type FlockMarkMode } from './flockCompareStyle';
import { FLOCK_LEAK_DOTS_LAYER, FLOCK_LAYER_ORDER, layersToRaise } from './flockLeakLayerIds';

/** ['match', ['get','g'], 1, C1, ..., FALLBACK] from the one color table. */
const groupColorExpression = (): unknown[] => [
  'match',
  ['get', 'g'],
  ...FLOCK_GROUPS.flatMap((g) => [g, FLOCK_GROUP_COLOR[g]]),
  '#9ca3af',
];

/**
 * The leaked Flock inventory: colored density dots to z10 (one point per
 * location + status + quality in the tiles), then from z9 the marks from
 * flockCompareStyle (one point per device), crossfading over z9 to z10 like
 * the OSM camera layers. The Flock view and the Swipe view draw the filled
 * marks, Overlay the hollow ones. Filters come from flockLeakStore; the swipe
 * divider is applied by clipping a second instance of this component in a
 * SwipeOverlayMaps overlay, not by any filter here.
 */
function buildDots(filter: FilterSpecification | undefined): maplibregl.CircleLayerSpecification {
  const dots: maplibregl.CircleLayerSpecification = {
    id: FLOCK_LEAK_DOTS_LAYER,
    type: 'circle',
    source: FLOCK_LEAK_SOURCE_ID,
    'source-layer': FLOCK_LEAK_SOURCE_LAYER,
    maxzoom: 10,
    layout: {
      'circle-sort-key': FLOCK_STATUS_SORT_KEY as never,
    },
    paint: {
      'circle-color': groupColorExpression() as never,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1.5, 7, 2.2, 8, 3.5, 9.9, 5],
      'circle-opacity': zoomOpacityByStatus([0, 0.5, 6, 0.6, 8.5, 0.75, 9.6, 0.75, 10, 0], 0.5) as never,
      'circle-stroke-width': 0,
    },
  };
  return filter ? { ...dots, filter } : dots;
}

const withVisibility = (
  spec: maplibregl.LayerSpecification,
  visibility: 'visible' | 'none'
): maplibregl.LayerSpecification =>
  ({ ...spec, layout: { ...(spec.layout ?? {}), visibility } }) as maplibregl.LayerSpecification;

interface FlockLeakLayersProps {
  visible: boolean;
  /** The fixed flock-inventory-v2 TileJSON URL. */
  sourceUrl: string;
  marks?: FlockMarkMode;
}

export function FlockLeakLayers({ visible, sourceUrl, marks = 'filled' }: FlockLeakLayersProps) {
  const { current: mapInstance } = useMap();
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const filter = useMemo(() => flockLayerFilter(groups, statuses, showSuspect), [groups, statuses, showSuspect]);
  const dots = useMemo(() => buildDots(filter), [filter]);
  const markLayers = useMemo(() => buildFlockMarkSpecs(marks, filter), [marks, filter]);

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

  // Keep the Flock marks above the OSM layers whatever the mount order. The
  // filtered OSM tiles mount lazily on the session's first filter, which in
  // Overlay is the compare seed, so they would otherwise land on top of the
  // rings. moveLayer fires styledata again; layersToRaise returns nothing
  // once the order is right, so this settles in one pass.
  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;
    const raise = () => {
      let order: string[];
      try {
        order = map.getLayersOrder();
      } catch {
        return; // style not loaded yet
      }
      for (const id of layersToRaise(order, FLOCK_LAYER_ORDER)) map.moveLayer(id);
    };
    raise();
    map.on('styledata', raise);
    return () => {
      map.off('styledata', raise);
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
      <Layer {...dots} layout={{ ...dots.layout, visibility }} />
      {markLayers.map((l) => (
        <Layer key={l.id} {...withVisibility(l, visibility)} />
      ))}
    </Source>
  );
}
