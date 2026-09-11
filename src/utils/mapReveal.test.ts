import { describe, it, expect } from 'vitest';
import { isMapRevealReady } from './mapReveal';

describe('isMapRevealReady', () => {
  it('is false while neither the basemap nor the camera source has loaded', () => {
    expect(isMapRevealReady({ cameraSourceReady: false, mapLoaded: false, tilesFailed: false })).toBe(false);
  });

  it('holds the reveal when cameras are in but the basemap is still loading', () => {
    expect(isMapRevealReady({ cameraSourceReady: true, mapLoaded: false, tilesFailed: false })).toBe(false);
  });

  it('holds the reveal when the basemap is in but cameras are still loading', () => {
    expect(isMapRevealReady({ cameraSourceReady: false, mapLoaded: true, tilesFailed: false })).toBe(false);
  });

  it('reveals once both the basemap and the camera source have loaded', () => {
    expect(isMapRevealReady({ cameraSourceReady: true, mapLoaded: true, tilesFailed: false })).toBe(true);
  });

  it('reveals the basemap alone once the camera tiles have given up (retry pill carries the failure)', () => {
    expect(isMapRevealReady({ cameraSourceReady: false, mapLoaded: true, tilesFailed: true })).toBe(true);
  });

  it('never reveals a black map: a camera failure before the basemap loads still waits', () => {
    expect(isMapRevealReady({ cameraSourceReady: false, mapLoaded: false, tilesFailed: true })).toBe(false);
  });
});
