import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { flockLayerFilter } from './flockLeakFilter';

function passes(filter: unknown, properties: Record<string, unknown>): boolean {
  if (filter === undefined) return true;
  const parsed = createExpression(filter as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return Boolean(parsed.value.evaluate({ zoom: 10 }, { type: 1, properties, geometry: null } as never));
}

describe('flockLayerFilter', () => {
  it('is undefined when every type and every selectable status is on', () => {
    expect(flockLayerFilter([], ['active', 'planned', 'decommissioned'])).toBeUndefined();
  });

  it('default (Active only) keeps active and unknown, drops planned and decommissioned', () => {
    const f = flockLayerFilter([], ['active']);
    expect(passes(f, { type: 'Falcon', status: 'Active' })).toBe(true);
    expect(passes(f, { type: 'Falcon' })).toBe(true); // unknown status never vanishes
    expect(passes(f, { type: 'Falcon', status: 'Planned' })).toBe(false);
    expect(passes(f, { type: 'Falcon', status: 'Removed' })).toBe(false);
  });

  it('type filter matches canonical types', () => {
    const f = flockLayerFilter(['condor', 'raven'], ['active', 'planned', 'decommissioned']);
    expect(passes(f, { type: 'Condor PTZ', status: 'Active' })).toBe(true);
    expect(passes(f, { type: 'Raven', status: 'Active' })).toBe(true);
    expect(passes(f, { type: 'Falcon', status: 'Active' })).toBe(false);
    expect(passes(f, { status: 'Active' })).toBe(false); // other is not selected
  });

  it('combines type and status', () => {
    const f = flockLayerFilter(['alpr'], ['planned']);
    expect(passes(f, { type: 'Falcon', status: 'Planned' })).toBe(true);
    expect(passes(f, { type: 'Falcon', status: 'Active' })).toBe(false);
    expect(passes(f, { type: 'Condor', status: 'Planned' })).toBe(false);
  });
});
