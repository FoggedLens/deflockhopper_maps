import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Canonical device types and statuses for the leaked Flock inventory.
 *
 * The tiles carry Flock's own labels. The same ordered keyword table drives
 * the JS normalizer (popups, counts) and the MapLibre expressions (layer
 * filters, icon selection), so the two can never disagree. Extend the
 * keyword lists from the real vocabulary once the first tile build exists;
 * anything unmatched renders as `other` / `unknown`, never disappears.
 */
export type FlockDeviceType = 'alpr' | 'condor' | 'raven' | 'drone' | 'other';
export type FlockDeviceStatus = 'active' | 'planned' | 'decommissioned' | 'unknown';

export const FLOCK_TYPES: readonly FlockDeviceType[] = ['alpr', 'condor', 'raven', 'drone', 'other'];
export const FLOCK_SELECTABLE_TYPES: readonly FlockDeviceType[] = ['alpr', 'condor', 'raven', 'drone'];
export const FLOCK_STATUSES: readonly FlockDeviceStatus[] = ['active', 'planned', 'decommissioned', 'unknown'];
export const FLOCK_SELECTABLE_STATUSES: readonly FlockDeviceStatus[] = ['active', 'planned', 'decommissioned'];

export const FLOCK_TYPE_LABEL: Record<FlockDeviceType, string> = {
  alpr: 'ALPR',
  condor: 'Condor',
  raven: 'Raven',
  drone: 'Drone',
  other: 'Other',
};

export const FLOCK_TYPE_LONG_LABEL: Record<FlockDeviceType, string> = {
  alpr: 'License plate reader',
  condor: 'PTZ video camera',
  raven: 'Audio detection',
  drone: 'Drone dock',
  other: 'Other device',
};

export const FLOCK_STATUS_LABEL: Record<FlockDeviceStatus, string> = {
  active: 'Active',
  planned: 'Planned',
  decommissioned: 'Decommissioned',
  unknown: 'Status unknown',
};

type Rules<T extends string> = ReadonlyArray<readonly [T, readonly string[]]>;

/** Ordered: first match wins. `drone` before `alpr` so "Falcon drone dock"
 *  is a dock; `decommissioned` before `active` so "inactive" is not active. */
export const FLOCK_TYPE_RULES: Rules<FlockDeviceType> = [
  ['drone', ['drone', 'dock', 'aerodome']],
  ['raven', ['raven', 'audio', 'gunshot']],
  ['condor', ['condor', 'ptz', 'video']],
  ['alpr', ['falcon', 'sparrow', 'lpr', 'plate', 'alpr']],
];

export const FLOCK_STATUS_RULES: Rules<FlockDeviceStatus> = [
  ['decommissioned', ['decom', 'remov', 'retire', 'inactive', 'offline']],
  ['planned', ['plan', 'pending', 'propos', 'schedul']],
  ['active', ['active', 'live', 'online', 'installed', 'deployed']],
];

function matchRules<T extends string>(raw: unknown, rules: Rules<T>, fallback: T): T {
  const lower = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!lower) return fallback;
  for (const [canonical, keywords] of rules) {
    if (keywords.some((k) => lower.includes(k))) return canonical;
  }
  return fallback;
}

export const normalizeFlockType = (raw: unknown): FlockDeviceType =>
  matchRules(raw, FLOCK_TYPE_RULES, 'other');

export const normalizeFlockStatus = (raw: unknown): FlockDeviceStatus =>
  matchRules(raw, FLOCK_STATUS_RULES, 'unknown');

/** Same table as a MapLibre expression: `['case', anyKeywordOf(rule) , canonical, ..., fallback]`. */
function rulesExpression<T extends string>(property: string, rules: Rules<T>, fallback: T): ExpressionSpecification {
  const lower = ['downcase', ['to-string', ['coalesce', ['get', property], '']]];
  const branches: unknown[] = [];
  for (const [canonical, keywords] of rules) {
    branches.push(['any', ...keywords.map((k) => ['in', k, lower])], canonical);
  }
  return ['case', ...branches, fallback] as unknown as ExpressionSpecification;
}

export const flockTypeExpression = (): ExpressionSpecification =>
  rulesExpression('type', FLOCK_TYPE_RULES, 'other');

export const flockStatusExpression = (): ExpressionSpecification =>
  rulesExpression('status', FLOCK_STATUS_RULES, 'unknown');

function sumInto<T extends string>(
  keys: readonly T[],
  raw: Record<string, number> | undefined,
  normalize: (v: string) => T
): Record<T, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
  if (!raw) return out;
  for (const [label, n] of Object.entries(raw)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    out[normalize(label)] += n;
  }
  return out;
}

/** Sum TileJSON `stats.byType` (raw labels) into canonical buckets. */
export const canonicalTypeCounts = (byType?: Record<string, number>): Record<FlockDeviceType, number> =>
  sumInto(FLOCK_TYPES, byType, normalizeFlockType);

export const canonicalStatusCounts = (byStatus?: Record<string, number>): Record<FlockDeviceStatus, number> =>
  sumInto(FLOCK_STATUSES, byStatus, normalizeFlockStatus);
