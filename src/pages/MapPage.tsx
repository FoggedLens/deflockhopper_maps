import { useEffect, useState, useCallback, useRef } from 'react';
import { MapLibreView, MapSearch, FloatingRouteCard, CameraStats, MapLoadingScreen, type MapLibreViewHandle } from '@/components/map';
import { HeaderCameraCount } from '@/components/map/HeaderCameraCount';
import { RoutePanel } from '@/components/panels';
import { ExplorePanel } from '@/components/panels/ExplorePanel';
import { DensityPanel } from '@/components/panels/DensityPanel';
import { NetworkPanel } from '@/components/panels/NetworkPanel';
import { MapPanel } from '@/components/panels/MapPanel';
import { MobileTabDrawer } from '@/components/panels/MobileTabDrawer';
import { DensityLegendBar } from '@/components/map/DensityLegendBar';
import { NetworkAgencyCount } from '@/components/map/NetworkAgencyCount';
import { NetworkLoadingPill } from '@/components/map/NetworkLoadingPill';
import { DensityLoadingPill } from '@/components/map/DensityLoadingPill';
import { Seo, LegacyMapLink, ShareButton, LoadingPill } from '@/components/common';
import { stateSlug, getStateName } from '@/services/stateFilterService';
import { isModeAvailable } from '@/services/cameraDataService';
import { useTilesHostStore, failoverTilesHost } from '@/store/tilesHostStore';
import { isWebGLAvailable } from '@/utils/webgl';
import { removeBootSplash } from '@/utils/bootSplash';
import { useCameraStore, useAppModeStore } from '@/store';
import { useEmbedMode } from '@/hooks/useEmbedMode';
import { useCameraRenderMode } from '@/hooks/useCameraRenderMode';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUrlSync } from '@/hooks/useUrlSync';
import { MapStyleControl } from '@/components/map/MapStyleControl';
import { CameraFilterControl } from '@/components/map/CameraFilterControl';
import { BoundaryControl } from '@/components/map/BoundaryControl';
import { BoundaryFeaturePopup } from '@/components/map/BoundaryFeaturePopup';
import { MapThemeControl } from '@/components/map/MapThemeControl';
import { CameraTileStatusPill } from '@/components/map/CameraTileStatusPill';
import { TimelineBar } from '@/modes/timeline/TimelineBar';
import { DensityFeaturePopup } from '@/modes/density/DensityFeaturePopup';
import { Route, Compass, BarChart3, Network, Map as MapIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AppMode } from '@/store';

const WEBGL_REQUIRED_MESSAGE =
  'WebGL is required to display the interactive map. Please enable hardware acceleration in your browser settings, then reload the page.';

const MODE_LABELS: Record<AppMode, { icon: typeof Route; label: string }> = {
  map: { icon: MapIcon, label: 'Map' },
  route: { icon: Route, label: 'Route' },
  explore: { icon: Compass, label: 'Timeline' },
  density: { icon: BarChart3, label: 'Analysis' },
  network: { icon: Network, label: 'Network' },
};

export function MapPage() {
  const {
    retryCameraLoad,
    isInitialized,
    cameras,
    country,
  } = useCameraStore();
  const appMode = useAppModeStore(s => s.appMode);
  const setAppMode = useAppModeStore(s => s.setAppMode);
  const enterTimeline = useAppModeStore(s => s.enterTimeline);
  const updateTimelineSettings = useAppModeStore(s => s.updateTimelineSettings);
  const isEmbed = useEmbedMode();
  const isExploreMode = appMode === 'explore';
  const hasAutoPlayed = useRef(false);

  // Single URL↔state bridge: seeds stores from the boot URL (viewport,
  // country, mode, state filter) and mirrors store changes back into the
  // address bar. All URL logic lives in useUrlSync/urlState.
  useUrlSync();

  const stateFilter = useCameraStore(s => s.filters.state);
  const isMobile = useIsMobile();

  // Mode switching is a plain store update — the URL follows via useUrlSync.
  const handleSetAppMode = useCallback((mode: AppMode) => {
    if (mode === 'explore') {
      enterTimeline();
      hasAutoPlayed.current = false;
    } else {
      setAppMode(mode);
    }
  }, [enterTimeline, setAppMode]);

  // US-only modes (Route/Analysis/Network): bounce back to Map when Canada
  // is active — covers the country switcher, deep links, and URL edits
  useEffect(() => {
    if (!isModeAvailable(appMode, country)) {
      handleSetAppMode('map');
    }
  }, [appMode, country, handleSetAppMode]);

  // Track map markers ready state
  const [markersReady, setMarkersReady] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [mapInitError, setMapInitError] = useState<string | null>(null);
  const mapRef = useRef<MapLibreViewHandle>(null);
  const mapInitDeadlineRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset UI state on mount (handles stale state from previous navigation)
  // and probe for WebGL before doing any work — without it the map cannot
  // render. Camera JSON is no longer fetched here: tiles are the default
  // rendering path and need no JSON at all, and useCameraRenderMode()
  // lazily triggers ensureCamerasLoaded() the moment a feature actually
  // needs the dataset (filters/timeline/heatmap/Canada).
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[MapPage] Component mounted');
    }

    removeBootSplash();
    setMarkersReady(false);
    setMapInitError(null);

    if (!isWebGLAvailable()) {
      setMapInitError(WEBGL_REQUIRED_MESSAGE);
      if (import.meta.env.DEV) {
        console.warn('[MapPage] WebGL not available — surfacing error UI');
      }
    }
  }, []);

  const { needsGeojson } = useCameraRenderMode();

  // Map-init deadline: if markers don't become ready within 15s, treat the
  // map init as failed and surface the existing error UI (Try Again + Legacy
  // Maps Link). Arms on either rendering path:
  // - geojson: after the dataset is hydrated (isInitialized && cameras)
  // - tiles: immediately (!needsGeojson) — a silently stalled TileJSON load
  //   (hung connection) emits neither sourcedata nor 'error' events, so
  //   without this the loading screen would spin forever with no retry UI.
  // On the first miss the tile host fails over to backup and the map
  // remounts; the deadline re-arms (tilesEpoch) and a second miss surfaces
  // the error UI.
  // The inner retry pipeline in MapLibreContainer keeps event listeners
  // attached for the full duration, so a successful late init before the
  // deadline still clears markersReady (which also clears this timer).
  const tilesEpoch = useTilesHostStore(s => s.epoch);
  useEffect(() => {
    const watchdogArmed = !needsGeojson || (isInitialized && cameras.length > 0);
    if (watchdogArmed && !markersReady && !mapInitError) {
      mapInitDeadlineRef.current = setTimeout(() => {
        if (!markersReady) {
          if (failoverTilesHost('map init deadline')) {
            setMapKey(k => k + 1);
            return;
          }
          setMapInitError('Map failed to initialize. Please try again.');
          if (import.meta.env.DEV) {
            console.warn('[MapPage] Map init deadline exceeded (15s) — surfacing error UI');
          }
        }
      }, 15000);

      return () => {
        if (mapInitDeadlineRef.current) {
          clearTimeout(mapInitDeadlineRef.current);
        }
      };
    }
  }, [needsGeojson, isInitialized, cameras.length, markersReady, mapInitError, tilesEpoch]);

  // Handle markers ready callback from MapLibreView
  const handleMarkersReady = useCallback((ready: boolean) => {
    if (import.meta.env.DEV) {
      console.log(`[MapPage] Markers ready: ${ready}`);
    }
    setMarkersReady(ready);
    if (ready) {
      setMapInitError(null);
    }
  }, []);

  // Handle retry with map remount
  const handleRetryWithRemount = useCallback(async () => {
    if (import.meta.env.DEV) {
      console.log('[MapPage] Retry with remount requested');
    }

    // Re-probe WebGL on every retry — if it's still unavailable, surface the
    // same WebGL-specific message and skip the camera refetch / remount.
    if (!isWebGLAvailable()) {
      setMapInitError(WEBGL_REQUIRED_MESSAGE);
      if (import.meta.env.DEV) {
        console.warn('[MapPage] Retry: WebGL still not available');
      }
      return;
    }

    setMapInitError(null);
    setMarkersReady(false);
    // Force map remount with new key — unconditional, always the recovery
    // path for a stalled tile source. The (multi-MB) GeoJSON refetch only
    // helps when a feature actually needs it (filters/timeline/heatmap/Canada);
    // skip it in tiles mode where the remount alone drives recovery.
    // Clear a prior camera-tile failure so the remount re-requests the
    // tileset (the retry pill's point). The tile host is left as is: every
    // page load starts on primary, and a mid-session retry stays on whichever
    // host the app already failed over to.
    useCameraStore.getState().setTilesFailed(false);
    useCameraStore.getState().setFilterTilesFailed(false);
    setMapKey(k => k + 1);

    if (needsGeojson) {
      try {
        await retryCameraLoad();
      } catch {
        // Error handling done in store
      }
    }
  }, [retryCameraLoad, needsGeojson]);

  // Tiles mode: the map is "ready" when the tile source has rendered
  // (markersReady). The JSON dataset only gates readiness when a feature
  // actually needs it (filters/timeline/heatmap/Canada).
  const camerasReady = needsGeojson ? (isInitialized && cameras.length > 0) : true;
  const isFullyReady = camerasReady && markersReady;

  // The pill covers GeoJSON loads with no visible panel to host a skeleton:
  // mobile, and any non-explore desktop context (heatmap/filters/Canada).
  // Desktop Timeline gets an in-panel skeleton instead (ExplorePanel).
  // Deliberately NOT gated on !camerasReady: camerasReady flips true in the
  // same atomic store commit as loadPhase → 'ready', so gating on it here
  // would unmount the pill before it can render its own "N cameras ready"
  // completion flash. The pill owns its own visibility (idle/ready-without-
  // flash → null) so it's safe to keep mounted through the ready transition.
  const showCameraPill =
    needsGeojson && !mapInitError &&
    (isMobile || appMode !== 'explore');

  // Timeline entry: auto-play the dot density animation once the map is ready
  useEffect(() => {
    if (isExploreMode && isFullyReady && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      // Short delay so TimelineBar mounts and registers the tick callback
      const timer = setTimeout(() => {
        updateTimelineSettings({ isPlaying: true });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isExploreMode, isFullyReady, updateTimelineSettings]);

  const seo = stateFilter ? (
    <Seo
      title={`${getStateName(stateFilter)} ALPR Cameras | DeFlock Maps`}
      description={`Map of known ALPR (license plate reader) cameras in ${getStateName(stateFilter)}, with brand breakdowns and privacy-optimized routing.`}
      path={`/state/${stateSlug(stateFilter)}`}
    />
  ) : (
    <Seo
      title="DeFlock Maps | ALPR Camera Map & Privacy Routes"
      description="Explore the national ALPR camera map and compare direct routes with privacy-optimized alternatives."
      path="/"
    />
  );

  return (
    <>
      {seo}
      {/* Full-screen overlay is error-only: WebGL missing, watchdog timeout,
          or tile-source stall. GeoJSON loads surface in-panel / as a pill. */}
      {mapInitError && (
        <MapLoadingScreen error={mapInitError} onRetry={handleRetryWithRemount} />
      )}
      <div className={`map-page h-screen supports-[height:100dvh]:h-[100dvh] w-screen flex flex-col bg-dark-900 overflow-hidden ${appMode === 'map' ? 'map-mode-active' : ''}`}>
        {/* Header - hidden in embed mode */}
        {!isEmbed && (
        <header className="h-[38px] lg:h-12 bg-dark-900 border-b border-hairline flex items-center z-50 shrink-0">
          <div className="w-full px-4 lg:px-5">
            <div className="flex items-center justify-between h-full">
              {/* Logo + Product Switcher */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <a
                  href="https://deflock.org"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <img
                    src="/deflock-icon.png"
                    alt="DeFlock Icon"
                    className="h-5 lg:h-8 w-auto object-contain"
                  />
                  <img
                    src="/deflock-logo.svg"
                    alt="DeFlock Logo"
                    className="h-5 lg:h-8 w-auto object-contain"
                  />
                  <span className="text-dark-400 text-[11px] font-medium tracking-[0.2em] uppercase hidden sm:inline self-end mb-[3px]">Maps</span>
                </a>
              </div>

              {/* Desktop: Mode tabs - editorial underline style */}
              <nav className="hidden lg:flex items-center gap-6" aria-label="App modes">
                {(Object.entries(MODE_LABELS) as [AppMode, typeof MODE_LABELS[AppMode]][]).map(([mode, { label }]) => {
                  const available = isModeAvailable(mode, country);
                  return (
                    <button
                      key={mode}
                      onClick={() => available && handleSetAppMode(mode)}
                      disabled={!available}
                      title={available ? undefined : 'Available in the US only'}
                      className={`relative text-sm font-medium uppercase tracking-widest pb-1 transition-colors duration-150 ${
                        appMode === mode
                          ? 'text-accent'
                          : available
                            ? 'text-dark-200 hover:text-white'
                            : 'text-dark-600 cursor-not-allowed'
                      }`}
                      aria-current={appMode === mode ? 'page' : undefined}
                    >
                      {label}
                      {appMode === mode && (
                        <span className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-accent" />
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Mobile: live count + share. No count on Timeline/Analysis/
                  Network — "in view" ignores the timeline date, Analysis shows
                  choropleths not cameras, and Network shows agencies. */}
              <div className="lg:hidden flex items-center gap-2 h-full">
                {appMode !== 'explore' && appMode !== 'density' && appMode !== 'network' && <HeaderCameraCount />}
                <ShareButton variant="icon" className="-mr-2" />
              </div>

              <div className="hidden lg:flex items-center gap-4 flex-shrink-0">
                <ShareButton variant="header" />
                <div className="w-px h-4 bg-dark-600" />
                <LegacyMapLink variant="header" />
              </div>
            </div>
          </div>
        </header>
        )} {/* end !isEmbed header */}

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile: unified tabbed drawer */}
          {isMobile && <MobileTabDrawer onModeChange={handleSetAppMode} />}

          {/* Desktop: individual side panels */}
          {!isMobile && appMode === 'map' && <MapPanel />}
          {!isMobile && appMode === 'route' && <RoutePanel />}
          {!isMobile && appMode === 'explore' && <ExplorePanel />}
          {!isMobile && appMode === 'density' && <DensityPanel />}
          {!isMobile && appMode === 'network' && <NetworkPanel />}

          {/* Map */}
          <main className="flex-1 relative w-full lg:w-auto">
            <h1 className="sr-only">DeFlock ALPR Camera Map</h1>
            {/* Map fades in on first render instead of popping */}
            <div className={`absolute inset-0 transition-opacity duration-300 ${markersReady ? 'opacity-100' : 'opacity-0'}`}>
              <MapLibreView
                ref={mapRef}
                mapKey={mapKey}
                onMarkersReady={handleMarkersReady}
              />
            </div>

            {/* The wrapper above holds the map at opacity-0 until markersReady, which
                leaves a black void on slow connections. This indicator fills that gap:
                delayed 400ms so fast loads never flash it, and its exit crossfades
                with the map's own 300ms fade-in. AnimatePresence unmounts it after
                the exit, so nothing keeps animating once the map is up. */}
            <AnimatePresence>
              {!markersReady && !mapInitError && (
                <motion.div
                  role="status"
                  className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.4, duration: 0.3, ease: 'easeOut' } }}
                  exit={{ opacity: 0, transition: { duration: 0.3 } }}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-dark-400 border-t-accent rounded-full animate-spin" />
                    <span className="text-dark-400 text-[11px] font-medium tracking-[0.2em] uppercase">Loading map</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Map Overlays */}
            {!isEmbed && (appMode === 'route' ? <FloatingRouteCard /> : <MapSearch />)}
            {/* Camera-count overlay only where it's meaningful: route mode.
                Timeline's count ignores the scrubbed date; Analysis renders
                choropleths, not cameras. */}
            {appMode === 'network' ? <NetworkAgencyCount /> : appMode === 'route' ? <CameraStats /> : null}
            {/* Country switch only where switching countries is meaningful:
                camera browse + Explore. Hidden on Route/Analysis/Network. */}
            {(appMode === 'map' || appMode === 'explore') && <MapStyleControl />}
            {showCameraPill && <LoadingPill />}
            {(appMode === 'map' || appMode === 'route') && !needsGeojson && (
              <CameraTileStatusPill onRetryTiles={handleRetryWithRemount} />
            )}
            {appMode === 'network' && <NetworkLoadingPill />}
            {appMode === 'density' && <DensityLoadingPill />}
            <MapThemeControl />
            <CameraFilterControl />
            {appMode === 'map' && <BoundaryControl />}
            {appMode === 'map' && <BoundaryFeaturePopup />}

            {/* Density feature popup — floating stats card */}
            {appMode === 'density' && <DensityFeaturePopup />}

            {/* Density legend bar — horizontal bottom overlay */}
            {appMode === 'density' && <DensityLegendBar />}


            {/* Map Legend - route mode only (explore/density legends live in side panel) */}
            {appMode === 'route' && (
              <div className="absolute bottom-6 left-[68px] z-20 hidden lg:flex flex-col gap-2">
                <div className="bg-dark-800/90 rounded-md px-3 py-2 border border-dark-600">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-accent shadow-[0_0_8px_rgba(56,189,248,0.3)]"></div>
                      <span className="text-dark-100">ALPR Camera</span>
                    </div>
                    <div className="w-px h-5 bg-dark-600"></div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-1 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.5)]" style={{backgroundImage: 'repeating-linear-gradient(90deg, #f97316 0, #f97316 4px, transparent 4px, transparent 7px)'}}></div>
                      <span className="text-dark-100">Direct Route</span>
                    </div>
                    <div className="w-px h-5 bg-dark-600"></div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-1 rounded-full bg-success shadow-[0_0_6px_rgba(34,197,94,0.5)]"></div>
                      <span className="text-dark-100">Privacy Route</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Map mode legend */}
            {appMode === 'map' && (
              <div className="absolute bottom-6 left-[68px] z-20 hidden lg:flex flex-col gap-2">
                <div className="bg-dark-800/90 rounded-md px-3 py-2 border border-dark-600">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-accent shadow-[0_0_8px_rgba(56,189,248,0.3)]"></div>
                      <span className="text-dark-100">ALPR Camera</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Timeline Bar — desktop only; on mobile the scrubber lives in the drawer peek */}
            {isExploreMode && !isMobile && isInitialized && (
              <div className="timeline-bar-desktop absolute bottom-4 left-4 right-20 z-20 h-14 bg-dark-900/70 backdrop-blur-xl rounded-xl border border-white/[0.06] shadow-lg shadow-black/30">
                <TimelineBar />
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
