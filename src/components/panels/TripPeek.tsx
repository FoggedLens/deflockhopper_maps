import { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useTripStore, orderedStops, TRIP_MAX_STOPS } from '../../store/tripStore';
import { useMapStore } from '../../store';
import { googleMapsTripUrl } from '../../utils/googleMapsTripUrl';
import { tripHint } from '../../utils/tripCopy';
import { FLOCK_LEAK_POINTS_MINZOOM } from '../../services/flockLeakTilesService';

const CTA = 'mt-3 flex items-center justify-center gap-2 w-full h-11 rounded-xl text-[15px] font-semibold transition-colors';

/**
 * The drawer header in trip mode, in place of the tab row: the count and
 * Done (plus Clear when expanded), the hint, and the Google Maps bar. It is
 * the whole peek, and it stays on top when the stop list is expanded.
 */
export function TripPeek({ expanded, onDone }: { expanded: boolean; onDone: () => void }) {
  const stops = useTripStore((s) => s.stops);
  const order = useTripStore((s) => s.order);
  const clear = useTripStore((s) => s.clear);
  // A boolean: re-renders only when the view crosses z9, once a gesture ends.
  const canPick = useMapStore((s) => s.zoom >= FLOCK_LEAK_POINTS_MINZOOM);
  const href = useMemo(() => googleMapsTripUrl(orderedStops(stops, order)), [stops, order]);
  const count = stops.length;

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between h-7">
        <p className="flex items-baseline gap-2">
          <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-dark-500">Trip</span>
          <span className="ml-1 text-[13px] font-semibold text-white tabular-nums">{count} of {TRIP_MAX_STOPS}</span>
          <span className="text-xs text-dark-500">stops</span>
        </p>
        <div className="flex items-center -mr-2">
          {expanded && count > 0 && (
            <button onClick={clear} className="h-9 px-2 text-[13px] font-medium text-dark-400 active:text-dark-200">
              Clear
            </button>
          )}
          <button onClick={onDone} className="h-9 px-2 text-[13px] font-medium text-white active:text-dark-300">
            Done
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-dark-500" aria-live="polite">{tripHint(count, canPick)}</p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={`${CTA} bg-accent active:bg-accent-hover text-white`}>
          Open in Google Maps
          <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
        </a>
      ) : (
        <span aria-disabled="true" className={`${CTA} bg-white/[0.06] text-dark-500`}>
          Open in Google Maps
          <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
