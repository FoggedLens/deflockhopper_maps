import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouteStore, useAppModeStore, useCameraStore, useMapStore } from '../../store';
import { TYPE_LABELS, useNetworkStore } from '../../store/networkStore';
import type { AppMode } from '../../store';
import { BottomSheet, type SnapPoint } from '../common/BottomSheet';
import { LegacyMapLink } from '../common/LegacyMapLink';
import { isModeAvailable } from '../../services/cameraDataService';
import { AlertTriangle, ChevronUp, Navigation2, Share2, History, DatabaseZap, X, ExternalLink } from 'lucide-react';
import { TimelineBar } from '../../modes/timeline/TimelineBar';
import { RoutePanelContent } from './RoutePanelContent';
import { FlockHopperCTA } from './FlockHopperCTA';
import { NetworkPanelContent } from './NetworkPanelContent';
import { MapTypeDropdown } from './MapTypeDropdown';
import { HeatmapControls } from '../../modes/heatmap/HeatmapControls';
import { HeatmapLegend } from '../../modes/heatmap/HeatmapLegend';
import { DotDensityControls } from '../../modes/dots/DotDensityControls';
import { MapPanelContent } from './MapPanel';
import { Skeleton } from '../common';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import { BrandBreakdown } from '../map/BrandBreakdown';
import { FlockCompareControl } from '../map/FlockCompareControl';
import { FlockLeakPanelContent, FlockCompareKey, FLOCK_LEAK_COPY } from './FlockLeakPanelContent';
import { useFlockLeakStore } from '../../store/flockLeakStore';

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                    */
/* ------------------------------------------------------------------ */

interface TabDef {
  mode: AppMode;
  label: string;
}

const TABS: TabDef[] = [
  { mode: 'map', label: 'Map' },
  { mode: 'route', label: 'Route' },
  { mode: 'explore', label: 'Timeline' },
  { mode: 'leak', label: 'Leak' },
  { mode: 'network', label: 'Network' },
];

/** Shared drawer footer: legacy-map link (its mobile home now that the
 *  header menu is gone) + attribution. */
function DrawerFooter() {
  return (
    <div className="mt-6 pt-4 border-t border-hairline flex flex-col items-center gap-2">
      <LegacyMapLink variant="menu-item" className="justify-center !py-1 text-xs" />
      <p className="text-[10px] text-dark-500 text-center">
        Maps by{' '}
        <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
      </p>
    </div>
  );
}

/** Native pointerdown isolation: children (the timeline scrubber) own their
 *  pointer gestures; without this the BottomSheet's framer-motion drag
 *  handler (native listener on the header) would also move the sheet. */
function StopSheetDrag({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: PointerEvent) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    return () => el.removeEventListener('pointerdown', stop);
  }, []);
  return <div ref={ref}>{children}</div>;
}

const PEEK: Partial<Record<AppMode, { title: string; desc: string; Icon: typeof Navigation2; tint?: 'danger' }>> = {
  // route renders the FlockHopper start ad instead of IdentityRow; entry kept so the peek effects treat route as peekable
  route:   { title: 'Route', desc: 'Set a start and destination to see ALPR exposure along your route — and safer alternatives.', Icon: Navigation2 },
  explore: { title: 'Timeline', desc: 'Watch the ALPR camera network grow as volunteers documented it on OpenStreetMap.', Icon: History },
  leak:    { title: FLOCK_LEAK_COPY.title, desc: FLOCK_LEAK_COPY.peek, Icon: DatabaseZap, tint: 'danger' },
  network: { title: 'Flock Sharing Network', desc: 'Law enforcement agencies sharing Flock ALPR data with each other, as publicly disclosed. Tap an agency to trace its connections.', Icon: Share2 },
};

/** One resting height for every content-mode peek — the sheet never changes
 *  height switching among Route/Timeline/Network. Tune spacing to
 *  fit content, never this number per-mode. */
const UNIFORM_PEEK_HEIGHT = 180;
const PEEK_MODES: ReadonlySet<AppMode> = new Set(['route', 'explore', 'leak', 'network']);

/** Mode identity at peek. The whole row is the expand affordance — icon,
 *  real title, one-liner, chevron. */
function IdentityRow({ mode, onExpand, extra, desc }: { mode: AppMode; onExpand: () => void; extra?: React.ReactNode; desc?: React.ReactNode }) {
  const cfg = PEEK[mode];
  if (!cfg) return null;
  const Icon = cfg.Icon;
  const boxClass = cfg.tint === 'danger'
    ? 'bg-danger/10 border-danger/35'
    : 'bg-accent-muted border-accent/30';
  const iconClass = cfg.tint === 'danger' ? 'text-danger' : 'text-accent';
  return (
    <div className="mt-3 animate-fade-in">
      <button
        onClick={onExpand}
        className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity min-h-11"
        aria-label={`${cfg.title} — open controls and details`}
      >
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${boxClass}`}>
          <Icon className={`w-[18px] h-[18px] ${iconClass}`} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-display font-semibold text-white leading-tight">{cfg.title}</h2>
          {desc ?? <p className="text-xs text-dark-400 leading-snug mt-0.5">{cfg.desc}</p>}
        </div>
        <ChevronUp className="w-4 h-4 text-dark-500 flex-shrink-0" aria-hidden="true" />
      </button>
      {extra}
    </div>
  );
}

/** Selected agency at peek — name, type, key counts; ✕ clears. */
function NetworkPeekSummary({ onExpand, onClear }: { onExpand: () => void; onClear: () => void }) {
  const node = useNetworkStore(s => s.selectedNode);
  const adjacency = useNetworkStore(s => s.adjacency);
  const inferredConnectionsEnabled = useNetworkStore(s => s.inferredConnectionsEnabled);
  if (!node) return null;
  const connections = adjacency[node.id]?.length ?? node.connectionCount;
  const gated = !node.isPortal && !inferredConnectionsEnabled;
  return (
    <div className="mt-2 animate-fade-in">
      <div className="flex items-start gap-3">
        <button onClick={onExpand} className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity" aria-label={`${node.name} — open details`}>
          <p className="text-[15px] font-display font-semibold text-white leading-snug truncate">{node.name}</p>
          <p className="text-2xs text-dark-400 uppercase mt-0.5">{TYPE_LABELS[node.type]} · {node.state}</p>
          {gated ? (
            <p className="text-xs text-amber-400/90 mt-1.5">No transparency portal</p>
          ) : (
            <p className="text-xs text-dark-400 mt-1.5 tabular-nums">
              {connections.toLocaleString()} connection{connections !== 1 ? 's' : ''}
              {node.isPortal && node.cameras > 0 && <> · {node.cameras.toLocaleString()} cameras</>}
            </p>
          )}
        </button>
        <button
          onClick={onClear}
          className="flex-shrink-0 w-11 h-8 -mr-2 rounded-lg flex items-center justify-center text-dark-400 active:text-dark-200 transition-colors"
          aria-label="Clear selected agency"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Full-width CTA fills the peek's remaining height (route-peek idiom);
          keep it inside UNIFORM_PEEK_HEIGHT, never grow the sheet for it */}
      {node.portalSlug && (
        <a
          href={`https://transparency.flocksafety.com/${node.portalSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 mt-2 w-full py-2 rounded-xl bg-[#3C7F66] active:bg-[#2C5D4A] text-white text-sm font-semibold shadow-sm shadow-[#3C7F66]/30 transition-colors"
        >
          Flock Portal
          <ExternalLink className="w-3.5 h-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MobileTabDrawer                                                    */
/* ------------------------------------------------------------------ */

interface MobileTabDrawerProps {
  onModeChange: (mode: AppMode) => void;
}

export function MobileTabDrawer({ onModeChange }: MobileTabDrawerProps) {
  const [snapPoint, setSnapPoint] = useState<SnapPoint>('minimized');
  const [didAutoExpand, setDidAutoExpand] = useState(false);

  /* ---- stores ---- */
  const { appMode, mapVisualization } = useAppModeStore();
  const { normalRoute, avoidanceRoute } = useRouteStore();
  const hasRoutes = !!(normalRoute && avoidanceRoute);

  // Network store — preload data when tab is selected (before drawer expands)
  const loadNetworkData = useNetworkStore(s => s.loadNetworkData);
  const selectedNode = useNetworkStore(s => s.selectedNode);
  const adjacency = useNetworkStore(s => s.adjacency);
  const adjacencyReady = useNetworkStore(s => s.adjacencyReady);
  const setSelectedNodeId = useNetworkStore(s => s.setSelectedNodeId);

  // Flock Leak: while comparing, the peek's one-liner becomes the mark key.
  const leakCompare = useFlockLeakStore(s => s.view === 'overlay');

  /* ---- country (gates US-only tabs) ---- */
  const country = useCameraStore(s => s.country);

  // Camera GeoJSON (gates the explore tab's timeline/viz controls)
  const cameraIsInitialized = useCameraStore(s => s.isInitialized);
  const cameraLoadPhase = useCameraStore(s => s.loadPhase);
  const cameraError = useCameraStore(s => s.error);
  const retryCameraLoad = useCameraStore(s => s.retryCameraLoad);

  // Presence only: height + strip slot flip together, and per-pan stat
  // updates re-render just the BrandBreakdown leaf, never this drawer.
  const hasBrandStrip = useMapStore(
    (s) => s.tileViewBrandStats !== null && s.tileViewBrandStats.total > 0
  );

  /* ---- load data on mode switch ---- */
  useEffect(() => {
    if (appMode === 'network') loadNetworkData();
  }, [appMode, loadNetworkData]);

  /* ---- route auto-expand ---- */
  useEffect(() => {
    if (hasRoutes && appMode === 'route' && !didAutoExpand) {
      setSnapPoint('peek');
      setDidAutoExpand(true);
    }
    if (!hasRoutes && didAutoExpand) {
      setDidAutoExpand(false);
    }
  }, [hasRoutes, appMode, didAutoExpand]);

  // Entering a mode that has an identity peek from the minimized state
  // raises the sheet to peek — covers tab taps AND deep links, and never
  // fights a user who deliberately expanded or is mid-gesture. The mirror
  // case: returning to Map (no peek content) from a mode parked at peek
  // drops back to minimized so the swipe-up hint row returns; a
  // deliberately-expanded full sheet is left alone.
  useEffect(() => {
    if (PEEK[appMode] && snapPoint === 'minimized') {
      setSnapPoint('peek');
    } else if (!PEEK[appMode] && snapPoint === 'peek') {
      setSnapPoint('minimized');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  // Tapping an agency node surfaces its summary at the peek. Only ever
  // raises — never lowers a full one.
  useEffect(() => {
    if (appMode === 'network' && selectedNode && snapPoint !== 'full') {
      setSnapPoint('peek');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, appMode]);

  const exploresPending = !cameraIsInitialized && cameraLoadPhase !== 'error';
  const showExploreSkeleton = useDelayedFlag(exploresPending);

  /* ---- callbacks for BottomSheet ---- */
  const handleExpandSheet = useCallback(() => setSnapPoint('full'), []);

  // Explore's floor IS the peek (minimized height === peek height). Keep the
  // stored snap canonical by mapping the equal-height 'minimized' label to
  // 'peek' at the state boundary, so mode switches never pass through a
  // one-frame 80px 'minimized' render.
  const handleSnapPointChange = useCallback((p: SnapPoint) => {
    setSnapPoint(appMode === 'explore' && p === 'minimized' ? 'peek' : p);
  }, [appMode]);

  /* ---- tab switch ----
   * The tapped tab highlights this frame (pendingMode); the actual mode
   * switch (store update → layer swaps → panel mounts) is deferred one
   * painted frame so the tap always feels instant. */
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null);
  // Latest requested mode — dedupes same-tab re-taps and lets a newer tap
  // supersede an older one's still-queued deferred switch.
  const latestTabRequestRef = useRef<AppMode | null>(null);

  const handleTabPress = useCallback((mode: AppMode) => {
    if (mode === (latestTabRequestRef.current ?? appMode)) return;
    latestTabRequestRef.current = mode;
    setPendingMode(mode);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (latestTabRequestRef.current !== mode) return; // superseded by a newer tap
      latestTabRequestRef.current = null;
      onModeChange(mode);
    }));
    // Keep the drawer at its current snap — do NOT auto-expand on tab tap
  }, [appMode, onModeChange]);

  // Clear the optimistic highlight once the real mode lands (or is bounced,
  // e.g. the Canada US-only guard switching back to 'map').
  useEffect(() => {
    setPendingMode(null);
  }, [appMode]);

  const activeMode = pendingMode ?? appMode;

  /* ---- render controls for explore mode ---- */
  const renderExploreControls = () => {
    switch (mapVisualization) {
      case 'heatmap':
        return <HeatmapControls />;
      case 'dots':
        return <DotDensityControls />;
      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  Header: single-row pill tabs                                     */
  /* ================================================================ */

  // Map mode's minimized header carries the swipe-up hint row. Explore's
  // floor IS the peek (scrubber always visible), so its minimized height
  // equals the peek height and the lower snap collapses out of the sheet.
  // Map's minimized floor grows to fit the live brand strip when the index
  // has stats; without them it is exactly the pre-strip layout.
  const minimizedHeight =
    appMode === 'map' ? (hasBrandStrip ? 160 : 108)
    : appMode === 'explore' ? UNIFORM_PEEK_HEIGHT
    : 80;

  // Resting height feeds --drawer-height so map controls/attribution ride
  // above the sheet. Parked at the peek height while 'full' (controls are
  // behind the sheet then anyway; jumping them to 85vh would look broken).
  const peekHeightForMode = PEEK_MODES.has(appMode) ? UNIFORM_PEEK_HEIGHT : minimizedHeight;
  const drawerRestHeight = snapPoint === 'minimized' ? minimizedHeight : peekHeightForMode;

  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.map-page');
    el?.style.setProperty('--drawer-height', `${drawerRestHeight}px`);
  }, [drawerRestHeight]);

  const headerContent = (
    <div>
      <div className="flex items-stretch -mx-4 px-2 border-b border-hairline">
        {TABS.map(({ mode, label }) => {
          const isActive = activeMode === mode;
          const available = isModeAvailable(mode, country);
          return (
            <button
              key={mode}
              onClick={() => available && handleTabPress(mode)}
              disabled={!available}
              aria-disabled={!available}
              className={`relative flex-1 min-w-11 py-2.5 text-2xs font-semibold uppercase tracking-[0.14em] transition-colors ${
                isActive
                  ? 'text-white'
                  : available
                    ? 'text-dark-500 active:text-dark-300'
                    : 'text-dark-600'
              }`}
            >
              {label}
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[1.5px] bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      {appMode === 'map' && snapPoint === 'minimized' && (
        <>
          <BrandBreakdown variant="strip" />
          <div className="mt-2.5 flex items-center justify-center gap-1 text-dark-400 animate-fade-in">
            <ChevronUp className="w-3.5 h-3.5 animate-nudge-up" />
            <span className="text-[11px] font-medium">Swipe up to learn about this map</span>
          </div>
        </>
      )}
      {appMode === 'explore' && (
        <div className={`mt-3 animate-fade-in ${snapPoint === 'full' ? 'hidden' : ''}`}>
          {mapVisualization === 'heatmap' ? (
            <div className="mt-16">
              <IdentityRow mode="explore" onExpand={handleExpandSheet} />
            </div>
          ) : (
            <>
              {cameraIsInitialized ? (
                <StopSheetDrag>
                  <div className="h-20"><TimelineBar bare showCount /></div>
                </StopSheetDrag>
              ) : (
                // Placeholder keeps the h-20 scrubber row's height stable while
                // the camera GeoJSON is still loading — avoids an empty
                // sparkline, "· 0" count, and a dead play button (mirrors the
                // desktop gate: isExploreMode && !isMobile && isInitialized).
                <div className="h-20 flex items-center gap-2 lg:gap-3" aria-hidden="true">
                  <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
                  <Skeleton className="flex-1 h-8 rounded-sm" />
                  <Skeleton className="w-[150px] h-4 flex-shrink-0" />
                </div>
              )}
              <p className="text-2xs text-dark-500 uppercase mt-1">When cameras were mapped on OSM</p>
            </>
          )}
        </div>
      )}
      {appMode !== 'explore' && snapPoint === 'peek' && (
        appMode === 'route' ? (
          hasRoutes ? (
            <div className="mt-3 animate-fade-in">
              <FlockHopperCTA variant="start" />
            </div>
          ) : (
            // Optically centered in the peek's content region (no floating gap)
            <div className="mt-6 animate-fade-in">
              <FlockHopperCTA variant="banner" />
            </div>
          )
        ) : appMode === 'network' && selectedNode ? (
          <NetworkPeekSummary
            onExpand={handleExpandSheet}
            onClear={() => setSelectedNodeId(null)}
          />
        ) : (
          <IdentityRow
            mode={appMode}
            onExpand={handleExpandSheet}
            desc={appMode === 'leak' && leakCompare ? <FlockCompareKey className="mt-1" /> : undefined}
            extra={
              appMode === 'leak'
                ? <FlockCompareControl className="mt-3" />
                : appMode === 'network'
                  ? (
                    <div className="mt-3 flex items-center justify-center gap-1 text-dark-400">
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-medium">Swipe up for details</span>
                    </div>
                  )
                  : undefined
            }
          />
        )
      )}
    </div>
  );

  /* ================================================================ */
  /*  Tab content (rendered only when snapPoint === 'full')            */
  /* ================================================================ */

  const renderTabContent = () => {
    switch (appMode) {
      /* ---------- MAP ---------- */
      case 'map':
        return (
          <div className="pb-8">
            <MapPanelContent />
            <DrawerFooter />
          </div>
        );

      /* ---------- ROUTE ---------- */
      case 'route':
        return (
          <div className="pb-8">
            <RoutePanelContent />

            <DrawerFooter />
          </div>
        );

      /* ---------- EXPLORE ---------- */
      case 'explore':
        return (
          <div className="pb-8">
            <p className="text-xs text-dark-400 mb-3 leading-relaxed">
              Watch the US ALPR network grow. Each camera appears on the date volunteers documented it on{' '}
              <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">OpenStreetMap</a>
              {' '}(which trails real-world installation). Data from{' '}
              <a href="https://deflock.me" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">DeFlock</a>
              {' '}&amp; OSM contributors. Switch layers below.
            </p>

            <div className="mb-3">
              <MapTypeDropdown />
            </div>

            {cameraLoadPhase === 'error' && cameraError ? (
              <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
                <p className="text-sm text-red-400 mb-2">Failed to load camera data</p>
                <p className="text-xs text-dark-500 mb-3">{cameraError}</p>
                <button
                  onClick={() => {
                    // store owns the error state
                    retryCameraLoad().catch(() => {});
                  }}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : exploresPending ? (
              showExploreSkeleton && (
                <div className="space-y-4" aria-busy="true">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              )
            ) : (
              renderExploreControls()
            )}

            {mapVisualization === 'heatmap' && (
              <div className="mt-6">
                <HeatmapLegend />
              </div>
            )}

            <DrawerFooter />
          </div>
        );

      /* ---------- FLOCK LEAK ---------- */
      case 'leak':
        return (
          <div className="pb-8">
            <FlockLeakPanelContent />
            <DrawerFooter />
          </div>
        );

      /* ---------- NETWORK ---------- */
      case 'network':
        return (
          <div className="pb-8">
            <NetworkPanelContent />
            <DrawerFooter />
          </div>
        );

      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const isNonSharingPortal = appMode === 'network' &&
    adjacencyReady &&
    selectedNode?.isPortal &&
    (adjacency[selectedNode.id]?.length ?? 0) === 0;
  const showNetworkWarning = isNonSharingPortal && snapPoint !== 'full';

  return (
    <>
      {showNetworkWarning && (
        <button
          onClick={handleExpandSheet}
          className="fixed left-4 z-[52] flex items-center justify-center w-11 h-11 rounded-full bg-amber-500 shadow-lg shadow-amber-500/30 active:bg-amber-600 transition-colors"
          style={{ bottom: 'calc(var(--drawer-height, 80px) + 16px)' }}
          aria-label="View sharing disclaimer"
        >
          <AlertTriangle className="w-5 h-5 text-white" />
        </button>
      )}
      <BottomSheet
        snapPoint={snapPoint}
        onSnapPointChange={handleSnapPointChange}
        minimizedHeight={minimizedHeight}
        peekHeight={peekHeightForMode}
        fullHeight={85}
        headerContent={headerContent}
        disableHeaderTap
      >
        {snapPoint === 'full' && renderTabContent()}
      </BottomSheet>
    </>
  );
}
