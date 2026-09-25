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

describe('turning on the OSM comparison', () => {
  it('narrows Flock to plate readers (every status) and OSM to brand Flock Safety', () => {
    leak().beginVisit();
    leak().toggleStatus(3);
    leak().setView('overlay');
    expect(leak().groups).toEqual([1]);
    expect(leak().statuses).toEqual([1, 2, 3]);
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

  it('seeds once per visit, so edits made while comparing survive a trip back to Flock', () => {
    leak().beginVisit();
    leak().setView('overlay');
    leak().toggleGroup(2);
    leak().toggleStatus(3);
    useCameraStore.setState({ filters: { ...clean } });
    leak().setView('flock');
    leak().setView('overlay');
    expect(leak().groups).toEqual([1, 2]);
    expect(leak().statuses).toEqual([1, 2]);
    expect(osm().brands).toEqual([]);
  });

  it('does not reseed when the view is set to the one it already has', () => {
    leak().beginVisit();
    leak().setView('overlay');
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

describe('each view keeps its own filters', () => {
  it('going back to Flock restores what both sides had before comparing', () => {
    useCameraStore.setState({ filters: { ...clean, brands: ['Genetec'], showAll: false } });
    leak().beginVisit();
    leak().toggleStatus(3);
    leak().setView('overlay');
    expect(leak().groups).toEqual([1]);
    expect(leak().statuses).toEqual([1, 2, 3]);
    expect(osm().brands).toEqual(['Flock Safety']);
    leak().setView('flock');
    expect(leak().groups).toEqual([]);
    expect(leak().statuses).toEqual([1, 2]);
    expect(osm().brands).toEqual(['Genetec']);
    expect(osm().showAll).toBe(false);
  });

  it('an edit made in Flock survives a trip through the comparison', () => {
    leak().beginVisit();
    leak().toggleGroup(4);
    leak().setView('overlay');
    expect(leak().groups).toEqual([1]);
    leak().setView('flock');
    expect(leak().groups).toEqual([4]);
  });

  it('the comparison keeps its own set after the seed; Flock keeps its own', () => {
    leak().beginVisit();
    leak().setView('overlay');
    leak().clearGroups();
    leak().setView('flock');
    leak().toggleGroup(5);
    leak().setView('overlay');
    expect(leak().groups).toEqual([]);
    leak().setView('flock');
    expect(leak().groups).toEqual([5]);
  });

  it('a parked set never leaks into the next visit', () => {
    leak().beginVisit();
    leak().setView('overlay');
    leak().toggleGroup(2);
    leak().setView('flock');
    leak().endVisit();
    leak().beginVisit();
    leak().setView('overlay');
    expect(leak().groups).toEqual([1]);
    leak().setView('flock');
    expect(leak().groups).toEqual([]);
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
    leak().setView('overlay');
    leak().toggleStatus(2);
    leak().endVisit();
    expect(leak().view).toBe('flock');
    expect(leak().groups).toEqual([]);
    expect(leak().statuses).toEqual([1, 2, 3]);
  });

  it('drops the tapped device, so the next visit does not open on it', () => {
    leak().beginVisit();
    leak().setSelection({ lon: -95.37, lat: 29.76, zoom: 15, g: 1, s: 1, q: 0, devices: [], nearestOsmMeters: null });
    leak().endVisit();
    expect(leak().selection).toBeNull();
  });

  it('seeds again on the next visit', () => {
    leak().beginVisit();
    leak().setView('overlay');
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
