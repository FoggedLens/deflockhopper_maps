import { describe, it, expect } from 'vitest';
import { validateStyleMin, createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification, StyleSpecification, CircleLayerSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { buildFlockMarkSpecs, FLOCK_PLANNED_ICON } from './flockCompareStyle';
import { FLOCK_LEAK_GLOW_LAYER, FLOCK_LEAK_CORE_LAYER, FLOCK_LEAK_PLANNED_LAYER, FLOCK_LEAK_OTHERS_LAYER } from './flockLeakLayerIds';
import { FLOCK_LEAK_SOURCE_ID } from '../../../services/flockLeakTilesService';

const ALPR: FilterSpecification = ['==', ['get', 'g'], 1] as never;

const styleWith = (layers: ReturnType<typeof buildFlockMarkSpecs>): StyleSpecification => ({
  version: 8,
  sources: { [FLOCK_LEAK_SOURCE_ID]: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.mvt'] } },
  layers: layers as never,
});

const byId = (layers: ReturnType<typeof buildFlockMarkSpecs>, id: string) => layers.find((l) => l.id === id);
const filterOf = (l: unknown) => JSON.stringify((l as { filter?: unknown }).filter);

describe('buildFlockMarkSpecs', () => {
  it('produces style-spec-valid layers in both compare modes, with and without a base filter', () => {
    for (const mode of ['filled', 'hollow'] as const) {
      for (const base of [undefined, ALPR]) {
        const errors = validateStyleMin(styleWith(buildFlockMarkSpecs(mode, base)));
        expect(errors.map((e) => e.message), `${mode} ${base ? 'filtered' : 'unfiltered'}`).toEqual([]);
      }
    }
  });

  it('uses the same layer ids in both modes, so the Flock and Swipe views are one picture and Overlay its hollow twin', () => {
    const filled = buildFlockMarkSpecs('filled').map((l) => l.id);
    const hollow = buildFlockMarkSpecs('hollow').map((l) => l.id);
    expect(filled).toContain(FLOCK_LEAK_CORE_LAYER);
    expect(hollow).toEqual(filled.filter((id) => id !== FLOCK_LEAK_GLOW_LAYER));
  });

  it('hollow draws a ring: no glow, transparent core, red stroke', () => {
    const layers = buildFlockMarkSpecs('hollow');
    expect(byId(layers, FLOCK_LEAK_GLOW_LAYER)).toBeUndefined();
    const points = byId(layers, FLOCK_LEAK_CORE_LAYER) as CircleLayerSpecification;
    expect(points.type).toBe('circle');
    expect(points.paint?.['circle-opacity']).toBe(0);
    expect(points.paint?.['circle-stroke-color']).toBe('#ef4444');
  });

  it('filled draws the fogged lens: glow beneath a filled core with the OSM radii', () => {
    const layers = buildFlockMarkSpecs('filled');
    expect(layers[0].id).toBe(FLOCK_LEAK_GLOW_LAYER);
    expect(layers[0].type).toBe('circle');
    const points = byId(layers, FLOCK_LEAK_CORE_LAYER) as CircleLayerSpecification;
    expect(points.paint?.['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 9, 4.3, 10, 6]);
    expect(points.paint?.['circle-stroke-color']).toBe('#fca5a5');
  });

  it('planned devices get the dashed ring icon and are excluded from the core layers', () => {
    for (const mode of ['filled', 'hollow'] as const) {
      const layers = buildFlockMarkSpecs(mode, ALPR);
      const planned = byId(layers, FLOCK_LEAK_PLANNED_LAYER) as SymbolLayerSpecification;
      expect(planned.type).toBe('symbol');
      expect(planned.layout?.['icon-image']).toBe(FLOCK_PLANNED_ICON);
      expect(JSON.stringify(planned.filter)).toContain('["==",["coalesce",["get","s"],4],2]');
      for (const l of layers) {
        expect(filterOf(l), `${mode} ${l.id} carries the base filter`).toContain(JSON.stringify(ALPR));
        if (l.id !== FLOCK_LEAK_PLANNED_LAYER && l.id !== FLOCK_LEAK_OTHERS_LAYER) {
          expect(filterOf(l), `${mode} ${l.id} excludes planned`).toContain('["!=",["coalesce",["get","s"],4],2]');
        }
      }
    }
  });

  it('dims decommissioned devices to 35% of the in-service opacity', () => {
    const points = byId(buildFlockMarkSpecs('hollow'), FLOCK_LEAK_CORE_LAYER) as CircleLayerSpecification;
    const res = createPropertyExpression(points.paint?.['circle-stroke-opacity'] as never, v8.paint_circle['circle-stroke-opacity'] as never);
    if (res.result !== 'success') throw new Error(JSON.stringify(res.value));
    const ev = (s: number) => res.value.evaluate({ zoom: 12 }, { type: 1, properties: { s }, geometry: null } as never);
    expect(ev(1)).toBeCloseTo(0.9);
    expect(ev(3)).toBeCloseTo(0.9 * 0.35);
  });
});

describe('other device groups in the compare views', () => {
  const ALPR_ONLY = '["==",["get","g"],1]';
  const NOT_ALPR = '["!=",["get","g"],1]';

  it('reserves the ring, lens and planned ring for plate readers', () => {
    for (const mode of ['filled', 'hollow'] as const) {
      for (const l of buildFlockMarkSpecs(mode)) {
        if (l.id === FLOCK_LEAK_OTHERS_LAYER) continue;
        expect(filterOf(l), `${mode} ${l.id}`).toContain(ALPR_ONLY);
      }
    }
  });

  it('draws every other group as its own icon: hollow or filled, dashed when planned', () => {
    for (const mode of ['filled', 'hollow'] as const) {
      const others = byId(buildFlockMarkSpecs(mode), FLOCK_LEAK_OTHERS_LAYER) as SymbolLayerSpecification;
      expect(others.type).toBe('symbol');
      expect(filterOf(others)).toContain(NOT_ALPR);
      const icon = JSON.stringify(others.layout?.['icon-image']);
      expect(icon).toContain('"flock-g"');
      expect(icon).toContain('"-planned"');
      if (mode === 'hollow') expect(icon).toContain('"-hollow"');
      else expect(icon).not.toContain('"-hollow"');
    }
  });

  it('still validates against the style spec', () => {
    for (const mode of ['filled', 'hollow'] as const) {
      expect(validateStyleMin(styleWith(buildFlockMarkSpecs(mode, ALPR))).map((e) => e.message)).toEqual([]);
    }
  });
});
