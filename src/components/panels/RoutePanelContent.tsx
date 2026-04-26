import { useState, useRef } from 'react';
import { useRouteStore, useMapStore } from '../../store';
import { AddressSearch } from '../inputs/AddressSearch';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { FlockHopperAppPromo } from './FlockHopperAppPromo';
import { downloadGPX } from '../../services/gpxService';
import { formatDistance, formatDuration } from '../../utils/geo';
import { formatPercent } from '../../utils/formatting';
import type { Location } from '../../types';

interface RoutePanelContentProps {
  /** Callback to expand the bottom sheet (mobile only) */
  onExpandSheet?: () => void;
  /** Callback to collapse the bottom sheet (mobile only) */
  onCollapseSheet?: () => void;
  /** Whether this is rendered inside a bottom sheet (mobile) vs side panel (desktop) */
  isBottomSheet?: boolean;
}

export function RoutePanelContent({ onExpandSheet, onCollapseSheet, isBottomSheet = false }: RoutePanelContentProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showNamingModal, setShowNamingModal] = useState(false);
  const [routeName, setRouteName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  
  const {
    origin,
    destination,
    setOrigin,
    setDestination,
    calculateRoutes,
    clearRoutes,
    swapLocations,
    normalRoute,
    avoidanceRoute,
    comparison,
    isCalculating,
    error,
    activeRoute,
    setActiveRoute,
    routeOptions,
    setCameraDistance,
    setUseDirectionalZones,
    pickingLocation,
    startPickingLocation,
    cancelPickingLocation,
  } = useRouteStore();

  const flyTo = useMapStore(s => s.flyTo);

  // Wrapper to set origin and zoom to it
  const handleSetOrigin = (location: Location | null) => {
    setOrigin(location);
    if (location) {
      // Zoom to the origin location at a city-level zoom
      flyTo([location.lat, location.lon], 13);
    }
  };

  const handleCalculate = () => {
    calculateRoutes();
  };

  const openNamingModal = () => {
    // Pre-fill with a suggested name based on origin/destination
    const suggestedName = origin && destination 
      ? `${origin.name?.split(',')[0] || 'Start'} to ${destination.name?.split(',')[0] || 'End'}`
      : '';
    setRouteName(suggestedName);
    setShowNamingModal(true);
  };

  const handleExportGPX = () => {
    const route = activeRoute === 'avoidance' ? avoidanceRoute : normalRoute;
    if (route) {
      // Sanitize filename: remove special chars, replace spaces with hyphens
      const sanitizedName = routeName.trim()
        ? routeName.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
        : `${activeRoute}-route`;
      const filename = `flockhopper-${sanitizedName}-${Date.now()}.gpx`;
      downloadGPX(route, filename);
      setShowNamingModal(false);
      setRouteName('');
    }
  };

  // Expand sheet when user focuses on inputs (mobile only)
  const handleInputFocus = () => {
    if (isBottomSheet && onExpandSheet) {
      onExpandSheet();
    }
  };

  const canCalculate = origin && destination && !isCalculating;
  const hasRoutes = normalRoute && avoidanceRoute && comparison;
  
  const normalCameraCount = comparison?.normalCameras.length ?? 0;
  const avoidanceCameraCount = comparison?.avoidanceCameras.length ?? 0;
  const cameraReduction = normalCameraCount > 0 
    ? Math.round(((normalCameraCount - avoidanceCameraCount) / normalCameraCount) * 100)
    : 0;

  return (
    <div className="space-y-6">
          {/* Intro (when no routes) */}
          {!hasRoutes && (
            <div className="space-y-4">
              <div>
                <img src="/FlockHopper-2.png" alt="FlockHopper" className="h-14 w-auto" />
                <div className="flex items-center gap-2 mt-2">
                  <p className="text-xs text-dark-400">
                    Powered by{' '}
                    <a
                      href="https://dontgetflocked.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:text-accent-hover font-medium transition-colors"
                    >
                      dontgetflocked.com
                    </a>
                  </p>
                  <span className="text-dark-600">·</span>
                  <FlockHopperAppPromo />
                </div>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed">
                Enter your starting point and destination to analyze ALPR camera exposure along your route and discover safer alternatives.
              </p>
            </div>
          )}

          {/* Route Inputs */}
          <div className="space-y-1">
            <AddressSearch
              value={origin}
              onChange={handleSetOrigin}
              placeholder="Where are you starting?"
              label="Start"
              icon="origin"
              onFocus={handleInputFocus}
              onPickFromMap={() => {
                if (pickingLocation === 'origin') {
                  cancelPickingLocation();
                } else {
                  startPickingLocation('origin');
                  // Collapse sheet so user can see the map
                  if (isBottomSheet && onCollapseSheet) {
                    onCollapseSheet();
                  }
                }
              }}
              isPickingFromMap={pickingLocation === 'origin'}
            />
            <div className="flex justify-center -my-1">
              <button
                onClick={swapLocations}
                disabled={!origin && !destination}
                className="p-1 text-gray-300 hover:text-white transition-all disabled:opacity-30"
                title="Swap locations"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z" />
                </svg>
              </button>
            </div>
            <AddressSearch
              value={destination}
              onChange={setDestination}
              placeholder="Where are you going?"
              label="Destination"
              icon="destination"
              onFocus={handleInputFocus}
              onPickFromMap={() => {
                if (pickingLocation === 'destination') {
                  cancelPickingLocation();
                } else {
                  startPickingLocation('destination');
                  // Collapse sheet so user can see the map
                  if (isBottomSheet && onCollapseSheet) {
                    onCollapseSheet();
                  }
                }
              }}
              isPickingFromMap={pickingLocation === 'destination'}
            />
          </div>

          {/* Settings Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-between px-4 py-3.5 bg-dark-800 hover:bg-dark-700 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
              <span className="text-sm text-gray-200 font-medium">Avoidance Settings</span>
            </div>
            <svg 
              className={`w-5 h-5 text-gray-400 transition-transform ${showSettings ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
            </svg>
          </button>

          {/* Settings Panel */}
          {showSettings && (
            <div className="bg-dark-800 rounded-xl border border-dark-600 p-5 space-y-4 animate-fade-in">
              {/* Camera Distance - The only setting that matters */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-200 font-medium">Camera Distance to Route</label>
                  <span className="text-sm text-accent font-bold">
                    {Math.round(routeOptions.cameraDistanceMeters * 3.28084)} ft
                  </span>
                </div>
                <p className="text-xs text-gray-300 mb-3">
                  Stay this far from cameras. Smaller = shorter routes but closer to cameras.
                </p>
                <input
                  type="range"
                  min="30"
                  max="500"
                  step="10"
                  value={Math.round(routeOptions.cameraDistanceMeters * 3.28084)}
                  onChange={(e) => setCameraDistance(Math.round(parseInt(e.target.value) * 0.3048))}
                  className="w-full h-2 bg-dark-600 rounded-lg appearance-none cursor-pointer accent-accent"
                  aria-label="Camera avoidance distance"
                />
                <div className="flex justify-between text-xs text-gray-300 mt-2">
                  <span>30 ft (risky)</span>
                  <span>500 ft (safe)</span>
                </div>
              </div>

              {/* Directional Zones Toggle */}
              <div className="pt-4 border-t border-dark-700">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-4">
                    <label className="text-sm text-gray-200 font-medium">Directional Camera Zones</label>
                    <p className="text-xs text-gray-400 mt-1">
                      Use camera facing direction to create cone-shaped avoidance zones. Routes can pass behind cameras.
                    </p>
                  </div>
                  <button
                    onClick={() => setUseDirectionalZones(!routeOptions.useDirectionalZones)}
                    className={`relative inline-flex h-[22px] w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-dark-800 ${
                      routeOptions.useDirectionalZones ? 'bg-accent' : 'bg-dark-600'
                    }`}
                    role="switch"
                    aria-checked={routeOptions.useDirectionalZones}
                  >
                    <span
                      className={`pointer-events-none inline-block w-[18px] h-[18px] transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        routeOptions.useDirectionalZones ? 'translate-x-[18px]' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Calculate Button */}
          <button
            onClick={handleCalculate}
            disabled={!canCalculate}
            className="w-full py-4 bg-accent hover:bg-accent-hover disabled:bg-dark-600 disabled:cursor-not-allowed text-white font-display font-bold text-base rounded-md transition-all duration-300 flex items-center justify-center gap-3"
            aria-label="Analyze route"
          >
            {isCalculating ? (
              <>
                <LoadingSpinner size="sm" />
                <span>Scanning route...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.71 11.29l-9-9a.996.996 0 00-1.41 0l-9 9a.996.996 0 000 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 000-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z" />
                </svg>
                <span>Analyze Route</span>
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="p-4 bg-accent/10 border border-accent/30 rounded-xl text-sm text-accent flex items-start gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {hasRoutes && (
            <div className="space-y-5 animate-fade-in">
              
              {/* Big Camera Count Display */}
              <div className="relative overflow-hidden rounded-md bg-dark-800 border border-dark-600 p-6">
                <div className="relative text-center">
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <div className="w-3 h-3 rounded-full bg-accent rec-indicator shadow-[0_0_12px_rgba(30,144,255,0.6)]"></div>
                    <span className="text-sm font-medium text-gray-200 uppercase tracking-wide">
                      Direct Route
                    </span>
                  </div>
                  
                  <div className="text-6xl font-display font-black text-white mb-2">
                    {normalCameraCount}
                  </div>
                  
                  <p className="text-sm text-gray-300">
                    {normalCameraCount === 0 
                      ? 'No ALPR cameras detected!'
                      : normalCameraCount === 1 
                        ? 'camera will scan your plates'
                        : 'cameras will scan your plates'
                    }
                  </p>
                </div>
              </div>

              {/* Route Comparison Cards */}
              <div className="grid grid-cols-2 gap-4">
                {/* Normal Route */}
                <button
                  onClick={() => setActiveRoute('normal')}
                  aria-selected={activeRoute === 'normal'}
                  aria-label="Select direct route"
                  className={`relative p-4 rounded-md border-2 transition-all ${
                    activeRoute === 'normal'
                      ? 'bg-orange-500/10 border-orange-500'
                      : 'bg-dark-800 border-dark-600 hover:border-dark-500'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-1 rounded-full bg-orange-500" style={{backgroundImage: 'repeating-linear-gradient(90deg, #e5a04d 0, #e5a04d 3px, transparent 3px, transparent 5px)'}}></div>
                    <span className="text-xs font-semibold text-gray-200 uppercase tracking-wide">
                      Direct
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="text-xl font-display font-bold text-white">
                      {formatDistance(normalRoute.distanceMeters)}
                    </p>
                    <p className="text-sm text-gray-300 mt-1">
                      {formatDuration(normalRoute.durationSeconds)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-dark-600">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent"></div>
                    <span className="text-lg font-bold text-accent">
                      {normalCameraCount}
                    </span>
                    <span className="text-sm text-gray-300">cameras</span>
                  </div>
                </button>

                {/* Avoidance Route */}
                <button
                  onClick={() => setActiveRoute('avoidance')}
                  aria-selected={activeRoute === 'avoidance'}
                  aria-label="Select privacy route"
                  className={`relative p-4 rounded-md border-2 transition-all ${
                    activeRoute === 'avoidance'
                      ? 'bg-blue-500/10 border-blue-500'
                      : 'bg-dark-800 border-dark-600 hover:border-dark-500'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-1 rounded-full bg-blue-500"></div>
                    <span className="text-xs font-semibold text-gray-200 uppercase tracking-wide">
                      Privacy
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="text-xl font-display font-bold text-white">
                      {formatDistance(avoidanceRoute.distanceMeters)}
                    </p>
                    <p className="text-sm text-gray-300 mt-1">
                      {formatDuration(avoidanceRoute.durationSeconds)}
                      {comparison.durationIncreasePercent > 0 && (
                        <span className="text-route-direct ml-1">
                          (+{formatPercent(comparison.durationIncreasePercent)})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-dark-600">
                    <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                    <span className="text-lg font-bold text-accent">
                      {avoidanceCameraCount}
                    </span>
                    <span className="text-sm text-gray-300">cameras</span>
                  </div>
                </button>
              </div>

              {/* Success Banner */}
              {cameraReduction > 0 && (
                <div className="bg-dark-800 border border-dark-600 rounded-md p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-6 h-6 text-accent" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        <span className="text-accent">{cameraReduction}% fewer</span> cameras
                      </p>
                      <p className="text-sm text-gray-300 mt-1">
                        +{formatDistance(comparison.distanceIncrease)} extra
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Export Button */}
              <button
                onClick={openNamingModal}
                className="w-full py-3.5 bg-dark-800 hover:bg-dark-700 border border-dark-600 text-white font-medium text-sm rounded-md transition-colors flex items-center justify-center gap-3"
                aria-label="Download route as GPX"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
                Download {activeRoute === 'avoidance' ? 'Privacy' : 'Direct'} Route (GPX)
              </button>

              {/* Route Naming Modal */}
              {showNamingModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-fade-in">
                  <div
                    className="bg-dark-800 border border-dark-600 rounded-md p-6 w-full max-w-md animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-display font-bold text-white">Name Your Route</h3>
                        <p className="text-sm text-gray-400">Give this route a memorable name</p>
                      </div>
                    </div>

                    <input
                      ref={nameInputRef}
                      type="text"
                      autoFocus
                      value={routeName}
                      onChange={(e) => setRouteName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleExportGPX();
                        if (e.key === 'Escape') setShowNamingModal(false);
                      }}
                      placeholder="e.g., Work Commute, Weekend Trip..."
                      className="w-full px-4 py-3 bg-dark-900 border border-dark-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    />

                    <div className="flex gap-3 mt-5">
                      <button
                        onClick={() => setShowNamingModal(false)}
                        className="flex-1 py-3 bg-dark-700 hover:bg-dark-600 text-gray-300 font-medium rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleExportGPX}
                        className="flex-1 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-md transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                        </svg>
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Clear */}
              <button
                onClick={clearRoutes}
                className="w-full py-3 text-gray-400 hover:text-gray-200 text-sm font-medium transition-colors"
              >
                Start over
              </button>
            </div>
          )}

          {/* How it works (when no routes) */}
          {!hasRoutes && !isCalculating && (
            <div className="bg-dark-800/50 rounded-xl p-5 border border-dark-700/50">
              <h4 className="text-sm font-semibold text-gray-200 uppercase tracking-wide mb-4">
                How it works
              </h4>
              <ol className="space-y-3">
                {[
                  'Enter your starting point and destination',
                  'See exactly how many cameras track your commute',
                  'FlockHopper generates an alternative private route',
                  'Customize by adding waypoints or avoiding areas',
                  'Export to GPX and navigate with OsmAnd or Organic Maps',
                ].map((step, idx) => (
                  <li key={idx} className="flex gap-4 text-sm text-gray-200">
                    <span className="w-6 h-6 rounded-full bg-dark-700 flex items-center justify-center text-sm font-bold text-accent flex-shrink-0">
                      {idx + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

    </div>
  );
}

