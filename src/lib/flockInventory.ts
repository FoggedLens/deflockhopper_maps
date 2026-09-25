/**
 * The leaked Flock device inventory (flock-inventory-v2): codes, labels,
 * totals and record parsing. The tiles carry integer codes at every zoom
 * and full records from z9; everything display-facing maps through here.
 * Contract: docs/superpowers/specs/2026-09-23-flock-inventory-v2-contract.md
 */
export type FlockGroup = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type FlockStatus = 1 | 2 | 3 | 4;
export type FlockQuality = 0 | 1 | 2 | 3 | 4;

export const FLOCK_GROUPS: readonly FlockGroup[] = [1, 2, 3, 4, 5, 6, 7, 8];
export const FLOCK_SELECTABLE_STATUSES: readonly FlockStatus[] = [1, 2, 3];

export const FLOCK_GROUP_LABEL: Record<FlockGroup, string> = {
  1: 'Plate readers',
  2: 'Video and PTZ cameras',
  3: 'Third-party cameras',
  4: 'Raven audio sensors',
  5: 'Drones',
  6: 'Mobile trailers',
  7: 'Components and other',
  8: 'Factory fixtures',
};

/** One device of the group, for a popup subtitle. */
export const FLOCK_GROUP_SINGULAR: Record<FlockGroup, string> = {
  1: 'Plate reader',
  2: 'Video or PTZ camera',
  3: 'Third-party camera',
  4: 'Raven audio sensor',
  5: 'Drone equipment',
  6: 'Mobile trailer',
  7: 'Component',
  8: 'Factory fixture',
};

/** Short names, for a merged point's popup title below z9. Group 4 is only
 *  ever `raven`, so it goes by the product name. */
export const FLOCK_GROUP_SHORT: Record<FlockGroup, string> = {
  1: 'ALPR',
  2: 'Video',
  3: 'Wing',
  4: 'Raven',
  5: 'Drone',
  6: 'Trailer',
  7: 'Other',
  8: 'Fixture',
};

/** A filter chip and legend row: one class on the map. Mobile trailers
 *  (146 devices, 5 in service) fold into Other: a legend class that rare
 *  costs more to read than it tells. Group 8 (factory fixtures) is always
 *  q = 2 and never drawn, so it has no chip. */
export interface FlockDeviceClass {
  key: string;
  groups: readonly FlockGroup[];
  short: string;
  label: string;
}

export const FLOCK_DEVICE_CLASSES: readonly FlockDeviceClass[] = [
  { key: 'alpr', groups: [1], short: 'ALPR', label: 'Plate readers' },
  { key: 'video', groups: [2], short: 'Video', label: 'Video and PTZ cameras' },
  { key: 'wing', groups: [3], short: 'Wing', label: 'Wing third-party cameras' },
  { key: 'raven', groups: [4], short: 'Raven', label: 'Raven audio sensors' },
  { key: 'drone', groups: [5], short: 'Drones', label: 'Drones and docks' },
  { key: 'other', groups: [6, 7], short: 'Other', label: 'Trailers, compute boxes, other' },
];

export const FLOCK_STATUS_LABEL: Record<FlockStatus, string> = {
  1: 'In service',
  2: 'Planned',
  3: 'Decommissioned',
  4: 'Unknown',
};

export const FLOCK_QUALITY_LABEL: Record<FlockQuality, string> = {
  0: 'Clean',
  1: 'Unknown status',
  2: 'Factory or test fixture',
  3: 'Placeholder location',
  4: 'Outside North America',
};

/** Flock's internal product names to friendly labels. One table, on purpose. */
export const FLOCK_TYPE_LABEL: Record<string, string> = {
  falcon: 'Falcon',
  falconHighway: 'Falcon Highway',
  falconFlex: 'Falcon Flex',
  sparrow: 'Sparrow',
  lprTrailer: 'LPR Trailer',
  condor: 'Condor',
  picardPtz: 'Picard PTZ',
  wing: 'Wing',
  wingUbiuia: 'Wing Ubiquia',
  wingGateway: 'Wing Gateway',
  wingApi: 'Wing API',
  external: 'External camera',
  raven: 'Raven',
  drone: 'Drone',
  droneDockingStation: 'Drone Dock',
  droneControllerBox: 'Drone Controller',
  droneRadar: 'Drone Radar',
  trailer: 'Trailer',
  picardTrailer: 'Picard Trailer',
  picard: 'Picard',
  avicore: 'Avicore',
  talkDown: 'Talk Down',
  backhaulBox: 'Backhaul Box',
  multiEvidenceDevice: 'Multi-Evidence Device',
  owl: 'Owl',
  automotus: 'Automotus',
  factoryFixture: 'Factory fixture',
};

export const FLOCK_FEATURE_LABEL: Record<string, string> = {
  livestream: 'Live stream',
  lpr: 'LPR',
  readsLicensePlates: 'Reads plates',
  replay: 'Replay',
  supportsFreeFormSearchPeople: 'People search',
  supportsVehicleDescriptionAlerts: 'Vehicle description alerts',
};

/** Records imported in bulk carry this creation stamp; it is an upper bound. */
export const FLOCK_IMPORT_SENTINEL = '2024-03-26T18:02:45.611000+00:00';

/** Totals from the contract. The tiles never carry totals and rendered
 *  features must not be counted for them (tile-border duplicates). */
export const FLOCK_INVENTORY = {
  snapshotIso: '2025-12-14',
  snapshotLabel: 'Dec 14, 2025',
  devices: 335_701,
  devicesClean: 311_907,
  devicesFlagged: 23_794,
  nationalPoints: 250_868,
  nationalPointsClean: 249_506,
  cleanByStatus: { inService: 163_540, planned: 54_396, decommissioned: 31_570 },
  /** Clean national points per group: [in service, planned, decommissioned]. */
  cleanByGroup: {
    1: [117_959, 39_701, 18_196],
    2: [5_505, 6_860, 1_283],
    3: [24_762, 498, 5_787],
    4: [14_905, 6_429, 4_961],
    5: [57, 259, 5],
    6: [5, 131, 10],
    7: [347, 518, 1_328],
  } as Record<Exclude<FlockGroup, 8>, readonly [number, number, number]>,
} as const;

/** Clean national points in these groups for the given statuses: what the
 *  map draws for a chip under the current status filter. Unknown status (4)
 *  is never clean, so it adds nothing. */
export function cleanPointsFor(groups: readonly FlockGroup[], statuses: readonly FlockStatus[]): number {
  let sum = 0;
  for (const g of groups) {
    const row = FLOCK_INVENTORY.cleanByGroup[g as Exclude<FlockGroup, 8>];
    if (!row) continue;
    for (const s of statuses) if (s >= 1 && s <= 3) sum += row[s - 1];
  }
  return sum;
}

function parseCode<T extends number>(raw: unknown, allowed: readonly T[]): T | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return (allowed as readonly number[]).includes(n) ? (n as T) : null;
}

export const parseGroup = (raw: unknown): FlockGroup | null => parseCode(raw, FLOCK_GROUPS);
export const parseStatus = (raw: unknown): FlockStatus | null => parseCode(raw, [1, 2, 3, 4] as const);
export const parseQuality = (raw: unknown): FlockQuality | null => parseCode(raw, [0, 1, 2, 3, 4] as const);

export function flockTypeLabel(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return 'Unknown type';
  return FLOCK_TYPE_LABEL[t] ?? t;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 10, 2025", or the import upper bound, or null for garbage. */
export function formatCreated(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw === FLOCK_IMPORT_SENTINEL) return 'On or before Mar 26, 2024';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export function parseFeatures(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface FlockDeviceRecord {
  id: number;
  g: FlockGroup;
  s: FlockStatus;
  q: FlockQuality;
  type: string;
  name: string;
  created: string;
  features: string[];
  active: boolean;
  rotationAngle: number | null;
  lat: number;
  lon: number;
}

/** A z9+ feature's properties as a device record; null for anything short of one. */
export function parseDeviceRecord(props: Record<string, unknown>): FlockDeviceRecord | null {
  const id = typeof props.id === 'number' ? props.id : Number(props.id);
  const g = parseGroup(props.g);
  const s = parseStatus(props.s);
  const q = parseQuality(props.q);
  const lat = typeof props.lat === 'number' ? props.lat : NaN;
  const lon = typeof props.lon === 'number' ? props.lon : NaN;
  if (!Number.isFinite(id) || g === null || s === null || q === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return {
    id,
    g,
    s,
    q,
    type: typeof props.type === 'string' ? props.type.trim() : '',
    name: typeof props.name === 'string' ? props.name.trim() : '',
    created: typeof props.created === 'string' ? props.created : '',
    features: parseFeatures(props.features),
    active: props.active === 1 || props.active === '1' || props.active === true,
    rotationAngle: typeof props.rotationAngle === 'number' && Number.isFinite(props.rotationAngle) ? props.rotationAngle : null,
    lat,
    lon,
  };
}

/** Devices at exactly this coordinate, deduped by id (tile-border copies),
 *  non-component devices first so a pole's sensor leads its compute box. */
export function groupDevicesAtCoordinate(records: FlockDeviceRecord[], lat: number, lon: number): FlockDeviceRecord[] {
  const seen = new Set<number>();
  const out: FlockDeviceRecord[] = [];
  for (const r of records) {
    if (r.lat !== lat || r.lon !== lon || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  const lead = out.filter((r) => r.g !== 7);
  const rest = out.filter((r) => r.g === 7);
  return [...lead, ...rest];
}

/** Among records already within the click box, the exact coordinate nearest
 *  the click. Stacks and near neighbours share render pixels at z14, so the
 *  topmost feature is not what the user tapped; the nearest coordinate is. */
export function nearestCoordinateGroup(
  records: FlockDeviceRecord[],
  clickLat: number,
  clickLon: number
): { lat: number; lon: number } | null {
  const cosLat = Math.cos((clickLat * Math.PI) / 180);
  let best: { lat: number; lon: number; d2: number } | null = null;
  const seen = new Set<string>();
  for (const r of records) {
    const key = `${r.lat},${r.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dLat = r.lat - clickLat;
    const dLon = (r.lon - clickLon) * cosLat;
    const d2 = dLat * dLat + dLon * dLon;
    if (!best || d2 < best.d2) best = { lat: r.lat, lon: r.lon, d2 };
  }
  return best ? { lat: best.lat, lon: best.lon } : null;
}

/** "2 Drone Dock · 2 Picard", in order of first appearance. */
export function typeCountLine(records: FlockDeviceRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    const label = flockTypeLabel(r.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(' · ');
}
