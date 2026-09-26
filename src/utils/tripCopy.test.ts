import { describe, it, expect } from 'vitest';
import { tripHint, tripFootnote, tripStopDetail } from './tripCopy';

describe('tripHint', () => {
  it('asks to zoom in first, whatever the count', () => {
    expect(tripHint(0, false)).toBe('Zoom in to tap devices.');
    expect(tripHint(4, false)).toBe('Zoom in to tap devices.');
  });
  it('covers empty, some and full', () => {
    expect(tripHint(0, true)).toBe('Tap devices to add stops.');
    expect(tripHint(4, true)).toBe('Tap devices to add or remove stops.');
    expect(tripHint(10, true)).toBe('Trip is full. Remove a stop to add another.');
  });
});

describe('tripFootnote', () => {
  it('says where the order starts', () => {
    expect(tripFootnote(true)).toBe('Starts from your location, in the shortest order. Opening the trip sends these stops to Google.');
    expect(tripFootnote(false)).toBe('Starts at stop 1, in the shortest order. Opening the trip sends these stops to Google.');
  });
});

describe('tripStopDetail', () => {
  it('shows the type, and the count for a stack', () => {
    expect(tripStopDetail({ type: 'Falcon', deviceCount: 1 })).toBe('Falcon');
    expect(tripStopDetail({ type: 'Falcon', deviceCount: 3 })).toBe('Falcon · 3 devices here');
  });
  it('names the type the way the device card does', () => {
    // The tiles carry raw lowercase types; the card shows flockTypeLabel's name.
    expect(tripStopDetail({ type: 'falcon', deviceCount: 1 })).toBe('Falcon');
    expect(tripStopDetail({ type: '', deviceCount: 1 })).toBe('Unknown type');
  });
});
