import { describe, it, expect, beforeEach } from 'vitest';
import { parseAppUrl, parseCountryParam, buildAppUrl } from './urlState';
import { useMapStore } from '../store/mapStore';
import { useAppModeStore } from '../store/appModeStore';
import { useCameraStore } from '../store/cameraStore';
import type { CameraFilters } from '../types';

describe('parseAppUrl — mode from path', () => {
  it.each([
    ['/', 'map'],
    ['/map', 'map'],
    ['/route', 'route'],
    ['/timeline', 'explore'],
    ['/explore', 'explore'],
    ['/analysis', 'map'],
    ['/leak', 'leak'],
    ['/flock-leak', 'leak'],
    ['/network', 'network'],
  ])('%s parses as %s', (path, mode) => {
    expect(parseAppUrl(path, '').mode).toBe(mode);
  });

  it('canonical path beats legacy ?mode=', () => {
    expect(parseAppUrl('/timeline', '?mode=route').mode).toBe('explore');
    expect(parseAppUrl('/network', '?mode=explore').mode).toBe('network');
  });

  it('legacy ?mode= applies on map paths', () => {
    expect(parseAppUrl('/', '?mode=route').mode).toBe('route');
    expect(parseAppUrl('/map', '?mode=density').mode).toBe('map');
    expect(parseAppUrl('/', '?mode=network').mode).toBe('network');
    expect(parseAppUrl('/', '?mode=explore').mode).toBe('explore');
    expect(parseAppUrl('/', '?mode=leak').mode).toBe('leak');
    expect(parseAppUrl('/', '?mode=bogus').mode).toBe('map');
  });

  it('keeps the viewport of an old /analysis link while landing on map', () => {
    const parsed = parseAppUrl('/analysis', '?lat=29.76&lng=-95.36&zoom=12');
    expect(parsed.mode).toBe('map');
    expect(parsed.viewport).toEqual({ lat: 29.76, lng: -95.36, zoom: 12 });
  });
});

describe('parseAppUrl — state filter', () => {
  it('parses /state/texas as map mode with TX filter', () => {
    const r = parseAppUrl('/state/texas', '');
    expect(r.mode).toBe('map');
    expect(r.stateFilter).toBe('TX');
  });

  it('accepts a trailing slash and postal slugs', () => {
    expect(parseAppUrl('/state/texas/', '').stateFilter).toBe('TX');
    expect(parseAppUrl('/state/tx', '').stateFilter).toBe('TX');
  });

  it('accepts legacy ?state= param', () => {
    expect(parseAppUrl('/', '?state=tx').stateFilter).toBe('TX');
  });

  it('returns null for unknown states', () => {
    expect(parseAppUrl('/state/atlantis', '').stateFilter).toBeNull();
    expect(parseAppUrl('/', '?state=zz').stateFilter).toBeNull();
  });
});

describe('parseAppUrl — viewport', () => {
  it('parses a full viewport', () => {
    expect(parseAppUrl('/', '?lat=33.7&lng=-84.4&zoom=10.55').viewport)
      .toEqual({ lat: 33.7, lng: -84.4, zoom: 10.55 });
  });

  it('defaults zoom to 4 and clamps to [1, 20]', () => {
    expect(parseAppUrl('/', '?lat=33.7&lng=-84.4').viewport?.zoom).toBe(4);
    expect(parseAppUrl('/', '?lat=33.7&lng=-84.4&zoom=99').viewport?.zoom).toBe(20);
    expect(parseAppUrl('/', '?lat=33.7&lng=-84.4&zoom=0.1').viewport?.zoom).toBe(1);
  });

  it('rejects missing or out-of-range coordinates', () => {
    expect(parseAppUrl('/', '?lat=33.7').viewport).toBeNull();
    expect(parseAppUrl('/', '?lat=91&lng=0').viewport).toBeNull();
    expect(parseAppUrl('/', '?lat=0&lng=181').viewport).toBeNull();
    expect(parseAppUrl('/', '').viewport).toBeNull();
  });
});

describe('parseAppUrl — country and viz', () => {
  it('parses country=ca and rejects everything else', () => {
    expect(parseAppUrl('/', '?country=ca').country).toBe('ca');
    expect(parseAppUrl('/', '?country=us').country).toBeNull();
    expect(parseAppUrl('/', '').country).toBeNull();
  });

  it('parses viz values and rejects unknowns', () => {
    expect(parseAppUrl('/timeline', '?viz=heatmap').viz).toBe('heatmap');
    expect(parseAppUrl('/timeline', '?viz=dots').viz).toBe('dots');
    expect(parseAppUrl('/timeline', '?viz=lava').viz).toBeNull();
  });
});

describe('parseCountryParam', () => {
  it('extracts ca from a raw search string', () => {
    expect(parseCountryParam('?country=ca')).toBe('ca');
    expect(parseCountryParam('?country=us')).toBeNull();
    expect(parseCountryParam('')).toBeNull();
  });
});

function filters(overrides: Partial<CameraFilters> = {}): CameraFilters {
  return {
    operators: [],
    brands: [],
    surveillanceZones: [],
    mountTypes: [],
    showAll: true,
    ...overrides,
  };
}

describe('buildAppUrl', () => {
  beforeEach(() => {
    useMapStore.setState({ center: [33.7, -84.4], zoom: 10.5 });
    useAppModeStore.setState({ appMode: 'map', mapVisualization: 'dots' });
    useCameraStore.setState({ country: 'us', filters: filters() });
  });

  it('map mode serializes to / with viewport only', () => {
    const { pathname, search } = buildAppUrl();
    expect(pathname).toBe('/');
    const params = new URLSearchParams(search);
    expect(params.get('lat')).toBe('33.7000');
    expect(params.get('lng')).toBe('-84.4000');
    expect(params.get('zoom')).toBe('10.50');
    expect(params.get('viz')).toBeNull();
    expect(params.get('country')).toBeNull();
    expect(params.get('mode')).toBeNull();
    expect(params.get('state')).toBeNull();
  });

  it('each mode serializes to its canonical path', () => {
    for (const [mode, path] of [
      ['route', '/route'],
      ['explore', '/timeline'],
      ['leak', '/leak'],
      ['network', '/network'],
    ] as const) {
      useAppModeStore.setState({ appMode: mode });
      expect(buildAppUrl().pathname).toBe(path);
    }
  });

  it('explore mode includes viz', () => {
    useAppModeStore.setState({ appMode: 'explore', mapVisualization: 'heatmap' });
    expect(new URLSearchParams(buildAppUrl().search).get('viz')).toBe('heatmap');
  });

  it('map mode with a state filter serializes to /state/<slug>', () => {
    useCameraStore.setState({ filters: filters({ state: 'TX', showAll: false }) });
    expect(buildAppUrl().pathname).toBe('/state/texas');
  });

  it('non-map modes do not encode the state filter', () => {
    useCameraStore.setState({ filters: filters({ state: 'TX', showAll: false }) });
    useAppModeStore.setState({ appMode: 'route' });
    const { pathname, search } = buildAppUrl();
    expect(pathname).toBe('/route');
    expect(new URLSearchParams(search).get('state')).toBeNull();
  });

  it('non-US country is encoded', () => {
    useCameraStore.setState({ country: 'ca' });
    expect(new URLSearchParams(buildAppUrl().search).get('country')).toBe('ca');
  });

  it('round-trips through parseAppUrl for every mode', () => {
    useCameraStore.setState({ country: 'ca', filters: filters({ state: 'TX', showAll: false }) });
    for (const mode of ['map', 'route', 'explore', 'leak', 'network'] as const) {
      useAppModeStore.setState({ appMode: mode });
      const { pathname, search } = buildAppUrl();
      const parsed = parseAppUrl(pathname, search);
      expect(parsed.mode).toBe(mode);
      expect(parsed.country).toBe('ca');
      expect(parsed.viewport).not.toBeNull();
      if (mode === 'map') expect(parsed.stateFilter).toBe('TX');
    }
  });
});
