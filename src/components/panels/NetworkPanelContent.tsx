import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNetworkStore } from '../../store/networkStore';
import { useMapStore } from '../../store';
import { Search, X, ChevronDown, ChevronUp, Camera, ScanSearch, Car, AlertTriangle, Link2, Users, ArrowUpRight, ArrowDownLeft, ExternalLink } from 'lucide-react';
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
  incoming: '#3B82F6',
  mutual:   '#8B5CF6',
};

const DIRECTION_DOT: Record<Direction, string> = {
  outgoing: 'bg-orange-500',
  incoming: 'bg-blue-500',
  mutual:   'bg-violet-500',
};

const DIRECTION_TAB_LABEL: Record<Direction, string> = {
  mutual: 'Mutual',
  outgoing: 'Outgoing',
  incoming: 'Incoming',
};

const DIRECTION_EMPTY_MSG: Record<Direction, string> = {
  mutual: 'No mutual connections.',
  outgoing: 'No outgoing-only connections.',
  incoming: 'No incoming-only connections.',
};

/** Small inline SVG arc swatch that matches the map's solid arc treatment. */
function ArcSwatch({ direction }: { direction: Direction }) {
  const color = DIRECTION_HEX[direction];
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" className="flex-shrink-0">
      <path d="M2 8 Q 11 -1 20 8" stroke={color} strokeOpacity="0.9" strokeWidth="1.75" fill="none" strokeLinecap="round" />
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
    activeTab, setActiveTab,
    clearSelection, arcWidth, setArcWidth, hoverArcsEnabled, setHoverArcsEnabled,
    portalOnly, togglePortalOnly, error,
  } = useNetworkStore();

  // Load data on mount
  useEffect(() => {
    loadNetworkData();
  }, [loadNetworkData]);

  // Reset pagination whenever selection changes (tab reset is handled by the store)
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
        n.id.toLowerCase().includes(q) ||
        n.aliases.some(a => a.toLowerCase().includes(q))
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
  const byDirection = useMemo(() => {
    const buckets: Record<Direction, NetworkNode[]> = { mutual: [], outgoing: [], incoming: [] };
    for (const arc of selectedArcs) buckets[arc.direction].push(arc.target);
    return buckets;
  }, [selectedArcs]);
  const mutualCount   = byDirection.mutual.length;
  const outgoingCount = byDirection.outgoing.length;
  const incomingCount = byDirection.incoming.length;
  // Each entry pairs a node with its direction. 'all' tab concatenates mutual → outgoing → incoming.
  const activeConnections = useMemo<Array<{ node: NetworkNode; direction: Direction }>>(() => {
    if (activeTab === 'all') {
      return [
        ...byDirection.mutual.map(node => ({ node, direction: 'mutual' as Direction })),
        ...byDirection.outgoing.map(node => ({ node, direction: 'outgoing' as Direction })),
        ...byDirection.incoming.map(node => ({ node, direction: 'incoming' as Direction })),
      ];
    }
    return byDirection[activeTab].map(node => ({ node, direction: activeTab }));
  }, [byDirection, activeTab]);
  const visibleConnections = showAll ? activeConnections : activeConnections.slice(0, INITIAL_SHOW_COUNT);
  const hasMore = activeConnections.length > INITIAL_SHOW_COUNT;

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
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${TYPE_COLORS[selectedNode.type] || TYPE_COLORS.other}`} />
                    <span className="text-xs text-dark-400">
                      {TYPE_LABELS[selectedNode.type]}
                      {selectedNode.state && ` \u00b7 ${selectedNode.state}`}
                    </span>
                    {selectedNode.isInactive && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-dark-700 text-dark-300 border border-dark-600">
                        Inactive
                      </span>
                    )}
                  </div>
                  {(selectedNode.geocodeMethod === 'state' || selectedNode.geocodeMethod === 'default') && (
                    <p className="text-xs text-amber-500/80 mt-1">
                      Location approximate ({selectedNode.geocodeMethod}-level)
                    </p>
                  )}
                  {selectedNode.portalSlug && (
                    <a
                      href={`https://transparency.flocksafety.com/${selectedNode.portalSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 text-sm bg-[#3C7F66] hover:bg-[#346E58] active:bg-[#2C5D4A] text-white px-4 py-1.5 rounded-full font-semibold shadow-sm shadow-[#3C7F66]/30 transition-colors"
                    >
                      Flock Portal
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                    </a>
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
              </div>

              {selectedNode.isPortal && outgoingCount === 0 && (
                <div role="status" className="mb-4 flex gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
                  <div className="text-xs text-amber-100/90 leading-relaxed">
                    <p className="font-medium text-amber-300 mb-1">Outgoing shares not visible</p>
                    <p>
                      This agency operates a transparency portal but lists zero outgoing shares. Flock portals
                      allow agencies to redact their &ldquo;Organizations shared with&rdquo; list, so this may
                      mean the information is hidden rather than truly absent.
                      {incomingCount > 0 && ' Incoming shares shown above are confirmed from other portals.'}
                    </p>
                  </div>
                </div>
              )}

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

              {/* Tabbed connections list */}
              {selectedArcs.length > 0 && (
                <div>
                  <div className="flex gap-1 mb-2 border-b border-dark-700/50" role="tablist">
                    {(['all', 'mutual', 'outgoing', 'incoming'] as const).map(tab => {
                      const count = tab === 'all' ? selectedArcs.length : byDirection[tab].length;
                      const label = tab === 'all' ? 'All' : DIRECTION_TAB_LABEL[tab];
                      const isActive = activeTab === tab;
                      return (
                        <button
                          key={tab}
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => { setActiveTab(tab); setShowAll(false); }}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                            isActive ? 'text-white border-accent' : 'text-dark-400 border-transparent hover:text-white'
                          }`}
                        >
                          {tab !== 'all' && (
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${DIRECTION_DOT[tab]}`} aria-hidden />
                          )}
                          {label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {activeConnections.length === 0 ? (
                    <p className="text-xs text-dark-500 py-2">
                      {activeTab === 'outgoing' && selectedNode.isPortal && outgoingCount === 0
                        ? 'No outgoing shares visible. This portal may have redacted its "Organizations shared with" list.'
                        : activeTab === 'all'
                          ? 'No connections.'
                          : DIRECTION_EMPTY_MSG[activeTab]}
                    </p>
                  ) : (
                    <>
                      <div className="space-y-0.5">
                        {visibleConnections.map(({ node, direction }) => (
                          <button
                            key={node.id}
                            onClick={() => handleConnectionClick(node)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-dark-800 transition-colors group flex items-center gap-2"
                          >
                            {activeTab === 'all' && (
                              <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${DIRECTION_DOT[direction]}`} aria-hidden />
                            )}
                            <span className="text-sm text-dark-200 group-hover:text-white truncate">{node.name}</span>
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
                            <>Show all {activeConnections.length} <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

            </div>
          ) : (
            <div>
              <p className="text-sm text-dark-300 leading-relaxed mb-3">
                This map visualizes the Flock Safety surveillance sharing network &mdash; {nodesArray.length.toLocaleString()}+ law enforcement agencies that share automatic license plate reader (ALPR) data with each other. Click an agency to see who they share data with.
              </p>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-3 h-3 rounded-full bg-dark-700 ring-2 ring-pink-500 flex-shrink-0" aria-hidden />
                <span className="text-xs text-dark-300">Pink ring = has a transparency portal (click for details)</span>
              </div>

              <div role="alert" className="mb-3 flex gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
                <div className="text-xs text-amber-100/90 leading-relaxed">
                  <p className="font-semibold text-amber-300 mb-1">Most of the network is hidden.</p>
                  <p>
                    Of <span className="font-semibold text-amber-200">6,400+ agencies</span> using Flock, only about <span className="font-semibold text-amber-200">900</span> run a public transparency portal &mdash; and just <span className="font-semibold text-amber-200">~530</span> of those actually disclose who they share data with. The rest redact their sharing list or don&rsquo;t publish one at all.
                  </p>
                </div>
              </div>

              <p className="text-xs text-dark-500 leading-relaxed">
                Data sourced from{' '}
                <a href="https://eyesonflock.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent transition-colors">
                  EyesOnFlock.com
                </a>
                . Portal metrics (cameras, searches, etc.) are only available for agencies with a public transparency portal.
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
