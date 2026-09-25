import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flockIconId, flockHollowIconId, drawFlockIcon, drawPlannedRing, ensureFlockIcons, FLOCK_GROUP_COLOR, FLOCK_GROUP_SHAPE, FLOCK_ICON_IDS } from './flockLeakIcons';
import { FLOCK_GROUPS } from '../../../lib/flockInventory';

describe('flockIconId', () => {
  it('names solid and planned variants per group', () => {
    expect(flockIconId(1, false)).toBe('flock-g1');
    expect(flockIconId(5, true)).toBe('flock-g5-planned');
  });

  it('lists every group solid, planned and hollow, plus the planned ring, with a color and a shape per group', () => {
    expect(FLOCK_ICON_IDS).toHaveLength(FLOCK_GROUPS.length * 5 + 3);
    for (const g of FLOCK_GROUPS) {
      expect(FLOCK_ICON_IDS).toContain(flockIconId(g, false));
      expect(FLOCK_ICON_IDS).toContain(flockIconId(g, true));
      expect(FLOCK_ICON_IDS).toContain(flockHollowIconId(g));
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

describe('planned ring icon for the compare views', () => {
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

  it('is listed with the group icons and registered by ensureFlockIcons', () => {
    expect(FLOCK_ICON_IDS).toContain('flock-planned-ring');
    const added: string[] = [];
    const map = { hasImage: () => false, addImage: (id: string) => { added.push(id); } };
    ensureFlockIcons(map as never);
    expect(added).toContain('flock-planned-ring');
    expect(added).toContain('flock-planned-lens-dark');
    expect(added).toContain('flock-planned-lens-light');
  });

  it('fills the core only for the planned lens', () => {
    const fills: string[] = [];
    const spy = { ...ctx, fill: () => { fills.push(spy.fillStyle); } } as unknown as CanvasRenderingContext2D & { fillStyle: string };
    drawPlannedRing(spy, 44);
    expect(fills).toEqual([]);
    drawPlannedRing(spy, 44, '#15151c');
    expect(fills).toEqual(['#15151c']);
  });
});

describe('hollow icons for the Overlay compare', () => {
  const spyCtx = () => {
    const calls: string[] = [];
    const rec = (name: string) => () => { calls.push(name); };
    return {
      calls,
      ctx: {
        clearRect: rec('clearRect'), beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), closePath: rec('closePath'),
        arc: rec('arc'), rect: rec('rect'), fill: rec('fill'), stroke: rec('stroke'), setLineDash: rec('setLineDash'), save: rec('save'), restore: rec('restore'),
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter',
      } as unknown as CanvasRenderingContext2D,
    };
  };

  it('names the hollow variant per group', () => {
    expect(flockHollowIconId(2)).toBe('flock-g2-hollow');
  });

  it('draws a filled shape as an undashed outline only', () => {
    const { ctx, calls } = spyCtx();
    drawFlockIcon(ctx, 2, 44, false, true);
    expect(calls).toContain('stroke');
    expect(calls).not.toContain('fill');
    expect(calls).not.toContain('setLineDash');
  });

  it('keeps the Raven ring with its center dot', () => {
    const { ctx, calls } = spyCtx();
    drawFlockIcon(ctx, 4, 44, false, true);
    expect(calls.filter((c) => c === 'fill')).toHaveLength(1);
  });
});

describe('plate readers are round everywhere', () => {
  it('uses the lens shape for group 1 so chips and legend match the map', () => {
    expect(FLOCK_GROUP_SHAPE[1]).toBe('lens');
  });

  it('draws the lens as a filled circle with a light ring', () => {
    const calls: string[] = [];
    const rec = (name: string) => () => { calls.push(name); };
    const ctx = {
      clearRect: rec('clearRect'), beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), closePath: rec('closePath'),
      arc: rec('arc'), rect: rec('rect'), fill: rec('fill'), stroke: rec('stroke'), setLineDash: rec('setLineDash'), save: rec('save'), restore: rec('restore'),
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;
    drawFlockIcon(ctx, 1, 44, false);
    expect(calls).toContain('arc');
    expect(calls).toContain('fill');
    expect(calls).toContain('stroke');
    expect(calls).not.toContain('rect');
  });
});
