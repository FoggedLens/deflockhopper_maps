import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boundaryTileJsonUrl } from './boundaryTilesService';
import { _resetTilesHostForTests, failoverTilesHost } from '../store/tilesHostStore';

beforeEach(() => {
  _resetTilesHostForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('boundaryTileJsonUrl', () => {
  it('points at the boundaries TileJSON on the primary host', () => {
    expect(boundaryTileJsonUrl()).toBe('https://deflock.dontgetflocked.com/boundaries-us.json');
  });
  it('follows a failover to the backup host', () => {
    failoverTilesHost('test');
    expect(boundaryTileJsonUrl()).toBe('https://tiles.dontgetflocked.com/boundaries-us.json');
  });
});
