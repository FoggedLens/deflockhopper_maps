import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_NETWORK_DATA_BASE,
  networkDataBase,
  networkDataUrl,
  parseNetworkMeta,
} from './networkDataService';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('networkDataUrl', () => {
  it('defaults to the deflock-data CDN', () => {
    expect(DEFAULT_NETWORK_DATA_BASE).toBe('https://deflockdata.dontgetflocked.com');
    expect(networkDataUrl('sharing-network-nodes.geojson'))
      .toBe('https://deflockdata.dontgetflocked.com/sharing-network-nodes.geojson');
    expect(networkDataUrl('sharing-network-adjacency.json'))
      .toBe('https://deflockdata.dontgetflocked.com/sharing-network-adjacency.json');
    expect(networkDataUrl('sharing-network-meta.json'))
      .toBe('https://deflockdata.dontgetflocked.com/sharing-network-meta.json');
  });

  it('honors VITE_NETWORK_DATA_BASE, tolerating a trailing slash', () => {
    vi.stubEnv('VITE_NETWORK_DATA_BASE', 'http://localhost:8787/');
    expect(networkDataBase()).toBe('http://localhost:8787');
    expect(networkDataUrl('sharing-network-nodes.geojson'))
      .toBe('http://localhost:8787/sharing-network-nodes.geojson');
  });

  it('ignores an empty override', () => {
    vi.stubEnv('VITE_NETWORK_DATA_BASE', '   ');
    expect(networkDataBase()).toBe(DEFAULT_NETWORK_DATA_BASE);
  });

  it('never appends cache-busting query strings', () => {
    expect(networkDataUrl('sharing-network-adjacency.json')).not.toMatch(/\?/);
  });
});

describe('parseNetworkMeta', () => {
  const published = {
    generatedAt: '2026-09-10T18:40:19Z',
    source: 'https://eyesonflock.com/api/v1/data',
    snapshotPortals: 1439,
    featureCount: 6893,
    portalCount: 1437,
    adjacencyKeys: 872,
    directedEdges: 462866,
    geocodeMethods: { place: 3943 },
    junk: 28,
    inactive: 116,
    likelyAggregators: 228,
    runId: '34515727494',
  };

  it('keeps generatedAt and the headline counts from the published shape', () => {
    const meta = parseNetworkMeta(published);
    expect(meta?.generatedAt).toBe('2026-09-10T18:40:19Z');
    expect(meta?.featureCount).toBe(6893);
    expect(meta?.portalCount).toBe(1437);
    expect(meta?.directedEdges).toBe(462866);
    expect(meta?.adjacencyKeys).toBe(872);
  });

  it('returns null when generatedAt is missing or not a string', () => {
    expect(parseNetworkMeta({ featureCount: 1 })).toBeNull();
    expect(parseNetworkMeta({ generatedAt: 12345 })).toBeNull();
    expect(parseNetworkMeta(null)).toBeNull();
    expect(parseNetworkMeta('nope')).toBeNull();
  });

  it('tolerates missing counts (only generatedAt is required)', () => {
    const meta = parseNetworkMeta({ generatedAt: '2026-09-10T18:40:19Z' });
    expect(meta).toEqual({ generatedAt: '2026-09-10T18:40:19Z' });
  });
});
