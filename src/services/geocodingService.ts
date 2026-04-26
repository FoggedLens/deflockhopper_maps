import type { Location } from '../types';
import { lookupZipCode } from './zipCodeService';

// ============================================================================
// TYPES
// ============================================================================

export interface GeocodingResult {
  id: string;
  lat: number;
  lon: number;
  name: string;
  description: string;
  type: 'address' | 'poi' | 'city' | 'state' | 'zip' | 'coordinates' | 'street';
  distance?: number; // Only for coordinate-based results
}

interface PhotonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    osm_id: number;
    osm_type: string;
    osm_key: string;
    osm_value: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
    type?: string;
    extent?: [number, number, number, number];
  };
}

interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

// Nominatim types
interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance?: number;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

// ============================================================================
// COORDINATE DETECTION
// ============================================================================

const COORD_PATTERNS = [
  // "40.7128, -74.0060" or "40.7128,-74.0060"
  /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/,
  // "40.7128 -74.0060"
  /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/,
  // "N 40.7128 W 74.0060" or "40.7128N 74.0060W"
  /^[NnSs]?\s*(-?\d+\.?\d*)\s*[NnSs]?\s*[,\s]\s*[EeWw]?\s*(-?\d+\.?\d*)\s*[EeWw]?$/,
];

/**
 * Check if input looks like GPS coordinates
 */
function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const trimmed = input.trim();
  
  for (const pattern of COORD_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      let lat = parseFloat(match[1]);
      let lon = parseFloat(match[2]);
      
      // Handle NSEW directions
      if (trimmed.toLowerCase().includes('s')) lat = -Math.abs(lat);
      if (trimmed.toLowerCase().includes('w')) lon = -Math.abs(lon);
      
      // Validate ranges
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon };
      }
    }
  }
  
  return null;
}

// ============================================================================
// ZIP CODE DETECTION
// ============================================================================

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

/**
 * Check if input is a US zip code
 */
function isZipCode(input: string): boolean {
  return ZIP_PATTERN.test(input.trim());
}

// ============================================================================
// PHOTON GEOCODING (Primary - Fast, Free, No Rate Limits)
// ============================================================================

const PHOTON_API = 'https://photon.komoot.io/api';

/**
 * Search using Photon geocoder (OSM-based, fast, no rate limits)
 */
async function searchPhoton(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '8',
    lang: 'en',
  });
  
  // Bias results toward US
  // Columbus, OH as rough center of continental US
  params.append('lat', '39.9612');
  params.append('lon', '-82.9988');

  const response = await fetch(`${PHOTON_API}?${params}`, { signal });
  
  if (!response.ok) {
    throw new Error(`Photon API error: ${response.status}`);
  }

  const data: PhotonResponse = await response.json();
  
  return data.features
    .filter(f => {
      // Filter to US results (or results without country info)
      const cc = f.properties.countrycode?.toLowerCase();
      return !cc || cc === 'us';
    })
    .map(photonToResult);
}

/**
 * Convert Photon feature to our result format
 */
function photonToResult(feature: PhotonFeature): GeocodingResult {
  const props = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  
  // Determine result type
  let type: GeocodingResult['type'] = 'address';
  const osmKey = props.osm_key?.toLowerCase() || '';
  const osmValue = props.osm_value?.toLowerCase() || '';
  
  if (osmKey === 'shop' || osmKey === 'amenity' || osmKey === 'tourism' || osmKey === 'leisure') {
    type = 'poi';
  } else if (osmKey === 'place' && ['city', 'town', 'village', 'hamlet'].includes(osmValue)) {
    type = 'city';
  } else if (osmKey === 'place' && osmValue === 'state') {
    type = 'state';
  } else if (osmKey === 'highway') {
    type = 'street';
  } else if (props.postcode && !props.street && !props.name) {
    type = 'zip';
  }
  
  // Build name
  let name = '';
  if (props.name) {
    name = props.name;
  } else if (props.housenumber && props.street) {
    name = `${props.housenumber} ${props.street}`;
  } else if (props.street) {
    name = props.street;
  } else if (props.city) {
    name = props.city;
  } else if (props.state) {
    name = props.state;
  }
  
  // Build description
  const descParts: string[] = [];
  if (props.housenumber && props.street && props.name) {
    descParts.push(`${props.housenumber} ${props.street}`);
  }
  if (props.city) descParts.push(props.city);
  if (props.state) descParts.push(props.state);
  if (props.postcode) descParts.push(props.postcode);
  
  const description = descParts.join(', ') || 'United States';
  
  return {
    id: `photon-${props.osm_id}-${props.osm_type}`,
    lat,
    lon,
    name: name || description.split(',')[0],
    description,
    type,
  };
}

// ============================================================================
// NOMINATIM-FORMAT RESULT CONVERTER
// ============================================================================

/**
 * Convert Nominatim-format result to our result format
 */
function nominatimToResult(result: NominatimResult): GeocodingResult {
  const addr = result.address;

  // Determine result type based on class and type
  let type: GeocodingResult['type'] = 'address';
  const resultClass = result.class?.toLowerCase() || '';
  const resultType = result.type?.toLowerCase() || '';

  if (resultClass === 'shop' || resultClass === 'amenity' || resultClass === 'tourism' || resultClass === 'leisure') {
    type = 'poi';
  } else if (resultClass === 'place' && ['city', 'town', 'village', 'hamlet'].includes(resultType)) {
    type = 'city';
  } else if (resultClass === 'boundary' && resultType === 'administrative') {
    if (addr?.state && !addr?.city && !addr?.town && !addr?.village && !addr?.road) {
      type = 'state';
    } else {
      type = 'city';
    }
  } else if (resultClass === 'highway') {
    type = 'street';
  } else if (resultType === 'postcode') {
    type = 'zip';
  }

  // Build name - prefer structured address parts
  let name = '';
  if (addr?.house_number && addr?.road) {
    name = `${addr.house_number} ${addr.road}`;
  } else if (addr?.road) {
    name = addr.road;
  } else {
    name = result.display_name.split(',')[0];
  }

  // Build description from address parts
  const descParts: string[] = [];
  const city = addr?.city || addr?.town || addr?.village;
  if (city) descParts.push(city);
  if (addr?.state) descParts.push(addr.state);
  if (addr?.postcode) descParts.push(addr.postcode);

  const description = descParts.join(', ') || 'United States';

  return {
    id: `nom-${result.place_id}`,
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    name: name || description.split(',')[0],
    description,
    type,
  };
}

// ============================================================================
// PROXY GEOCODING (Primary - custom proxy returning Nominatim-format results)
// ============================================================================

const GEOCODE_PROXY_URL = (import.meta.env.VITE_GEOCODE_API_URL as string | undefined) || 'https://api.deflock.org/geocode/multi';

/**
 * Search using the custom geocoding proxy (returns Nominatim-format JSON).
 * Uses ?query= param as required by the proxy.
 */
async function searchProxy(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({ query });
  const response = await fetch(`${GEOCODE_PROXY_URL}?${params}`, { signal });

  if (!response.ok) {
    throw new Error(`Geocoding proxy error: ${response.status}`);
  }

  const data: NominatimResult[] = await response.json();
  const mapped = data.map(nominatimToResult);

  // Deduplicate by name: when multiple results share the same display name
  // (e.g. multiple buildings at the same street address), keep only the first.
  const seen = new Set<string>();
  return mapped.filter(r => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

// ============================================================================
// FALLBACK CHAIN
// ============================================================================

type GeocodingProvider = (query: string, signal?: AbortSignal) => Promise<GeocodingResult[]>;

/**
 * Search through providers in order: Proxy → Photon (fallback).
 * Falls through to the next provider on failure or empty results.
 */
async function searchWithFallback(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
  const providers: { name: string; search: GeocodingProvider }[] = [
    { name: 'Proxy', search: searchProxy },
    { name: 'Photon', search: searchPhoton },
  ];

  for (const provider of providers) {
    try {
      const results = await provider.search(query, signal);
      if (results.length > 0) {
        return results;
      }
      // Empty results — try next provider
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return [];
      }
      // Log and fall through to next provider
      if (import.meta.env.DEV) {
        console.warn(`[Geocoding] ${provider.name} failed, trying next provider:`, error);
      }
    }
  }

  return [];
}

// ============================================================================
// MAIN SEARCH FUNCTION
// ============================================================================

/**
 * Smart geocoding search that handles:
 * - GPS coordinates (40.7128, -74.0060)
 * - ZIP codes (43215) - uses local bundled data for instant lookups
 * - Addresses (123 Main St, Columbus, OH)
 * - Cities (Columbus, Ohio)
 * - POI/Business (Walmart Columbus)
 */
export async function smartSearch(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
  const trimmed = query.trim();
  
  if (!trimmed || trimmed.length < 2) {
    return [];
  }

  // Check for GPS coordinates first — return directly, no reverse lookup needed
  const coords = parseCoordinates(trimmed);
  if (coords) {
    return [{
      id: `coords-${coords.lat}-${coords.lon}`,
      lat: coords.lat,
      lon: coords.lon,
      name: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`,
      description: 'GPS Coordinates',
      type: 'coordinates',
    }];
  }

  // Check for ZIP codes - use local bundled data for instant, reliable lookups
  if (isZipCode(trimmed)) {
    try {
      const zipData = await lookupZipCode(trimmed);
      if (zipData) {
        // Return the ZIP code result from local data
        return [{
          id: `zip-${trimmed}`,
          lat: zipData.lat,
          lon: zipData.lon,
          name: trimmed,
          description: `${zipData.city}, ${zipData.state}`,
          type: 'zip',
        }];
      }
    } catch {
      // If local lookup fails, fall through to API search
      console.warn('Local ZIP lookup failed, falling back to API');
    }
    
    // Fall back to API providers for ZIP lookup
    return searchWithFallback(`${trimmed}, USA`, signal);
  }

  // Search with 2-tier fallback: Proxy → Photon
  return searchWithFallback(trimmed, signal);
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Convert GeocodingResult to Location
 */
export function toLocation(result: GeocodingResult): Location {
  return {
    lat: result.lat,
    lon: result.lon,
    name: result.name,
    address: result.description,
  };
}

/**
 * Get icon name for result type
 */
export function getResultTypeIcon(type: GeocodingResult['type']): string {
  switch (type) {
    case 'poi': return 'store';
    case 'city': return 'city';
    case 'state': return 'state';
    case 'zip': return 'mail';
    case 'coordinates': return 'gps';
    case 'street': return 'road';
    case 'address':
    default: return 'location';
  }
}

