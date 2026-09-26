import { describe, it, expect } from 'vitest';
import { shouldCollapseSearch } from './searchPill';

describe('shouldCollapseSearch', () => {
  it('always folds on picking a place, the close button and Escape', () => {
    expect(shouldCollapseSearch('picked', 'austin', true)).toBe(true);
    expect(shouldCollapseSearch('close', 'austin', false)).toBe(true);
    expect(shouldCollapseSearch('escape', 'austin', true)).toBe(true);
  });

  it('folds on blur only when nothing is typed and no results show', () => {
    expect(shouldCollapseSearch('blur', '', false)).toBe(true);
    expect(shouldCollapseSearch('blur', '   ', false)).toBe(true);
    expect(shouldCollapseSearch('blur', 'austin', false)).toBe(false);
    // Tapping a result blurs the input before the click lands; the list must survive.
    expect(shouldCollapseSearch('blur', '', true)).toBe(false);
  });
});
