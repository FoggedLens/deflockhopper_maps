import { useState, useRef, useEffect, useCallback } from 'react';
import { smartSearch, toLocation, type GeocodingResult } from '../../services/geocodingService';
import type { Location } from '../../types';

interface AddressSearchProps {
  value: Location | null;
  onChange: (location: Location | null) => void;
  placeholder?: string;
  label?: string;
  icon?: 'origin' | 'destination';
  onFocus?: () => void;
  onPickFromMap?: () => void;
  isPickingFromMap?: boolean;
}

// Geolocation state type
type GeolocationState = 'idle' | 'loading' | 'success' | 'error';
type GeolocationError = 'denied' | 'unavailable' | 'timeout' | 'not-supported' | null;

// Result type icons as inline SVGs for instant rendering
const TypeIcons: Record<GeocodingResult['type'], JSX.Element> = {
  poi: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.36 9l.6 3H5.04l.6-3h12.72M20 4H4v2h16V4zm0 3H4l-1 5v2h1v6h10v-6h4v6h2v-6h1v-2l-1-5zM6 18v-4h6v4H6z" />
    </svg>
  ),
  city: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z" />
    </svg>
  ),
  state: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  ),
  zip: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z" />
    </svg>
  ),
  coordinates: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
    </svg>
  ),
  street: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 15h16v-2H4v2zm0 4h16v-2H4v2zm0-8h16V9H4v2zm0-6v2h16V5H4z" />
    </svg>
  ),
  address: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  ),
};

export function AddressSearch({
  value,
  onChange,
  placeholder = 'Search address, city, or place...',
  label,
  icon = 'origin',
  onFocus,
  onPickFromMap,
  isPickingFromMap = false,
}: AddressSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Geolocation state
  const [geoState, setGeoState] = useState<GeolocationState>('idle');
  const [geoError, setGeoError] = useState<GeolocationError>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Derive stable IDs from label for aria associations
  const idSlug = label?.toLowerCase().replace(/\s+/g, '-') ?? 'search';
  const inputId = `address-input-${idSlug}`;
  const errorId = `address-error-${idSlug}`;

  // Handle "Use My Location" button click
  const handleUseMyLocation = useCallback(async () => {
    // Check if geolocation is supported
    if (!navigator.geolocation) {
      setGeoState('error');
      setGeoError('not-supported');
      return;
    }

    setGeoState('loading');
    setGeoError(null);

    try {
      // Get current position with high accuracy for mobile devices
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000, // 15 second timeout
          maximumAge: 60000, // Cache for 1 minute
        });
      });

      const { latitude: lat, longitude: lon } = position.coords;

      const locationName = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      const locationAddress = 'Current Location';

      // Create the location object
      const location: Location = {
        lat,
        lon,
        name: locationName,
        address: locationAddress,
      };

      // Update state
      setQuery(locationName);
      onChange(location);
      setResults([]);
      setIsOpen(false);
      setGeoState('success');

      // Reset success state after a moment
      setTimeout(() => setGeoState('idle'), 2000);

    } catch (err) {
      setGeoState('error');

      if (err instanceof GeolocationPositionError) {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGeoError('denied');
            break;
          case err.POSITION_UNAVAILABLE:
            setGeoError('unavailable');
            break;
          case err.TIMEOUT:
            setGeoError('timeout');
            break;
          default:
            setGeoError('unavailable');
        }
      } else {
        setGeoError('unavailable');
      }

      // Clear error state after 3 seconds
      setTimeout(() => {
        setGeoState('idle');
        setGeoError(null);
      }, 3000);
    }
  }, [onChange]);

  // Perform search - only called on Enter or button click
  const performSearch = useCallback(async (searchQuery: string) => {
    // Cancel any in-flight request
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
    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      setError(null);
      const searchResults = await smartSearch(searchQuery, 'routing', abortControllerRef.current.signal);
      setResults(searchResults);
      setIsOpen(searchResults.length > 0);
      setSelectedIndex(-1);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Ignore aborted requests
      }
      console.error('Search error:', err);
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle input change - just update query, don't search
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    // Close results when typing new query
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

  const handleSelectResult = (result: GeocodingResult) => {
    const location = toLocation(result);
    onChange(location);
    setQuery(result.name);
    setIsOpen(false);
    setResults([]);
    setSelectedIndex(-1);
  };

  const handleClear = () => {
    setQuery('');
    onChange(null);
    setResults([]);
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        if (isOpen && results.length > 0) {
          e.preventDefault();
          setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
        }
        break;
      case 'ArrowUp':
        if (isOpen && results.length > 0) {
          e.preventDefault();
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelectResult(results[selectedIndex]);
        } else if (isOpen && results.length > 0) {
          handleSelectResult(results[0]);
        } else {
          // No results open, trigger search
          handleSubmit();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Update query when value changes externally
  useEffect(() => {
    if (value?.name && value.name !== query) {
      setQuery(value.name);
    }
  }, [value?.name]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const iconColor = icon === 'origin' ? 'text-success' : 'text-danger';

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label htmlFor={inputId} className="block text-sm text-dark-100 mb-2 font-medium">
          {label}
        </label>
      )}

      <div className="relative">
        <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${iconColor}`}>
          {icon === 'origin' ? (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="8" />
            </svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          )}
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
            onFocus?.();
          }}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-describedby={error ? errorId : undefined}
          className="w-full pl-12 pr-20 py-3.5 bg-dark-800 border border-dark-600 rounded-md text-white placeholder-dark-200 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
        />

        {/* Right side: Clear and Search button */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && !isLoading && (
            <button
              onClick={handleClear}
              type="button"
              aria-label="Clear address"
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
            aria-label="Search address"
            disabled={isLoading || query.trim().length < 2}
            className="p-2 bg-accent hover:bg-accent-hover disabled:bg-dark-700 disabled:text-dark-400 text-white rounded-md transition-colors"
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

      {/* Quick actions row - Use My Location & Pick on Map */}
      {!value && (
        <div className="mt-1.5 flex items-center gap-3">
          {/* Use My Location */}
          <button
            onClick={handleUseMyLocation}
            type="button"
            aria-label="Use my location"
            disabled={geoState === 'loading'}
            className={`flex items-center gap-1.5 text-xs transition-all ${
              geoState === 'loading'
                ? 'text-accent'
                : geoState === 'success'
                ? 'text-success'
                : geoState === 'error'
                ? 'text-danger'
                : 'text-dark-300 hover:text-accent'
            }`}
          >
            {geoState === 'loading' ? (
              <>
                <div className="w-3 h-3 border-[1.5px] border-accent/30 border-t-accent rounded-full animate-spin" />
                <span>Getting location...</span>
              </>
            ) : geoState === 'success' ? (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
                <span>Location set!</span>
              </>
            ) : geoState === 'error' ? (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
                <span>
                  {geoError === 'denied' ? 'Location denied' :
                   geoError === 'timeout' ? 'Timed out' :
                   geoError === 'not-supported' ? 'Not supported' :
                   'Unavailable'}
                </span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
                </svg>
                <span>Use my location</span>
              </>
            )}
          </button>

          {/* Separator */}
          {onPickFromMap && <span className="text-dark-600">•</span>}

          {/* Pick on Map */}
          {onPickFromMap && (
            <button
              onClick={onPickFromMap}
              type="button"
              aria-label="Pick location on map"
              className={`flex items-center gap-1.5 text-xs transition-all ${
                isPickingFromMap
                  ? 'text-accent'
                  : 'text-dark-300 hover:text-accent'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z" />
              </svg>
              <span>{isPickingFromMap ? 'Click on map...' : 'Choose on map'}</span>
            </button>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div id={errorId} role="alert" className="mt-1.5 text-sm text-danger flex items-center gap-1.5">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          {error}
        </div>
      )}

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute z-50 w-full mt-2 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden animate-fade-in"
        >
          <ul className="max-h-80 overflow-y-auto">
            {results.map((result, index) => (
              <li key={result.id} role="option" aria-selected={index === selectedIndex}>
                <button
                  onClick={() => handleSelectResult(result)}
                  type="button"
                  className={`w-full px-4 py-3.5 text-left flex items-start gap-3 transition-colors border-b border-dark-700/50 last:border-b-0 ${
                    index === selectedIndex
                      ? 'bg-accent/10'
                      : 'hover:bg-dark-700/70'
                  }`}
                >
                  {/* Type icon */}
                  <span className={`mt-0.5 flex-shrink-0 ${
                    result.type === 'poi' ? 'text-route-direct' :
                    result.type === 'city' ? 'text-accent' :
                    result.type === 'coordinates' ? 'text-success' :
                    'text-dark-400'
                  }`}>
                    {TypeIcons[result.type]}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="text-base text-white font-medium truncate">
                      {result.name}
                    </div>
                    <div className="text-sm text-dark-200 truncate mt-0.5">
                      {result.description}
                    </div>
                  </div>

                  {/* Type badge */}
                  <span className={`text-xs uppercase tracking-wide px-2 py-1 rounded-lg flex-shrink-0 ${
                    result.type === 'poi' ? 'bg-route-direct/20 text-route-direct' :
                    result.type === 'city' ? 'bg-accent/20 text-accent' :
                    result.type === 'coordinates' ? 'bg-success/20 text-success' :
                    result.type === 'zip' ? 'bg-accent/10 text-accent' :
                    'bg-dark-600 text-dark-400'
                  }`}>
                    {result.type === 'poi' ? 'Place' :
                     result.type === 'coordinates' ? 'GPS' :
                     result.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Search tip footer */}
          <div className="px-4 py-2.5 bg-dark-900/50 border-t border-dark-700/50 flex items-center justify-between">
            <span className="text-xs text-dark-200">
              ↑↓ to navigate · Enter to select
            </span>
            <span className="text-xs text-dark-400">
              OpenStreetMap
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
