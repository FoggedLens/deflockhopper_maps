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
  it('lands on the Flock view, divider centered, active only', () => {
    const s = useFlockLeakStore.getState();
    expect(s.view).toBe('flock');
    expect(s.divider).toBe(0.5);
    expect(s.types).toEqual([]);
    expect(s.statuses).toEqual(['active']);
    expect(s.loadPhase).toBe('idle');
  });
});

describe('setDivider', () => {
  it('clamps and is equality-gated (no new state object for the same value)', () => {
    const { setDivider } = useFlockLeakStore.getState();
    setDivider(0.25);
    const before = useFlockLeakStore.getState();
    setDivider(0.25);
    expect(useFlockLeakStore.getState()).toBe(before);
    setDivider(7);
    expect(useFlockLeakStore.getState().divider).toBe(1);
  });
});

describe('filters', () => {
  it('toggles types and clears back to all', () => {
    const s = useFlockLeakStore.getState();
    s.toggleType('condor');
    s.toggleType('alpr');
    expect(useFlockLeakStore.getState().types).toEqual(['condor', 'alpr']);
    s.toggleType('condor');
    expect(useFlockLeakStore.getState().types).toEqual(['alpr']);
    s.clearTypes();
    expect(useFlockLeakStore.getState().types).toEqual([]);
  });

  it('toggles statuses', () => {
    useFlockLeakStore.getState().toggleStatus('planned');
    expect(useFlockLeakStore.getState().statuses).toEqual(['active', 'planned']);
    useFlockLeakStore.getState().toggleStatus('active');
    expect(useFlockLeakStore.getState().statuses).toEqual(['planned']);
  });

  it('counts the Active-only default as one filter, all statuses as none', () => {
    expect(activeFlockFilterCount({ types: [], statuses: ['active'] })).toBe(1);
    expect(activeFlockFilterCount({ types: [], statuses: ['active', 'planned', 'decommissioned'] })).toBe(0);
    expect(activeFlockFilterCount({ types: ['alpr'], statuses: ['active', 'planned', 'decommissioned'] })).toBe(1);
    expect(activeFlockFilterCount({ types: ['alpr'], statuses: ['active'] })).toBe(2);
  });
});

describe('ensureTileJsonLoaded', () => {
  it('stores the document and goes ready', async () => {
    loadMock.mockResolvedValue({ tiles: ['x'], stats: { total: 5 } });
    await useFlockLeakStore.getState().ensureTileJsonLoaded();
    const s = useFlockLeakStore.getState();
    expect(s.loadPhase).toBe('ready');
    expect(s.tileJson?.stats?.total).toBe(5);
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
