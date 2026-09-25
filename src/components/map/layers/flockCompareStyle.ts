import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';
import {
  FLOCK_LEAK_SOURCE_ID,
  FLOCK_LEAK_SOURCE_LAYER,
  FLOCK_LEAK_POINTS_MINZOOM,
} from '../../../services/flockLeakTilesService';
import { combineFilters } from '../../../utils/flockLeakFilter';
import type { MapTileStyleId } from '../../../store/appModeStore';
import { zoomOpacityByStatus } from './flockLeakStyle';
import { FLOCK_LEAK_GLOW_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER, FLOCK_LEAK_OTHERS_LAYER, FLOCK_LEAK_MINOR_LAYER } from './flockLeakLayerIds';

/**
 * Flock marks from z9 (approved 2026-09-24 from Houston screenshots). Plate
 * readers use the OSM camera mark's radius family in red so the two datasets
 * read as one system; every other group keeps its own icon.
 *  - filled (the Flock view): the fogged
 *    lens (glow, dark core, light ring) at full opacity; other groups as
 *    their filled icons.
 *  - hollow (Overlay, the OSM comparison): the lens with its core removed, so a blue OSM dot
 *    inside a red ring is "both" and a lone ring is "Flock knows, OSM does
 *    not"; other groups as outlines (Raven keeps its dot). Nothing is hidden.
 * Planned is a dashed variant; decommissioned is the same mark dimmed.
 * Pure: no MapLibre runtime, validated against the style spec in tests.
 */
export type FlockMarkMode = 'filled' | 'hollow';

export const FLOCK_PLANNED_ICON = 'flock-planned-ring';
/** The Flock view's planned plate reader: the dashed ring around an opaque
 *  core in the basemap's ground color, so it still reads as an open ring
 *  but hides a compute box stacked on the same pole (drawn beneath), which
 *  the transparent ring let show through. Ground colors sampled from the
 *  street-zoom basemaps on 2026-09-24. */
export const flockPlannedLensId = (theme: MapTileStyleId): string => `flock-planned-lens-${theme}`;
export const FLOCK_PLANNED_CORE: Record<MapTileStyleId, string> = { dark: '#1f1f1f', light: '#e2dfda' };

/** The OSM lens hues (glow / core / ring) shifted to red. Change HERE only. */
export const FLOCK_COMPARE_COLOR = {
  glow: '#f87171',
  core: '#dc2626',
  ring: '#fca5a5',
  line: '#ef4444',
} as const;

const DECOMMISSIONED_SCALE = 0.35;
const STATUS = ['coalesce', ['get', 's'], 4];
const IS_PLANNED = ['==', STATUS, 2] as unknown as FilterSpecification;
const NOT_PLANNED = ['!=', STATUS, 2] as unknown as FilterSpecification;
const IS_ALPR = ['==', ['get', 'g'], 1] as unknown as FilterSpecification;
const NOT_ALPR = ['!=', ['get', 'g'], 1] as unknown as FilterSpecification;
/** Trailers (6) and components (7): the Other class. */
const MINOR_GROUPS = ['in', ['get', 'g'], ['literal', [6, 7]]];
const IS_MINOR = MINOR_GROUPS as unknown as FilterSpecification;
const NOT_MINOR = ['!', MINOR_GROUPS] as unknown as FilterSpecification;
/** Other-class icons draw at this share of the full icon size: support
 *  hardware reads below the sensors. */
const MINOR_ICON_SCALE = 0.8;

/** In service above planned above decommissioned where points coincide. */
export const FLOCK_STATUS_SORT_KEY = ['-', 5, STATUS];

/** 'flock-g{g}' + '-planned' when planned, else `suffix` ('' solid, '-hollow'). */
export const groupIconExpression = (suffix: '' | '-hollow'): unknown[] => [
  'concat',
  'flock-g',
  ['to-string', ['coalesce', ['get', 'g'], 7]],
  ['case', ['==', STATUS, 2], '-planned', suffix],
];

export function buildFlockMarkSpecs(mode: FlockMarkMode, base?: FilterSpecification, theme: MapTileStyleId = 'dark'): LayerSpecification[] {
  const src = { source: FLOCK_LEAK_SOURCE_ID, 'source-layer': FLOCK_LEAK_SOURCE_LAYER } as const;
  const withFilter = <T extends LayerSpecification>(spec: T, ...extra: FilterSpecification[]): T => {
    const filter = combineFilters(base, ...extra);
    return filter ? { ...spec, filter } : spec;
  };
  const layers: LayerSpecification[] = [];
  const groupIcon = (id: string, scale: number, ...extra: FilterSpecification[]): LayerSpecification =>
    withFilter(
      {
        id,
        type: 'symbol',
        ...src,
        minzoom: FLOCK_LEAK_POINTS_MINZOOM,
        layout: {
          'icon-image': groupIconExpression(mode === 'hollow' ? '-hollow' : '') as never,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6 * scale, 10, scale],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': FLOCK_STATUS_SORT_KEY as never,
        },
        paint: {
          'icon-opacity': zoomOpacityByStatus([9, 0, 9.6, 1], DECOMMISSIONED_SCALE) as never,
        },
      },
      ...extra
    );

  // Beneath the plate-reader marks (see FLOCK_LEAK_MINOR_LAYER).
  layers.push(groupIcon(FLOCK_LEAK_MINOR_LAYER, MINOR_ICON_SCALE, IS_MINOR));

  if (mode === 'filled') {
    layers.push(
      withFilter(
        {
          id: FLOCK_LEAK_GLOW_LAYER,
          type: 'circle',
          ...src,
          minzoom: 8,
          paint: {
            'circle-color': FLOCK_COMPARE_COLOR.glow,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 9, 5, 10, 9, 11, 10, 12, 16],
            'circle-opacity': zoomOpacityByStatus([8, 0, 9, 0.15, 11, 0.15, 12, 0.4], DECOMMISSIONED_SCALE) as never,
            'circle-blur': 0.5,
            'circle-stroke-width': 0,
          },
        },
        IS_ALPR,
        NOT_PLANNED
      )
    );
    layers.push(
      withFilter(
        {
          id: FLOCK_LEAK_CORE_LAYER,
          type: 'circle',
          ...src,
          minzoom: FLOCK_LEAK_POINTS_MINZOOM,
          paint: {
            'circle-color': FLOCK_COMPARE_COLOR.core,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4.3, 10, 6],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9.6, 0, 10.4, 2],
            'circle-stroke-color': FLOCK_COMPARE_COLOR.ring,
            'circle-opacity': zoomOpacityByStatus([9, 0, 9.6, 1], DECOMMISSIONED_SCALE) as never,
            'circle-stroke-opacity': zoomOpacityByStatus([9, 0, 9.6, 1], DECOMMISSIONED_SCALE) as never,
          },
        },
        IS_ALPR,
        NOT_PLANNED
      )
    );
  } else {
    layers.push(
      withFilter(
        {
          id: FLOCK_LEAK_CORE_LAYER,
          type: 'circle',
          ...src,
          minzoom: FLOCK_LEAK_POINTS_MINZOOM,
          paint: {
            'circle-color': FLOCK_COMPARE_COLOR.core,
            'circle-opacity': 0,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4.3, 10, 7.5],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9.6, 1, 10.4, 2.5],
            'circle-stroke-color': FLOCK_COMPARE_COLOR.line,
            'circle-stroke-opacity': zoomOpacityByStatus([9, 0, 9.6, 0.9], DECOMMISSIONED_SCALE) as never,
          },
        },
        IS_ALPR,
        NOT_PLANNED
      )
    );
  }

  layers.push(
    withFilter(
      {
        id: FLOCK_LEAK_PLANNED_LAYER,
        type: 'symbol',
        ...src,
        minzoom: FLOCK_LEAK_POINTS_MINZOOM,
        layout: {
          'icon-image': mode === 'filled' ? flockPlannedLensId(theme) : FLOCK_PLANNED_ICON,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 10, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 9.6, mode === 'filled' ? 1 : 0.9],
        },
      },
      IS_ALPR,
      IS_PLANNED
    )
  );

  layers.push(groupIcon(FLOCK_LEAK_OTHERS_LAYER, 1, NOT_ALPR, NOT_MINOR));
  return layers;
}
