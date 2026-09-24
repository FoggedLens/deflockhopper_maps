import { describe, it, expect } from 'vitest';
import { isModeAvailable } from './cameraDataService';

describe('isModeAvailable', () => {
  it('leak is US only, like route and network', () => {
    expect(isModeAvailable('leak', 'us')).toBe(true);
    expect(isModeAvailable('leak', 'ca')).toBe(false);
    expect(isModeAvailable('route', 'ca')).toBe(false);
    expect(isModeAvailable('network', 'ca')).toBe(false);
  });

  it('map and explore work in Canada', () => {
    expect(isModeAvailable('map', 'ca')).toBe(true);
    expect(isModeAvailable('explore', 'ca')).toBe(true);
  });
});
