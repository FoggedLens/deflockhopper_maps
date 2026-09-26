import { describe, it, expect } from 'vitest';
import { googleMapsTripUrl } from './googleMapsTripUrl';

const at = (lat: number, lon: number) => ({ lat, lon });

describe('googleMapsTripUrl', () => {
  it('is null with no stops', () => {
    expect(googleMapsTripUrl([])).toBeNull();
  });

  it('sends one stop as the destination with no waypoints', () => {
    expect(googleMapsTripUrl([at(29.7604, -95.3698)])).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=29.760400%2C-95.369800'
    );
  });

  it('keeps the given order: the rest are waypoints, the last is the destination', () => {
    const url = new URL(googleMapsTripUrl([at(1, 2), at(3, 4), at(5, 6)])!);
    expect(url.searchParams.get('waypoints')).toBe('1.000000,2.000000|3.000000,4.000000');
    expect(url.searchParams.get('destination')).toBe('5.000000,6.000000');
  });

  it('never carries an origin or starts navigation on its own', () => {
    const url = new URL(googleMapsTripUrl([at(1, 2), at(3, 4)])!);
    expect(url.searchParams.has('origin')).toBe(false);
    expect(url.searchParams.has('dir_action')).toBe(false);
  });

  it('fits Google’s 2,048 character limit at 10 stops', () => {
    const stops = Array.from({ length: 10 }, (_, i) => at(-89.123456 + i, -179.123456 + i));
    const url = googleMapsTripUrl(stops)!;
    expect(url.length).toBeLessThan(2048);
    expect(new URL(url).searchParams.get('waypoints')!.split('|')).toHaveLength(9);
  });
});
