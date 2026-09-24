import { describe, it, expect } from 'vitest';
import { formatFlockHeaderCount } from './flockHeaderCount';

describe('formatFlockHeaderCount', () => {
  it('shows the snapshot total below z9 in Flock view', () => {
    expect(formatFlockHeaderCount({ zoom: 4, view: 'flock', flockCount: null, osmCount: null }))
      .toBe('335,701 Flock devices');
  });

  it('shows the snapshot total below z9 in Overlay', () => {
    expect(formatFlockHeaderCount({ zoom: 4, view: 'overlay', flockCount: null, osmCount: 900 }))
      .toBe('900 OSM · 335,701 Flock');
  });

  it('shows the in-view Flock count in Flock view from z9', () => {
    expect(formatFlockHeaderCount({ zoom: 12, view: 'flock', flockCount: 38, osmCount: 31 }))
      .toBe('38 Flock in view');
  });

  it('shows both counts in Overlay from z9', () => {
    expect(formatFlockHeaderCount({ zoom: 12, view: 'overlay', flockCount: 1200, osmCount: 900 }))
      .toBe('900 OSM · 1,200 Flock in view');
  });

  it('uses an ellipsis while a count is unknown from z9', () => {
    expect(formatFlockHeaderCount({ zoom: 12, view: 'flock', flockCount: null, osmCount: null }))
      .toBe('… Flock in view');
    expect(formatFlockHeaderCount({ zoom: 12, view: 'overlay', flockCount: 5, osmCount: null }))
      .toBe('… OSM · 5 Flock in view');
  });

  it('treats z9 itself as in-view, not the snapshot total', () => {
    expect(formatFlockHeaderCount({ zoom: 9, view: 'flock', flockCount: 4, osmCount: 2 }))
      .toBe('4 Flock in view');
  });
});
