import { FLOCK_COMPARE_COLOR, FLOCK_DECOMMISSIONED_COLOR, FLOCK_PLANNED_CORE } from './layers/flockCompareStyle';
import { drawFlockIcon } from './layers/flockLeakIcons';
import type { FlockGroup } from '../../lib/flockInventory';

/**
 * The Leak tab's map marks as inline SVG for the panel, legend and key, drawn
 * from the same radii and colors as the map layers (the OSM point in
 * CameraTileLayers, the Flock lens and ring in flockCompareStyle) so the key
 * matches what is on the map exactly. 20 px box, r 6 like the map at z10+.
 */
const OSM = { fill: '#2196E8', ring: '#93CBFF' } as const;
const BOX = 20;
const C = BOX / 2;

function Svg({ children, label, size = BOX }: { children: React.ReactNode; label?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      className="flex-shrink-0"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

const OsmDot = () => <circle cx={C} cy={C} r={5} fill={OSM.fill} stroke={OSM.ring} strokeWidth={2} />;
const FlockRing = ({ stroke = FLOCK_COMPARE_COLOR.line }: { stroke?: string }) => (
  <circle cx={C} cy={C} r={7.5} fill="none" stroke={stroke} strokeWidth={2.5} />
);

/** An OSM camera: the blue point with its light ring. */
export function OsmDotMark({ size }: { size?: number }) {
  return <Svg size={size}><OsmDot /></Svg>;
}

/** A Flock plate reader in the Flock view: the red lens (glow, core, ring);
 *  decommissioned, the same lens in gray without the glow. */
export function FlockLensMark({ size, decommissioned = false }: { size?: number; decommissioned?: boolean }) {
  if (decommissioned) {
    return (
      <Svg size={size}>
        <circle cx={C} cy={C} r={5} fill={FLOCK_DECOMMISSIONED_COLOR.core} stroke={FLOCK_DECOMMISSIONED_COLOR.ring} strokeWidth={2} />
      </Svg>
    );
  }
  return (
    <Svg size={size}>
      <circle cx={C} cy={C} r={9} fill={FLOCK_COMPARE_COLOR.glow} opacity={0.25} />
      <circle cx={C} cy={C} r={5} fill={FLOCK_COMPARE_COLOR.core} stroke={FLOCK_COMPARE_COLOR.ring} strokeWidth={2} />
    </Svg>
  );
}

/** A Flock plate reader while comparing: the hollow red ring (gray when
 *  decommissioned). */
export function FlockRingMark({ size, decommissioned = false }: { size?: number; decommissioned?: boolean }) {
  return <Svg size={size}><FlockRing stroke={decommissioned ? FLOCK_DECOMMISSIONED_COLOR.line : undefined} /></Svg>;
}

/** Planned: the dashed red ring. Open while comparing (FLOCK_PLANNED_ICON);
 *  around a dark core in the Flock view (flockPlannedLensId). */
export function FlockPlannedMark({ size, open = false }: { size?: number; open?: boolean }) {
  return (
    <Svg size={size}>
      <circle
        cx={C}
        cy={C}
        r={6}
        fill={open ? 'none' : FLOCK_PLANNED_CORE.dark}
        stroke={FLOCK_COMPARE_COLOR.line}
        strokeWidth={2}
        strokeDasharray="2.6 2"
      />
    </Svg>
  );
}

/** On both maps: an OSM point inside a Flock ring. */
export function BothMark({ size }: { size?: number }) {
  return <Svg size={size}><FlockRing /><OsmDot /></Svg>;
}

const iconUrls = new Map<string, string>();

/** The map's own canvas icon for a group, as a data URL (cached). */
function groupIconUrl(g: FlockGroup, hollow: boolean, planned: boolean, decommissioned: boolean, px: number): string | null {
  const key = `${g}-${hollow ? 'h' : 'f'}-${planned ? 'p' : decommissioned ? 'd' : 's'}-${px}`;
  const hit = iconUrls.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawFlockIcon(ctx, g, px, planned, hollow, decommissioned);
  const url = canvas.toDataURL();
  iconUrls.set(key, url);
  return url;
}

/**
 * A device group's mark exactly as the map draws it at z10+: plate readers
 * as the lens (or the compare ring), every other group from the same canvas
 * code that registers the map icons (flockLeakIcons). Used by the legend and
 * the filter chips, so a swatch can never drift from the map.
 */
export function FlockGroupMark({ g, hollow = false, planned = false, decommissioned = false, size = BOX }: {
  g: FlockGroup;
  hollow?: boolean;
  planned?: boolean;
  decommissioned?: boolean;
  size?: number;
}) {
  if (g === 1) {
    if (planned) return <FlockPlannedMark size={size} open={hollow} />;
    return hollow
      ? <FlockRingMark size={size} decommissioned={decommissioned} />
      : <FlockLensMark size={size} decommissioned={decommissioned} />;
  }
  const url = groupIconUrl(g, hollow, planned, decommissioned, size * 2);
  if (!url) return null;
  return <img src={url} width={size} height={size} alt="" aria-hidden="true" className="flex-shrink-0" />;
}
