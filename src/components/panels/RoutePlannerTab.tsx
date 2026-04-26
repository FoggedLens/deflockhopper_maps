import { useRouteStore } from '../../store';
import { AddressSearch } from '../inputs/AddressSearch';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { downloadGPX } from '../../services/gpxService';
import { formatDistance, formatDuration } from '../../utils/geo';
import { formatPercent } from '../../utils/formatting';

export function RoutePlannerTab() {
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
    pickingLocation,
    startPickingLocation,
    cancelPickingLocation,
  } = useRouteStore();

  const handleCalculate = () => {
    calculateRoutes();
  };

  const handleExportGPX = () => {
    const route = activeRoute === 'avoidance' ? avoidanceRoute : normalRoute;
    if (route) {
      const filename = `flockhopper-${activeRoute}-route-${Date.now()}.gpx`;
      downloadGPX(route, filename);
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
      {/* Intro */}
      {!hasRoutes && (
        <div className="text-center py-2">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/20 rounded-full mb-4">
            <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
            </svg>
            <span className="text-xs font-medium text-accent uppercase tracking-wider">
              Privacy Route
            </span>
          </div>
          <h2 className="text-xl font-display font-bold text-white mb-2">
            Find a camera-avoiding route
          </h2>
          <p className="text-sm text-dark-400 max-w-xs mx-auto">
            We'll calculate both normal and avoidance routes so you can compare.
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
          onPickFromMap={() => {
            if (pickingLocation === 'origin') {
              cancelPickingLocation();
            } else {
              startPickingLocation('origin');
            }
          }}
          isPickingFromMap={pickingLocation === 'origin'}
        />

        <div className="flex justify-center">
          <button
            onClick={swapLocations}
            disabled={!origin && !destination}
            className="p-2.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-xl transition-all disabled:opacity-30"
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
          onPickFromMap={() => {
            if (pickingLocation === 'destination') {
              cancelPickingLocation();
            } else {
              startPickingLocation('destination');
            }
          }}
          isPickingFromMap={pickingLocation === 'destination'}
        />
      </div>

      {/* Calculate Button */}
      <button
        onClick={handleCalculate}
        disabled={!canCalculate}
        className="w-full py-4 bg-accent hover:bg-accent-hover disabled:bg-dark-600 disabled:cursor-not-allowed text-white font-display font-bold text-lg rounded-md transition-all duration-300 flex items-center justify-center gap-3"
        aria-label="Calculate routes"
      >
        {isCalculating ? (
          <>
            <LoadingSpinner size="sm" />
            <span>Finding routes...</span>
          </>
        ) : (
          <>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.71 11.29l-9-9a.996.996 0 00-1.41 0l-9 9a.996.996 0 000 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 000-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z" />
            </svg>
            <span>Calculate Routes</span>
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

      {/* Route Comparison */}
      {hasRoutes && (
        <div className="space-y-4 animate-fade-in">
          {/* Route Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Normal Route */}
            <button
              onClick={() => setActiveRoute('normal')}
              aria-selected={activeRoute === 'normal'}
              aria-label="Select direct route"
              className={`relative p-4 rounded-md border transition-all ${
                activeRoute === 'normal'
                  ? 'bg-orange-500/10 border-orange-500 ring-2 ring-orange-500/30'
                  : 'bg-dark-800 border-dark-600 hover:border-dark-500'
              }`}
            >
              {activeRoute === 'normal' && (
                <div className="absolute top-2 right-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-1 rounded-full bg-orange-500" style={{backgroundImage: 'repeating-linear-gradient(90deg, #e5a04d 0, #e5a04d 3px, transparent 3px, transparent 5px)'}}></div>
                <span className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Direct
                </span>
              </div>
              <div className="text-left">
                <p className="text-lg font-display font-bold text-white">
                  {formatDistance(normalRoute.distanceMeters)}
                </p>
                <p className="text-xs text-dark-400">
                  {formatDuration(normalRoute.durationSeconds)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-dark-600">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                <span className="text-sm font-bold text-accent">
                  {normalCameraCount}
                </span>
                <span className="text-xs text-dark-500">cameras</span>
              </div>
            </button>

            {/* Avoidance Route */}
            <button
              onClick={() => setActiveRoute('avoidance')}
              aria-selected={activeRoute === 'avoidance'}
              aria-label="Select privacy route"
              className={`relative p-4 rounded-md border transition-all ${
                activeRoute === 'avoidance'
                  ? 'bg-blue-500/10 border-blue-500 ring-2 ring-blue-500/30'
                  : 'bg-dark-800 border-dark-600 hover:border-dark-500'
              }`}
            >
              {activeRoute === 'avoidance' && (
                <div className="absolute top-2 right-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-1 rounded-full bg-blue-500"></div>
                <span className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Privacy
                </span>
              </div>
              <div className="text-left">
                <p className="text-lg font-display font-bold text-white">
                  {formatDistance(avoidanceRoute.distanceMeters)}
                </p>
                <p className="text-xs text-dark-400">
                  {formatDuration(avoidanceRoute.durationSeconds)}
                  {comparison.durationIncreasePercent > 0 && (
                    <span className="text-route-direct ml-1">
                      (+{formatPercent(comparison.durationIncreasePercent)})
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-dark-600">
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
                <span className="text-sm font-bold text-accent">
                  {avoidanceCameraCount}
                </span>
                <span className="text-xs text-dark-500">cameras</span>
              </div>
            </button>
          </div>

          {/* Summary Banner */}
          {cameraReduction > 0 && (
            <div className="bg-dark-800 border border-dark-600 rounded-md p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    <span className="text-accent">{cameraReduction}% fewer</span> cameras
                  </p>
                  <p className="text-xs text-dark-400">
                    +{formatDistance(comparison.distanceIncrease)} extra distance
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Export Button */}
          <button
            onClick={handleExportGPX}
            className="w-full py-3 bg-dark-800 hover:bg-dark-700 border border-dark-600 text-white font-medium rounded-md transition-colors flex items-center justify-center gap-2"
            aria-label="Export route as GPX"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            Export {activeRoute === 'avoidance' ? 'Privacy' : 'Direct'} Route (GPX)
          </button>

          {/* Clear */}
          <button
            onClick={clearRoutes}
            className="w-full py-2.5 text-dark-400 hover:text-dark-200 text-sm font-medium transition-colors"
          >
            Start over
          </button>
        </div>
      )}

      {/* How it works */}
      {!hasRoutes && !isCalculating && (
        <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
          <h4 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-3">
            How avoidance works
          </h4>
          <ol className="space-y-2.5">
            {[
              'We calculate the direct route first',
              'Identify all ALPR cameras on that route',
              'Find alternative paths that avoid camera clusters',
              'Return the best privacy-preserving route',
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

