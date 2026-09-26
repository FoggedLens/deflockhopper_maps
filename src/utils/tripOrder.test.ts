import { describe, it, expect } from 'vitest';
import { orderStops, TRIP_ORDER_MAX, type LatLon } from './tripOrder';
import { haversineDistance } from './geo';

const onEquator = (lon: number): LatLon => ({ lat: 0, lon });

function pathLength(origin: LatLon | null, stops: LatLon[], order: number[]): number {
  let total = 0;
  let prev = origin;
  for (const i of order) {
    if (prev) total += haversineDistance(prev.lat, prev.lon, stops[i].lat, stops[i].lon);
    prev = stops[i];
  }
  return total;
}

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) {
    for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  }
  return out;
}

/** Deterministic pseudo-random points around Houston. */
function points(n: number, seed: number): LatLon[] {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () => ({ lat: 29.6 + rand() * 0.3, lon: -95.5 + rand() * 0.3 }));
}

describe('orderStops', () => {
  it('handles no stops and one stop', () => {
    expect(orderStops(null, [])).toEqual([]);
    expect(orderStops(onEquator(0), [onEquator(1)])).toEqual([0]);
  });

  it('starts from the origin', () => {
    const stops = [onEquator(3), onEquator(1), onEquator(2)];
    expect(orderStops(onEquator(0), stops)).toEqual([1, 2, 0]);
  });

  it('beats nearest-neighbour when that is not shortest', () => {
    // From 0, nearest-first goes 1, -1.5, 5 (10 degrees). Shortest is -1.5, 1, 5 (8).
    const stops = [onEquator(1), onEquator(-1.5), onEquator(5)];
    expect(orderStops(onEquator(0), stops)).toEqual([1, 0, 2]);
  });

  it('without an origin, walks the shortest path from its lower-indexed end', () => {
    const stops = [onEquator(3), onEquator(1), onEquator(2)];
    expect(orderStops(null, stops)).toEqual([0, 2, 1]);
  });

  it('matches brute force on 7 scattered stops, with and without an origin', () => {
    const stops = points(7, 42);
    const origin = { lat: 29.75, lon: -95.37 };
    for (const o of [origin, null]) {
      const best = Math.min(...permutations(7).map((p) => pathLength(o, stops, p)));
      expect(pathLength(o, stops, orderStops(o, stops))).toBeCloseTo(best, 3);
    }
  });

  it('orders 10 stops quickly and returns every index once', () => {
    const stops = points(TRIP_ORDER_MAX, 7);
    const t0 = performance.now();
    const order = orderStops({ lat: 29.75, lon: -95.37 }, stops);
    expect(performance.now() - t0).toBeLessThan(50);
    expect([...order].sort((a, b) => a - b)).toEqual([...Array(TRIP_ORDER_MAX).keys()]);
  });

  it('is deterministic', () => {
    const stops = points(9, 3);
    expect(orderStops(null, stops)).toEqual(orderStops(null, stops));
  });

  it('refuses more than the cap', () => {
    expect(() => orderStops(null, points(TRIP_ORDER_MAX + 1, 1))).toThrow(RangeError);
  });
});
