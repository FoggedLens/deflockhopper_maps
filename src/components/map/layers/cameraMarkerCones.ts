import type { ALPRCamera } from '../../../types';
import { createDirectionCone, resolveDirectionViews } from './cameraGeometry';

export function cameraMarkerCones(
  camera: ALPRCamera,
): GeoJSON.Feature<GeoJSON.Polygon>[] {
  const timestampMs = camera.osmTimestamp
    ? new Date(camera.osmTimestamp).getTime()
    : 0;
  const directionViews = resolveDirectionViews(
    camera.direction,
    camera.directions,
    camera.directionSpan,
    camera.directionSpans,
  );

  return directionViews.map(({ bearing, spreadDegrees }) => {
    const cone = createDirectionCone(
      camera.lon,
      camera.lat,
      bearing,
      undefined,
      spreadDegrees,
    );
    cone.properties = { ...cone.properties, ts: timestampMs };
    return cone;
  });
}
