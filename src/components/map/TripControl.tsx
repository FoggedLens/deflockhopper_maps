import { Route } from 'lucide-react';
import { useTripStore } from '../../store/tripStore';
import { useFlockLeakStore } from '../../store/flockLeakStore';

/**
 * Phones, Leak tab: opens trip mode. It takes the bottom slot of the left
 * map column, nearest the thumb, with Flock and Legend above it. While a
 * trip is saved but closed, a badge shows its stop count. Same button
 * idiom as the Legend and Flock controls.
 */
export function TripControl() {
  const count = useTripStore((s) => s.stops.length);

  const openTrip = () => {
    // No device card or selection ring carries over into trip mode.
    useFlockLeakStore.getState().setSelection(null);
    useTripStore.getState().open();
  };

  return (
    <div className="map-trip-control absolute z-10 flex flex-col items-start">
      <button
        onClick={openTrip}
        aria-label={count > 0 ? `Trip, ${count} stops saved` : 'Plan a trip'}
        title="Trip"
        className="relative z-0 w-[40px] h-[40px] flex items-center justify-center rounded-md transition-colors bg-dark-800 border border-dark-600 text-dark-300 hover:bg-dark-700"
      >
        <span className="flex flex-col items-center gap-0.5 leading-none">
          <Route className="w-4 h-4" />
          <span className="text-[8px] font-semibold uppercase tracking-wide">Trip</span>
        </span>
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-dark-900 text-[10px] font-bold flex items-center justify-center tabular-nums border-2 border-dark-900">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
