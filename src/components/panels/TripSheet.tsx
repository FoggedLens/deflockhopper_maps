import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useTripStore, orderedStops } from '../../store/tripStore';
import { tripFootnote, tripStopDetail } from '../../utils/tripCopy';

/** The expanded trip: stops in driving order, named by Flock's own device
 *  names, each removable; then where the order starts and that Google gets
 *  the stops. The Google Maps bar stays in the header (TripPeek). */
export function TripSheet() {
  const stops = useTripStore((s) => s.stops);
  const order = useTripStore((s) => s.order);
  const hasOrigin = useTripStore((s) => s.origin !== null);
  const removeStop = useTripStore((s) => s.removeStop);
  const ordered = useMemo(() => orderedStops(stops, order), [stops, order]);

  return (
    <div className="pb-8">
      {ordered.length === 0 ? (
        <p className="py-4 text-sm text-dark-400">No stops yet. Tap devices on the map to add them.</p>
      ) : (
        <ol className="divide-y divide-white/[0.07]" aria-label="Stops in driving order">
          {ordered.map((s, i) => (
            <li key={s.key} className="flex items-center gap-3 min-h-14 py-1.5">
              <span
                aria-hidden="true"
                className="w-[22px] h-[22px] rounded-full bg-white text-[#0b0d10] text-xs font-bold leading-[22px] text-center tabular-nums flex-shrink-0"
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-100 truncate">{s.name}</p>
                <p className="text-xs text-dark-500 truncate">{tripStopDetail(s)}</p>
              </div>
              <button
                onClick={() => removeStop(s.key)}
                aria-label={`Remove stop ${i + 1}, ${s.name}`}
                className="w-10 h-10 -mr-2 flex items-center justify-center text-dark-500 active:text-dark-300"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-dark-500 leading-relaxed">{tripFootnote(hasOrigin)}</p>
    </div>
  );
}
