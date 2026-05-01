import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { MapLibreView, MapSearch, CameraStats, MapLoadingScreen, type MapLibreViewHandle } from '@/components/map';
import { RoutePanel } from '@/components/panels';
import { ExplorePanel } from '@/components/panels/ExplorePanel';
import { DensityPanel } from '@/components/panels/DensityPanel';
import { NetworkPanel } from '@/components/panels/NetworkPanel';
import { MapPanel } from '@/components/panels/MapPanel';
import { MobileTabDrawer } from '@/components/panels/MobileTabDrawer';
import { DensityLegendBar } from '@/components/map/DensityLegendBar';
import { NetworkAgencyCount } from '@/components/map/NetworkAgencyCount';
import { Seo, LegacyMapLink, ShareButton, ProductSwitcher } from '@/components/common';
import { parseViewportFromURL, writeViewportParams } from '@/utils/urlParams';
import { useCameraStore, useMapStore, useAppModeStore } from '@/store';
import { useEmbedMode } from '@/hooks/useEmbedMode';
import { MapStyleControl } from '@/components/map/MapStyleControl';
import { TimelineBar } from '@/modes/timeline/TimelineBar';
import { DensityFeaturePopup } from '@/modes/density/DensityFeaturePopup';
import { Route, Compass, BarChart3, Menu, X, Network, Map as MapIcon } from 'lucide-react';
import type { AppMode } from '@/store';

const MODE_LABELS: Record<AppMode, { icon: typeof Route; label: string }> = {
  map: { icon: MapIcon, label: 'Map' },
  route: { icon: Route, label: 'Route' },
  explore: { icon: Compass, label: 'Timeline' },
  density: { icon: BarChart3, label: 'Analysis' },
  network: { icon: Network, label: 'Network' },
};

export function MapPage() {
  const { 
    ensureCamerasLoaded,
    retryCameraLoad,
    isInitialized,
    cameras,
    error,
    getCamerasInBounds,
    loadPhase,
  } = useCameraStore();
  const bounds = useMapStore(s => s.bounds);
  const center = useMapStore(s => s.center);
  const zoom = useMapStore(s => s.zoom);
  const appMode = useAppModeStore(s => s.appMode);
  const mapVisualization = useAppModeStore(s => s.mapVisualization);
  const setAppMode = useAppModeStore(s => s.setAppMode);
  const isEmbed = useEmbedMode();
  const updateTimelineSettings = useAppModeStore(s => s.updateTimelineSettings);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isExplorePath = location.pathname === '/explore';
  const isTimelinePath = location.pathname === '/timeline';
  const isAnalysisPath = location.pathname === '/analysis';
  const isNetworkPath = location.pathname === '/network';
  const isRoutePath = location.pathname === '/route';
  const isExploreMode = appMode === 'explore';
  const hasAutoPlayed = useRef(false);

  // Seed map viewport from URL params once, before MapLibreContainer mounts.
  // useState initializer runs once — sets store synchronously so initialViewState picks it up.
  useState(() => {
    const viewport = parseViewportFromURL(new URLSearchParams(window.location.search));
    if (viewport) {
      useMapStore.setState({ center: [viewport.lat, viewport.lng], zoom: viewport.zoom });
    }
  });

  // Debounced live URL sync: mirrors whatever buildShareURL would produce,
  // so copying the address bar equals clicking Share.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchParams(prev => writeViewportParams(new URLSearchParams(prev)), { replace: true });
    }, 500);
    return () => clearTimeout(t);
  }, [center, zoom, appMode, mapVisualization, setSearchParams]);

  // Responsive breakpoint — single source of truth for timeline bar layout
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sync URL params with app mode on mount
  useEffect(() => {
    const vizParam = searchParams.get('viz');
    const viz = vizParam === 'heatmap' ? 'heatmap' : 'dots';

    if (isAnalysisPath) {
      setAppMode('density');
    } else if (isExplorePath || isTimelinePath) {
      useAppModeStore.setState({
        appMode: 'explore',
        mapVisualization: viz,
        timelineSettings: {
          currentDate: isTimelinePath ? '2024-07-01' : new Date().toISOString().slice(0, 10),
          isPlaying: false,
          playSpeed: 45,
        },
      });
    } else if (isNetworkPath) {
      setAppMode('network');
    } else if (isRoutePath) {
      setAppMode('route');
    } else {
      const urlMode = searchParams.get('mode');
      if (urlMode === 'route') {
        setAppMode('route');
      } else if (urlMode === 'explore') {
        setAppMode('explore');
      } else if (urlMode === 'density') {
        setAppMode('density');
      } else if (urlMode === 'network') {
        setAppMode('network');
      } else {
        setAppMode('map');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update URL when mode changes
  const handleSetAppMode = useCallback((mode: AppMode) => {
    if (mode === 'explore') {
      // Set timeline state directly — bypass setAppMode which defaults to today's date
      useAppModeStore.setState({
        appMode: 'explore',
        mapVisualization: 'dots',
        timelineSettings: {
          currentDate: '2024-07-01',
          isPlaying: false,
          playSpeed: 45,
        },
      });
      hasAutoPlayed.current = false;
      navigate('/timeline', { replace: true });
    } else if (mode === 'map') {
      setAppMode(mode);
      setSearchParams({}, { replace: true });
    } else if (mode === 'route') {
      setAppMode(mode);
      setSearchParams({ mode: 'route' }, { replace: true });
    } else if (mode === 'density') {
      setAppMode(mode);
      setSearchParams({ mode: 'density' }, { replace: true });
    } else if (mode === 'network') {
      setAppMode(mode);
      setSearchParams({ mode: 'network' }, { replace: true });
    }
  }, [setAppMode, setSearchParams, navigate]);

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Track map markers ready state
  const [markersReady, setMarkersReady] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [mapInitError, setMapInitError] = useState<string | null>(null);
  const mapRef = useRef<MapLibreViewHandle>(null);
  const mapInitDeadlineRef = useRef<ReturnType<typeof setTimeout>>();

  // Get cameras in view for mobile header display
  const viewCameraCount = bounds
    ? getCamerasInBounds(bounds.north, bounds.south, bounds.east, bounds.west).length
    : 0;

  // Load cameras on mount - immediately, not waiting for idle
  // Also resets UI state in case of stale state from previous navigation
  useEffect(() => {
    const mountTime = performance.now();
    if (import.meta.env.DEV) {
      console.log('[MapPage] Component mounted, starting camera load...');
    }

    // Reset UI state on mount (handles navigation back scenarios)
    setMarkersReady(false);
    setMapInitError(null);

    ensureCamerasLoaded()
      .then(() => {
        if (import.meta.env.DEV) {
          console.log(`[MapPage] Camera load complete in ${(performance.now() - mountTime).toFixed(0)}ms`);
        }
      })
      .catch((err) => {
        console.error('Camera initialization failed:', err);
      });
  }, [ensureCamerasLoaded]);

  // Map-init deadline: if markers don't become ready within 15s after cameras
  // load, treat the map init as failed and surface the existing error UI
  // (Try Again + Legacy Maps Link). The inner retry pipeline in
  // MapLibreContainer keeps event listeners attached for the full duration,
  // so a successful late init before the deadline still clears markersReady.
  useEffect(() => {
    if (isInitialized && cameras.length > 0 && !markersReady && !mapInitError) {
      mapInitDeadlineRef.current = setTimeout(() => {
        if (!markersReady) {
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
  }, [isInitialized, cameras.length, markersReady, mapInitError]);

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
    setMapInitError(null);
    setMarkersReady(false);
    // Force map remount with new key — unconditional so a failing
    // retryCameraLoad still gets a fresh map instance on next attempt
    setMapKey(k => k + 1);

    try {
      await retryCameraLoad();
    } catch {
      // Error handling done in store
    }
  }, [retryCameraLoad]);

  // Map progress: idle -> loading -> hydrating -> ready (for cameras)
  // Then map also needs markers to be ready
  const cameraProgress = error ? 'error' : loadPhase;
  
  // Show map only when cameras are fully loaded
  const camerasReady = isInitialized && cameras.length > 0;
  
  // Full ready state: cameras loaded AND map markers rendered
  const isFullyReady = camerasReady && markersReady;

  // /timeline path: auto-play dot density animation once map is ready
  useEffect(() => {
    if (isTimelinePath && isFullyReady && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      // Short delay so TimelineBar mounts and registers the tick callback
      const timer = setTimeout(() => {
        updateTimelineSettings({ isPlaying: true });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isTimelinePath, isFullyReady, updateTimelineSettings]);

  const seo = (
    <Seo
      title="DeFlock Maps | ALPR Camera Map & Privacy Routes"
      description="Explore the national ALPR camera map and compare direct routes with privacy-optimized alternatives."
      path="/"
    />
  );

  return (
    <>
      {seo}
      {/* Unified loading overlay — map renders underneath so tiles load in parallel */}
      {(!isFullyReady || error || mapInitError) && (
        <MapLoadingScreen
          cameraProgress={cameraProgress}
          cameraCount={cameras.length}
          error={error ?? mapInitError}
          onRetry={handleRetryWithRemount}
          markersReady={markersReady}
          camerasReady={camerasReady}
        />
      )}
      <div className={`map-page h-screen w-screen flex flex-col bg-dark-900 overflow-hidden ${isExploreMode ? 'timeline-active' : ''}`}>
        {/* Header - Persistent on Map View */}
        <header className="h-12 bg-dark-900 border-b border-dark-600 flex items-center z-50 shrink-0">
          <div className="w-full px-4 lg:px-5">
            <div className="flex items-center justify-between h-12">
              {/* Logo + Product Switcher */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <ProductSwitcher />
                <a
                  href="https://deflock.org"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <img
                    src="/deflock-icon.png"
                    alt="DeFlock Icon"
                    className="h-7 lg:h-8 w-auto object-contain"
                  />
                  <img
                    src="/deflock-logo.svg"
                    alt="DeFlock Logo"
                    className="h-7 lg:h-8 w-auto object-contain"
                  />
                  <span className="text-dark-400 text-[11px] font-medium tracking-[0.2em] uppercase hidden sm:inline self-end mb-[3px]">Maps</span>
                </a>
              </div>

              {/* Desktop: Mode tabs - editorial underline style */}
              <nav className="hidden lg:flex items-center gap-6" aria-label="App modes">
                {(Object.entries(MODE_LABELS) as [AppMode, typeof MODE_LABELS[AppMode]][]).map(([mode, { label }]) => (
                  <button
                    key={mode}
                    onClick={() => handleSetAppMode(mode)}
                    className={`relative text-sm font-medium uppercase tracking-widest pb-1 transition-colors duration-150 ${
                      appMode === mode
                        ? 'text-accent'
                        : 'text-dark-200 hover:text-white'
                    }`}
                    aria-current={appMode === mode ? 'page' : undefined}
                  >
                    {label}
                    {appMode === mode && (
                      <span className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-accent" />
                    )}
                  </button>
                ))}
              </nav>

              {/* Mobile: Camera count + hamburger */}
              <div className="lg:hidden flex items-center gap-2">
                <span className="text-xs text-dark-400">
                  <span className="text-dark-200 font-semibold tabular-nums">{viewCameraCount.toLocaleString()}</span> in view
                </span>
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="inline-flex items-center justify-center w-10 h-10 text-dark-300 hover:text-dark-100 transition-colors duration-150"
                  aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={mobileMenuOpen}
                >
                  {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
              </div>

              {/* Desktop: Share + Legacy map link */}
              {!isEmbed && (
              <div className="hidden lg:flex items-center gap-4 flex-shrink-0">
                <ShareButton variant="header" />
                <div className="w-px h-4 bg-dark-600" />
                <LegacyMapLink variant="header" />
              </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile slide-down menu */}
        {mobileMenuOpen && (
          <nav
            className="lg:hidden absolute top-12 left-0 right-0 z-[60] bg-dark-800 border-b border-dark-600"
            aria-label="Mobile navigation"
          >
            <div className="px-4 py-2 space-y-0.5">
              {(Object.entries(MODE_LABELS) as [AppMode, typeof MODE_LABELS[AppMode]][]).map(([mode, { icon: Icon, label }]) => (
                <button
                  key={mode}
                  onClick={() => {
                    handleSetAppMode(mode);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150 ${
                    appMode === mode
                      ? 'text-accent'
                      : 'text-dark-300 hover:text-dark-100'
                  }`}
                  aria-current={appMode === mode ? 'page' : undefined}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-dark-600 mt-1 pt-1 px-4 pb-2 space-y-0.5">
              {!isEmbed && <ShareButton variant="menu-item" />}
              {!isEmbed && <LegacyMapLink variant="menu-item" />}
            </div>
          </nav>
        )}

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
            <MapLibreView
              ref={mapRef}
              mapKey={mapKey}
              onMarkersReady={handleMarkersReady}
            />

            {/* Map Overlays */}
            {!isEmbed && <MapSearch />}
            {appMode === 'network' ? <NetworkAgencyCount /> : appMode !== 'map' ? <CameraStats /> : null}
            <MapStyleControl />

            {/* Density feature popup — floating stats card */}
            {appMode === 'density' && <DensityFeaturePopup />}

            {/* Density legend bar — horizontal bottom overlay */}
            {appMode === 'density' && <DensityLegendBar />}


            {/* Map Legend - route mode only (explore/density legends live in side panel) */}
            {appMode === 'route' && (
              <div className="absolute bottom-6 left-4 z-20 hidden lg:flex flex-col gap-2">
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
                      <div className="w-6 h-1 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]"></div>
                      <span className="text-dark-100">Privacy Route</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Map mode legend */}
            {appMode === 'map' && (
              <div className="absolute bottom-6 left-4 z-20 hidden lg:flex flex-col gap-2">
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

            {/* Timeline Bar — single instance, wrapper switches on breakpoint */}
            {isExploreMode && (
              <div className={isMobile
                ? "timeline-bar-mobile fixed bottom-[84px] left-3 right-3 z-[51] h-12 bg-dark-900/70 backdrop-blur-xl rounded-xl border border-white/[0.06] shadow-lg shadow-black/30"
                : "timeline-bar-desktop absolute bottom-4 left-4 right-20 z-20 h-14 bg-dark-900/70 backdrop-blur-xl rounded-xl border border-white/[0.06] shadow-lg shadow-black/30"
              }>
                <TimelineBar />
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
