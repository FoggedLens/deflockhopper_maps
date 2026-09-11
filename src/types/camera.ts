export interface ALPRCamera {
  osmId: number;
  osmType: 'node' | 'way';
  lat: number;
  lon: number;
  operator?: string;
  brand?: string;
  model?: string;
  direction?: number;
  directions?: number[];
  directionCardinal?: string;
  surveillanceZone?: 'traffic' | 'town' | 'parking' | 'other';
  mountType?: 'pole' | 'wall' | 'street_light' | 'other';
  ref?: string;
  startDate?: string;
  osmTimestamp?: string;  // ISO 8601 from Overpass out meta
  osmVersion?: number;    // Element version (1 = never edited)
  wikimediaCommons?: string;
}

export interface CameraOnRoute {
  camera: ALPRCamera;
  distanceFromRoute: number;
  nearestRoutePoint: [number, number];
  isFacingRoute: boolean;
}

export interface CameraFilters {
  operators: string[];
  brands: string[];
  surveillanceZones: string[];
  mountTypes: string[];
  /** Two-letter US state postal code (URL-linkable via ?state=XX). */
  state?: string;
  showAll: boolean;
  timelineDate?: string;  // YYYY-MM format, filters cameras by osmTimestamp
}

export interface OverpassResponse {
  version: number;
  generator: string;
  elements: OverpassElement[];
}

export interface OverpassElement {
  type: 'node' | 'way';
  id: number;
  lat: number;
  lon: number;
  timestamp?: string;
  version?: number;
  tags?: {
    'man_made'?: string;
    'surveillance:type'?: string;
    'operator'?: string;
    'brand'?: string;
    'manufacturer'?: string;
    'direction'?: string;
    'camera:direction'?: string;
    'surveillance:zone'?: string;
    'camera:mount'?: string;
    'ref'?: string;
    'start_date'?: string;
    [key: string]: string | undefined;
  };
}

/** One selectable value in the filter manifest. Ids are build-scoped —
 *  they match the codes baked into the cameras filter tileset from the same
 *  pipeline run and may change between builds. Never persist ids. */
export interface ManifestFacetEntry {
  id: number;
  label: string;
  count: number;
}

/** Filter dictionary generated alongside the cameras filter tileset. */
export interface CameraManifest {
  version: string;
  generatedAt: string;
  total: number;
  brands: ManifestFacetEntry[];
  operators: ManifestFacetEntry[];
  zones: ManifestFacetEntry[];
  mounts: ManifestFacetEntry[];
}

