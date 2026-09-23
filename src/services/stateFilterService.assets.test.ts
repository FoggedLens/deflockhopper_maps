import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The state filter (stateFilterService.loadStateGeometry) fetches this asset
 * at runtime. It was deleted once as "density data" and silently blanked the
 * camera layer for every /state/* link. Keep it, or change the loader.
 */
describe('state filter boundary asset', () => {
  it('public/geo/states-metrics.geojson exists and is a FeatureCollection with GEOIDs', () => {
    const raw = readFileSync(resolve(process.cwd(), 'public/geo/states-metrics.geojson'), 'utf8');
    const doc = JSON.parse(raw) as { type: string; features: Array<{ properties: Record<string, unknown> }> };
    expect(doc.type).toBe('FeatureCollection');
    expect(doc.features.length).toBeGreaterThan(50);
    expect(doc.features.every((f) => typeof f.properties.GEOID === 'string')).toBe(true);
  });
});
