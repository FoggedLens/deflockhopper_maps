import type { OverpassResponse, OverpassElement, GeoJSON, Dataset, FetchOptions, CountryCode } from '../types';
import { queryOverpassTile, OVERPASS_ENDPOINTS } from '../lib/overpass';
import { pointFeature, buildFeatureCollection } from '../lib/geojson';
import { retryWithBackoff } from '../lib/retry';
import { tileIntegrityFailed, belowMinimum } from '../lib/guards';

// Legacy single-shot national query. No longer used to fetch — a US-wide query now
// returns ~107K elements / ~54MB and runs right at the 60s gateway ceiling, so it
// times out unreliably. Kept for reference/tests; fetchCameras() uses adaptive tiling.
export const CAMERAS_OVERPASS_QUERY = `[out:json][timeout:120];
area["ISO3166-1"="US"]->.us;
(
  node["man_made"="surveillance"]["surveillance:type"="ALPR"](area.us);
  way["man_made"="surveillance"]["surveillance:type"="ALPR"](area.us);
);
out meta;
>;
out skel qt;`;

// Retryable "the fetch clearly worked" floor on the raw, all-country tiled total.
// Distinct from per-country write floors. Skipped for scoped bbox-override dev runs.
const RAW_MIN_TOTAL = 50_000;

const US_R2_KEY = 'cameras.geojson.gz'; // unchanged from the pre-multi-country dataset — do NOT rename (deployed web/mobile clients fetch this key)
const US_MIN_COUNT = 50_000;

interface PublishConfig {
  country: CountryCode;
  r2Key: string;
  minCount: number;
}

// Bordering countries whose ALPR nodes bleed into the US tiling grid. Each is fetched by
// an authoritative OSM area query and subtracted from the US set by node ID. `publish`
// also writes it as its own dataset; `null` = subtract-only. `areaMinCount` is the area
// query's own integrity floor (see fetchCountryArea) — distinct from `publish.minCount`,
// which gates the write of a *published* dataset. Adding a country = one entry.
const NEIGHBOUR_COUNTRIES: Array<{ iso: string; publish: PublishConfig | null; areaMinCount: number }> = [
  // Full CA ALPR set was measured at ~512 nodes; 250 catches a >~50% truncation.
  { iso: 'CA', publish: { country: 'CA', r2Key: 'cameras-ca.geojson.gz', minCount: 0 }, areaMinCount: 250 },
  // MX is subtract-only and may legitimately be 0 — never throw on an empty MX response.
  { iso: 'MX', publish: null, areaMinCount: 0 },
];

// ---- Adaptive tiling configuration --------------------------------------------------
// Instead of one national query, we cover the US with a grid of bounding boxes and
// fetch each separately. Any box holding more than SPLIT_THRESHOLD cameras is split
// into quadrants first, so every individual request stays small (seconds, not minutes)
// and can never hit the 60s gateway timeout. This also self-adapts as the network
// grows: denser areas simply split further.

interface Tile {
  s: number; // south lat
  w: number; // west lon
  n: number; // north lat
  e: number; // east lon
}

/** A leaf tile ready to fetch, tagged with the camera count its probe reported. */
interface PlannedTile extends Tile {
  probed: number;
}

const SPLIT_THRESHOLD = 5_000; // split a tile holding more cameras than this
const MIN_TILE_SPAN = 0.05;    // deg — safety floor; stop subdividing below this size
const TILE_CONCURRENCY = 5;    // parallel requests in flight to Overpass
const TILE_RETRIES = 3;        // per-tile retries before failing the whole fetch
const TILE_RETRY_DELAY_MS = 1_000;
// A tile's fetched feature count must be within this fraction of its probed count,
// else we treat the response as partial/corrupt and fail (rather than silently
// writing a hole into the dataset). 0.10 tolerates churn between probe and fetch.
const TILE_FETCH_TOLERANCE = 0.10;

/** Coarse seed grid covering the continental US + AK/HI/PR. Splitting handles density. */
function buildSeedTiles(): Tile[] {
  const tiles: Tile[] = [];
  // Continental US: lat 24..50, lon -125..-66, in ~6.5deg x ~9.84deg cells.
  for (let s = 24; s < 50; s += 6.5) {
    for (let w = -125; w < -66; w += 9.84) {
      tiles.push({ s, w, n: Math.min(s + 6.5, 50), e: Math.min(w + 9.84, -66) });
    }
  }
  tiles.push({ s: 51, w: -180, n: 72, e: -129 });   // Alaska (mainland)
  tiles.push({ s: 18, w: -161, n: 23, e: -154 });   // Hawaii
  tiles.push({ s: 17.5, w: -67.5, n: 18.7, e: -64.5 }); // Puerto Rico + USVI
  return tiles;
}

function tileSelector(t: Tile): string {
  const b = `${t.s},${t.w},${t.n},${t.e}`;
  return (
    `node["man_made"="surveillance"]["surveillance:type"="ALPR"](${b});` +
    `way["man_made"="surveillance"]["surveillance:type"="ALPR"](${b});`
  );
}

/** Cheap (<1s) count probe used to decide whether a tile needs splitting. */
async function countTile(t: Tile): Promise<number> {
  const query = `[out:json][timeout:60];(${tileSelector(t)});out count;`;
  const { data } = await queryOverpassTile(query);
  const countEl = data.elements?.[0] as unknown as { tags?: { total?: string } } | undefined;
  const total = countEl?.tags?.total;
  return total ? Number(total) : 0;
}

/** Expand the seed grid into leaf tiles each holding <= SPLIT_THRESHOLD cameras. */
async function planLeafTiles(seed: Tile[]): Promise<PlannedTile[]> {
  const leaves: PlannedTile[] = [];
  const queue: Tile[] = [...seed];

  while (queue.length > 0) {
    const batch = queue.splice(0, TILE_CONCURRENCY);
    const counts = await Promise.all(
      batch.map((t) => retryWithBackoff(() => countTile(t), TILE_RETRIES, TILE_RETRY_DELAY_MS))
    );

    batch.forEach((t, i) => {
      const count = counts[i];
      if (count === 0) return; // empty tile — drop it
      const span = Math.min(t.n - t.s, t.e - t.w);
      if (count <= SPLIT_THRESHOLD || span <= MIN_TILE_SPAN) {
        leaves.push({ ...t, probed: count });
        return;
      }
      const my = (t.s + t.n) / 2;
      const mx = (t.w + t.e) / 2;
      queue.push(
        { s: t.s, w: t.w, n: my, e: mx },
        { s: t.s, w: mx, n: my, e: t.e },
        { s: my, w: t.w, n: t.n, e: mx },
        { s: my, w: mx, n: t.n, e: t.e }
      );
    });
  }

  return leaves;
}

/**
 * Fetch one tile's full data, verify it against its probe, then merge into the
 * shared map. Throws if the tile returned far fewer features than the probe
 * promised — that throw is retried, and if it persists the whole fetch fails
 * closed (the pipeline keeps the previous R2 data rather than writing a hole).
 */
async function fetchTileInto(t: PlannedTile, featureMap: Map<string, GeoJSON.Feature>): Promise<void> {
  const query = `[out:json][timeout:60];(${tileSelector(t)});out meta;>;out skel qt;`;
  const { data } = await queryOverpassTile(query);

  // Build into a local map first so we can integrity-check this tile in isolation
  // (counting against the shared map would be skewed by neighbour-tile overlap).
  const local = new Map<string, GeoJSON.Feature>();
  addElementsToFeatures(data.elements, local);

  if (tileIntegrityFailed(local.size, t.probed, TILE_FETCH_TOLERANCE)) {
    throw new Error(
      `Tile (${t.s},${t.w},${t.n},${t.e}) integrity check failed: got ${local.size} features, probe expected ${t.probed}`
    );
  }

  for (const [key, feature] of local) featureMap.set(key, feature);
}

const CARDINALS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

const SPELLED_CARDINALS: Record<string, number> = {
  NORTH: 0, NORTHEAST: 45, EAST: 90, SOUTHEAST: 135,
  SOUTH: 180, SOUTHWEST: 225, WEST: 270, NORTHWEST: 315,
};

const BOUND_DIRECTIONS: Record<string, number> = {
  NB: 0, EB: 90, SB: 180, WB: 270,
};

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Resolve a simple token (cardinal, spelled-out, bound, or numeric) to raw degrees. No normalization, no range/semicolon handling. */
function resolveSimple(token: string): number | null {
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper in CARDINALS) return CARDINALS[upper];
  if (upper in SPELLED_CARDINALS) return SPELLED_CARDINALS[upper];
  if (upper in BOUND_DIRECTIONS) return BOUND_DIRECTIONS[upper];
  const num = Number(upper);  // Number() rejects "338-23" unlike parseFloat
  return Number.isFinite(num) ? num : null;
}

/** Compute the clockwise span from startDeg to endDeg (raw values, not pre-normalized). */
function rangeSpan(startDeg: number, endDeg: number): number {
  const rawArc = endDeg - startDeg;
  const normalizedArc = normalizeDegrees(rawArc);
  // Full circle: raw values differ but normalized arc is 0 (e.g. 0→360)
  return normalizedArc === 0 && rawArc !== 0 ? 360 : normalizedArc;
}

/** Compute the midpoint bearing of a clockwise sector from startDeg to endDeg. */
function rangeMidpoint(startDeg: number, endDeg: number): number {
  return normalizeDegrees(startDeg + rangeSpan(startDeg, endDeg) / 2);
}

interface ParsedDirectionToken {
  bearing: number;
  span?: number;
}

/** Parse one token while retaining range metadata needed during publication. */
function parseDetailedToken(token: string): ParsedDirectionToken | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Try simple resolve first (cardinal, spelled-out, bound, numeric)
  const simple = resolveSimple(trimmed);
  if (simple !== null) return { bearing: normalizeDegrees(simple) };

  // Range notation: "338-23", "WSW-ESE" — find dash that isn't a leading negative
  const dashIdx = trimmed.indexOf('-', 1);
  if (dashIdx > 0) {
    const left = resolveSimple(trimmed.slice(0, dashIdx));
    const right = resolveSimple(trimmed.slice(dashIdx + 1));
    if (left !== null && right !== null) {
      const span = rangeSpan(left, right);
      const bearing = rangeMidpoint(left, right);
      if (!Number.isFinite(span) || !Number.isFinite(bearing)) return null;
      return {
        bearing,
        span,
      };
    }
  }

  return null;
}

function parseDetailedDirections(value: string | undefined): ParsedDirectionToken[] {
  if (!value) return [];
  const results: ParsedDirectionToken[] = [];
  for (const token of value.split(/[;,]/)) {
    const parsed = parseDetailedToken(token);
    if (parsed !== null) results.push(parsed);
  }
  return results;
}

/** Parse a direction tag into all resolved bearings (handles semicolons and commas). */
export function parseDirections(value: string | undefined): number[] {
  return parseDetailedDirections(value).map(({ bearing }) => bearing);
}

/** Parse a direction tag into a single bearing (first resolved value). Backward-compatible. */
export function parseDirection(value: string | undefined): number | null {
  const dirs = parseDirections(value);
  return dirs.length > 0 ? dirs[0] : null;
}

/**
 * Transform a batch of Overpass elements (one tile's response, or a whole national
 * response) into GeoJSON point features, merging into `featureMap`. Keyed by
 * `${type}/${id}` so cameras appearing in two overlapping tiles are deduped to one.
 */
export function addElementsToFeatures(
  elements: OverpassElement[],
  featureMap: Map<string, GeoJSON.Feature>
): void {
  // Build node lookup for way centroid calculation (scoped to this batch; Overpass
  // recursion `>;` keeps a selected way's child nodes in the same response).
  const nodesById = new Map<number, { lat: number; lon: number }>();
  for (const el of elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodesById.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }

  for (const el of elements) {
    const tags = el.tags ?? {};

    // Only process surveillance ALPR elements
    if (tags['man_made'] !== 'surveillance') continue;
    if (tags['surveillance:type'] !== 'ALPR') continue;

    let lat = el.lat;
    let lon = el.lon;

    // For ways, compute centroid from child nodes
    if (el.type === 'way' && el.nodes) {
      const wayNodes = el.nodes
        .map((id) => nodesById.get(id))
        .filter((n): n is { lat: number; lon: number } => n !== undefined);

      if (wayNodes.length > 0) {
        lat = wayNodes.reduce((sum, n) => sum + n.lat, 0) / wayNodes.length;
        lon = wayNodes.reduce((sum, n) => sum + n.lon, 0) / wayNodes.length;
      }
    }

    if (lat === undefined || lon === undefined) continue;

    const directionTag = tags['direction'] || tags['camera:direction'];
    const parsedDirections = parseDetailedDirections(directionTag);
    const firstDirection = parsedDirections[0];
    const directions = parsedDirections.map(({ bearing }) => bearing);
    const direction = firstDirection?.bearing ?? null;
    const directionSpan = firstDirection?.span;
    const directionSpans = parsedDirections.length > 1
      && parsedDirections.some(({ span }) => span !== undefined)
      ? parsedDirections.map(({ span }) => span ?? null)
      : undefined;
    // directionCardinal stores the original cardinal string when the (first) token is a compass point
    const firstToken = directionTag?.split(/[;,]/)[0]?.trim();
    const isCardinal = firstToken ? firstToken.toUpperCase() in CARDINALS : false;

    const properties: Record<string, unknown> = {
      osmId: el.id,
      osmType: el.type,
    };

    if (tags['operator']) properties.operator = tags['operator'];
    if (tags['brand'] || tags['manufacturer']) {
      properties.brand = tags['brand'] || tags['manufacturer'];
    }
    if (direction !== null) properties.direction = direction;
    if (directionSpan !== undefined) properties.directionSpan = directionSpan;
    if (directions.length > 1) properties.directions = directions;
    if (directionSpans !== undefined) properties.directionSpans = directionSpans;
    if (isCardinal) properties.directionCardinal = firstToken;
    if (tags['surveillance:zone']) properties.surveillanceZone = tags['surveillance:zone'];
    if (tags['camera:mount']) properties.mountType = tags['camera:mount'];
    if (tags['ref']) properties.ref = tags['ref'];
    if (tags['start_date']) properties.startDate = tags['start_date'];
    if (el.timestamp) properties.osmTimestamp = el.timestamp;
    if (el.version) properties.osmVersion = el.version;

    featureMap.set(`${el.type}/${el.id}`, pointFeature(lon, lat, properties));
  }
}

export function transformOverpassToGeoJSON(
  data: OverpassResponse
): GeoJSON.FeatureCollection {
  const featureMap = new Map<string, GeoJSON.Feature>();
  addElementsToFeatures(data.elements, featureMap);

  // Sort by osmId for deterministic output
  const features = [...featureMap.values()].sort(
    (a, b) => (a.properties.osmId as number) - (b.properties.osmId as number)
  );

  return buildFeatureCollection(features);
}

/**
 * Fetch one country's complete ALPR set via an authoritative OSM area query, then
 * enforce `minCount` as an integrity floor. A truncated or empty Overpass response
 * still returns HTTP 200 (allowEmpty), so a short result is only distinguishable from
 * a genuinely sparse country by this floor — below it we refuse to let a caller
 * subtract a partial result from the US set. A 0-node result is only valid when
 * `minCount` is 0 (e.g. MX, subtract-only).
 */
async function fetchCountryArea(iso: string, minCount: number): Promise<Map<string, GeoJSON.Feature>> {
  const query =
    `[out:json][timeout:90];area["ISO3166-1"="${iso}"]["admin_level"="2"]->.a;` +
    `(node["man_made"="surveillance"]["surveillance:type"="ALPR"](area.a);` +
    `way["man_made"="surveillance"]["surveillance:type"="ALPR"](area.a););` +
    `out meta;>;out skel qt;`;
  const { data } = await queryOverpassTile(query);
  const map = new Map<string, GeoJSON.Feature>();
  addElementsToFeatures(data.elements, map);

  if (belowMinimum(map.size, minCount)) {
    throw new Error(
      `Area query ${iso}: got ${map.size} ALPR features (integrity floor ${minCount}). Likely a partial/empty Overpass response — refusing to subtract a partial result.`
    );
  }

  return map;
}

/** Pure: return merged features whose ${type}/${id} key is not in foreignKeys. */
export function subtractForeign(
  merged: Map<string, GeoJSON.Feature>,
  foreignKeys: Set<string>
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const [key, feature] of merged) {
    if (!foreignKeys.has(key)) out.push(feature);
  }
  return out;
}

/** Pure: assemble one country's sorted, keyed, counted Dataset. */
export function buildDataset(
  country: CountryCode,
  r2Key: string,
  features: GeoJSON.Feature[],
  minCount: number,
  endpoint: string
): Dataset {
  const sorted = [...features].sort(
    (a, b) => (a.properties.osmId as number) - (b.properties.osmId as number)
  );
  return {
    country,
    r2Key,
    source: 'overpass',
    featureCollection: buildFeatureCollection(sorted),
    featureCount: sorted.length,
    endpoint,
    minCount,
  };
}

export async function fetchCameras(opts: FetchOptions = {}): Promise<Dataset[]> {
  console.log('Fetching camera data (US tiling + neighbour area subtraction)...');

  // 1. Tile the US grid (or a single override box) -> merged, deduped set M.
  const seed: Tile[] = opts.bboxOverride
    ? [{ s: opts.bboxOverride[0], w: opts.bboxOverride[1], n: opts.bboxOverride[2], e: opts.bboxOverride[3] }]
    : buildSeedTiles();
  const leaves = await planLeafTiles(seed);
  console.log(`Planned ${leaves.length} leaf tiles`);

  const merged = new Map<string, GeoJSON.Feature>();
  const queue: PlannedTile[] = [...leaves];
  while (queue.length > 0) {
    const batch = queue.splice(0, TILE_CONCURRENCY);
    await Promise.all(
      batch.map((t) => retryWithBackoff(() => fetchTileInto(t, merged), TILE_RETRIES, TILE_RETRY_DELAY_MS))
    );
  }

  const rawTotal = merged.size;
  console.log(`Merged ${rawTotal} raw camera features from ${leaves.length} tiles`);
  if (!opts.bboxOverride && rawTotal < RAW_MIN_TOTAL) {
    throw new Error(`Validation failed: only ${rawTotal} raw cameras (minimum ${RAW_MIN_TOTAL}). Skipping update.`);
  }

  // 2. Fetch each bordering country's authoritative ALPR set via OSM area query.
  const neighbourMaps = new Map<string, Map<string, GeoJSON.Feature>>();
  for (const { iso, areaMinCount } of NEIGHBOUR_COUNTRIES) {
    const m = await retryWithBackoff(() => fetchCountryArea(iso, areaMinCount), TILE_RETRIES, TILE_RETRY_DELAY_MS);
    neighbourMaps.set(iso, m);
    console.log(`Area query ${iso}: ${m.size} ALPR features`);
  }

  // 3. Subtract all foreign IDs from M -> clean US set.
  const foreignKeys = new Set<string>();
  for (const m of neighbourMaps.values()) {
    for (const key of m.keys()) foreignKeys.add(key);
  }
  const usFeatures = subtractForeign(merged, foreignKeys);
  console.log(`US after subtraction: ${usFeatures.length} (removed ${rawTotal - usFeatures.length} foreign)`);

  // 4. Assemble published datasets: US + each publishable neighbour.
  const endpoint = `${OVERPASS_ENDPOINTS[0]} (tiling + area subtraction)`;
  const datasets: Dataset[] = [buildDataset('US', US_R2_KEY, usFeatures, US_MIN_COUNT, endpoint)];
  for (const { iso, publish } of NEIGHBOUR_COUNTRIES) {
    if (!publish) continue;
    const feats = [...neighbourMaps.get(iso)!.values()];
    datasets.push(buildDataset(publish.country, publish.r2Key, feats, publish.minCount, endpoint));
  }
  for (const ds of datasets) console.log(`  dataset ${ds.country}: ${ds.featureCount} -> ${ds.r2Key}`);
  return datasets;
}
