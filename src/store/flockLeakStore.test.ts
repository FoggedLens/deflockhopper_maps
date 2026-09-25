import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFlockLeakStore, activeFlockFilterCount, _resetFlockLeakStoreForTests } from './flockLeakStore';

vi.mock('../services/flockLeakTilesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/flockLeakTilesService')>();
  return { ...actual, loadFlockLeakTileJson: vi.fn() };
});
import { loadFlockLeakTileJson } from '../services/flockLeakTilesService';
const loadMock = vi.mocked(loadFlockLeakTileJson);

beforeEach(() => {
  _resetFlockLeakStoreForTests();
  loadMock.mockReset();
});

describe('defaults', () => {
  it('lands on the Flock view with every group and every status', () => {
    const s = useFlockLeakStore.getState();
    expect(s.view).toBe('flock');
    expect(s.groups).toEqual([]);
    expect(s.statuses).toEqual([1, 2, 3]);
    expect(s.loadPhase).toBe('idle');
  });
});

describe('filters', () => {
  it('toggles groups and clears back to all', () => {
    const s = useFlockLeakStore.getState();
    s.toggleGroup(2);
    s.toggleGroup(1);
    expect(useFlockLeakStore.getState().groups).toEqual([2, 1]);
    s.toggleGroup(2);
    expect(useFlockLeakStore.getState().groups).toEqual([1]);
    s.clearGroups();
    expect(useFlockLeakStore.getState().groups).toEqual([]);
  });

  it('toggles a multi-group class as one: on only when all its groups are', () => {
    const s = useFlockLeakStore.getState();
    s.toggleGroup(7);
    s.toggleGroups([6, 7]);
    expect(useFlockLeakStore.getState().groups).toEqual([7, 6]);
    s.toggleGroups([6, 7]);
    expect(useFlockLeakStore.getState().groups).toEqual([]);
  });

  it('toggles statuses', () => {
    useFlockLeakStore.getState().toggleStatus(2);
    expect(useFlockLeakStore.getState().statuses).toEqual([1, 3]);
    useFlockLeakStore.getState().toggleStatus(1);
    expect(useFlockLeakStore.getState().statuses).toEqual([3]);
  });

  it('counts a group selection and a narrowed status set as one filter each; the default as none', () => {
    expect(activeFlockFilterCount({ groups: [], statuses: [1, 2, 3] })).toBe(0);
    expect(activeFlockFilterCount({ groups: [], statuses: [1] })).toBe(1);
    expect(activeFlockFilterCount({ groups: [1], statuses: [1, 2, 3] })).toBe(1);
    expect(activeFlockFilterCount({ groups: [1], statuses: [1] })).toBe(2);
  });
});

describe('ensureTileJsonLoaded', () => {
  it('stores the document and goes ready', async () => {
    loadMock.mockResolvedValue({ tiles: ['x'], name: 'v2' });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    const s = useFlockLeakStore.getState();
    expect(s.loadPhase).toBe('ready');
    expect(s.tileJson?.name).toBe('v2');
  });

  it('loads once', async () => {
    loadMock.mockResolvedValue({ tiles: ['x'] });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it('records an error and retry reloads with a new source epoch', async () => {
    loadMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ tiles: ['x'] });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    expect(useFlockLeakStore.getState().loadPhase).toBe('error');
    useFlockLeakStore.getState().setTilesFailed(true);
    useFlockLeakStore.getState().retry();
    await vi.waitFor(() => expect(useFlockLeakStore.getState().loadPhase).toBe('ready'));
    expect(useFlockLeakStore.getState().tilesFailed).toBe(false);
    expect(useFlockLeakStore.getState().sourceEpoch).toBe(1);
  });
});
