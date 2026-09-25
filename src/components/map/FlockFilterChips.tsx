import type { ReactNode } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_DEVICE_CLASSES,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_STATUS_LABEL,
  cleanPointsFor,
  type FlockStatus,
} from '../../lib/flockInventory';
import { FlockGroupMark, FlockLensMark, FlockPlannedMark } from './FlockLeakMarks';

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

/** Device type and status chips. Each carries its map mark; counts follow
 *  the status selection, so a chip says how many points the map draws. */
export function FlockFilterChips({ showCounts = false }: { showCounts?: boolean }) {
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const toggleGroups = useFlockLeakStore((s) => s.toggleGroups);
  const clearGroups = useFlockLeakStore((s) => s.clearGroups);
  const toggleStatus = useFlockLeakStore((s) => s.toggleStatus);

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Device type">
        <p className="text-xs text-dark-400 mb-2">Device type</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={groups.length === 0} onClick={clearGroups}>All</Chip>
          {FLOCK_DEVICE_CLASSES.map((c) => (
            <Chip
              key={c.key}
              on={c.groups.every((g) => groups.includes(g))}
              onClick={() => toggleGroups(c.groups)}
              count={showCounts ? cleanPointsFor(c.groups, statuses) : undefined}
            >
              <FlockGroupMark g={c.groups[0]} size={14} />
              {c.short}
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
    </div>
  );
}
