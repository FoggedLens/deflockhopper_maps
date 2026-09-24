import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flockIconId, ensureFlockIcons, FLOCK_GROUP_COLOR, FLOCK_GROUP_SHAPE, FLOCK_ICON_IDS } from './flockLeakIcons';
import { FLOCK_GROUPS } from '../../../lib/flockInventory';

describe('flockIconId', () => {
  it('names solid and planned variants per group', () => {
    expect(flockIconId(1, false)).toBe('flock-g1');
    expect(flockIconId(5, true)).toBe('flock-g5-planned');
  });

  it('lists every group in both variants with a color and a shape', () => {
    expect(FLOCK_ICON_IDS).toHaveLength(FLOCK_GROUPS.length * 2);
    for (const g of FLOCK_GROUPS) {
      expect(FLOCK_GROUP_COLOR[g]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(FLOCK_GROUP_SHAPE[g]).toBeTruthy();
    }
  });
});

describe('ensureFlockIcons', () => {
  const ctx = {
    clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    arc: () => {}, rect: () => {}, roundRect: () => {}, fill: () => {}, stroke: () => {}, setLineDash: () => {}, save: () => {}, restore: () => {},
    getImageData: () => ({ width: 44, height: 44, data: new Uint8ClampedArray(44 * 44 * 4) }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter',
  };

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds every missing icon once and skips existing ones', () => {
    const added: string[] = [];
    const map = { hasImage: (id: string) => id === 'flock-g1', addImage: (id: string) => { added.push(id); } };
    ensureFlockIcons(map as never);
    expect(added).not.toContain('flock-g1');
    expect(added).toContain('flock-g1-planned');
    expect(added).toHaveLength(FLOCK_ICON_IDS.length - 1);
  });

  it('registers images at pixel ratio 2', () => {
    const opts: unknown[] = [];
    const map = { hasImage: () => false, addImage: (_id: string, _img: unknown, o: unknown) => { opts.push(o); } };
    ensureFlockIcons(map as never);
    expect(opts.every((o) => (o as { pixelRatio: number }).pixelRatio === 2)).toBe(true);
  });
});
