import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Map as MaplibreMap } from 'maplibre-gl';

const BRANCH_COUNT = 9;
const CARD_WIDTH = 224;
const GAP = 110; // agency dot -> card edge, px
const EST_CARD_HEIGHT = 84; // only used to decide above vs. below
const EDGE_MARGIN = 12;
const NODE_CLEARANCE = 8; // start branches just off the dot, not on top of it
const BRANCH_INSET = 20;

type Placement = 'above' | 'below';

// Center branches reach the card first, outer ones follow, so it reads as branching.
const BRANCHES = Array.from({ length: BRANCH_COUNT }, (_, i) => {
  const span = CARD_WIDTH - 2 * BRANCH_INSET;
  return {
    x: -span / 2 + (span * i) / (BRANCH_COUNT - 1),
    delay: Math.abs(i - (BRANCH_COUNT - 1) / 2) * 45,
  };
});

function pickPlacement(y: number): Placement {
  return y - GAP - EST_CARD_HEIGHT < EDGE_MARGIN ? 'below' : 'above';
}

// Trunk leaves the dot vertically, splays out, and arrives square to the card edge.
function branchPath(x: number, dir: number): string {
  return `M 0 ${dir * NODE_CLEARANCE} C 0 ${dir * GAP * 0.6}, ${x} ${dir * GAP * 0.4}, ${x} ${dir * GAP}`;
}

interface GhostCalloutProps {
  map: MaplibreMap;
  coordinates: [number, number];
}

/**
 * Orange branches growing out of a no-portal agency into a message card. We
 * don't know who the agency shares with, so the lines end at the explanation
 * instead of at any real destination. Pinned to the agency by writing a
 * transform on map move (no React render in the gesture path).
 */
export function GhostCallout({ map, coordinates }: GhostCalloutProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>(() => pickPlacement(map.project(coordinates).y));

  useLayoutEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const position = () => {
      const pt = map.project(coordinates);
      el.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
    };
    const settle = () => setPlacement(pickPlacement(map.project(coordinates).y));
    position();
    map.on('move', position);
    map.on('moveend', settle);
    return () => {
      map.off('move', position);
      map.off('moveend', settle);
    };
  }, [map, coordinates]);

  const dir = placement === 'above' ? -1 : 1;

  return createPortal(
    <div ref={groupRef} className="pointer-events-none absolute left-0 top-0 z-10" style={{ willChange: 'transform' }}>
      <svg width="1" height="1" className="absolute left-0 top-0 overflow-visible" aria-hidden>
        {BRANCHES.map((b, i) => (
          <path
            key={i}
            className="ghost-branch"
            d={branchPath(b.x, dir)}
            pathLength={1}
            fill="none"
            stroke="#F97316"
            strokeOpacity={0.8}
            strokeWidth={1.5}
            strokeLinecap="round"
            style={{ animationDelay: `${b.delay}ms` }}
          />
        ))}
      </svg>
      <div
        role="status"
        className="ghost-callout-card absolute rounded-md border border-orange-500/40 bg-dark-800/95 px-3 py-2 text-center shadow-lg backdrop-blur-sm"
        style={{ width: CARD_WIDTH, left: -CARD_WIDTH / 2, ...(dir < 0 ? { bottom: GAP } : { top: GAP }) }}
      >
        <p className="text-xs font-semibold text-orange-300">No transparency portal</p>
        <p className="mt-0.5 text-xs leading-snug text-dark-300">
          This agency doesn&rsquo;t publish its sharing data. It&rsquo;s likely sharing with agencies across the country.
        </p>
      </div>
    </div>,
    map.getContainer(),
  );
}
