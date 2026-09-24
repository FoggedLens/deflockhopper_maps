import type { ReactNode } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_SELECTABLE_GROUPS,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_GROUP_SHORT,
  FLOCK_STATUS_LABEL,
  FLOCK_INVENTORY,
  type FlockGroup,
} from '../../lib/flockInventory';
import { FLOCK_GROUP_COLOR, FLOCK_GROUP_SHAPE } from './layers/flockLeakIcons';

/** Legend and chip swatch: the same shape language as the map icons. */
export function GroupSwatch({ g, size = 8 }: { g: FlockGroup; size?: number }) {
  const color = FLOCK_GROUP_COLOR[g];
  const base = { width: size, height: size, display: 'inline-block', flexShrink: 0 } as const;
  switch (FLOCK_GROUP_SHAPE[g]) {
    case 'square':
      return <i style={{ ...base, background: color, borderRadius: 1 }} aria-hidden="true" />;
    case 'diamond':
      return <i style={{ ...base, background: color, transform: 'rotate(45deg) scale(0.85)' }} aria-hidden="true" />;
    case 'hollow-square':
      return <i style={{ ...base, border: `2px solid ${color}`, boxSizing: 'border-box' }} aria-hidden="true" />;
    case 'ring':
      return <i style={{ ...base, border: `2px solid ${color}`, borderRadius: '50%', boxSizing: 'border-box' }} aria-hidden="true" />;
    case 'triangle':
      return (
        <i
          style={{ ...base, width: 0, height: 0, borderLeft: `${size / 2}px solid transparent`, borderRight: `${size / 2}px solid transparent`, borderBottom: `${size}px solid ${color}` }}
          aria-hidden="true"
        />
      );
    case 'pill':
      return <i style={{ ...base, width: size * 1.6, height: size * 0.7, background: color, borderRadius: size }} aria-hidden="true" />;
    case 'cross':
      return <i style={{ ...base, color, fontSize: size * 1.4, lineHeight: `${size}px`, width: 'auto' }} aria-hidden="true">×</i>;
    default:
      return <i style={{ ...base, background: color, borderRadius: '50%' }} aria-hidden="true" />;
  }
}

function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
        on ? 'border-white/40 bg-white/[0.06] text-white' : 'border-hairline text-dark-400 hover:text-dark-200'
      }`}
    >
      {children}
      {count !== undefined && <span className="text-2xs text-dark-500 tabular-nums">{count.toLocaleString()}</span>}
    </button>
  );
}

/** Clean national points in the group across the three lifecycle statuses. */
const groupTotal = (g: FlockGroup): number | undefined => {
  const row = FLOCK_INVENTORY.cleanByGroup[g as Exclude<FlockGroup, 8>];
  return row ? row[0] + row[1] + row[2] : undefined;
};

export function FlockFilterChips({ showCounts = false }: { showCounts?: boolean }) {
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const toggleGroup = useFlockLeakStore((s) => s.toggleGroup);
  const clearGroups = useFlockLeakStore((s) => s.clearGroups);
  const toggleStatus = useFlockLeakStore((s) => s.toggleStatus);
  const setShowSuspect = useFlockLeakStore((s) => s.setShowSuspect);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-2xs uppercase text-dark-500 mb-1.5">Device group</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={groups.length === 0} onClick={clearGroups}>All</Chip>
          {FLOCK_SELECTABLE_GROUPS.map((g) => (
            <Chip key={g} on={groups.includes(g)} onClick={() => toggleGroup(g)} count={showCounts ? groupTotal(g) : undefined}>
              <GroupSwatch g={g} />
              {FLOCK_GROUP_SHORT[g]}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <p className="text-2xs uppercase text-dark-500 mb-1.5">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {FLOCK_SELECTABLE_STATUSES.map((s) => (
            <Chip key={s} on={statuses.includes(s)} onClick={() => toggleStatus(s)}>
              {FLOCK_STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={showSuspect}
        onClick={() => setShowSuspect(!showSuspect)}
        className="w-full flex items-center justify-between py-1.5 text-left"
      >
        <span className="text-xs text-dark-300">Show suspect records</span>
        <span className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${showSuspect ? 'bg-danger' : 'bg-dark-600'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showSuspect ? 'translate-x-4' : 'translate-x-0'}`} />
        </span>
      </button>
      <p className="text-[11px] text-dark-500 leading-snug">
        Suspect records: unknown status, factory fixtures, placeholder locations with many devices on one point, and devices outside North America.
      </p>
    </div>
  );
}
