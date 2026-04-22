import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, ArcLayer } from '@deck.gl/layers';
import { useNetworkStore, classifyArcs } from '../../../store/networkStore';
import type { NetworkNode, Direction, DirectionalArc } from '../../../store/networkStore';

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

export function NetworkLayers() {
  const { current: mapgl } = useMap();
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ node: NetworkNode; x: number; y: number } | null>(null);
  const [hoveredArcs, setHoveredArcs] = useState<DirectionalArc[]>([]);
  const hoverDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const nodesArray = useNetworkStore(s => s.nodesArray);
  const nodesMap = useNetworkStore(s => s.nodesMap);
  const adjacency = useNetworkStore(s => s.adjacency);
  const reverseAdjacency = useNetworkStore(s => s.reverseAdjacency);
  const selectedArcs = useNetworkStore(s => s.selectedArcs);
  const selectedNodeId = useNetworkStore(s => s.selectedNodeId);
  const typeFilter = useNetworkStore(s => s.typeFilter);
  const portalOnly = useNetworkStore(s => s.portalOnly);
  const arcWidth = useNetworkStore(s => s.arcWidth);
  const hoverArcsEnabled = useNetworkStore(s => s.hoverArcsEnabled);
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
      setSelectedNodeId(info.object.id);
    }
  }, [setSelectedNodeId]);

  const handleNodeHover = useCallback((info: { object?: NetworkNode; x?: number; y?: number }) => {
    if (info.object && info.x != null && info.y != null) {
      setHoverInfo({ node: info.object, x: info.x, y: info.y });
      setHoveredNode(info.object);

      // Debounced hover arcs — only compute adjacency after pointer settles
      if (hoverArcsEnabled && !selectedNodeId) {
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
  }, [setHoveredNode, hoverArcsEnabled, selectedNodeId, adjacency, reverseAdjacency, nodesMap, hoveredArcs.length]);

  // Clear hover arcs when a node gets clicked (selected arcs take over)
  useEffect(() => {
    if (selectedNodeId) setHoveredArcs([]);
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

  // Build layers
  const layers = useMemo(() => {
    const result = [];

    // ScatterplotLayer - always visible
    result.push(
      new ScatterplotLayer<NetworkNode>({
        id: 'network-nodes',
        data: filteredNodes,
        getPosition: (d: NetworkNode) => d.coordinates,
        getRadius: (d: NetworkNode) => d.isPortal ? 6000 : 3000,
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
        getLineColor: (d: NetworkNode) => d.isPortal ? [34, 197, 94] : [255, 255, 255],
        getLineWidth: (d: NetworkNode) => d.isPortal ? 2 : 1,
        stroked: true,
        pickable: true,
        radiusMinPixels: 2,
        radiusMaxPixels: 12,
        onClick: handleNodeClick,
        onHover: handleNodeHover,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 100],
        updateTriggers: {
          getFillColor: [selectedNodeId, selectedArcs.length],
        },
      })
    );

    // ArcLayer - selected node (full opacity, with dimming on scatterplot)
    if (visibleSelectedArcs.length > 0) {
      result.push(
        new ArcLayer<DirectionalArc>({
          id: 'network-arcs',
          data: visibleSelectedArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], 230];
          },
          getTargetColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], 230];
          },
          getWidth: arcWidth * 4,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 4)),
        })
      );
    }

    // ArcLayer - hover preview (semi-transparent, no dimming)
    if (visibleHoveredArcs.length > 0 && !selectedNodeId) {
      result.push(
        new ArcLayer<DirectionalArc>({
          id: 'network-hover-arcs',
          data: visibleHoveredArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], 130];
          },
          getTargetColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            return [c[0], c[1], c[2], 130];
          },
          getWidth: arcWidth * 3,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 3)),
        })
      );
    }

    return result;
  }, [filteredNodes, selectedArcs, selectedNodeId, arcWidth, visibleSelectedArcs, visibleHoveredArcs, handleNodeClick, handleNodeHover]);
  // Note: selectedArcs kept in deps because ScatterplotLayer dimming uses it unfiltered (direction filter should not change which nodes dim).

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

  // Fly to US overview with 3D pitch on mount.
  // Deferred by one frame so the deck.gl overlay is fully initialised and
  // any prior pitch animation (e.g. from DensityLayers cleanup) has settled.
  // Skip the flyTo if URL had viewport params (share link) — just set the pitch.
  useEffect(() => {
    if (!mapgl) return;
    const map = mapgl.getMap();
    const hasViewport = new URLSearchParams(window.location.search).has('lat');

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

  // Hover tooltip
  if (!hoverInfo || !tooltipPos) return null;

  return (
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
  );
}
