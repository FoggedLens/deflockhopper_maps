import { TRIP_MAX_STOPS, type TripStop } from '../store/tripStore';
import { flockTypeLabel } from '../lib/flockInventory';

/** The line under the trip count. Zoom comes first: below z9 no tap can add a stop. */
export function tripHint(count: number, canPick: boolean): string {
  if (!canPick) return 'Zoom in to tap devices.';
  if (count === 0) return 'Tap devices to add stops.';
  if (count >= TRIP_MAX_STOPS) return 'Trip is full. Remove a stop to add another.';
  return 'Tap devices to add or remove stops.';
}

/** Under the stop list: where the order starts, and that Google gets the stops. */
export function tripFootnote(hasOrigin: boolean): string {
  const start = hasOrigin ? 'Starts from your location' : 'Starts at stop 1';
  return `${start}, in the shortest order. Opening the trip sends these stops to Google.`;
}

/** A stop's second line: Flock's device type, named as the device card names
 *  it, plus the count for a stack. */
export function tripStopDetail(stop: Pick<TripStop, 'type' | 'deviceCount'>): string {
  const type = flockTypeLabel(stop.type);
  return stop.deviceCount > 1 ? `${type} · ${stop.deviceCount} devices here` : type;
}
