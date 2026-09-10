import { getTilesHost } from '../store/tilesHostStore';

/**
 * US administrative boundaries served as a plain vector tileset (MVT) from the
 * active DeFlock tile host. One tileset, three source-layers, all polygons.
 *
 * Consumed via the TileJSON URL only — MapLibre reads the tile template and
 * zoom range from it (never hardcode the {z}/{x}/{y}.mvt path).
 *
 * Contract (from boundaries-us.json):
 *  - states         z0–12  fields: abbrev ("IL"), name ("Illinois"), fips ("17")
 *  - counties       z2–12  fields: name ("Cook"), state ("IL"), fips ("17031")
 *  - municipalities z5–12  fields: name, type, state ("IL"), county (nullable), fips
 *  - fips is unique within each layer → used as the feature id (promoteId).
 */
export const boundaryTileJsonUrl = () => `${getTilesHost()}/boundaries-us.json`;

export type BoundaryLevel = 'states' | 'counties' | 'municipalities';

export const BOUNDARY_LEVELS: BoundaryLevel[] = ['states', 'counties', 'municipalities'];

export const BOUNDARY_LEVEL_LABEL: Record<BoundaryLevel, string> = {
  states: 'States',
  counties: 'Counties',
  municipalities: 'Municipalities',
};

/** The tileset's own maxzoom — MapLibre overzooms past this automatically. */
export const BOUNDARY_TILES_MAXZOOM = 12;

/** Per-layer minzoom (from the TileJSON). Below these, a layer has no data. */
export const BOUNDARY_LEVEL_MINZOOM: Record<BoundaryLevel, number> = {
  states: 0,
  counties: 2,
  municipalities: 5,
};

/** Promote fips to the feature id per source-layer so feature-state works. */
export const BOUNDARY_PROMOTE_ID: Record<BoundaryLevel, string> = {
  states: 'fips',
  counties: 'fips',
  municipalities: 'fips',
};
