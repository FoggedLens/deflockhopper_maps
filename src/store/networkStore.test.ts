import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNetworkStore, type NetworkNode } from './networkStore';

const CDN = 'https://deflockdata.dontgetflocked.com';
const NODES_PATH = '/sharing-network-nodes.geojson';
const ADJ_PATH = '/sharing-network-adjacency.json';
const META_PATH = '/sharing-network-meta.json';

function nodeFeature(id: string, lng = -84.4, lat = 33.7) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { id, name: `Agency ${id}`, type: 'pd', isPortal: true, geocodeMethod: 'exact' },
  };
}

const NODES_BODY = JSON.stringify({
  type: 'FeatureCollection',
  features: [nodeFeature('a'), nodeFeature('b'), nodeFeature('c')],
});
const ADJ_BODY = JSON.stringify({ a: ['b'], b: ['a', 'c'] });
const META_BODY = JSON.stringify({
  generatedAt: '2026-09-10T18:40:19Z',
  featureCount: 3,
  portalCount: 3,
  adjacencyKeys: 2,
  directedEdges: 3,
  runId: 'test',
});

/** fetch stub matching on the path suffix so the base URL stays configurable */
function stubFetch(opts: {
  adjacencyDelayed?: boolean;
  failAdjacency?: boolean;
  failNodes?: boolean;
  failMeta?: boolean;
  malformedMeta?: boolean;
} = {}) {
  let releaseAdjacency: () => void = () => {};
  const adjacencyGate = new Promise<void>(resolve => { releaseAdjacency = resolve; });

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith(NODES_PATH)) {
      if (opts.failNodes) return new Response('', { status: 500 });
      return new Response(NODES_BODY, { status: 200 });
    }
    if (url.endsWith(ADJ_PATH)) {
      if (opts.adjacencyDelayed) await adjacencyGate;
      if (opts.failAdjacency) return new Response('', { status: 500 });
      return new Response(ADJ_BODY, { status: 200 });
    }
    if (url.endsWith(META_PATH)) {
      if (opts.failMeta) throw new TypeError('Failed to fetch');
      if (opts.malformedMeta) return new Response('{"nope":true}', { status: 200 });
      return new Response(META_BODY, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, releaseAdjacency };
}

const fetchedUrls = () =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));

/** Poll until the store satisfies a predicate (progressive commits are async). */
async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useNetworkStore.setState({
    loadPhase: 'idle',
    adjacencyReady: false,
    nodesMap: new Map(),
    nodesArray: [],
    adjacency: {},
    reverseAdjacency: {},
    selectedNodeId: null,
    selectedNode: null,
    selectedArcs: [],
    nodesProgress: null,
    adjacencyProgress: null,
    meta: null,
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadNetworkData progressive commits', () => {
  it('commits nodes and flips loadPhase to ready before adjacency arrives', async () => {
    const { releaseAdjacency } = stubFetch({ adjacencyDelayed: true });

    const loadPromise = useNetworkStore.getState().loadNetworkData();
    await waitFor(() => useNetworkStore.getState().loadPhase === 'ready');

    expect(useNetworkStore.getState().nodesArray).toHaveLength(3);
    expect(useNetworkStore.getState().adjacencyReady).toBe(false);

    releaseAdjacency();
    await loadPromise;

    expect(useNetworkStore.getState().adjacencyReady).toBe(true);
    expect(useNetworkStore.getState().reverseAdjacency['a']).toEqual(['b']);
  });

  it('backfills arcs for a selection made while adjacency was streaming', async () => {
    const { releaseAdjacency } = stubFetch({ adjacencyDelayed: true });

    const loadPromise = useNetworkStore.getState().loadNetworkData();
    await waitFor(() => useNetworkStore.getState().loadPhase === 'ready');

    useNetworkStore.getState().setSelectedNodeId('a');
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(0);

    releaseAdjacency();
    await loadPromise;

    const arcs = useNetworkStore.getState().selectedArcs;
    expect(arcs).toHaveLength(1);
    expect(arcs[0].target.id).toBe('b');
    expect(arcs[0].direction).toBe('mutual');
  });

  it('keeps nodes usable when only adjacency fails, and retries just adjacency', async () => {
    const { fetchMock } = stubFetch({ failAdjacency: true });

    await useNetworkStore.getState().loadNetworkData();

    expect(useNetworkStore.getState().loadPhase).toBe('ready');
    expect(useNetworkStore.getState().nodesArray).toHaveLength(3);
    expect(useNetworkStore.getState().error).toMatch(/Adjacency/);

    // Retry: only the adjacency URL is refetched
    fetchMock.mockClear();
    stubFetch({});
    await useNetworkStore.getState().loadNetworkData();

    const retried = fetchedUrls();
    expect(retried).toEqual([`${CDN}${ADJ_PATH}`]);
    expect(useNetworkStore.getState().adjacencyReady).toBe(true);
    expect(useNetworkStore.getState().error).toBeNull();
  });

  it('sets loadPhase to error when the nodes fetch fails', async () => {
    stubFetch({ failNodes: true });

    await useNetworkStore.getState().loadNetworkData();

    expect(useNetworkStore.getState().loadPhase).toBe('error');
    expect(useNetworkStore.getState().error).toMatch(/Nodes/);
  });
});

describe('loadNetworkData source', () => {
  it('fetches nodes, adjacency and meta from the deflock-data CDN in parallel, never from /public', async () => {
    stubFetch();
    await useNetworkStore.getState().loadNetworkData();
    const urls = fetchedUrls().sort();
    expect(urls).toEqual([
      `${CDN}${ADJ_PATH}`,
      `${CDN}${META_PATH}`,
      `${CDN}${NODES_PATH}`,
    ]);
    expect(urls.some(u => u.startsWith('/'))).toBe(false);
    expect(urls.some(u => u.includes('?'))).toBe(false);
  });

  it('honors VITE_NETWORK_DATA_BASE for every file', async () => {
    vi.stubEnv('VITE_NETWORK_DATA_BASE', 'http://localhost:8787');
    stubFetch();
    await useNetworkStore.getState().loadNetworkData();
    for (const u of fetchedUrls()) expect(u.startsWith('http://localhost:8787/')).toBe(true);
  });

  it('reads the data files as compressed (indeterminate percent, byte counts only)', async () => {
    stubFetch();
    const seen: Array<number | null> = [];
    const unsub = useNetworkStore.subscribe((s) => {
      if (s.nodesProgress) seen.push(s.nodesProgress.percent);
      if (s.adjacencyProgress) seen.push(s.adjacencyProgress.percent);
    });
    await useNetworkStore.getState().loadNetworkData();
    unsub();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(p => p === null || p === 100)).toBe(true);
  });

  it('surfaces generatedAt from meta once loaded', async () => {
    stubFetch();
    await useNetworkStore.getState().loadNetworkData();
    expect(useNetworkStore.getState().meta?.generatedAt).toBe('2026-09-10T18:40:19Z');
    expect(useNetworkStore.getState().meta?.featureCount).toBe(3);
  });

  it('treats meta as optional: a failed meta fetch leaves the map loaded with no error', async () => {
    stubFetch({ failMeta: true });
    await useNetworkStore.getState().loadNetworkData();
    expect(useNetworkStore.getState().loadPhase).toBe('ready');
    expect(useNetworkStore.getState().adjacencyReady).toBe(true);
    expect(useNetworkStore.getState().error).toBeNull();
    expect(useNetworkStore.getState().meta).toBeNull();
  });

  it('treats malformed meta as absent', async () => {
    stubFetch({ malformedMeta: true });
    await useNetworkStore.getState().loadNetworkData();
    expect(useNetworkStore.getState().error).toBeNull();
    expect(useNetworkStore.getState().meta).toBeNull();
  });

  it('does not refetch meta on a retry once it is loaded', async () => {
    stubFetch({ failAdjacency: true });
    await useNetworkStore.getState().loadNetworkData();
    expect(useNetworkStore.getState().meta).not.toBeNull();
    stubFetch({});
    await useNetworkStore.getState().loadNetworkData();
    expect(fetchedUrls()).toEqual([`${CDN}${ADJ_PATH}`]);
  });
});

/* ------------------------------------------------------------------ */
/*  Inferred-connection gating                                         */
/* ------------------------------------------------------------------ */

function makeNode(id: string, isPortal: boolean): NetworkNode {
  return {
    id,
    name: id,
    city: '',
    state: 'TX',
    type: 'pd',
    isPortal,
    isInactive: false,
    isLikelyAggregator: false,
    portalSlug: isPortal ? id : null,
    aliases: [],
    cameras: 0,
    searches: 0,
    vehiclesCaptured: 0,
    connectionCount: 1,
    population: 0,
    hotlistHits: 0,
    geocodeMethod: 'city',
    coordinates: [-97, 32],
  };
}

describe('networkStore defaults', () => {
  it('shows all agencies by default (portalOnly off)', () => {
    expect(useNetworkStore.getState().portalOnly).toBe(false);
  });
});

describe('inferred-connection gating', () => {
  const portalA = makeNode('portalA', true);
  const plainB = makeNode('plainB', false);

  beforeEach(() => {
    useNetworkStore.setState({
      nodesMap: new Map([
        ['portalA', portalA],
        ['plainB', plainB],
      ]),
      nodesArray: [portalA, plainB],
      adjacency: { portalA: ['plainB'] },
      reverseAdjacency: { plainB: ['portalA'] },
      adjacencyReady: true,
      inferredConnectionsEnabled: false,
    });
  });

  it('portal selection yields arcs while the flag is off', () => {
    useNetworkStore.getState().setSelectedNodeId('portalA');
    const arcs = useNetworkStore.getState().selectedArcs;
    expect(arcs).toHaveLength(1);
    expect(arcs[0].target.id).toBe('plainB');
  });

  it('non-portal selection yields no arcs while the flag is off', () => {
    useNetworkStore.getState().setSelectedNodeId('plainB');
    expect(useNetworkStore.getState().selectedNode?.id).toBe('plainB');
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(0);
  });

  it('toggling the flag on populates arcs for the selected non-portal node', () => {
    useNetworkStore.getState().setSelectedNodeId('plainB');
    useNetworkStore.getState().toggleInferredConnections();
    const arcs = useNetworkStore.getState().selectedArcs;
    expect(useNetworkStore.getState().inferredConnectionsEnabled).toBe(true);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].direction).toBe('incoming');
  });

  it('toggling the flag off clears arcs for the selected non-portal node', () => {
    useNetworkStore.getState().setSelectedNodeId('plainB');
    // Non-portal click resets inferredConnectionsEnabled and starts with no arcs
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(0);
    // Toggle on to populate inferred arcs
    useNetworkStore.getState().toggleInferredConnections();
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(1);
    // Toggle off clears them
    useNetworkStore.getState().toggleInferredConnections();
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(0);
  });

  it('toggling the flag leaves a selected portal node untouched', () => {
    useNetworkStore.getState().setSelectedNodeId('portalA');
    useNetworkStore.getState().toggleInferredConnections();
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(1);
  });
});
