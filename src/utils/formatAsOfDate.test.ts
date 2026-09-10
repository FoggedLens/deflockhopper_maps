import { describe, it, expect } from 'vitest';
import { formatAsOfDate } from './formatting';

describe('formatAsOfDate', () => {
  it('renders an ISO timestamp as a short UTC calendar date', () => {
    expect(formatAsOfDate('2026-09-10T18:40:19Z')).toBe('Sep 10, 2026');
  });

  it('does not shift the date across the local timezone boundary', () => {
    expect(formatAsOfDate('2026-09-10T00:30:00Z')).toBe('Sep 10, 2026');
    expect(formatAsOfDate('2026-09-10T23:30:00Z')).toBe('Sep 10, 2026');
  });

  it('returns null for an unparseable timestamp', () => {
    expect(formatAsOfDate('soon')).toBeNull();
    expect(formatAsOfDate('')).toBeNull();
  });
});
