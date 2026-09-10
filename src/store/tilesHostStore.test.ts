import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTilesHostStore,
  TILES_HOSTS,
  getTilesHost,
  failoverTilesHost,
  _resetTilesHostForTests,
} from './tilesHostStore';

beforeEach(() => {
  _resetTilesHostForTests();
});

describe('tilesHostStore', () => {
  it('starts on the primary host with epoch 0', () => {
    const s = useTilesHostStore.getState();
    expect(s.hostId).toBe('primary');
    expect(s.host).toBe(TILES_HOSTS.primary);
    expect(s.epoch).toBe(0);
    expect(getTilesHost()).toBe('https://deflock.dontgetflocked.com');
  });

  it('failover switches to the backup host and bumps the epoch', () => {
    expect(failoverTilesHost('test')).toBe(true);
    const s = useTilesHostStore.getState();
    expect(s.hostId).toBe('backup');
    expect(s.host).toBe('https://tiles.dontgetflocked.com');
    expect(s.epoch).toBe(1);
    expect(getTilesHost()).toBe(TILES_HOSTS.backup);
  });

  it('a second failover is a no-op that reports false', () => {
    failoverTilesHost('first');
    expect(failoverTilesHost('second')).toBe(false);
    expect(useTilesHostStore.getState().epoch).toBe(1);
    expect(useTilesHostStore.getState().hostId).toBe('backup');
  });

  it('reset returns to primary (fresh page load semantics)', () => {
    failoverTilesHost('x');
    _resetTilesHostForTests();
    expect(useTilesHostStore.getState().hostId).toBe('primary');
    expect(useTilesHostStore.getState().epoch).toBe(0);
  });
});
