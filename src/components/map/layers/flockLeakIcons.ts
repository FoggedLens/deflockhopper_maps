import type maplibregl from 'maplibre-gl';
import { FLOCK_GROUPS, type FlockGroup } from '../../../lib/flockInventory';

/**
 * Flock device marks by group, drawn on a canvas at runtime and registered
 * as map images (no sprite rebuild). Placeholder palette from the theme:
 * colors and shapes are decided elsewhere later; change them HERE only.
 * Planned (s = 2) is the same shape as a dashed outline; decommissioned is
 * the solid mark at reduced opacity (a paint property, not an image).
 */
export const FLOCK_GROUP_COLOR: Record<FlockGroup, string> = {
  1: '#ef4444', // plate readers
  2: '#f59e0b', // video / PTZ
  3: '#fb923c', // third-party cameras (Wing)
  4: '#a78bfa', // audio sensors
  5: '#34d399', // drones
  6: '#e5a04d', // mobile trailers
  7: '#9ca3af', // components / other
  8: '#6b7280', // factory fixtures (q = 2, hidden by default)
};

export type FlockShape = 'square' | 'diamond' | 'hollow-square' | 'ring' | 'triangle' | 'pill' | 'dot' | 'cross';

export const FLOCK_GROUP_SHAPE: Record<FlockGroup, FlockShape> = {
  1: 'square',
  2: 'diamond',
  3: 'hollow-square',
  4: 'ring',
  5: 'triangle',
  6: 'pill',
  7: 'dot',
  8: 'cross',
};

/** Logical pixel size of a mark at icon-size 1. */
export const FLOCK_ICON_PX = 14;
const PAD = 4;
const RATIO = 2;

export const flockIconId = (g: FlockGroup, planned: boolean): string =>
  `flock-g${g}${planned ? '-planned' : ''}`;

export const FLOCK_ICON_IDS: readonly string[] = FLOCK_GROUPS.flatMap((g) => [
  flockIconId(g, false),
  flockIconId(g, true),
]);

export function drawFlockIcon(ctx: CanvasRenderingContext2D, g: FlockGroup, size: number, planned: boolean): void {
  const color = FLOCK_GROUP_COLOR[g];
  const shape = FLOCK_GROUP_SHAPE[g];
  const c = size / 2;
  const r = size * 0.36;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'square':
    case 'hollow-square':
      ctx.rect(c - r, c - r, r * 2, r * 2);
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
    case 'pill':
      ctx.rect(c - r * 1.25, c - r * 0.6, r * 2.5, r * 1.2);
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
  const outlineOnly = planned || shape === 'hollow-square' || shape === 'ring' || shape === 'cross';
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
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }
  ctx.restore();
}

function renderIcon(g: FlockGroup, planned: boolean): { width: number; height: number; data: Uint8ClampedArray } | null {
  const px = (FLOCK_ICON_PX + PAD * 2) * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, px, px);
  drawFlockIcon(ctx, g, px, planned);
  const img = ctx.getImageData(0, 0, px, px);
  return { width: img.width, height: img.height, data: img.data };
}

/** Register every Flock icon the style might request. Idempotent. */
export function ensureFlockIcons(map: Pick<maplibregl.Map, 'hasImage' | 'addImage'>): void {
  for (const g of FLOCK_GROUPS) {
    for (const planned of [false, true]) {
      const id = flockIconId(g, planned);
      if (map.hasImage(id)) continue;
      const img = renderIcon(g, planned);
      if (img) map.addImage(id, img, { pixelRatio: RATIO });
    }
  }
}
