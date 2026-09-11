import { create } from 'zustand';
import { readBodyWithProgress, type DownloadProgress } from '../services/cameraDataService';
import { networkDataUrl, parseNetworkMeta, type NetworkMeta } from '../services/networkDataService';

export interface NetworkNode {
  id: string;
  name: string;
  city: string;
  state: string;
  type: 'pd' | 'so' | 'federal' | 'school' | 'other';
  isPortal: boolean;
  isInactive: boolean;
  isLikelyAggregator: boolean;
  portalSlug: string | null;
  aliases: string[];
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
export type TabKey = 'all' | Direction;

/** Human-readable labels for NetworkNode['type']. */
export const TYPE_LABELS: Record<NetworkNode['type'], string> = {
  pd: 'Police Department',
  so: "Sheriff's Office",
  federal: 'Federal Agency',
  school: 'School District',
  other: 'Other Agency',
};

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

/** Arcs for a selection, honoring the inferred-connections gate: non-portal
 *  agencies have no disclosures of their own, so their arcs (mentions in
 *  other agencies' portals) stay hidden until the user opts in. */
function gatedArcs(
  source: NetworkNode,
  state: Pick<NetworkState, 'nodesMap' | 'adjacency' | 'reverseAdjacency' | 'inferredConnectionsEnabled'>,
): DirectionalArc[] {
  if (!source.isPortal && !state.inferredConnectionsEnabled) return [];
  return classifyArcs(source, state.nodesMap, state.adjacency, state.reverseAdjacency);
}

export type NetworkLoadPhase = 'idle' | 'fetching' | 'ready' | 'error';

interface NetworkState {
  /** Nodes lifecycle. 'ready' means agency dots can render; adjacency may still be streaming. */
  loadPhase: NetworkLoadPhase;
  /** True once adjacency + reverseAdjacency are committed. */
  adjacencyReady: boolean;
  nodesProgress: DownloadProgress | null;
  adjacencyProgress: DownloadProgress | null;
  /** Provenance of the loaded snapshot (weekly publish). Optional: null when
   *  the meta file is unavailable; the map loads regardless. */
  meta: NetworkMeta | null;
  nodesMap: Map<string, NetworkNode>;
  nodesArray: NetworkNode[];
  adjacency: Record<string, string[]>;
  reverseAdjacency: Record<string, string[]>;
  selectedNodeId: string | null;
  selectedNode: NetworkNode | null;
  selectedArcs: DirectionalArc[];
  activeTab: TabKey;
  hoveredNode: NetworkNode | null;
  hoverArcsEnabled: boolean;
  arcWidth: number;
  searchQuery: string;
  typeFilter: Set<string>; // empty = show all
  portalOnly: boolean;
  /** When false, non-portal hover arcs are suppressed and click triggers ghost reveal. */
  inferredConnectionsEnabled: boolean;
  /** Incremented each time a ghost reveal animation should play (non-portal click). */
  ghostRevealSeq: number;
  error: string | null;

  loadNetworkData: () => Promise<void>;
  setSelectedNodeId: (id: string | null) => void;
  setActiveTab: (tab: TabKey) => void;
  setHoveredNode: (node: NetworkNode | null) => void;
  setHoverArcsEnabled: (enabled: boolean) => void;
  setArcWidth: (width: number) => void;
  setSearchQuery: (query: string) => void;
  toggleTypeFilter: (type: string) => void;
  clearTypeFilter: () => void;
  togglePortalOnly: () => void;
  toggleInferredConnections: () => void;
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
    if (p.isJunk === true) continue; // upstream-flagged garbage (e.g. "265", "DO NOT USE")
    const raw: NetworkNode = {
      id: p.id as string,
      name: p.name as string,
      city: (p.city as string) || '',
      state: (p.state as string) || '',
      type: (p.type as NetworkNode['type']) || 'other',
      isPortal: Boolean(p.isPortal),
      isInactive: Boolean(p.isInactive),
      isLikelyAggregator: Boolean(p.isLikelyAggregator),
      portalSlug: (p.portalSlug as string | null) ?? null,
      aliases: Array.isArray(p.aliases) ? (p.aliases as string[]) : [],
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
  adjacencyReady: false,
  nodesProgress: null,
  adjacencyProgress: null,
  meta: null,
  nodesMap: new Map(),
  nodesArray: [],
  adjacency: {},
  reverseAdjacency: {},
  selectedNodeId: null,
  selectedNode: null,
  selectedArcs: [],
  activeTab: 'all',
  hoveredNode: null,
  hoverArcsEnabled: false,
  arcWidth: 0.5,
  searchQuery: '',
  typeFilter: new Set(),
  portalOnly: false,
  inferredConnectionsEnabled: false,
  ghostRevealSeq: 0,
  error: null,

  loadNetworkData: async () => {
    if (get().loadPhase === 'fetching') return;
    if (_initPromise) return _initPromise;

    const needNodes = get().nodesArray.length === 0;
    const needAdjacency = !get().adjacencyReady;
    const needMeta = get().meta === null;
    if (!needNodes && !needAdjacency) return;

    _initPromise = (async () => {
      set({ error: null, ...(needNodes ? { loadPhase: 'fetching' as const } : {}) });

      // Each file commits the moment it lands: nodes unlock the dot layer
      // (and flip loadPhase to 'ready'); adjacency arrives later and
      // backfills arcs for any selection made in the meantime.
      // Files come from the deflock-data CDN (weekly publish; see
      // networkDataService). They are stored gzip, which a cross-origin fetch
      // cannot see in the headers, so progress is byte counts, not percent.
      const nodesTask = needNodes
        ? (async () => {
            const response = await fetch(networkDataUrl('sharing-network-nodes.geojson'));
            if (!response.ok) throw new Error(`Nodes fetch failed: ${response.status}`);
            const text = await readBodyWithProgress(response, (percent, loadedBytes) => {
              set({ nodesProgress: { percent, loadedBytes } });
            }, { assumeCompressed: true });
            const { nodesMap, nodesArray } = parseGeoJSON(JSON.parse(text));
            set({ nodesMap, nodesArray, loadPhase: 'ready', nodesProgress: null });
          })()
        : Promise.resolve();

      const adjacencyTask = needAdjacency
        ? (async () => {
            const response = await fetch(networkDataUrl('sharing-network-adjacency.json'));
            if (!response.ok) throw new Error(`Adjacency fetch failed: ${response.status}`);
            const text = await readBodyWithProgress(response, (percent, loadedBytes) => {
              set({ adjacencyProgress: { percent, loadedBytes } });
            }, { assumeCompressed: true });
            const adjacency = JSON.parse(text) as Record<string, string[]>;
            const reverseAdjacency = buildReverseAdjacency(adjacency);
            set({ adjacency, reverseAdjacency, adjacencyReady: true, adjacencyProgress: null });

            // Backfill arcs for a selection made while adjacency streamed
            const backfillState = get();
            const source = backfillState.selectedNodeId
              ? backfillState.nodesMap.get(backfillState.selectedNodeId)
              : undefined;
            if (source) {
              set({ selectedArcs: gatedArcs(source, backfillState) });
            }
          })()
        : Promise.resolve();

      // Provenance is best-effort: the "as of" label is nice to have, the map
      // must never wait on it or fail because of it.
      const metaTask = needMeta
        ? (async () => {
            try {
              const response = await fetch(networkDataUrl('sharing-network-meta.json'));
              if (!response.ok) return;
              const meta = parseNetworkMeta(await response.json());
              if (meta) set({ meta });
            } catch (err) {
              console.warn('[NetworkStore] Network meta unavailable:', err);
            }
          })()
        : Promise.resolve();

      const [nodesResult, adjacencyResult] = await Promise.allSettled([nodesTask, adjacencyTask, metaTask]);
      _initPromise = null;

      const failure = [nodesResult, adjacencyResult].find(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      if (failure) {
        console.error('[NetworkStore] Failed to load network data:', failure.reason);
        set((state) => ({
          error: failure.reason instanceof Error ? failure.reason.message : 'Failed to load network data',
          // Failed adjacency after committed nodes leaves the dots usable
          loadPhase: nodesResult.status === 'rejected' ? 'error' : state.loadPhase,
          nodesProgress: null,
          adjacencyProgress: null,
        }));
      }
    })();

    return _initPromise;
  },

  setSelectedNodeId: (id) => {
    if (!id) {
      set({ selectedNodeId: null, selectedNode: null, selectedArcs: [], activeTab: 'all', ghostRevealSeq: 0 });
      return;
    }
    const { nodesMap } = get();
    const sourceNode = nodesMap.get(id);
    if (!sourceNode) return;

    const needsGhostReveal = !sourceNode.isPortal;
    const arcs = needsGhostReveal ? [] : gatedArcs(sourceNode, get());

    set({
      selectedNodeId: id,
      selectedNode: sourceNode,
      selectedArcs: arcs,
      ghostRevealSeq: needsGhostReveal ? get().ghostRevealSeq + 1 : 0,
      inferredConnectionsEnabled: needsGhostReveal ? false : get().inferredConnectionsEnabled,
      activeTab: 'all',
    });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

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

  toggleInferredConnections: () => {
    set((s) => ({ inferredConnectionsEnabled: !s.inferredConnectionsEnabled }));
    const { selectedNode } = get();
    if (selectedNode) {
      set({ selectedArcs: gatedArcs(selectedNode, get()) });
    }
  },

  clearSelection: () => set({ selectedNodeId: null, selectedNode: null, selectedArcs: [], activeTab: 'all', ghostRevealSeq: 0 }),
}));
