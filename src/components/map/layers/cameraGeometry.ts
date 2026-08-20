import { DIRECTIONAL_ZONE, CAMERA_DETECTION, ZONE_SAFETY_MULTIPLIERS } from '../../../services/routingConfig';

// Helper to create a direction cone polygon from a point and direction.
// Defaults come from routing config; explicit spans can be visualization metadata.
export function createDirectionCone(
  lon: number,
  lat: number,
  direction: number,
  lengthMeters: number = CAMERA_DETECTION.routeBufferMeters * ZONE_SAFETY_MULTIPLIERS.block * 0.75,
  spreadDegrees: number = DIRECTIONAL_ZONE.cameraFovDegrees
): GeoJSON.Feature<GeoJSON.Polygon> {
  const earthRadiusMeters = 6371000;
  const latRad = (lat * Math.PI) / 180;

  // Convert meters to degrees (approximate)
  const lengthDegrees = (lengthMeters / earthRadiusMeters) * (180 / Math.PI);
  const pointAtBearing = (bearingDegrees: number): [number, number] => {
    const angle = (bearingDegrees * Math.PI) / 180;
    return [
      lon + lengthDegrees * Math.sin(angle) / Math.cos(latRad),
      lat + lengthDegrees * Math.cos(angle),
    ];
  };

  // Calculate the three points of the cone
  const points: [number, number][] = [[lon, lat]]; // Start at camera

  // Left edge of cone
  points.push(pointAtBearing(direction - spreadDegrees / 2));

  // Create arc for the front of the cone
  const arcSteps = 8;
  for (let step = 1; step < arcSteps; step++) {
    const bearing = direction - spreadDegrees / 2 + (spreadDegrees * step) / arcSteps;
    points.push(pointAtBearing(bearing));
  }

  // Right edge of cone
  points.push(pointAtBearing(direction + spreadDegrees / 2));

  // Close the polygon
  points.push([lon, lat]);

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [points],
    },
  };
}

export interface DirectionView {
  bearing: number;
  spreadDegrees: number;
}

function resolveSpreadDegrees(spread: unknown): number {
  return typeof spread === 'number' && Number.isFinite(spread) && spread > 0 && spread <= 360
    ? spread
    : DIRECTIONAL_ZONE.cameraFovDegrees;
}

function parseArrayAttribute(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return undefined;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDirectionViews(
  direction: number | null | undefined,
  directions: unknown,
  directionSpan: number | null | undefined,
  directionSpans: unknown
): DirectionView[] {
  const parsedDirections = parseArrayAttribute(directions);
  if (parsedDirections && parsedDirections.length > 1) {
    const alignedSpans = parseArrayAttribute(directionSpans) ?? [];
    return parsedDirections.flatMap((bearing, index) =>
      typeof bearing === 'number' && Number.isFinite(bearing)
        ? [{ bearing, spreadDegrees: resolveSpreadDegrees(alignedSpans[index]) }]
        : []
    );
  }

  if (typeof direction !== 'number' || !Number.isFinite(direction)) return [];

  return [
    {
      bearing: direction,
      spreadDegrees: resolveSpreadDegrees(directionSpan),
    },
  ];
}

/**
 * Normalize a camera's bearing(s). `directions` may be a real array (from the
 * GeoJSON dataset) or a JSON-encoded string like "[90,270]" (from vector
 * tiles, where tippecanoe stringifies array attributes).
 */
export function parseDirections(
  direction: number | null | undefined,
  directions: unknown
): number[] {
  const parsedDirections = parseArrayAttribute(directions);
  if (Array.isArray(directions) && parsedDirections && parsedDirections.length > 1) {
    return parsedDirections.filter((value): value is number => Number.isFinite(value));
  }
  if (typeof directions === 'string' && parsedDirections) {
    const numericDirections = parsedDirections.map(Number).filter(Number.isFinite);
    if (numericDirections.length > 1) return numericDirections;
  }
  return direction !== null && direction !== undefined && Number.isFinite(direction)
    ? [direction]
    : [];
}
