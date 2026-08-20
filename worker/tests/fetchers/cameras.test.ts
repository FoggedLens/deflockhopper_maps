import { describe, it, expect } from 'vitest';
import { transformOverpassToGeoJSON, addElementsToFeatures, parseDirection, parseDirections, CAMERAS_OVERPASS_QUERY, subtractForeign, buildDataset } from '../../src/fetchers/cameras';
import type { OverpassResponse, OverpassElement, GeoJSON } from '../../src/types';

describe('addElementsToFeatures (tile merge/dedupe)', () => {
  const alprNode = (id: number, lat: number, lon: number): OverpassElement => ({
    type: 'node', id, lat, lon,
    tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR' },
  });

  it('dedupes a camera that appears in two overlapping tiles', () => {
    const map = new Map<string, GeoJSON.Feature>();
    // Same node id 42 returned by two adjacent tiles (shared bbox edge).
    addElementsToFeatures([alprNode(42, 38.0, -77.0)], map);
    addElementsToFeatures([alprNode(42, 38.0, -77.0), alprNode(43, 39.0, -76.0)], map);
    expect(map.size).toBe(2);
    expect(map.has('node/42')).toBe(true);
    expect(map.has('node/43')).toBe(true);
  });

  it('accumulates features across many tile batches', () => {
    const map = new Map<string, GeoJSON.Feature>();
    addElementsToFeatures([alprNode(1, 38, -77), alprNode(2, 38, -76)], map);
    addElementsToFeatures([alprNode(3, 39, -75)], map);
    expect(map.size).toBe(3);
  });
});

describe('parseDirection', () => {
  it('parses numeric direction', () => {
    expect(parseDirection('180')).toBe(180);
  });

  it('parses cardinal N', () => {
    expect(parseDirection('N')).toBe(0);
  });

  it('parses cardinal SW', () => {
    expect(parseDirection('SW')).toBe(225);
  });

  it('handles semicolon-separated numeric (takes first)', () => {
    expect(parseDirection('90;270')).toBe(90);
  });

  it('handles semicolon-separated cardinals (takes first)', () => {
    expect(parseDirection('N;S')).toBe(0);
    expect(parseDirection('E;W')).toBe(90);
  });

  it('handles range notation (returns midpoint)', () => {
    // 338-23: sector from 338° clockwise to 23° → arc=45°, midpoint=0.5°
    expect(parseDirection('338-23')).toBeCloseTo(0.5, 1);
    // 48-93: arc=45°, midpoint=70.5°
    expect(parseDirection('48-93')).toBeCloseTo(70.5, 1);
    // 0-360: full circle, arc=360° → midpoint=180°
    expect(parseDirection('0-360')).toBeCloseTo(180, 1);
  });

  it('handles cardinal range notation', () => {
    // WSW(247.5)-ESE(112.5): arc = (112.5-247.5+360)%360 = 225°, midpoint = 247.5+112.5 = 0°
    expect(parseDirection('WSW-ESE')).toBeCloseTo(0, 1);
  });

  it('handles bound directions (NB/SB/EB/WB)', () => {
    expect(parseDirection('NB')).toBe(0);
    expect(parseDirection('SB')).toBe(180);
    expect(parseDirection('EB')).toBe(90);
    expect(parseDirection('WB')).toBe(270);
  });

  it('handles spelled-out cardinals', () => {
    expect(parseDirection('north')).toBe(0);
    expect(parseDirection('south')).toBe(180);
    expect(parseDirection('northeast')).toBe(45);
    expect(parseDirection('northwest')).toBe(315);
  });

  it('normalizes degrees to 0-359', () => {
    expect(parseDirection('360')).toBe(0);
    expect(parseDirection('400')).toBeCloseTo(40, 1);
    expect(parseDirection('-10')).toBeCloseTo(350, 1);
  });

  it('handles comma-separated values', () => {
    expect(parseDirection('95, 95')).toBe(95);
    expect(parseDirection('70, 210, 300')).toBe(70);
  });

  it('returns null for empty string', () => {
    expect(parseDirection('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseDirection(undefined)).toBeNull();
  });

  it('returns null for unresolvable values', () => {
    expect(parseDirection('forward')).toBeNull();
    expect(parseDirection('backward')).toBeNull();
    expect(parseDirection('both')).toBeNull();
    expect(parseDirection('Flock Raven')).toBeNull();
  });
});

describe('parseDirections', () => {
  it('returns all directions from semicolon-separated values', () => {
    expect(parseDirections('90;270')).toEqual([90, 270]);
    expect(parseDirections('N;S')).toEqual([0, 180]);
    expect(parseDirections('0;90;180;270')).toEqual([0, 90, 180, 270]);
  });

  it('returns all directions from comma-separated values', () => {
    expect(parseDirections('70, 210, 300')).toEqual([70, 210, 300]);
  });

  it('returns single-element array for simple values', () => {
    expect(parseDirections('180')).toEqual([180]);
    expect(parseDirections('NW')).toEqual([315]);
  });

  it('returns empty array for empty/undefined', () => {
    expect(parseDirections('')).toEqual([]);
    expect(parseDirections(undefined)).toEqual([]);
  });

  it('filters out unresolvable tokens', () => {
    // mixed valid and invalid
    expect(parseDirections('180;forward;270')).toEqual([180, 270]);
  });
});

describe('transformOverpassToGeoJSON', () => {
  const minimalNodeResponse: OverpassResponse = {
    version: 0.6,
    generator: 'Overpass API',
    elements: [
      {
        type: 'node',
        id: 12345,
        lat: 38.89,
        lon: -77.03,
        timestamp: '2025-11-15T00:00:00Z',
        version: 3,
        tags: {
          'man_made': 'surveillance',
          'surveillance:type': 'ALPR',
          'operator': 'Flock Safety',
          'brand': 'Flock',
          'direction': '180',
          'surveillance:zone': 'traffic',
          'camera:mount': 'pole',
          'ref': 'CAM-001',
          'start_date': '2024-06-01',
        },
      },
    ],
  };

  it('transforms a node element to a GeoJSON Feature', () => {
    const fc = transformOverpassToGeoJSON(minimalNodeResponse);

    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);

    const f = fc.features[0];
    expect(f.geometry.coordinates).toEqual([-77.03, 38.89]);
    expect(f.properties.osmId).toBe(12345);
    expect(f.properties.osmType).toBe('node');
    expect(f.properties.operator).toBe('Flock Safety');
    expect(f.properties.brand).toBe('Flock');
    expect(f.properties.direction).toBe(180);
    expect(f.properties.directionCardinal).toBeUndefined(); // numeric direction, not a cardinal string
    expect(f.properties.surveillanceZone).toBe('traffic');
    expect(f.properties.mountType).toBe('pole');
    expect(f.properties.ref).toBe('CAM-001');
    expect(f.properties.startDate).toBe('2024-06-01');
    expect(f.properties.osmTimestamp).toBe('2025-11-15T00:00:00Z');
    expect(f.properties.osmVersion).toBe(3);
  });

  it('computes centroid for way elements', () => {
    const wayResponse: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'way',
          id: 99999,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR' },
          nodes: [1, 2],
          timestamp: '2025-01-01T00:00:00Z',
          version: 1,
        },
        { type: 'node', id: 1, lat: 40.0, lon: -74.0 },
        { type: 'node', id: 2, lat: 40.2, lon: -74.2 },
      ],
    };

    const fc = transformOverpassToGeoJSON(wayResponse);
    expect(fc.features).toHaveLength(1);

    const coords = fc.features[0].geometry.coordinates;
    expect(coords[0]).toBeCloseTo(-74.1, 5); // lon = avg(-74.0, -74.2)
    expect(coords[1]).toBeCloseTo(40.1, 5);  // lat = avg(40.0, 40.2)
  });

  it('skips elements without surveillance:type=ALPR', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        { type: 'node', id: 1, lat: 38.0, lon: -77.0, tags: { 'man_made': 'surveillance' } },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features).toHaveLength(0);
  });

  it('skips elements without coordinates', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        { type: 'way', id: 1, tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR' }, nodes: [999] },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features).toHaveLength(0);
  });

  it('sorts features by osmId', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        { type: 'node', id: 300, lat: 38.0, lon: -77.0, tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR' } },
        { type: 'node', id: 100, lat: 39.0, lon: -76.0, tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR' } },
        { type: 'node', id: 200, lat: 40.0, lon: -75.0, tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR' } },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features.map((f) => f.properties.osmId)).toEqual([100, 200, 300]);
  });

  it('maps manufacturer tag to brand when brand is missing', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'manufacturer': 'Vigilant' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features[0].properties.brand).toBe('Vigilant');
  });

  it('sets directionCardinal only for cardinal strings', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': 'SW' },
        },
        {
          type: 'node', id: 2, lat: 39.0, lon: -76.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '270' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    // Cardinal "SW" → direction=225, directionCardinal="SW"
    expect(fc.features[0].properties.direction).toBe(225);
    expect(fc.features[0].properties.directionCardinal).toBe('SW');
    // Numeric "270" → direction=270, no directionCardinal
    expect(fc.features[1].properties.direction).toBe(270);
    expect(fc.features[1].properties.directionCardinal).toBeUndefined();
  });

  it('outputs directions array for multi-directional cameras', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '90;270' },
        },
        {
          type: 'node', id: 2, lat: 39.0, lon: -76.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '180' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    // Multi-direction: direction=first, directions=all
    expect(fc.features[0].properties.direction).toBe(90);
    expect(fc.features[0].properties.directions).toEqual([90, 270]);
    // Single direction: direction set, no directions array
    expect(fc.features[1].properties.direction).toBe(180);
    expect(fc.features[1].properties.directions).toBeUndefined();
  });

  it('does not invent span metadata for plural non-range directions', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '90;270' },
        },
      ],
    };

    const feature = transformOverpassToGeoJSON(response).features[0];
    expect(feature.properties.direction).toBe(90);
    expect(feature.properties.directions).toEqual([90, 270]);
    expect(feature.properties.directionSpan).toBeUndefined();
    expect(feature.properties.directionSpans).toBeUndefined();
  });

  it('handles range notation in transform', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '338-23' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features[0].properties.direction).toBeCloseTo(0.5, 1);
  });

  it.each([
    ['57-117', 87, 60],
    ['338-23', 0.5, 45],
    ['90-90', 90, 0],
    ['0-360', 180, 360],
  ])('publishes boundary range %s as midpoint %s and span %s', (range, midpoint, span) => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': range },
        },
      ],
    };

    const feature = transformOverpassToGeoJSON(response).features[0];
    expect(feature.properties.direction).toBeCloseTo(midpoint, 5);
    expect(feature.properties.directionSpan).toBe(span);
  });

  it('preserves the midpoint and span of a direction range', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '239-284' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features[0].properties.direction).toBeCloseTo(261.5, 1);
    expect(fc.features[0].properties.directionSpan).toBe(45);
  });

  it('publishes aligned spans for plural direction tokens', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': '90;250-260;N' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features[0].properties.direction).toBe(90);
    expect(fc.features[0].properties.directions).toEqual([90, 255, 0]);
    expect(fc.features[0].properties.directionSpan).toBeUndefined();
    expect(fc.features[0].properties.directionSpans).toEqual([null, 10, null]);
  });

  it('uses the first retained token for singular range metadata', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': 'bad;250-260;N' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    expect(fc.features[0].properties.direction).toBe(255);
    expect(fc.features[0].properties.directionSpan).toBe(10);
    expect(fc.features[0].properties.directions).toEqual([255, 0]);
    expect(fc.features[0].properties.directionSpans).toEqual([10, null]);
  });

  it.each([
    '1e309;250-260',
    '0-1e309;250-260',
    '-1e308-1e308;250-260',
  ])('atomically rejects non-finite direction token in %s', (direction) => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', direction },
        },
      ],
    };

    const feature = transformOverpassToGeoJSON(response).features[0];
    expect(feature.properties.direction).toBe(255);
    expect(feature.properties.directionSpan).toBe(10);
    expect(feature.properties.directions).toBeUndefined();
    expect(feature.properties.directionSpans).toBeUndefined();
  });

  it('sets directionCardinal from first token of multi-value cardinal tag', () => {
    const response: OverpassResponse = {
      version: 0.6,
      generator: 'Overpass API',
      elements: [
        {
          type: 'node', id: 1, lat: 38.0, lon: -77.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': 'N;S' },
        },
        {
          type: 'node', id: 2, lat: 39.0, lon: -76.0,
          tags: { 'man_made': 'surveillance', 'surveillance:type': 'ALPR', 'direction': 'NB' },
        },
      ],
    };

    const fc = transformOverpassToGeoJSON(response);
    // "N;S" → first token "N" is a cardinal → directionCardinal="N"
    expect(fc.features[0].properties.directionCardinal).toBe('N');
    // "NB" is a bound direction, not a cardinal → no directionCardinal
    expect(fc.features[1].properties.directionCardinal).toBeUndefined();
  });
});

describe('subtractForeign', () => {
  const feat = (osmId: number): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { osmId },
  });

  it('drops merged features whose key is in foreignKeys', () => {
    const merged = new Map<string, GeoJSON.Feature>([
      ['node/10', feat(10)], // US
      ['node/20', feat(20)], // foreign (e.g. Toronto)
    ]);
    const us = subtractForeign(merged, new Set(['node/20']));
    expect(us.map((f) => f.properties.osmId)).toEqual([10]);
  });

  it('ignores foreign keys absent from merged (no-op)', () => {
    const merged = new Map<string, GeoJSON.Feature>([['node/10', feat(10)]]);
    const us = subtractForeign(merged, new Set(['node/999']));
    expect(us.map((f) => f.properties.osmId)).toEqual([10]);
  });
});

describe('buildDataset', () => {
  const feat = (osmId: number): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { osmId },
  });

  it('builds a keyed, sorted, counted dataset', () => {
    const ds = buildDataset('US', 'cameras.geojson.gz', [feat(30), feat(10), feat(20)], 50000, 'ep');
    expect(ds.country).toBe('US');
    expect(ds.r2Key).toBe('cameras.geojson.gz');
    expect(ds.minCount).toBe(50000);
    expect(ds.featureCount).toBe(3);
    expect(ds.featureCollection.features.map((f) => f.properties.osmId)).toEqual([10, 20, 30]);
  });
});
