import { useMemo } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/maplibre';
import { useTripStore, orderedStops } from '../../store/tripStore';

/**
 * Trip mode's marks, rendered inside <Map> on the Leak tab:
 * - a numbered chip on each stop in driving order
 * - a faint straight connector through them (schematic, not the road route)
 * - the phone's position when known
 * Chips are DOM markers: no glyphs needed, always above the Flock marks, and
 * MapLibre moves them during gestures without React. The connector is a
 * normal line layer; the Flock layers raise themselves above it.
 * Hidden when trip mode is closed (the Trip button carries the count).
 */
export function TripMarks() {
  const active = useTripStore((s) => s.active);
  const stops = useTripStore((s) => s.stops);
  const order = useTripStore((s) => s.order);
  const origin = useTripStore((s) => s.origin);
  const ordered = useMemo(() => orderedStops(stops, order), [stops, order]);
  const line = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(() => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        ...(origin ? [[origin.lon, origin.lat]] : []),
        ...ordered.map((s) => [s.markLon, s.markLat]),
      ],
    },
  }), [origin, ordered]);

  if (!active) return null;

  return (
    <>
      {line.geometry.coordinates.length > 1 && (
        <Source id="trip-connector" type="geojson" data={line}>
          <Layer
            id="trip-connector-line"
            type="line"
            paint={{ 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [2, 2] }}
          />
        </Source>
      )}
      {origin && (
        <Marker longitude={origin.lon} latitude={origin.lat} anchor="center" style={{ pointerEvents: 'none' }}>
          <span
            aria-hidden="true"
            className="block w-[18px] h-[18px] rounded-full bg-[#3b82f6] border-[3px] border-white"
            style={{ boxShadow: '0 0 0 8px rgba(59, 130, 246, 0.22)' }}
          />
        </Marker>
      )}
      {ordered.map((s, i) => (
        <Marker key={s.key} longitude={s.markLon} latitude={s.markLat} anchor="center" style={{ pointerEvents: 'none' }}>
          <span
            data-trip-chip
            aria-hidden="true"
            className="block w-6 h-6 rounded-full bg-white text-[#0b0d10] text-[13px] leading-6 font-bold text-center tabular-nums"
            style={{ boxShadow: '0 0 0 2px rgba(11, 13, 16, 0.85), 0 2px 6px rgba(0, 0, 0, 0.5)' }}
          >
            {i + 1}
          </span>
        </Marker>
      ))}
    </>
  );
}
