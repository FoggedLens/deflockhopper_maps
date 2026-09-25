import type maplibregl from 'maplibre-gl';
import { FLOCK_GROUPS, type FlockGroup } from '../../../lib/flockInventory';
import { FLOCK_PLANNED_ICON, FLOCK_COMPARE_COLOR, FLOCK_PLANNED_CORE, flockPlannedLensId } from './flockCompareStyle';

/**
 * Flock device marks by group, drawn on a canvas at runtime and registered
 * as map images (no sprite rebuild). Change colors and shapes HERE only.
 * Every group differs from the others in hue AND shape (redundant encoding,
 * so the marks survive color-vision deficiency), and no group uses the OSM
 * blue. Video, Wing and Trailer were three near-identical oranges until
 * 2026-09-24; Wing (other people's cameras) is now pink, and trailers (146
 * devices) share the Other class's small gray dot.
 * Planned (s = 2) is the same shape as a dashed outline; decommissioned is
 * the solid mark at reduced opacity (a paint property, not an image).
 */
export const FLOCK_GROUP_COLOR: Record<FlockGroup, string> = {
  1: '#ef4444', // plate readers
  2: '#f59e0b', // video / PTZ
  3: '#f472b6', // third-party cameras (Wing)
  4: '#a78bfa', // audio sensors
  5: '#34d399', // drones
  6: '#9ca3af', // mobile trailers (drawn as Other)
  7: '#9ca3af', // components / other
  8: '#6b7280', // factory fixtures (q = 2, hidden by default)
};

export type FlockShape = 'lens' | 'diamond' | 'hollow-square' | 'ring' | 'triangle' | 'dot' | 'cross';

export const FLOCK_GROUP_SHAPE: Record<FlockGroup, FlockShape> = {
  1: 'lens', // on the map, plate readers are circle layers (flockCompareStyle); this shape feeds the swatches
  2: 'diamond',
  3: 'hollow-square',
  4: 'ring',
  5: 'triangle',
  6: 'dot', // folded into the Other class (FLOCK_DEVICE_CLASSES)
  7: 'dot',
  8: 'cross',
};

/** Logical pixel size of a mark at icon-size 1. */
export const FLOCK_ICON_PX = 14;
const PAD = 4;
const RATIO = 2;

export const flockIconId = (g: FlockGroup, planned: boolean): string =>
  `flock-g${g}${planned ? '-planned' : ''}`;
/** Overlay compare: the group's shape as an undashed outline, so the OSM
 *  mark shows through. Raven keeps its center dot. */
export const flockHollowIconId = (g: FlockGroup): string => `flock-g${g}-hollow`;

export const FLOCK_ICON_IDS: readonly string[] = [
  ...FLOCK_GROUPS.flatMap((g) => [flockIconId(g, false), flockIconId(g, true), flockHollowIconId(g)]),
  FLOCK_PLANNED_ICON,
  flockPlannedLensId('dark'),
  flockPlannedLensId('light'),
];

/** A dashed red ring for planned plate readers, sized to the Overlay ring
 *  (r 7.5 at icon-size 1). With `core`, the ring is filled first (the Flock
 *  view's planned lens); without, it stays open (Overlay). */
export function drawPlannedRing(ctx: CanvasRenderingContext2D, size: number, core?: string): void {
  const c = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, size * 0.3, 0, Math.PI * 2);
  if (core) {
    ctx.fillStyle = core;
    ctx.fill();
  }
  ctx.setLineDash([size * 0.13, size * 0.1]);
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = FLOCK_COMPARE_COLOR.line;
  ctx.stroke();
  ctx.restore();
}

export function drawFlockIcon(ctx: CanvasRenderingContext2D, g: FlockGroup, size: number, planned: boolean, hollow = false): void {
  const color = FLOCK_GROUP_COLOR[g];
  const shape = FLOCK_GROUP_SHAPE[g];
  const c = size / 2;
  const r = size * 0.36;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'hollow-square':
      ctx.rect(c - r, c - r, r * 2, r * 2);
      break;
    case 'lens':
      ctx.arc(c, c, r, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(c, c - r * 1.15);
      ctx.lineTo(c + r * 1.15, c);
      ctx.lineTo(c, c + r * 1.15);
      ctx.lineTo(c - r * 1.15, c);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(c, c - r * 1.2);
      ctx.lineTo(c + r * 1.15, c + r * 0.9);
      ctx.lineTo(c - r * 1.15, c + r * 0.9);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(c - r, c - r);
      ctx.lineTo(c + r, c + r);
      ctx.moveTo(c + r, c - r);
      ctx.lineTo(c - r, c + r);
      break;
    case 'ring':
    case 'dot':
      ctx.arc(c, c, shape === 'dot' ? r * 0.7 : r, 0, Math.PI * 2);
      break;
  }
  const outlineOnly = planned || hollow || shape === 'hollow-square' || shape === 'ring' || shape === 'cross';
  if (outlineOnly) {
    if (planned) ctx.setLineDash([size * 0.14, size * 0.1]);
    ctx.lineWidth = size * 0.13;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (shape === 'ring' && !planned) {
      ctx.beginPath();
      ctx.arc(c, c, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  } else if (shape === 'lens') {
    ctx.fillStyle = FLOCK_COMPARE_COLOR.core;
    ctx.fill();
    ctx.lineWidth = size * 0.13;
    ctx.strokeStyle = FLOCK_COMPARE_COLOR.ring;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }
  ctx.restore();
}

function renderIcon(draw: (ctx: CanvasRenderingContext2D, px: number) => void, logicalPx: number): { width: number; height: number; data: Uint8ClampedArray } | null {
  const px = (logicalPx + PAD * 2) * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, px, px);
  draw(ctx, px);
  const img = ctx.getImageData(0, 0, px, px);
  return { width: img.width, height: img.height, data: img.data };
}

/** Register every Flock icon the style might request. Idempotent. */
export function ensureFlockIcons(map: Pick<maplibregl.Map, 'hasImage' | 'addImage'>): void {
  for (const g of FLOCK_GROUPS) {
    for (const planned of [false, true]) {
      const id = flockIconId(g, planned);
      if (map.hasImage(id)) continue;
      const img = renderIcon((ctx, px) => drawFlockIcon(ctx, g, px, planned), FLOCK_ICON_PX);
      if (img) map.addImage(id, img, { pixelRatio: RATIO });
    }
    const hollowId = flockHollowIconId(g);
    if (!map.hasImage(hollowId)) {
      const img = renderIcon((ctx, px) => drawFlockIcon(ctx, g, px, false, true), FLOCK_ICON_PX);
      if (img) map.addImage(hollowId, img, { pixelRatio: RATIO });
    }
  }
  if (!map.hasImage(FLOCK_PLANNED_ICON)) {
    const img = renderIcon((ctx, px) => drawPlannedRing(ctx, px), 22);
    if (img) map.addImage(FLOCK_PLANNED_ICON, img, { pixelRatio: RATIO });
  }
  for (const theme of ['dark', 'light'] as const) {
    const id = flockPlannedLensId(theme);
    if (map.hasImage(id)) continue;
    const img = renderIcon((ctx, px) => drawPlannedRing(ctx, px, FLOCK_PLANNED_CORE[theme]), 22);
    if (img) map.addImage(id, img, { pixelRatio: RATIO });
  }
}
