import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { IS_DECOMMISSIONED } from './flockLeakStyle';

describe('IS_DECOMMISSIONED', () => {
  it('matches status 3 only, treating a missing status as unknown', () => {
    const res = createExpression(IS_DECOMMISSIONED as never);
    if (res.result !== 'success') throw new Error(JSON.stringify(res.value));
    const ev = (properties: Record<string, unknown>) =>
      res.value.evaluate({ zoom: 12 }, { type: 1, properties, geometry: null } as never);
    expect(ev({ s: 3 })).toBe(true);
    expect(ev({ s: 1 })).toBe(false);
    expect(ev({})).toBe(false);
  });
});
