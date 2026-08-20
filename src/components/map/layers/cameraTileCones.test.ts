import { describe, expect, it } from 'vitest';
import { createDirectionCone } from './cameraGeometry';
import { cameraTileCones } from './cameraTileCones';

const coordinates = [-73.9857, 40.7484] as [number, number];

function tileFeature(
  properties: GeoJSON.GeoJsonProperties,
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates,
    },
  };
}

describe('cameraTileCones', () => {
  it('creates a cone using singular tile direction and directionSpan properties', () => {
    const cones = cameraTileCones(
      tileFeature({ direction: 90, directionSpan: 10 }),
    );

    expect(cones.map((cone) => cone.geometry.coordinates)).toEqual([
      createDirectionCone(coordinates[0], coordinates[1], 90, undefined, 10)
        .geometry.coordinates,
    ]);
  });

  it('creates aligned cones from PMTiles JSON-stringified directions and spans', () => {
    const cones = cameraTileCones(
      tileFeature({
        directions: '[90,255,0]',
        directionSpans: '[null,10,null]',
      }),
    );

    expect(cones.map((cone) => cone.geometry.coordinates)).toEqual(
      [
        createDirectionCone(coordinates[0], coordinates[1], 90, undefined, 50),
        createDirectionCone(coordinates[0], coordinates[1], 255, undefined, 10),
        createDirectionCone(coordinates[0], coordinates[1], 0, undefined, 50),
      ].map((cone) => cone.geometry.coordinates),
    );
  });
});
