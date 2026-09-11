import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, ArcLayer } from '@deck.gl/layers';
import { useNetworkStore, classifyArcs } from '../../../store/networkStore';
import type { NetworkNode, Direction, DirectionalArc } from '../../../store/networkStore';
import { useMapStore } from '../../../store/mapStore';
import { ArcFlowExtension } from './arcFlowExtension';
import type { ArcFlowExtensionProps } from './arcFlowExtension';

// Single shared instance — the extension carries no per-layer state of its own.
const arcFlowExtension = new ArcFlowExtension();

function getFlowSign(d: DirectionalArc): number {
  if (d.direction === 'outgoing') return 1;
  if (d.direction === 'incoming') return -1;
  return 0;
}

const NODE_COLORS: Record<string, [number, number, number]> = {
  pd:      [59, 130, 246],   // blue
  so:      [20, 184, 166],   // teal
  federal: [245, 158, 11],   // amber
  school:  [139, 92, 246],   // purple
  other:   [107, 114, 128],  // gray
};

const DIRECTION_COLORS: Record<Direction, [number, number, number]> = {
  outgoing: [249, 115, 22],   // orange  #F97316 - selected agency shares to them
  incoming: [59, 130, 246],   // blue    #3B82F6 - they share to selected agency
  mutual:   [139, 92, 246],   // violet  #8B5CF6 - both directions
};

const TYPE_LABELS: Record<string, string> = {
  pd: 'Police Department',
  so: "Sheriff's Office",
  federal: 'Federal Agency',
  school: 'School District',
  other: 'Other Agency',
};

/** Bright at the sender's end, fading toward the receiver — direction reads
 *  from which end of the arc glows, not just its hue. Mutual arcs have no
 *  single sender, so both ends stay at full brightness. */
function arcAlpha(direction: Direction, endpoint: 'source' | 'target', high: number, low: number): number {
  if (direction === 'mutual') return high;
  const senderEndpoint = direction === 'outgoing' ? 'source' : 'target';
  return endpoint === senderEndpoint ? high : low;
}

export function NetworkLayers() {
  const { current: mapgl } = useMap();
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ node: NetworkNode; x: number; y: number } | null>(null);
  const [hoveredArcs, setHoveredArcs] = useState<DirectionalArc[]>([]);
  const hoverDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const lastNodeClickRef = useRef(0);

  const nodesArray = useNetworkStore(s => s.nodesArray);
  const nodesMap = useNetworkStore(s => s.nodesMap);
  const adjacency = useNetworkStore(s => s.adjacency);
  const adjacencyReady = useNetworkStore(s => s.adjacencyReady);
  const reverseAdjacency = useNetworkStore(s => s.reverseAdjacency);
  const selectedArcs = useNetworkStore(s => s.selectedArcs);
  const selectedNodeId = useNetworkStore(s => s.selectedNodeId);
  const typeFilter = useNetworkStore(s => s.typeFilter);
  const portalOnly = useNetworkStore(s => s.portalOnly);
  const arcWidth = useNetworkStore(s => s.arcWidth);
  const hoverArcsEnabled = useNetworkStore(s => s.hoverArcsEnabled);
  const inferredConnectionsEnabled = useNetworkStore(s => s.inferredConnectionsEnabled);
  const ghostRevealSeq = useNetworkStore(s => s.ghostRevealSeq);
  const activeTab = useNetworkStore(s => s.activeTab);
  const setSelectedNodeId = useNetworkStore(s => s.setSelectedNodeId);
  const setHoveredNode = useNetworkStore(s => s.setHoveredNode);

  // Filter nodes by type and portal status
  const filteredNodes = useMemo(() => {
    let nodes = nodesArray;
    if (typeFilter.size > 0) nodes = nodes.filter(n => typeFilter.has(n.type));
    if (portalOnly) nodes = nodes.filter(n => n.isPortal);
    return nodes;
  }, [nodesArray, typeFilter, portalOnly]);

  const handleNodeClick = useCallback((info: { object?: NetworkNode }) => {
    if (info.object) {
      lastNodeClickRef.current = Date.now();
      setSelectedNodeId(info.object.id);
    }
  }, [setSelectedNodeId]);

  const handleNodeHover = useCallback((info: { object?: NetworkNode; x?: number; y?: number }) => {
    if (info.object && info.x != null && info.y != null) {
      setHoverInfo({ node: info.object, x: info.x, y: info.y });
      setHoveredNode(info.object);

      // Debounced hover arcs — only compute adjacency after pointer settles.
      // Non-portal nodes stay arc-free until inferred connections are enabled.
      if (hoverArcsEnabled && !selectedNodeId && (info.object.isPortal || inferredConnectionsEnabled)) {
        clearTimeout(hoverDebounceRef.current);
        const node = info.object;
        hoverDebounceRef.current = setTimeout(() => {
          // ~16ms ≈ one frame at 60fps
          const arcs = classifyArcs(node, nodesMap, adjacency, reverseAdjacency);
          setHoveredArcs(arcs);
        }, 16);
      }
    } else {
      setHoverInfo(null);
      setHoveredNode(null);
      clearTimeout(hoverDebounceRef.current);
      if (hoveredArcs.length > 0) setHoveredArcs([]);
    }
  }, [setHoveredNode, hoverArcsEnabled, inferredConnectionsEnabled, selectedNodeId, adjacency, reverseAdjacency, nodesMap, hoveredArcs.length]);

  // Clear hover arcs when a node gets clicked (selected arcs take over)
  useEffect(() => {
    if (selectedNodeId) setHoveredArcs([]);
  }, [selectedNodeId]);

  // Ghost reveal animation for non-portal nodes — arcs fan out to random
  // agencies across the country, then fade, showing "connections unknown."
  const [ghostProgress, setGhostProgress] = useState(-1);
  const [ghostArcs, setGhostArcs] = useState<Array<{ source: [number, number]; target: [number, number] }>>([]);
  const [showGhostToast, setShowGhostToast] = useState(false);

  useEffect(() => {
    if (ghostRevealSeq === 0) {
      setGhostProgress(-1);
      setGhostArcs([]);
      setShowGhostToast(false);
      return;
    }

    const source = useNetworkStore.getState().selectedNode;
    if (!source) return;

    const pool = nodesArray.filter(n => n.id !== source.id);
    const count = Math.min(40, pool.length);
    const picked: typeof ghostArcs = [];
    const used = new Set<number>();
    while (picked.length < count && used.size < pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      if (used.has(idx)) continue;
      used.add(idx);
      picked.push({ source: source.coordinates, target: pool[idx].coordinates });
    }
    setGhostArcs(picked);
    setShowGhostToast(false);

    const DURATION = 900;
    const startTime = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const p = Math.min((now - startTime) / DURATION, 1);
      setGhostProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setGhostProgress(-1);
        setGhostArcs([]);
        setShowGhostToast(true);
        if (!useNetworkStore.getState().inferredConnectionsEnabled) {
          useNetworkStore.getState().toggleInferredConnections();
        }
      }
    };

    setGhostProgress(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ghostRevealSeq, nodesArray]);

  // Auto-dismiss ghost toast after 3 seconds or when selection changes
  useEffect(() => {
    if (!showGhostToast) return;
    const t = setTimeout(() => setShowGhostToast(false), 3000);
    return () => clearTimeout(t);
  }, [showGhostToast]);

  useEffect(() => {
    if (!selectedNodeId) setShowGhostToast(false);
  }, [selectedNodeId]);

  // Filter arcs by the active direction tab
  const visibleSelectedArcs = useMemo(
    () => activeTab === 'all' ? selectedArcs : selectedArcs.filter(a => a.direction === activeTab),
    [selectedArcs, activeTab],
  );
  const visibleHoveredArcs = useMemo(
    () => activeTab === 'all' ? hoveredArcs : hoveredArcs.filter(a => a.direction === activeTab),
    [hoveredArcs, activeTab],
  );

  // Traveling flow pulse along directional arcs — a uniform-driven clock, not
  // a per-arc CPU update, so it stays cheap no matter how many arcs are
  // visible (see arcFlowExtension.ts). Only runs while a directed (non-mutual)
  // arc is actually on screen.
  const [flowTime, setFlowTime] = useState(0);
  const flowRafRef = useRef<number>();
  const flowStartRef = useRef<number | null>(null);
  const hasDirectedArcs = useMemo(
    () => visibleSelectedArcs.some(a => a.direction !== 'mutual') || visibleHoveredArcs.some(a => a.direction !== 'mutual'),
    [visibleSelectedArcs, visibleHoveredArcs],
  );

  useEffect(() => {
    if (!hasDirectedArcs) {
      if (flowRafRef.current != null) cancelAnimationFrame(flowRafRef.current);
      flowStartRef.current = null;
      return;
    }
    const tick = (now: number) => {
      if (flowStartRef.current === null) flowStartRef.current = now;
      setFlowTime(((now - flowStartRef.current) / 1000) % 1000);
      flowRafRef.current = requestAnimationFrame(tick);
    };
    flowRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (flowRafRef.current != null) cancelAnimationFrame(flowRafRef.current);
    };
  }, [hasDirectedArcs]);

  // Build layers
  const layers = useMemo(() => {
    const result = [];
    const isGhosting = ghostProgress >= 0 && ghostProgress < 1;

    // Ghost reveal phase calculations
    let ghostAlpha = 0;
    let ghostHeight = 0;

    if (isGhosting) {
      const p = ghostProgress;
      if (p <= 0.35) {
        ghostAlpha = (p / 0.35) * 90;
        ghostHeight = p / 0.35;
      } else if (p <= 0.55) {
        ghostAlpha = 90;
        ghostHeight = 1;
      } else {
        const fadeP = Math.min((p - 0.55) / 0.45, 1);
        ghostAlpha = 90 * (1 - fadeP);
        ghostHeight = 1;
      }
    }

    // ScatterplotLayer - always visible
    result.push(
      new ScatterplotLayer<NetworkNode>({
        id: 'network-nodes',
        data: filteredNodes,
        getPosition: (d: NetworkNode) => d.coordinates,
        getRadius: 4000,
        getFillColor: (d: NetworkNode) => {
          // Dim non-connected nodes when a node is selected
          if (selectedNodeId && d.id !== selectedNodeId) {
            const isConnected = selectedArcs.some(a => a.target.id === d.id);
            if (!isConnected) {
              const base = NODE_COLORS[d.type] || NODE_COLORS.other;
              return [...base, 60] as [number, number, number, number];
            }
          }
          return NODE_COLORS[d.type] || NODE_COLORS.other;
        },
        getLineColor: (d: NetworkNode): [number, number, number] => {
          if (!d.isPortal) return [0, 0, 0];
          // Adjacency still streaming: no sharing verdict yet, so use the same
          // neutral gray as NODE_COLORS.other (Tailwind dark-500) rather than
          // red/green — otherwise every portal briefly paints "redacted".
          if (!adjacencyReady) return [107, 114, 128];
          const hasOutgoing = (adjacency[d.id]?.length ?? 0) > 0;
          return hasOutgoing ? [34, 197, 94] : [239, 68, 68]; // green vs red
        },
        getLineWidth: (d: NetworkNode) => d.isPortal ? 3 : 0,
        lineWidthUnits: 'pixels',
        stroked: true,
        pickable: true,
        radiusMinPixels: 3,
        radiusMaxPixels: 10,
        onClick: handleNodeClick,
        onHover: handleNodeHover,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 100],
        parameters: {
          depthCompare: 'always',
          depthWriteEnabled: false,
        },
        updateTriggers: {
          getFillColor: [selectedNodeId, selectedArcs.length],
          getLineColor: [adjacency, adjacencyReady],
          getLineWidth: [adjacency],
        },
      })
    );

    // Ghost ArcLayer - white arcs to random agencies, unfurl and fade
    if (isGhosting && ghostArcs.length > 0) {
      const ga = Math.round(ghostAlpha);
      result.push(
        new ArcLayer<{ source: [number, number]; target: [number, number] }>({
          id: 'network-ghost-arcs',
          data: ghostArcs,
          getSourcePosition: (d) => d.source,
          getTargetPosition: (d) => d.target,
          getSourceColor: [255, 255, 255, ga],
          getTargetColor: [255, 255, 255, ga],
          getWidth: arcWidth * 2,
          getHeight: ghostHeight,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 2)),
        })
      );
    }

    // ArcLayer - selected node (full opacity, with dimming on scatterplot)
    if (visibleSelectedArcs.length > 0) {
      result.push(
        new ArcLayer<DirectionalArc, ArcFlowExtensionProps<DirectionalArc>>({
          id: 'network-arcs',
          data: visibleSelectedArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], arcAlpha(d.direction, 'source', 230, 55)];
          },
          getTargetColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], arcAlpha(d.direction, 'target', 230, 55)];
          },
          getWidth: arcWidth * 4,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 4)),
          getFlowSign,
          flowTime,
          extensions: [arcFlowExtension],
        })
      );
    }

    // ArcLayer - hover preview (semi-transparent, no dimming)
    if (visibleHoveredArcs.length > 0 && !selectedNodeId) {
      result.push(
        new ArcLayer<DirectionalArc, ArcFlowExtensionProps<DirectionalArc>>({
          id: 'network-hover-arcs',
          data: visibleHoveredArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], arcAlpha(d.direction, 'source', 180, 40)];
          },
          getTargetColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], arcAlpha(d.direction, 'target', 180, 40)];
          },
          getWidth: arcWidth * 3,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 3)),
          getFlowSign,
          flowTime,
          extensions: [arcFlowExtension],
        })
      );
    }

    return result;
  }, [filteredNodes, selectedArcs, selectedNodeId, arcWidth, visibleSelectedArcs, visibleHoveredArcs, handleNodeClick, handleNodeHover, adjacency, adjacencyReady, ghostProgress, ghostArcs, flowTime]);
  // Note: selectedArcs kept in deps because ScatterplotLayer dimming uses it unfiltered (direction filter should not change which nodes dim).
  // adjacency/adjacencyReady kept in deps so the portal-ring ScatterplotLayer is rebuilt (not just
  // attribute-diffed) when adjacency finishes streaming in — see updateTriggers.getLineColor above.

  // Mount/unmount the deck.gl overlay
  useEffect(() => {
    if (!mapgl) return;
    const map = mapgl.getMap();

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay as unknown as maplibregl.IControl);
    overlayRef.current = overlay;

    return () => {
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl);
      } catch { /* map may already be destroyed */ }
      overlayRef.current = null;
    };
  }, [mapgl]);

  // Update layers when they change
  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setProps({ layers });
    }
  }, [layers]);

  // Clear hover on map interaction — touch devices never fire pointerleave.
  useEffect(() => {
    if (!mapgl) return;
    const map = mapgl.getMap();
    const clearHover = () => {
      setHoverInfo(null);
      setHoveredArcs([]);
      setHoveredNode(null);
    };
    map.on('movestart', clearHover);
    return () => {
      map.off('movestart', clearHover);
    };
  }, [mapgl, setHoveredNode]);

  // Clear selection when tapping the empty basemap. Guard against the node's
  // own click also firing a map click immediately after.
  useEffect(() => {
    if (!mapgl) return;
    const map = mapgl.getMap();
    const handleMapClick = () => {
      if (Date.now() - lastNodeClickRef.current < 400) return;
      useNetworkStore.getState().clearSelection();
    };
    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [mapgl]);

  // Fly to US overview with 3D pitch on mount.
  // Deferred by one frame so the deck.gl overlay is fully initialised and
  // any prior pitch animation (e.g. from DensityLayers cleanup) has settled.
  // Skip the flyTo if URL had viewport params (share link) — just set the pitch.
  useEffect(() => {
    if (!mapgl) return;
    const map = mapgl.getMap();
    const hasViewport = useMapStore.getState().urlHadViewport;

    const raf = requestAnimationFrame(() => {
      if (hasViewport) {
        map.easeTo({ pitch: 45, duration: 800 });
      } else {
        map.flyTo({
          center: [-98.5, 39.0],
          zoom: 4,
          pitch: 45,
          bearing: 0,
          duration: 1500,
        });
      }
    });

    // Reset pitch when leaving network mode
    return () => {
      cancelAnimationFrame(raf);
      try {
        map.easeTo({ pitch: 0, duration: 300 });
      } catch { /* map may already be destroyed */ }
    };
  }, [mapgl]);

  // Compute tooltip position relative to the viewport by adding the map container's offset
  const tooltipPos = useMemo(() => {
    if (!hoverInfo || !mapgl) return null;
    const container = mapgl.getMap().getContainer();
    const rect = container.getBoundingClientRect();
    return {
      left: rect.left + hoverInfo.x + 12,
      top: rect.top + hoverInfo.y - 12,
    };
  }, [hoverInfo, mapgl]);

  // Project selected node to screen for ghost toast positioning
  const [ghostToastPos, setGhostToastPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!showGhostToast || !mapgl) {
      setGhostToastPos(null);
      return;
    }
    const node = useNetworkStore.getState().selectedNode;
    if (!node) return;

    const map = mapgl.getMap();
    const update = () => {
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      const pt = map.project(node.coordinates as [number, number]);
      setGhostToastPos({ left: rect.left + pt.x, top: rect.top + pt.y });
    };
    update();
    map.on('move', update);
    return () => { map.off('move', update); };
  }, [showGhostToast, mapgl]);

  return (
    <>
      {/* Hover tooltip */}
      {hoverInfo && tooltipPos && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="bg-dark-800/90 rounded-md border border-dark-600 px-3 py-2 whitespace-nowrap">
            <p className="text-sm font-medium text-white">{hoverInfo.node.name}</p>
            <p className="text-xs text-dark-400">
              {TYPE_LABELS[hoverInfo.node.type] || 'Other'}
              {hoverInfo.node.state && ` · ${hoverInfo.node.state}`}
            </p>
          </div>
        </div>
      )}

      {/* Ghost reveal toast — anchored above the clicked node */}
      {showGhostToast && ghostToastPos && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: ghostToastPos.left, top: ghostToastPos.top - 16 }}
        >
          <div className="rounded-md border border-dark-500/60 bg-dark-800/90 px-3 py-1.5 text-center whitespace-nowrap shadow-md backdrop-blur-sm">
            <p className="text-xs font-medium text-dark-300">No transparency portal. Showing inferred connections.</p>
          </div>
        </div>
      )}
    </>
  );
}
