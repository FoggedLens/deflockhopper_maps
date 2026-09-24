import type { ReactNode } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_SELECTABLE_GROUPS,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_GROUP_SHORT,
  FLOCK_STATUS_LABEL,
  FLOCK_INVENTORY,
  cleanPointsFor,
  type FlockGroup,
  type FlockStatus,
} from '../../lib/flockInventory';
import { FLOCK_GROUP_COLOR, FLOCK_GROUP_SHAPE } from './layers/flockLeakIcons';
import { FLOCK_COMPARE_COLOR } from './layers/flockCompareStyle';
import { FlockLensMark, FlockPlannedMark } from './FlockLeakMarks';
import { Switch } from './FlockCompareToggle';

/** Legend and chip swatch: the same shape language as the map icons. */
export function GroupSwatch({ g, size = 8 }: { g: FlockGroup; size?: number }) {
  const color = FLOCK_GROUP_COLOR[g];
  const base = { width: size, height: size, display: 'inline-block', flexShrink: 0 } as const;
  switch (FLOCK_GROUP_SHAPE[g]) {
    case 'lens':
      return <i style={{ ...base, background: FLOCK_COMPARE_COLOR.core, border: `1.5px solid ${FLOCK_COMPARE_COLOR.ring}`, borderRadius: '50%', boxSizing: 'border-box' }} aria-hidden="true" />;
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
      className={`flex items-center gap-1.5 min-h-8 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
        on ? 'border-white/40 bg-white/[0.06] text-white' : 'border-hairline text-dark-400 hover:text-dark-200'
      }`}
    >
      {children}
      {count !== undefined && <span className="text-2xs text-dark-500 tabular-nums">{count.toLocaleString()}</span>}
    </button>
  );
}

/** The map mark for each lifecycle status, so the chips double as the key. */
const STATUS_MARK: Record<FlockStatus, ReactNode> = {
  1: <FlockLensMark size={14} />,
  2: <FlockPlannedMark size={14} />,
  3: <FlockLensMark size={14} dimmed />,
  4: null,
};

const SUSPECT_COUNT = FLOCK_INVENTORY.devicesFlagged.toLocaleString();

/** Device group and status chips (they are also the legend: each carries its
 *  map mark) and the suspect-records switch. Counts follow the status
 *  selection, so a chip says what the map is drawing. */
export function FlockFilterChips({ showCounts = false }: { showCounts?: boolean }) {
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const showSuspect = useFlockLeakStore((s) => s.showSuspect);
  const toggleGroup = useFlockLeakStore((s) => s.toggleGroup);
  const clearGroups = useFlockLeakStore((s) => s.clearGroups);
  const toggleStatus = useFlockLeakStore((s) => s.toggleStatus);
  const setShowSuspect = useFlockLeakStore((s) => s.setShowSuspect);

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Device type">
        <p className="text-xs text-dark-400 mb-2">Device type</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={groups.length === 0} onClick={clearGroups}>All</Chip>
          {FLOCK_SELECTABLE_GROUPS.map((g) => (
            <Chip key={g} on={groups.includes(g)} onClick={() => toggleGroup(g)} count={showCounts ? cleanPointsFor(g, statuses) : undefined}>
              <GroupSwatch g={g} />
              {FLOCK_GROUP_SHORT[g]}
            </Chip>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Status">
        <p className="text-xs text-dark-400 mb-2">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {FLOCK_SELECTABLE_STATUSES.map((s) => (
            <Chip key={s} on={statuses.includes(s)} onClick={() => toggleStatus(s)}>
              {STATUS_MARK[s]}
              {FLOCK_STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <button
          type="button"
          role="switch"
          aria-checked={showSuspect}
          onClick={() => setShowSuspect(!showSuspect)}
          className="w-full min-h-9 flex items-center justify-between gap-3 text-left"
        >
          <span className="text-xs text-dark-200">Show suspect records</span>
          <Switch on={showSuspect} />
        </button>
        <p className="mt-1 text-xs text-dark-500 leading-relaxed">
          {SUSPECT_COUNT} records are hidden by default: unknown status, factory test units, placeholder
          locations that stack many devices on one point, and positions outside North America.
        </p>
      </div>
    </div>
  );
}
