import { create } from 'zustand';

export interface NetworkNode {
  id: string;
  name: string;
  city: string;
  state: string;
  type: 'pd' | 'so' | 'federal' | 'school' | 'other';
  isPortal: boolean;
  cameras: number;
  searches: number;
  vehiclesCaptured: number;
  connectionCount: number;
  population: number;
  hotlistHits: number;
  geocodeMethod: string;
  coordinates: [number, number]; // [lng, lat]
}

export type Direction = 'mutual' | 'outgoing' | 'incoming';

export interface DirectionalArc {
  source: NetworkNode;
  target: NetworkNode;
  direction: Direction;
}

/** Invert adjacency so we can answer "who shares inbound to X?" in O(1). */
function buildReverseAdjacency(adjacency: Record<string, string[]>): Record<string, string[]> {
  const reverse: Record<string, string[]> = {};
  for (const sourceId in adjacency) {
    for (const targetId of adjacency[sourceId]) {
      (reverse[targetId] ??= []).push(sourceId);
    }
  }
  return reverse;
}

/** Tag each neighbor of `source` as mutual/outgoing/incoming. */
export function classifyArcs(
  source: NetworkNode,
  nodesMap: Map<string, NetworkNode>,
  adjacency: Record<string, string[]>,
  reverseAdjacency: Record<string, string[]>,
): DirectionalArc[] {
  const outgoing = new Set(adjacency[source.id] ?? []);
  const incoming = new Set(reverseAdjacency[source.id] ?? []);
  const neighborIds = new Set<string>();
  outgoing.forEach(id => neighborIds.add(id));
  incoming.forEach(id => neighborIds.add(id));

  const arcs: DirectionalArc[] = [];
  for (const nid of neighborIds) {
    const target = nodesMap.get(nid);
    if (!target) continue;
    const isOut = outgoing.has(nid);
    const isIn = incoming.has(nid);
    const direction: Direction = isOut && isIn ? 'mutual' : isOut ? 'outgoing' : 'incoming';
    arcs.push({ source, target, direction });
  }
  return arcs;
}

export type NetworkLoadPhase = 'idle' | 'fetching' | 'ready' | 'error';

interface NetworkState {
  loadPhase: NetworkLoadPhase;
  nodesMap: Map<string, NetworkNode>;
  nodesArray: NetworkNode[];
  adjacency: Record<string, string[]>;
  reverseAdjacency: Record<string, string[]>;
  selectedNodeId: string | null;
  selectedNode: NetworkNode | null;
  selectedArcs: DirectionalArc[];
  hoveredNode: NetworkNode | null;
  hoverArcsEnabled: boolean;
  arcWidth: number;
  searchQuery: string;
  typeFilter: Set<string>; // empty = show all
  portalOnly: boolean;
  error: string | null;

  loadNetworkData: () => Promise<void>;
  setSelectedNodeId: (id: string | null) => void;
  setHoveredNode: (node: NetworkNode | null) => void;
  setHoverArcsEnabled: (enabled: boolean) => void;
  setArcWidth: (width: number) => void;
  setSearchQuery: (query: string) => void;
  toggleTypeFilter: (type: string) => void;
  clearTypeFilter: () => void;
  togglePortalOnly: () => void;
  clearSelection: () => void;
}

/** Deterministic hash for jittering state-centroid nodes */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Apply deterministic jitter to imprecise geocodes so they don't stack */
function jitterCoordinates(node: { id: string; geocodeMethod: string; coordinates: [number, number] }): [number, number] {
  if (node.geocodeMethod === 'state' || node.geocodeMethod === 'default') {
    const seed = hashCode(node.id);
    const dx = ((seed % 200) - 100) / 1000;       // +/-0.1 degrees
    const dy = (((seed >> 8) % 200) - 100) / 1000;
    return [node.coordinates[0] + dx, node.coordinates[1] + dy];
  }
  return node.coordinates;
}

interface GeoJSONFeature {
  type: string;
  geometry: { type: string; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

interface GeoJSONFeatureCollection {
  type: string;
  features: GeoJSONFeature[];
}

function parseGeoJSON(geojson: GeoJSONFeatureCollection): { nodesMap: Map<string, NetworkNode>; nodesArray: NetworkNode[] } {
  const nodesMap = new Map<string, NetworkNode>();
  const nodesArray: NetworkNode[] = [];

  for (const feature of geojson.features) {
    if (feature.geometry.type !== 'Point') continue;
    const [lng, lat] = feature.geometry.coordinates;
    if (lng === 0 && lat === 0) continue; // skip invalid coordinates
    const p = feature.properties;
    const raw: NetworkNode = {
      id: p.id as string,
      name: p.name as string,
      city: (p.city as string) || '',
      state: (p.state as string) || '',
      type: (p.type as NetworkNode['type']) || 'other',
      isPortal: Boolean(p.isPortal),
      cameras: Number(p.cameras) || 0,
      searches: Number(p.searches) || 0,
      vehiclesCaptured: Number(p.vehiclesCaptured) || 0,
      connectionCount: Number(p.connectionCount) || 0,
      population: Number(p.population) || 0,
      hotlistHits: Number(p.hotlistHits) || 0,
      geocodeMethod: (p.geocodeMethod as string) || 'default',
      coordinates: feature.geometry.coordinates as [number, number],
    };
    raw.coordinates = jitterCoordinates(raw);
    nodesMap.set(raw.id, raw);
    nodesArray.push(raw);
  }

  return { nodesMap, nodesArray };
}

let _initPromise: Promise<void> | null = null;

export const useNetworkStore = create<NetworkState>((set, get) => ({
  loadPhase: 'idle',
  nodesMap: new Map(),
  nodesArray: [],
  adjacency: {},
  reverseAdjacency: {},
  selectedNodeId: null,
  selectedNode: null,
  selectedArcs: [],
  hoveredNode: null,
  hoverArcsEnabled: false,
  arcWidth: 0.5,
  searchQuery: '',
  typeFilter: new Set(),
  portalOnly: true,
  error: null,

  loadNetworkData: async () => {
    const { loadPhase, nodesArray } = get();
    if (loadPhase === 'fetching') return;
    if (nodesArray.length > 0) return; // already loaded

    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      set({ loadPhase: 'fetching', error: null });
      try {
        const [nodesResponse, adjacencyResponse] = await Promise.all([
          fetch('/sharing-network-nodes.geojson'),
          fetch('/sharing-network-adjacency.json'),
        ]);

        if (!nodesResponse.ok) throw new Error(`Nodes fetch failed: ${nodesResponse.status}`);
        if (!adjacencyResponse.ok) throw new Error(`Adjacency fetch failed: ${adjacencyResponse.status}`);

        const [nodesGeoJSON, adjacency] = await Promise.all([
          nodesResponse.json(),
          adjacencyResponse.json(),
        ]);

        const { nodesMap, nodesArray } = parseGeoJSON(nodesGeoJSON);
        const reverseAdjacency = buildReverseAdjacency(adjacency);

        set({
          nodesMap,
          nodesArray,
          adjacency,
          reverseAdjacency,
          loadPhase: 'ready',
        });
        _initPromise = null;
      } catch (error) {
        console.error('[NetworkStore] Failed to load network data:', error);
        set({
          error: error instanceof Error ? error.message : 'Failed to load network data',
          loadPhase: 'error',
        });
        _initPromise = null;
      }
    })();

    return _initPromise;
  },

  setSelectedNodeId: (id) => {
    const { nodesMap, adjacency, reverseAdjacency } = get();
    if (!id) {
      set({ selectedNodeId: null, selectedNode: null, selectedArcs: [] });
      return;
    }
    const sourceNode = nodesMap.get(id);
    if (!sourceNode) return;

    const arcs = classifyArcs(sourceNode, nodesMap, adjacency, reverseAdjacency);

    set({
      selectedNodeId: id,
      selectedNode: sourceNode,
      selectedArcs: arcs,
    });
  },

  setHoveredNode: (node) => set({ hoveredNode: node }),
  setHoverArcsEnabled: (enabled) => set({ hoverArcsEnabled: enabled }),
  setArcWidth: (width) => set({ arcWidth: width }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleTypeFilter: (type) => {
    const { typeFilter } = get();
    const next = new Set(typeFilter);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    set({ typeFilter: next });
  },

  clearTypeFilter: () => set({ typeFilter: new Set() }),

  togglePortalOnly: () => set((s) => ({ portalOnly: !s.portalOnly })),

  clearSelection: () => set({ selectedNodeId: null, selectedNode: null, selectedArcs: [] }),
}));
