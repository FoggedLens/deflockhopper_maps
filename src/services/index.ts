// Primary data service - uses bundled camera data (fast!)
export {
  loadBundledCameras,
  getCamerasInBounds,
  getUniqueOperators,
  getUniqueBrands,
  clearCameraCache,
} from './cameraDataService';

// API client - FlockHopper routing API
export * from './apiClient';

// Geocoding - Nominatim + Photon based service
export { smartSearch, toLocation, getResultTypeIcon } from './geocodingService';
export type { GeocodingResult } from './geocodingService';

// Export utilities
export * from './gpxService';
