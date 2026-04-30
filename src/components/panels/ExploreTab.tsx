import { useState, useRef, useCallback, useEffect } from 'react';
import { useMapStore, useCameraStore } from '../../store';
import { smartSearch, toLocation, type GeocodingResult } from '../../services/geocodingService';

export function ExploreTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<GeocodingResult[]>([]);
  
  const flyTo = useMapStore(s => s.flyTo);
  const zoom = useMapStore(s => s.zoom);
  const center = useMapStore(s => s.center);
  const { getCamerasInBounds, cameras } = useCameraStore();
  
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Get cameras in current view
  const [viewCameraCount, setViewCameraCount] = useState(0);
  
  useEffect(() => {
    // Estimate visible cameras based on current center and zoom
    const latRange = 180 / Math.pow(2, zoom);
    const lonRange = 360 / Math.pow(2, zoom);
    
    const visibleCameras = getCamerasInBounds(
      center[0] + latRange / 2,
      center[0] - latRange / 2,
      center[1] + lonRange / 2,
      center[1] - lonRange / 2
    );
    setViewCameraCount(visibleCameras.length);
  }, [center, zoom, getCamerasInBounds, cameras]);

  // Perform search - only called on Enter or button click
  const performSearch = useCallback(async (searchQuery: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (searchQuery.length < 2) {
      setResults([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    try {
      const searchResults = await smartSearch(searchQuery, 'map', abortControllerRef.current.signal);
      setResults(searchResults);
      setIsOpen(searchResults.length > 0);
      setSelectedIndex(-1);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle input change - just update query, don't search
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (isOpen) {
      setIsOpen(false);
      setResults([]);
    }
  };

  // Handle search submission
  const handleSubmit = () => {
    if (query.trim().length >= 2) {
      performSearch(query.trim());
    }
  };

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && selectedIndex >= 0 && selectedIndex < results.length) {
        handleSelectResult(results[selectedIndex]);
      } else if (isOpen && results.length > 0) {
        handleSelectResult(results[0]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'ArrowDown' && isOpen) {
      e.preventDefault();
      setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp' && isOpen) {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSelectedIndex(-1);
    }
  };

  const handleSelectResult = (result: GeocodingResult) => {
    const location = toLocation(result);
    
    // Fly to location with appropriate zoom
    const targetZoom = result.type === 'city' ? 11 : 
                       result.type === 'state' ? 7 : 
                       result.type === 'zip' ? 13 : 15;
    
    flyTo([location.lat, location.lon], targetZoom);
    
    // Save to recent searches
    setRecentSearches(prev => {
      const filtered = prev.filter(r => r.id !== result.id);
      return [result, ...filtered].slice(0, 5);
    });
    
    setQuery(result.name);
    setIsOpen(false);
    setResults([]);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Quick zoom presets
  const quickLocations = [
    { name: 'New York', lat: 40.7128, lon: -74.006, zoom: 11 },
    { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, zoom: 11 },
    { name: 'Chicago', lat: 41.8781, lon: -87.6298, zoom: 11 },
    { name: 'Houston', lat: 29.7604, lon: -95.3698, zoom: 11 },
  ];

  return (
    <div className="space-y-6">
      {/* Current View Stats */}
      <div className="bg-dark-800 rounded-md border border-dark-600 p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-dark-400 uppercase tracking-wider">
            Current View
          </span>
          <span className="text-xs text-dark-500">
            Zoom: {Math.round(zoom)}
          </span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-danger"></div>
              <span className="text-3xl font-display font-bold text-white">
                {viewCameraCount.toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-dark-400">cameras visible</p>
          </div>
          
          <div className="text-right">
            <p className="text-lg font-display font-semibold text-dark-300">
              {cameras.length.toLocaleString()}
            </p>
            <p className="text-xs text-dark-500">total US</p>
          </div>
        </div>
      </div>

      {/* Location Search */}
      <div ref={containerRef} className="relative">
        <label className="block text-xs text-dark-400 mb-2 font-medium uppercase tracking-wider">
          Search Location
        </label>
        
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-400">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setIsOpen(true)}
            placeholder="City, zip code, or address..."
            autoComplete="off"
            className="w-full pl-12 pr-20 py-4 bg-dark-800 border border-dark-600 rounded-xl text-white placeholder-dark-500 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
          />

          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {query && !isLoading && (
              <button
                onClick={handleClear}
                type="button"
                className="p-1.5 text-dark-400 hover:text-white transition-colors"
                title="Clear"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            )}
            
            <button
              onClick={handleSubmit}
              type="button"
              disabled={isLoading || query.trim().length < 2}
              className="p-2 bg-accent hover:bg-accent-hover disabled:bg-dark-700 disabled:text-dark-400 text-white rounded-lg transition-colors"
              title="Search (Enter)"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Results dropdown */}
        {isOpen && results.length > 0 && (
          <div className="absolute z-50 w-full mt-2 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
            <ul className="max-h-64 overflow-y-auto">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    onClick={() => handleSelectResult(result)}
                    type="button"
                    className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors border-b border-dark-700/50 last:border-b-0 ${
                      index === selectedIndex ? 'bg-accent/10' : 'hover:bg-dark-700'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-dark-700 flex items-center justify-center text-accent">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{result.name}</p>
                      <p className="text-xs text-dark-400 truncate">{result.description}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-4 py-2 bg-dark-900/50 border-t border-dark-700/50 text-xs text-dark-500">
              ↑↓ to navigate · Enter to select
            </div>
          </div>
        )}
      </div>

      {/* Recent Searches */}
      {recentSearches.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-dark-400 uppercase tracking-wider mb-3">
            Recent Searches
          </h4>
          <div className="space-y-2">
            {recentSearches.map((result) => (
              <button
                key={result.id}
                onClick={() => handleSelectResult(result)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-dark-800 hover:bg-dark-700 rounded-xl transition-colors text-left"
              >
                <svg className="w-4 h-4 text-dark-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-dark-200 truncate">{result.name}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Access Cities */}
      <div>
        <h4 className="text-xs font-medium text-dark-400 uppercase tracking-wider mb-3">
          Major Cities
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {quickLocations.map((loc) => (
            <button
              key={loc.name}
              onClick={() => flyTo([loc.lat, loc.lon], loc.zoom)}
              className="flex items-center gap-2 px-4 py-3 bg-dark-800 hover:bg-dark-700 rounded-xl transition-colors text-left"
            >
              <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z" />
              </svg>
              <span className="text-sm text-dark-200 font-medium">{loc.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tip */}
      <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-dark-300 font-medium mb-1">Tip</p>
            <p className="text-xs text-dark-500">
              Click on any camera marker to see details. Use Route Check to see cameras along your path.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

