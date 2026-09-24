import { FLOCK_COMPARE_COLOR } from './layers/flockCompareStyle';

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
const FlockRing = () => <circle cx={C} cy={C} r={7.5} fill="none" stroke={FLOCK_COMPARE_COLOR.line} strokeWidth={2.5} />;

/** An OSM camera: the blue point with its light ring. */
export function OsmDotMark({ size }: { size?: number }) {
  return <Svg size={size}><OsmDot /></Svg>;
}

/** A Flock plate reader in the Flock view: the red lens (glow, core, ring). */
export function FlockLensMark({ size, dimmed = false }: { size?: number; dimmed?: boolean }) {
  return (
    <Svg size={size}>
      <g opacity={dimmed ? 0.35 : 1}>
        <circle cx={C} cy={C} r={9} fill={FLOCK_COMPARE_COLOR.glow} opacity={0.25} />
        <circle cx={C} cy={C} r={5} fill={FLOCK_COMPARE_COLOR.core} stroke={FLOCK_COMPARE_COLOR.ring} strokeWidth={2} />
      </g>
    </Svg>
  );
}

/** A Flock plate reader while comparing: the hollow red ring. */
export function FlockRingMark({ size }: { size?: number }) {
  return <Svg size={size}><FlockRing /></Svg>;
}

/** Planned: the dashed red ring (FLOCK_PLANNED_ICON). */
export function FlockPlannedMark({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx={C} cy={C} r={6} fill="none" stroke={FLOCK_COMPARE_COLOR.line} strokeWidth={2} strokeDasharray="2.6 2" />
    </Svg>
  );
}

/** On both maps: an OSM point inside a Flock ring. */
export function BothMark({ size }: { size?: number }) {
  return <Svg size={size}><FlockRing /><OsmDot /></Svg>;
}
