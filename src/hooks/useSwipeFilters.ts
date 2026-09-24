import { useEffect, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { FilterSpecification } from 'maplibre-gl';
import { useFlockLeakStore } from '../store/flockLeakStore';
import { planSwipe, dividerLongitude, type SwipeLayerState } from '../utils/swipeFilter';

export interface SwipeTargets {
  osmLayerIds: string[];
  osmBaseFilter?: FilterSpecification;
  flockLayerIds: string[];
  flockBaseFilter?: FilterSpecification;
}

/** Minimum gap between filter updates during a drag (20 per second). */
const MIN_INTERVAL_MS = 50;

/**
 * Drives the Swipe view without React commits: subscribes to the store's
 * divider, coalesces updates to one per animation frame and at most 20 per
 * second, and sets `within` filters on the OSM and Flock point layers.
 * MapLibre's setFilter deep-compares, so re-applying an unchanged filter
 * (on idle, on moveend) costs nothing. On disable every layer gets its base
 * filter back. The hook never touches layer visibility: react-map-gl applies
 * the declarative `layout.visibility` during render, and a cleanup that
 * restored 'visible' would re-show the OSM layer after a switch from Swipe
 * to the Flock-only view. A side is hidden through NEVER_MATCH instead.
 */
export function useSwipeFilters(
  mapRef: RefObject<MapRef>,
  enabled: boolean,
  targets: SwipeTargets,
  mapLoaded: boolean
): void {
  const osmKey = targets.osmLayerIds.join(',');
  const flockKey = targets.flockLayerIds.join(',');
  const { osmBaseFilter, flockBaseFilter } = targets;

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded || !enabled) return;
    const osmIds = osmKey ? osmKey.split(',') : [];
    const flockIds = flockKey ? flockKey.split(',') : [];

    const applyFilter = (id: string, state: SwipeLayerState) => {
      if (!map.getLayer(id)) return;
      map.setFilter(id, state.filter ?? null, { validate: false });
    };

    const apply = (divider: number) => {
      const plan = planSwipe(divider, dividerLongitude(map, divider), {
        osm: osmBaseFilter,
        flock: flockBaseFilter,
      });
      for (const id of osmIds) applyFilter(id, plan.osm);
      for (const id of flockIds) applyFilter(id, plan.flock);
    };

    let raf = 0;
    let pending: number | null = null;
    let lastAt = 0;
    const tick = () => {
      raf = 0;
      const now = performance.now();
      if (now - lastAt < MIN_INTERVAL_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (pending !== null) {
        lastAt = now;
        apply(pending);
        pending = null;
      }
    };
    const schedule = (divider: number) => {
      pending = divider;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const unsubscribe = useFlockLeakStore.subscribe((s, prev) => {
      if (s.divider !== prev.divider) schedule(s.divider);
    });
    // Panning moves the longitude under a fixed divider; idle covers layers
    // that mount after this effect ran (setFilter dedupes unchanged filters).
    const reapply = () => apply(useFlockLeakStore.getState().divider);
    map.on('moveend', reapply);
    map.on('idle', reapply);
    apply(useFlockLeakStore.getState().divider);

    return () => {
      unsubscribe();
      map.off('moveend', reapply);
      map.off('idle', reapply);
      if (raf) cancelAnimationFrame(raf);
      const restore = (ids: string[], base: FilterSpecification | undefined) => {
        for (const id of ids) {
          if (map.getLayer(id)) map.setFilter(id, base ?? null, { validate: false });
        }
      };
      restore(osmIds, osmBaseFilter);
      restore(flockIds, flockBaseFilter);
    };
  }, [mapRef, enabled, mapLoaded, osmKey, flockKey, osmBaseFilter, flockBaseFilter]);
}
