import { useState, useRef, useCallback, useEffect } from 'react';
import { useMapStore } from '../../store';
import { smartSearch, toLocation, type GeocodingResult } from '../../services/geocodingService';

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

// Icon color based on result type
function getIconColor(type: GeocodingResult['type']): string {
  switch (type) {
    case 'poi': return 'text-route-direct';
    case 'city': return 'text-accent';
    case 'coordinates': return 'text-success';
    case 'zip': return 'text-accent';
    default: return 'text-accent';
  }
}

export function MapSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  const flyTo = useMapStore(s => s.flyTo);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
      const searchResults = await smartSearch(searchQuery, abortControllerRef.current.signal);
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
    
    setQuery('');
    setIsOpen(false);
    setResults([]);
    setSelectedIndex(-1);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
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

  // Keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && isFocused) {
        inputRef.current?.blur();
        setIsOpen(false);
        setIsFocused(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFocused]);

  return (
    <div ref={containerRef} className="absolute top-3 left-3 right-3 lg:top-4 lg:left-4 lg:right-auto z-40 lg:w-96">
      {/* Search Input */}
      <div className={`relative transition-all duration-200 ${isFocused ? 'lg:scale-[1.02]' : ''}`}>
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-200 pointer-events-none z-10">
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
          onFocus={() => {
            setIsFocused(true);
            if (results.length > 0) setIsOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          placeholder="Search address, city, or zip..."
          autoComplete="off"
          aria-label="Search locations"
          className="w-full pl-12 pr-24 py-3.5 bg-dark-800 border border-dark-600 rounded-md text-white placeholder-dark-500 text-base text-left focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
        />

        {/* Right side: Search button, Loading, Clear */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && !isLoading && (
            <button
              onClick={handleClear}
              type="button"
              aria-label="Clear search"
              className="p-1.5 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
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
            aria-label="Search"
            className="p-2 bg-accent hover:bg-accent-hover disabled:bg-dark-700 disabled:text-dark-400 text-white rounded-md transition-colors"
            title="Search (Enter)"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div role="listbox" className="mt-2 bg-dark-800 border border-dark-600 rounded-md overflow-hidden animate-fade-in">
          <ul className="max-h-72 overflow-y-auto">
            {results.map((result, index) => (
              <li key={result.id} role="option">
                <button
                  onClick={() => handleSelectResult(result)}
                  type="button"
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors border-b border-dark-700/30 last:border-b-0 ${
                    index === selectedIndex ? 'bg-accent/10' : 'hover:bg-dark-700/50'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl bg-dark-700 flex items-center justify-center flex-shrink-0 ${getIconColor(result.type)}`}>
                    {TypeIcons[result.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-white font-medium truncate">{result.name}</p>
                    <p className="text-sm text-gray-400 truncate">{result.description}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {/* Keyboard hints */}
          <div className="px-4 py-2 bg-dark-800/50 border-t border-dark-700/30 text-xs text-gray-500">
            ↑↓ to navigate · Enter to select
          </div>
        </div>
      )}
    </div>
  );
}

