import { useState } from 'react';
import { useRouteStore } from '../../store';
import { AddressSearch } from '../inputs/AddressSearch';
import { LoadingSpinner } from '../common/LoadingSpinner';

export function RouteCheckTab() {
  const [showDetails, setShowDetails] = useState(false);
  
  const {
    origin,
    destination,
    setOrigin,
    setDestination,
    calculateRoutes,
    clearRoutes,
    swapLocations,
    normalRoute,
    comparison,
    isCalculating,
    error,
  } = useRouteStore();

  const handleCalculate = () => {
    calculateRoutes();
  };

  const canCalculate = origin && destination && !isCalculating;
  const normalCameraCount = comparison?.normalCameras.length ?? 0;
  const avoidanceCameraCount = comparison?.avoidanceCameras.length ?? 0;
  const hasResults = normalRoute && comparison;

  return (
    <div className="space-y-6">
      {/* Intro text */}
      {!hasResults && (
        <div className="text-center py-2">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/20 rounded-full mb-4">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            <span className="text-xs font-medium text-accent uppercase tracking-wider">
              Surveillance Check
            </span>
          </div>
          <h2 className="text-xl font-display font-bold text-white mb-2">
            How exposed is your route?
          </h2>
          <p className="text-sm text-dark-400 max-w-xs mx-auto">
            Enter your route to see how many ALPR cameras you'll pass.
          </p>
        </div>
      )}

      {/* Route Inputs */}
      <div className="space-y-3">
        <AddressSearch
          value={origin}
          onChange={setOrigin}
          placeholder="Starting point..."
          label="From"
          icon="origin"
        />

        <div className="flex justify-center">
          <button
            onClick={swapLocations}
            disabled={!origin && !destination}
            className="p-2.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-xl transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-dark-400"
            title="Swap locations"
            aria-label="Swap origin and destination"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z" />
            </svg>
          </button>
        </div>

        <AddressSearch
          value={destination}
          onChange={setDestination}
          placeholder="Destination..."
          label="To"
          icon="destination"
        />
      </div>

      {/* Calculate Button */}
      <button
        onClick={handleCalculate}
        disabled={!canCalculate}
        className="w-full py-4 bg-accent hover:bg-accent-hover disabled:bg-dark-600 disabled:cursor-not-allowed text-white font-display font-bold text-lg rounded-md transition-all duration-300 flex items-center justify-center gap-3"
        aria-label="Check route for ALPR cameras"
      >
        {isCalculating ? (
          <>
            <LoadingSpinner size="sm" />
            <span>Scanning route...</span>
          </>
        ) : (
          <>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
            </svg>
            <span>Check Route</span>
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
      {hasResults && (
        <div className="space-y-4 animate-fade-in">
          {/* Main Camera Count - Big Impact Display */}
          <div className="relative overflow-hidden rounded-md bg-dark-800 border border-dark-600 p-6">
            <div className="relative">
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className="w-3 h-3 rounded-full bg-accent rec-indicator shadow-[0_0_12px_rgba(30,144,255,0.6)]"></div>
                  <span className="text-xs font-medium text-dark-400 uppercase tracking-widest">
                    Cameras on Route
                  </span>
                </div>
                
                <div className="text-6xl font-display font-black text-white mb-1">
                  {normalCameraCount}
                </div>
                
                <p className="text-sm text-dark-400">
                  {normalCameraCount === 0 
                    ? 'No ALPR cameras detected!'
                    : normalCameraCount === 1 
                      ? 'ALPR camera will scan your plates'
                      : 'ALPR cameras will scan your plates'
                  }
                </p>
              </div>

              {/* Camera breakdown */}
              {normalCameraCount > 0 && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="w-full mt-4 pt-4 border-t border-dark-600 flex items-center justify-between text-dark-400 hover:text-dark-200 transition-colors"
                  aria-label="View camera details"
                >
                  <span className="text-xs font-medium">View camera details</span>
                  <svg 
                    className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} 
                    viewBox="0 0 24 24" 
                    fill="currentColor"
                  >
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Camera Details (expandable) */}
          {showDetails && comparison.normalCameras.length > 0 && (
            <div className="bg-dark-800 rounded-xl border border-dark-600 overflow-hidden animate-fade-in">
              <div className="px-4 py-3 border-b border-dark-600 bg-dark-700/50">
                <span className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Camera Breakdown
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {comparison.normalCameras.slice(0, 10).map((cam, idx) => (
                  <div 
                    key={cam.camera.osmId}
                    className="flex items-center gap-3 px-4 py-3 border-b border-dark-700/50 last:border-b-0"
                  >
                    <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark-200 truncate">
                        {cam.camera.operator || cam.camera.brand || 'Unknown operator'}
                      </p>
                      <p className="text-xs text-dark-500">
                        {Math.round(cam.distanceFromRoute)}m from route
                      </p>
                    </div>
                  </div>
                ))}
                {comparison.normalCameras.length > 10 && (
                  <div className="px-4 py-3 text-center text-xs text-dark-500">
                    +{comparison.normalCameras.length - 10} more cameras
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Avoidance CTA */}
          {normalCameraCount > avoidanceCameraCount && (
            <div className="bg-dark-800 border border-dark-600 rounded-md p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-accent/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white mb-1">
                    A safer route exists
                  </p>
                  <p className="text-xs text-dark-400 mb-3">
                    Reduce exposure to{' '}
                    <span className="text-accent font-bold">{avoidanceCameraCount} cameras</span>
                    {' '}({Math.round(((normalCameraCount - avoidanceCameraCount) / normalCameraCount) * 100)}% fewer)
                  </p>
                  <p className="text-xs text-dark-500">
                    Switch to "Route Planner" tab for the full avoidance tool →
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Clear button */}
          <button
            onClick={clearRoutes}
            className="w-full py-2.5 text-dark-400 hover:text-dark-200 text-sm font-medium transition-colors"
            aria-label="Check another route"
          >
            Check another route
          </button>
        </div>
      )}

      {/* How it works */}
      {!hasResults && !isCalculating && (
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <h4 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-3">
            How it works
          </h4>
          <ol className="space-y-2.5">
            {[
              'Enter your start and destination',
              'We calculate the direct route',
              'Count all ALPR cameras along the way',
            ].map((step, idx) => (
              <li key={idx} className="flex gap-3 text-xs text-dark-400">
                <span className="w-5 h-5 rounded-full bg-dark-700 flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
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

