import { useState, useEffect, useCallback } from 'react';
import { useRouteStore, useAppModeStore } from '../../store';
import { useDensityStore } from '../../store/densityStore';
import { useNetworkStore } from '../../store/networkStore';
import type { AppMode } from '../../store';
import { BottomSheet, type SnapPoint } from '../common/BottomSheet';
import { AlertTriangle } from 'lucide-react';
import { RoutePanelContent } from './RoutePanelContent';
import { MobileRoutePreview } from './MobileRoutePreview';
import { NetworkPanelContent } from './NetworkPanelContent';
import { MapTypeDropdown } from './MapTypeDropdown';
import { HeatmapControls } from '../../modes/heatmap/HeatmapControls';
import { HeatmapLegend } from '../../modes/heatmap/HeatmapLegend';
import { DotDensityControls } from '../../modes/dots/DotDensityControls';
import { DensityControls } from '../../modes/density/DensityControls';
import { DensityLegend } from '../../modes/density/DensityLegend';
import { MapPanelContent } from './MapPanel';

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
  { mode: 'density', label: 'Analysis' },
  { mode: 'network', label: 'Network' },
];

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

  // Density store
  const { loadPhase: densityLoadPhase, loadAllLevels: loadDensity, retryLoad: retryDensity, error: densityError } = useDensityStore();

  // Network store — preload data when tab is selected (before drawer expands)
  const loadNetworkData = useNetworkStore(s => s.loadNetworkData);
  const selectedNode = useNetworkStore(s => s.selectedNode);
  const adjacency = useNetworkStore(s => s.adjacency);

  /* ---- load data on mode switch ---- */
  useEffect(() => {
    if (appMode === 'density') loadDensity();
    if (appMode === 'network') loadNetworkData();
  }, [appMode, loadDensity, loadNetworkData]);

  /* ---- route auto-expand ---- */
  useEffect(() => {
    if (hasRoutes && appMode === 'route' && !didAutoExpand) {
      setSnapPoint('full');
      setDidAutoExpand(true);
    }
    if (!hasRoutes && didAutoExpand) {
      setDidAutoExpand(false);
    }
  }, [hasRoutes, appMode, didAutoExpand]);

  const densityIsLoading = densityLoadPhase === 'fetching';

  /* ---- callbacks for BottomSheet + RoutePanelContent ---- */
  const handleExpandSheet = useCallback(() => setSnapPoint('full'), []);
  const handleCollapseSheet = useCallback(() => setSnapPoint('minimized'), []);

  /* ---- tab switch ---- */
  const handleTabPress = useCallback((mode: AppMode) => {
    if (mode !== appMode) {
      onModeChange(mode);
    }
    // Keep the drawer at its current snap — do NOT auto-expand on tab tap
  }, [appMode, onModeChange]);

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

  const headerContent = (
    <div className="grid grid-cols-5 gap-1">
      {TABS.map(({ mode, label }) => {
        const isActive = appMode === mode;
        return (
          <button
            key={mode}
            onClick={() => handleTabPress(mode)}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
              isActive
                ? 'bg-accent/10 text-accent border border-dark-600'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700 active:bg-zinc-700'
            }`}
          >
            {label}
          </button>
        );
      })}
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
            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
          </div>
        );

      /* ---------- ROUTE ---------- */
      case 'route':
        return (
          <div className="pb-8">
            {/* Compact route strip at top */}
            <div className="mb-4">
              <MobileRoutePreview hasRoutes={hasRoutes} onExpand={handleExpandSheet} />
            </div>

            <RoutePanelContent
              isBottomSheet
              onExpandSheet={handleExpandSheet}
              onCollapseSheet={handleCollapseSheet}
            />

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
          </div>
        );

      /* ---------- EXPLORE ---------- */
      case 'explore':
        return (
          <div className="pb-8">
            <p className="text-xs text-dark-400 mb-3 leading-relaxed">
              Visualize ALPR camera density across the US. Data from{' '}
              <a href="https://deflock.me" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">DeFlock</a>
              {' '}&amp;{' '}
              <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">OSM</a>
              {' '}contributors. Switch layers below.
            </p>

            <div className="mb-3">
              <MapTypeDropdown />
            </div>

            {renderExploreControls()}

            {mapVisualization === 'heatmap' && (
              <div className="mt-6">
                <HeatmapLegend />
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
          </div>
        );

      /* ---------- DENSITY (Analysis) ---------- */
      case 'density':
        return (
          <div className="pb-8">
            <p className="text-xs text-dark-400 mb-3 leading-relaxed">
              Compare ALPR surveillance intensity by state or county. Data from{' '}
              <a href="https://deflock.me" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">DeFlock</a>
              {' '}&amp;{' '}
              <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">OSM</a>
              {' '}contributors. Tap any region on the map to reveal its statistics.
            </p>

            {densityIsLoading && (
              <div className="flex items-center gap-3 py-4">
                <div className="w-5 h-5 border-2 border-dark-600 border-t-accent rounded-full animate-spin" />
                <span className="text-sm text-dark-300">Loading density data...</span>
              </div>
            )}

            {densityError && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
                <p className="text-sm text-red-400 mb-2">Failed to load density data</p>
                <p className="text-xs text-dark-500 mb-3">{densityError}</p>
                <button
                  onClick={retryDensity}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {densityLoadPhase === 'ready' && (
              <>
                <DensityControls />
                <div className="mt-6">
                  <DensityLegend />
                </div>
              </>
            )}

            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
          </div>
        );

      /* ---------- NETWORK ---------- */
      case 'network':
        return (
          <div className="pb-8">
            <NetworkPanelContent />
            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
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
    selectedNode?.isPortal &&
    (adjacency[selectedNode.id]?.length ?? 0) === 0;
  const showNetworkWarning = isNonSharingPortal && snapPoint !== 'full';

  return (
    <>
      {showNetworkWarning && (
        <button
          onClick={handleExpandSheet}
          className="fixed bottom-[96px] left-4 z-[52] flex items-center justify-center w-10 h-10 rounded-full bg-amber-500 shadow-lg shadow-amber-500/30 active:bg-amber-600 transition-colors"
          aria-label="View sharing disclaimer"
        >
          <AlertTriangle className="w-5 h-5 text-white" />
        </button>
      )}
      <BottomSheet
        snapPoint={snapPoint}
        onSnapPointChange={setSnapPoint}
        minimizedHeight={80}
        peekHeight={80}
        fullHeight={85}
        headerContent={headerContent}
        disableHeaderTap
      >
        {snapPoint === 'full' && renderTabContent()}
      </BottomSheet>
    </>
  );
}
