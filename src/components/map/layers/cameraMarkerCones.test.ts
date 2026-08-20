import { describe, expect, it } from 'vitest';
import type { ALPRCamera } from '../../../types';
import { createDirectionCone } from './cameraGeometry';
import { cameraMarkerCones } from './cameraMarkerCones';

const timestamp = '2024-05-20T12:34:56.000Z';
const expectedTimestamp = new Date(timestamp).getTime();

function camera(overrides: Partial<ALPRCamera>): ALPRCamera {
  return {
    osmId: 123,
    osmType: 'node',
    lat: 33.7,
    lon: -84.4,
    osmTimestamp: timestamp,
    ...overrides,
  };
}

describe('cameraMarkerCones', () => {
  it('creates a singular camera cone using its direction span and timestamp', () => {
    const source = camera({ direction: 90, directionSpan: 10 });

    const cones = cameraMarkerCones(source);

    expect(cones).toHaveLength(1);
    expect(cones[0].geometry.coordinates).toEqual(
      createDirectionCone(source.lon, source.lat, 90, undefined, 10).geometry.coordinates,
    );
    expect(cones[0].properties?.ts).toBe(expectedTimestamp);
  });

  it('creates native plural direction cones using aligned spans and fallback spreads', () => {
    const source = camera({
      direction: 90,
      directions: [90, 255, 0],
      directionSpans: [null, 10, null],
    });

    const cones = cameraMarkerCones(source);

    expect(cones).toHaveLength(3);
    expect(cones.map((cone) => cone.geometry.coordinates)).toEqual([
      createDirectionCone(source.lon, source.lat, 90, undefined, 50).geometry.coordinates,
      createDirectionCone(source.lon, source.lat, 255, undefined, 10).geometry.coordinates,
      createDirectionCone(source.lon, source.lat, 0, undefined, 50).geometry.coordinates,
    ]);
    expect(cones.map((cone) => cone.properties?.ts)).toEqual([
      expectedTimestamp,
      expectedTimestamp,
      expectedTimestamp,
    ]);
  });
});
