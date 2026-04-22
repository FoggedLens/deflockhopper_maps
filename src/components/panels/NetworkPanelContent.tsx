import { useState, useEffect, useMemo, useCallback, useId } from 'react';
import { useNetworkStore } from '../../store/networkStore';
import { useMapStore } from '../../store';
import { Search, X, ChevronDown, ChevronUp, Camera, ScanSearch, Car, AlertTriangle, Link2, Users, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type { NetworkNode, Direction } from '../../store/networkStore';

/* ------------------------------------------------------------------ */
/*  Shared constants & helpers                                         */
/* ------------------------------------------------------------------ */

const TYPE_LABELS: Record<string, string> = {
  pd: 'Police Department',
  so: "Sheriff's Office",
  federal: 'Federal Agency',
  school: 'School District',
  other: 'Other Agency',
};

const TYPE_COLORS: Record<string, string> = {
  pd: 'bg-accent',
  so: 'bg-teal-500',
  federal: 'bg-amber-500',
  school: 'bg-purple-500',
  other: 'bg-gray-500',
};

const DIRECTION_HEX: Record<Direction, string> = {
  outgoing: '#F97316',
  incoming: '#38BDF8',
  mutual:   '#0080BC',
};

const DIRECTION_DOT: Record<Direction, string> = {
  outgoing: 'bg-orange-500',
  incoming: 'bg-sky-400',
  mutual:   'bg-accent',
};

// Reserved for Task 4 — silenced until then
const DIRECTION_TAB_LABEL: Record<Direction, string> = {
  mutual: 'Mutual',
  outgoing: 'Outgoing',
  incoming: 'Incoming',
};
void DIRECTION_TAB_LABEL;

// Reserved for Task 4 — silenced until then
const DIRECTION_EMPTY_MSG: Record<Direction, string> = {
  mutual: 'No mutual connections.',
  outgoing: 'No outgoing-only connections.',
  incoming: 'No incoming-only connections.',
};
void DIRECTION_EMPTY_MSG;

/** Small inline SVG arc swatch that matches the map's gradient treatment. */
function ArcSwatch({ direction }: { direction: Direction }) {
  const reactId = useId();
  const gradId = `arc-swatch-${direction}-${reactId}`;
  const color = DIRECTION_HEX[direction];

  if (direction === 'mutual') {
    return (
      <svg width="22" height="10" viewBox="0 0 22 10" className="flex-shrink-0">
        <path d="M2 8 Q 11 -1 20 8" stroke={color} strokeOpacity="0.85" strokeWidth="1.75" fill="none" strokeLinecap="round" />
      </svg>
    );
  }

  const fromOpacity = direction === 'outgoing' ? 0.9 : 0.25;
  const toOpacity   = direction === 'outgoing' ? 0.25 : 0.9;

  return (
    <svg width="22" height="10" viewBox="0 0 22 10" className="flex-shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0%" x2="100%">
          <stop offset="0%"   stopColor={color} stopOpacity={fromOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity={toOpacity} />
        </linearGradient>
      </defs>
      <path d="M2 8 Q 11 -1 20 8" stroke={`url(#${gradId})`} strokeWidth="1.75" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function StatRow({ icon: Icon, label, value, colorClass }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <Icon className="w-4 h-4 text-dark-400 flex-shrink-0" />
      <span className="text-sm text-dark-300 flex-1">{label}</span>
      {colorClass && (
        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} aria-hidden />
      )}
      <span className="text-sm font-medium text-white tabular-nums">{value}</span>
    </div>
  );
}

const INITIAL_SHOW_COUNT = 10;

/* ------------------------------------------------------------------ */
/*  NetworkPanelContent                                                */
/* ------------------------------------------------------------------ */

export function NetworkPanelContent() {
  const [showAll, setShowAll] = useState(false);

  const {
    loadPhase, loadNetworkData, nodesArray, searchQuery,
    setSearchQuery, setSelectedNodeId, selectedNode, selectedArcs,
    clearSelection, arcWidth, setArcWidth, hoverArcsEnabled, setHoverArcsEnabled,
    portalOnly, togglePortalOnly, error,
  } = useNetworkStore();

  // Load data on mount
  useEffect(() => {
    loadNetworkData();
  }, [loadNetworkData]);

  // Reset showAll when selected node changes
  useEffect(() => {
    setShowAll(false);
  }, [selectedNode?.id]);

  // Escape key to dismiss selection
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') clearSelection();
  }, [clearSelection]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return nodesArray
      .filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.city.toLowerCase().includes(q) ||
        n.state.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [nodesArray, searchQuery]);

  const handleSearchSelect = useCallback((node: NetworkNode) => {
    setSelectedNodeId(node.id);
    setSearchQuery('');
    useMapStore.getState().flyTo([node.coordinates[1], node.coordinates[0]], 8);
  }, [setSelectedNodeId, setSearchQuery]);

  const handleConnectionClick = useCallback((node: NetworkNode) => {
    setSelectedNodeId(node.id);
    useMapStore.getState().flyTo([node.coordinates[1], node.coordinates[0]], 8);
  }, [setSelectedNodeId]);

  const isLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const mutualCount   = useMemo(() => selectedArcs.filter(a => a.direction === 'mutual').length,   [selectedArcs]);
  const outgoingCount = useMemo(() => selectedArcs.filter(a => a.direction === 'outgoing').length, [selectedArcs]);
  const incomingCount = useMemo(() => selectedArcs.filter(a => a.direction === 'incoming').length, [selectedArcs]);
  const connections = selectedArcs.map(a => a.target);
  const visibleConnections = showAll ? connections : connections.slice(0, INITIAL_SHOW_COUNT);
  const hasMore = connections.length > INITIAL_SHOW_COUNT;

  return (
    <>
      {isLoading && (
        <div className="flex items-center gap-3 py-4">
          <div className="w-5 h-5 border-2 border-dark-600 border-t-accent rounded-full animate-spin" />
          <span className="text-sm text-dark-300">Loading network data...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-red-400 mb-2">Failed to load network data</p>
          <p className="text-xs text-dark-500 mb-3">{error}</p>
          <button
            onClick={() => { useNetworkStore.getState().loadNetworkData(); }}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {loadPhase === 'ready' && (
        <>
          {/* Search -- always at top */}
          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agencies..."
              className="w-full pl-10 pr-8 py-2.5 bg-dark-800 border border-dark-700 rounded-xl text-sm text-white placeholder:text-dark-500 focus:outline-none focus:border-accent/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-dark-700 rounded-xl shadow-xl shadow-black/30 max-h-60 overflow-y-auto z-10">
                {searchResults.map(node => (
                  <button
                    key={node.id}
                    onClick={() => handleSearchSelect(node)}
                    className="w-full text-left px-4 py-2.5 hover:bg-dark-700 transition-colors border-b border-dark-700/50 last:border-b-0"
                  >
                    <p className="text-sm text-white font-medium">{node.name}</p>
                    <p className="text-xs text-dark-400">
                      {node.connectionCount} connections
                      {node.isPortal && ` \u00b7 ${node.cameras} cameras`}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected node info / description */}
          {selectedNode ? (
            <div>
              {/* Node header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-white truncate">{selectedNode.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${TYPE_COLORS[selectedNode.type] || TYPE_COLORS.other}`} />
                    <span className="text-xs text-dark-400">
                      {TYPE_LABELS[selectedNode.type]}
                      {selectedNode.state && ` \u00b7 ${selectedNode.state}`}
                    </span>
                  </div>
                  {(selectedNode.geocodeMethod === 'state' || selectedNode.geocodeMethod === 'default') && (
                    <p className="text-xs text-amber-500/80 mt-1">
                      Location approximate ({selectedNode.geocodeMethod}-level)
                    </p>
                  )}
                </div>
                <button
                  onClick={clearSelection}
                  className="flex-shrink-0 ml-2 p-1 text-dark-400 hover:text-white rounded-lg hover:bg-dark-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Stats */}
              <div className="mb-4">
                {selectedNode.isPortal && (
                  <>
                    <StatRow icon={Camera} label="Cameras" value={formatNumber(selectedNode.cameras)} />
                    <StatRow icon={ScanSearch} label="Searches" value={formatNumber(selectedNode.searches)} />
                    <StatRow icon={Car} label="Vehicles scanned" value={formatNumber(selectedNode.vehiclesCaptured)} />
                    <StatRow icon={AlertTriangle} label="Hotlist hits" value={formatNumber(selectedNode.hotlistHits)} />
                  </>
                )}
                {mutualCount > 0 && (
                  <StatRow icon={Link2} label="Mutual" value={formatNumber(mutualCount)} colorClass={DIRECTION_DOT.mutual} />
                )}
                {outgoingCount > 0 && (
                  <StatRow icon={ArrowUpRight} label="Outgoing only" value={formatNumber(outgoingCount)} colorClass={DIRECTION_DOT.outgoing} />
                )}
                {incomingCount > 0 && (
                  <StatRow icon={ArrowDownLeft} label="Incoming only" value={formatNumber(incomingCount)} colorClass={DIRECTION_DOT.incoming} />
                )}
                {mutualCount + outgoingCount + incomingCount === 0 && (
                  <StatRow icon={Link2} label="Connections" value="0" />
                )}
                {selectedNode.population > 0 && (
                  <StatRow icon={Users} label="Population" value={formatNumber(selectedNode.population)} />
                )}
                {selectedNode.isPortal && (
                  <div className="mt-1">
                    <span className="inline-block text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">
                      Flock Portal
                    </span>
                  </div>
                )}
              </div>

              {/* Inline legend */}
              {selectedArcs.length > 0 && (
                <div className="mb-4 pb-3 border-b border-dark-700/50 space-y-1.5">
                  <p className="text-xs text-dark-400 uppercase tracking-wider font-medium mb-2">Connection Types</p>
                  <div className="flex items-center gap-2">
                    <ArcSwatch direction="mutual" />
                    <span className="text-xs text-dark-300">Mutual</span>
                    <span className="text-xs text-dark-500 ml-auto">both share</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArcSwatch direction="outgoing" />
                    <span className="text-xs text-dark-300">Outgoing</span>
                    <span className="text-xs text-dark-500 ml-auto">{selectedNode.name.length > 20 ? 'selected' : selectedNode.name} shares to them</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArcSwatch direction="incoming" />
                    <span className="text-xs text-dark-300">Incoming</span>
                    <span className="text-xs text-dark-500 ml-auto">they share to {selectedNode.name.length > 20 ? 'selected' : selectedNode.name}</span>
                  </div>
                </div>
              )}

              {/* Connections list */}
              {connections.length > 0 && (
                <div>
                  <p className="text-xs text-dark-400 uppercase tracking-wider font-medium mb-2">
                    Shares data with ({connections.length})
                  </p>
                  <div className="space-y-0.5">
                    {visibleConnections.map(node => (
                      <button
                        key={node.id}
                        onClick={() => handleConnectionClick(node)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-dark-800 transition-colors group"
                      >
                        <span className="text-sm text-dark-200 group-hover:text-white">{node.name}</span>
                      </button>
                    ))}
                  </div>
                  {hasMore && (
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="w-full flex items-center justify-center gap-1.5 mt-2 py-1.5 text-xs text-accent hover:text-accent transition-colors"
                    >
                      {showAll ? (
                        <>Show less <ChevronUp className="w-3 h-3" /></>
                      ) : (
                        <>Show all {connections.length} <ChevronDown className="w-3 h-3" /></>
                      )}
                    </button>
                  )}
                </div>
              )}

            </div>
          ) : (
            <div>
              <p className="text-sm text-dark-300 leading-relaxed mb-3">
                This map visualizes the Flock Safety surveillance sharing network &mdash; {nodesArray.length.toLocaleString()}+ law enforcement agencies that share automatic license plate reader (ALPR) data with each other. Click an agency to see who they share data with.
              </p>
              <p className="text-xs text-dark-500 leading-relaxed">
                Data sourced from{' '}
                <a href="https://eyesonflock.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent transition-colors">
                  EyesOnFlock.com
                </a>
                . This only includes agencies with public transparency portals &mdash; a fraction of the total network.
              </p>
            </div>
          )}

          {/* Arc settings */}
          <div className="mt-5 pt-5 border-t border-dark-700/50 space-y-4">
            {/* Portal only toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-dark-400 uppercase tracking-wider font-medium">Portal Agencies Only</span>
              <button
                onClick={togglePortalOnly}
                role="switch"
                aria-checked={portalOnly}
                className={`relative w-10 h-[22px] rounded-full transition-colors ${
                  portalOnly ? 'bg-accent' : 'bg-dark-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                    portalOnly ? 'translate-x-[18px]' : ''
                  }`}
                />
              </button>
            </div>

            {/* Hover arcs toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-dark-400 uppercase tracking-wider font-medium">Hover Preview</span>
              <button
                onClick={() => setHoverArcsEnabled(!hoverArcsEnabled)}
                role="switch"
                aria-checked={hoverArcsEnabled}
                className={`relative w-10 h-[22px] rounded-full transition-colors ${
                  hoverArcsEnabled ? 'bg-accent' : 'bg-dark-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                    hoverArcsEnabled ? 'translate-x-[18px]' : ''
                  }`}
                />
              </button>
            </div>

            {/* Arc thickness */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-dark-400 uppercase tracking-wider font-medium">Arc Thickness</span>
                <span className="text-xs text-dark-500 tabular-nums">{arcWidth.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={arcWidth}
                onChange={(e) => setArcWidth(Number(e.target.value))}
                className="w-full h-1.5 bg-dark-700 rounded-full appearance-none cursor-pointer accent-[#0080BC]"
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
