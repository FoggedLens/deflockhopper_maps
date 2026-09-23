import { describe, it, expect } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import {
  normalizeFlockType,
  normalizeFlockStatus,
  flockTypeExpression,
  flockStatusExpression,
  canonicalTypeCounts,
  canonicalStatusCounts,
  FLOCK_TYPES,
} from './flockTypeNormalization';

/** Evaluate a style expression against a point feature with these properties. */
function evaluate(expr: unknown, properties: Record<string, unknown>): unknown {
  const parsed = createExpression(expr as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 10 }, { type: 1, properties, geometry: null } as never);
}

describe('normalizeFlockType', () => {
  it('maps Flock product names to canonical types', () => {
    expect(normalizeFlockType('Falcon')).toBe('alpr');
    expect(normalizeFlockType('Falcon LPR')).toBe('alpr');
    expect(normalizeFlockType('Sparrow')).toBe('alpr');
    expect(normalizeFlockType('Condor PTZ')).toBe('condor');
    expect(normalizeFlockType('Raven Audio')).toBe('raven');
    expect(normalizeFlockType('Drone Dock')).toBe('drone');
    expect(normalizeFlockType('Aerodome')).toBe('drone');
  });

  it('is case-insensitive', () => {
    expect(normalizeFlockType('FALCON')).toBe('alpr');
    expect(normalizeFlockType('condor')).toBe('condor');
  });

  it('never drops a device: unknown, empty, and missing become other', () => {
    expect(normalizeFlockType('Widget 9000')).toBe('other');
    expect(normalizeFlockType('')).toBe('other');
    expect(normalizeFlockType(undefined)).toBe('other');
    expect(normalizeFlockType(null)).toBe('other');
    expect(normalizeFlockType(42)).toBe('other');
  });
});

describe('normalizeFlockStatus', () => {
  it('maps status labels', () => {
    expect(normalizeFlockStatus('Active')).toBe('active');
    expect(normalizeFlockStatus('Online')).toBe('active');
    expect(normalizeFlockStatus('Planned')).toBe('planned');
    expect(normalizeFlockStatus('Pending Install')).toBe('planned');
    expect(normalizeFlockStatus('Decommissioned')).toBe('decommissioned');
    expect(normalizeFlockStatus('Removed')).toBe('decommissioned');
  });

  it('treats inactive as decommissioned, not active', () => {
    expect(normalizeFlockStatus('Inactive')).toBe('decommissioned');
  });

  it('falls back to unknown', () => {
    expect(normalizeFlockStatus('')).toBe('unknown');
    expect(normalizeFlockStatus(undefined)).toBe('unknown');
    expect(normalizeFlockStatus('???')).toBe('unknown');
  });
});

describe('map expressions agree with the JS normalizers', () => {
  const rawTypes = ['Falcon', 'Falcon LPR', 'Sparrow', 'Condor PTZ', 'Raven Audio', 'Drone Dock', 'Widget', '', 'INACTIVE'];
  it.each(rawTypes)('type %s', (raw) => {
    expect(evaluate(flockTypeExpression(), { type: raw })).toBe(normalizeFlockType(raw));
  });

  it('type expression handles a missing property', () => {
    expect(evaluate(flockTypeExpression(), {})).toBe('other');
  });

  const rawStatuses = ['Active', 'Online', 'Planned', 'Pending Install', 'Decommissioned', 'Removed', 'Inactive', '', 'zzz'];
  it.each(rawStatuses)('status %s', (raw) => {
    expect(evaluate(flockStatusExpression(), { status: raw })).toBe(normalizeFlockStatus(raw));
  });

  it('status expression handles a missing property', () => {
    expect(evaluate(flockStatusExpression(), {})).toBe('unknown');
  });
});

describe('canonical counts', () => {
  it('sums raw labels into canonical buckets and zero-fills', () => {
    const counts = canonicalTypeCounts({ Falcon: 10, 'Falcon LPR': 5, Condor: 2, Mystery: 1 });
    expect(counts).toEqual({ alpr: 15, condor: 2, raven: 0, drone: 0, other: 1 });
    for (const t of FLOCK_TYPES) expect(typeof counts[t]).toBe('number');
  });

  it('returns zeros when stats are absent', () => {
    expect(canonicalTypeCounts(undefined)).toEqual({ alpr: 0, condor: 0, raven: 0, drone: 0, other: 0 });
    expect(canonicalStatusCounts(undefined)).toEqual({ active: 0, planned: 0, decommissioned: 0, unknown: 0 });
  });

  it('sums statuses', () => {
    expect(canonicalStatusCounts({ Active: 3, Inactive: 1, Planned: 2 })).toEqual({
      active: 3, planned: 2, decommissioned: 1, unknown: 0,
    });
  });
});
