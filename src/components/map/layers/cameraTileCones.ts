import { createDirectionCone, resolveDirectionViews } from './cameraGeometry';

export function cameraTileCones(
  feature: GeoJSON.Feature<GeoJSON.Point>,
): GeoJSON.Feature<GeoJSON.Polygon>[] {
  const properties = feature.properties ?? {};
  const [longitude, latitude] = feature.geometry.coordinates;
  const directionViews = resolveDirectionViews(
    properties.direction,
    properties.directions,
    properties.directionSpan,
    properties.directionSpans,
  );

  return directionViews.map(({ bearing, spreadDegrees }) =>
    createDirectionCone(longitude, latitude, bearing, undefined, spreadDegrees),
  );
}
