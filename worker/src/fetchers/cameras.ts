import type { OverpassResponse, OverpassElement, GeoJSON } from '../types';
import { queryOverpass } from '../lib/overpass';
import { pointFeature, buildFeatureCollection } from '../lib/geojson';

export const CAMERAS_OVERPASS_QUERY = `[out:json][timeout:300];
area["ISO3166-1"="US"]->.us;
(
  node["man_made"="surveillance"]["surveillance:type"="ALPR"](area.us);
  way["man_made"="surveillance"]["surveillance:type"="ALPR"](area.us);
);
out meta;
>;
out skel qt;`;

const MIN_CAMERA_COUNT = 50_000;

const CARDINALS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

const SPELLED_CARDINALS: Record<string, number> = {
  NORTH: 0, NORTHEAST: 45, EAST: 90, SOUTHEAST: 135,
  SOUTH: 180, SOUTHWEST: 225, WEST: 270, NORTHWEST: 315,
};

const BOUND_DIRECTIONS: Record<string, number> = {
  NB: 0, EB: 90, SB: 180, WB: 270,
};

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Resolve a simple token (cardinal, spelled-out, bound, or numeric) to raw degrees. No normalization, no range/semicolon handling. */
function resolveSimple(token: string): number | null {
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper in CARDINALS) return CARDINALS[upper];
  if (upper in SPELLED_CARDINALS) return SPELLED_CARDINALS[upper];
  if (upper in BOUND_DIRECTIONS) return BOUND_DIRECTIONS[upper];
  const num = Number(upper);  // Number() rejects "338-23" unlike parseFloat
  return isNaN(num) ? null : num;
}

/** Compute the midpoint bearing of a clockwise sector from startDeg to endDeg (raw values, not pre-normalized). */
function rangeMidpoint(startDeg: number, endDeg: number): number {
  const rawArc = endDeg - startDeg;
  const arc = ((rawArc % 360) + 360) % 360;
  // Full circle: raw values differ but normalized arc is 0 (e.g. 0→360)
  if (arc === 0 && rawArc !== 0) return normalizeDegrees(startDeg + 180);
  if (arc === 0) return normalizeDegrees(startDeg);
  return normalizeDegrees(startDeg + arc / 2);
}

/** Parse a single direction token which may be a cardinal, numeric, bound, spelled-out, or range (e.g. "338-23"). */
function parseSingleToken(token: string): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Try simple resolve first (cardinal, spelled-out, bound, numeric)
  const simple = resolveSimple(trimmed);
  if (simple !== null) return normalizeDegrees(simple);

  // Range notation: "338-23", "WSW-ESE" — find dash that isn't a leading negative
  const dashIdx = trimmed.indexOf('-', 1);
  if (dashIdx > 0) {
    const left = resolveSimple(trimmed.slice(0, dashIdx));
    const right = resolveSimple(trimmed.slice(dashIdx + 1));
    if (left !== null && right !== null) {
      return rangeMidpoint(left, right);
    }
  }

  return null;
}

/** Parse a direction tag into all resolved bearings (handles semicolons and commas). */
export function parseDirections(value: string | undefined): number[] {
  if (!value) return [];
  const tokens = value.split(/[;,]/).map((t) => t.trim()).filter(Boolean);
  const results: number[] = [];
  for (const token of tokens) {
    const deg = parseSingleToken(token);
    if (deg !== null) results.push(deg);
  }
  return results;
}

/** Parse a direction tag into a single bearing (first resolved value). Backward-compatible. */
export function parseDirection(value: string | undefined): number | null {
  const dirs = parseDirections(value);
  return dirs.length > 0 ? dirs[0] : null;
}

export function transformOverpassToGeoJSON(
  data: OverpassResponse
): GeoJSON.FeatureCollection {
  // Build node lookup for way centroid calculation
  const nodesById = new Map<number, { lat: number; lon: number }>();
  for (const el of data.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodesById.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }

  const features: GeoJSON.Feature[] = [];

  for (const el of data.elements) {
    const tags = el.tags ?? {};

    // Only process surveillance ALPR elements
    if (tags['man_made'] !== 'surveillance') continue;
    if (tags['surveillance:type'] !== 'ALPR') continue;

    let lat = el.lat;
    let lon = el.lon;

    // For ways, compute centroid from child nodes
    if (el.type === 'way' && el.nodes) {
      const wayNodes = el.nodes
        .map((id) => nodesById.get(id))
        .filter((n): n is { lat: number; lon: number } => n !== undefined);

      if (wayNodes.length > 0) {
        lat = wayNodes.reduce((sum, n) => sum + n.lat, 0) / wayNodes.length;
        lon = wayNodes.reduce((sum, n) => sum + n.lon, 0) / wayNodes.length;
      }
    }

    if (lat === undefined || lon === undefined) continue;

    const directionTag = tags['direction'] || tags['camera:direction'];
    const directions = parseDirections(directionTag);
    const direction = directions.length > 0 ? directions[0] : null;
    // directionCardinal stores the original cardinal string when the (first) token is a compass point
    const firstToken = directionTag?.split(/[;,]/)[0]?.trim();
    const isCardinal = firstToken ? firstToken.toUpperCase() in CARDINALS : false;

    const properties: Record<string, unknown> = {
      osmId: el.id,
      osmType: el.type,
    };

    if (tags['operator']) properties.operator = tags['operator'];
    if (tags['brand'] || tags['manufacturer']) {
      properties.brand = tags['brand'] || tags['manufacturer'];
    }
    if (direction !== null) properties.direction = direction;
    if (directions.length > 1) properties.directions = directions;
    if (isCardinal) properties.directionCardinal = firstToken;
    if (tags['surveillance:zone']) properties.surveillanceZone = tags['surveillance:zone'];
    if (tags['camera:mount']) properties.mountType = tags['camera:mount'];
    if (tags['ref']) properties.ref = tags['ref'];
    if (tags['start_date']) properties.startDate = tags['start_date'];
    if (el.timestamp) properties.osmTimestamp = el.timestamp;
    if (el.version) properties.osmVersion = el.version;
    if (tags['wikimedia_commons']) properties.wikimediaCommons = tags['wikimedia_commons'];

    features.push(pointFeature(lon, lat, properties));
  }

  // Sort by osmId for deterministic output
  features.sort((a, b) => (a.properties.osmId as number) - (b.properties.osmId as number));

  return buildFeatureCollection(features);
}

export async function fetchCameras(): Promise<{
  featureCollection: GeoJSON.FeatureCollection;
  featureCount: number;
}> {
  console.log('Fetching camera data from Overpass API...');
  const data = await queryOverpass(CAMERAS_OVERPASS_QUERY);

  console.log(`Received ${data.elements.length} elements, transforming to GeoJSON...`);
  const featureCollection = transformOverpassToGeoJSON(data);
  const featureCount = featureCollection.features.length;

  console.log(`Transformed to ${featureCount} camera features`);

  if (featureCount < MIN_CAMERA_COUNT) {
    throw new Error(
      `Validation failed: only ${featureCount} cameras (minimum ${MIN_CAMERA_COUNT}). Skipping update.`
    );
  }

  return { featureCollection, featureCount };
}
