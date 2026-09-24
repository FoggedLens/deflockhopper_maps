import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFlockLeakStore, _resetFlockLeakStoreForTests } from './flockLeakStore';
import { useCameraStore } from './cameraStore';
import type { CameraFilters } from '../types';

vi.mock('../services/flockLeakTilesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/flockLeakTilesService')>();
  return { ...actual, loadFlockLeakTileJson: vi.fn() };
});

const clean: CameraFilters = {
  operators: [],
  brands: [],
  surveillanceZones: [],
  mountTypes: [],
  state: undefined,
  showAll: true,
  timelineDate: undefined,
};
const osm = () => useCameraStore.getState().filters;
const leak = () => useFlockLeakStore.getState();

beforeEach(() => {
  _resetFlockLeakStoreForTests();
  useCameraStore.setState({ cameras: [], filteredCameras: [], filters: { ...clean } });
});

describe('entering a compare view', () => {
  it('narrows Flock to plate readers and OSM to brand Flock Safety', () => {
    leak().beginVisit();
    leak().setView('swipe');
    expect(leak().groups).toEqual([1]);
    expect(osm().brands).toEqual(['Flock Safety']);
    expect(osm().showAll).toBe(false);
  });

  it('keeps the OSM facets the user arrived with', () => {
    useCameraStore.setState({ filters: { ...clean, state: 'TX', showAll: false } });
    leak().beginVisit();
    leak().setView('overlay');
    expect(osm().state).toBe('TX');
    expect(osm().brands).toEqual(['Flock Safety']);
  });

  it('seeds once per visit, so edits survive a trip back to Flock', () => {
    leak().beginVisit();
    leak().setView('overlay');
    leak().toggleGroup(2);
    useCameraStore.setState({ filters: { ...clean } });
    leak().setView('flock');
    leak().setView('swipe');
    expect(leak().groups).toEqual([1, 2]);
    expect(osm().brands).toEqual([]);
  });

  it('does not touch filters when moving between Swipe and Overlay', () => {
    leak().beginVisit();
    leak().setView('swipe');
    leak().clearGroups();
    leak().setView('overlay');
    expect(leak().groups).toEqual([]);
    expect(osm().brands).toEqual(['Flock Safety']);
  });

  it('leaves the landing view showing every device', () => {
    leak().beginVisit();
    expect(leak().groups).toEqual([]);
    expect(osm().brands).toEqual([]);
  });
});

describe('leaving the tab', () => {
  it('restores the OSM filters from tab entry', () => {
    useCameraStore.setState({ filters: { ...clean, brands: ['Genetec'], showAll: false } });
    leak().beginVisit();
    leak().setView('overlay');
    expect(osm().brands).toEqual(['Flock Safety']);
    leak().endVisit();
    expect(osm().brands).toEqual(['Genetec']);
    expect(osm().showAll).toBe(false);
  });

  it('restores the Flock filters from tab entry and lands the next visit on Flock', () => {
    leak().beginVisit();
    leak().setView('swipe');
    leak().toggleStatus(2);
    leak().setShowSuspect(true);
    leak().endVisit();
    expect(leak().view).toBe('flock');
    expect(leak().groups).toEqual([]);
    expect(leak().statuses).toEqual([1]);
    expect(leak().showSuspect).toBe(false);
  });

  it('seeds again on the next visit', () => {
    leak().beginVisit();
    leak().setView('swipe');
    leak().endVisit();
    expect(osm().brands).toEqual([]);
    leak().beginVisit();
    leak().setView('overlay');
    expect(osm().brands).toEqual(['Flock Safety']);
    expect(leak().groups).toEqual([1]);
  });

  it('is harmless without a visit in progress', () => {
    useCameraStore.setState({ filters: { ...clean, brands: ['Genetec'], showAll: false } });
    leak().endVisit();
    expect(osm().brands).toEqual(['Genetec']);
  });
});
