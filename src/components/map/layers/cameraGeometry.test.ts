import { describe, expect, it } from 'vitest';
import { createDirectionCone, resolveDirectionViews } from './cameraGeometry';

describe('resolveDirectionViews', () => {
  it('uses an explicit span for a singular direction', () => {
    expect(resolveDirectionViews(261.5, undefined, 45, undefined)).toEqual([
      { bearing: 261.5, spreadDegrees: 45 },
    ]);
  });

  it.each([
    { direction: 90, span: 0, expectedSpread: 50 },
    { direction: 180, span: 360, expectedSpread: 360 },
  ])(
    'resolves singular span boundary $span to spread $expectedSpread',
    ({ direction, span, expectedSpread }) => {
      expect(resolveDirectionViews(direction, undefined, span, undefined)).toEqual([
        { bearing: direction, spreadDegrees: expectedSpread },
      ]);
    },
  );

  it('drops non-finite singular bearings before polygon generation', () => {
    expect(resolveDirectionViews(NaN, undefined, 45, undefined)).toEqual([]);
    expect(resolveDirectionViews(Infinity, undefined, 45, undefined)).toEqual([]);
    expect(resolveDirectionViews(-Infinity, undefined, 45, undefined)).toEqual([]);
  });

  it('aligns plural direction spans with their directions', () => {
    expect(
      resolveDirectionViews(90, [90, 255, 0], undefined, [null, 10, null]),
    ).toEqual([
      { bearing: 90, spreadDegrees: 50 },
      { bearing: 255, spreadDegrees: 10 },
      { bearing: 0, spreadDegrees: 50 },
    ]);
  });

  it('decodes JSON-stringified aligned plural directions and spans', () => {
    expect(
      resolveDirectionViews(90, '[90,255,0]', undefined, '[null,10,null]'),
    ).toEqual([
      { bearing: 90, spreadDegrees: 50 },
      { bearing: 255, spreadDegrees: 10 },
      { bearing: 0, spreadDegrees: 50 },
    ]);
  });

  it('drops invalid native plural bearings without shifting aligned spans', () => {
    expect(
      resolveDirectionViews(0, [90, null, 'bad', Infinity, 255], undefined, [10, 20, 30, 40, 50]),
    ).toEqual([
      { bearing: 90, spreadDegrees: 10 },
      { bearing: 255, spreadDegrees: 50 },
    ]);
  });

  it('drops invalid JSON plural bearings without shifting aligned spans', () => {
    expect(
      resolveDirectionViews(0, '[90,null,"bad",255]', undefined, '[10,20,30,50]'),
    ).toEqual([
      { bearing: 90, spreadDegrees: 10 },
      { bearing: 255, spreadDegrees: 50 },
    ]);
  });

  it('falls back per index when an aligned plural span is invalid', () => {
    const views = resolveDirectionViews(
      0,
      [0, 45, 90, 135, 180, 225, 270, 315],
      undefined,
      [null, 0, -1, NaN, Infinity, 361, '10', 10],
    );

    expect(views.map(({ spreadDegrees }) => spreadDegrees)).toEqual([
      50, 50, 50, 50, 50, 50, 50, 10,
    ]);
  });

  it('supports short plural spans and falls back from malformed plural JSON', () => {
    expect(resolveDirectionViews(90, [90, 255, 0], 50, [10])).toEqual([
      { bearing: 90, spreadDegrees: 10 },
      { bearing: 255, spreadDegrees: 50 },
      { bearing: 0, spreadDegrees: 50 },
    ]);

    expect(resolveDirectionViews(90, '[90,255,0', 50, '[10')).toEqual([
      { bearing: 90, spreadDegrees: 50 },
    ]);
  });
});

describe('createDirectionCone', () => {
  it('creates a closed finite full-circle polygon spanning all four quadrants', () => {
    const cone = createDirectionCone(0, 0, 180, 100, 360);
    const coordinates = cone.geometry.coordinates[0];
    const radialArcSamples = coordinates.slice(1, -1);

    expect(coordinates.every((point) => point.every(Number.isFinite))).toBe(true);
    expect(coordinates[coordinates.length - 1]).toEqual(coordinates[0]);
    expect([
      radialArcSamples.some(([x, y]) => x > 0 && y > 0),
      radialArcSamples.some(([x, y]) => x < 0 && y > 0),
      radialArcSamples.some(([x, y]) => x < 0 && y < 0),
      radialArcSamples.some(([x, y]) => x > 0 && y < 0),
    ]).toEqual([true, true, true, true]);
  });
});
