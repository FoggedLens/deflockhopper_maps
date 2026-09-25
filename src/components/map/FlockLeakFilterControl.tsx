import { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlockLeakStore, activeFlockFilterCount } from '../../store/flockLeakStore';
import { FlockFilterChips } from './FlockFilterChips';

/** Flock device filters: a button in the left control column (the country
 *  switch's slot, hidden on this tab) opening device type and status chips.
 *  Same popover idiom as BoundaryControl. Leak mode only.
 *  Captioned "Flock" because while comparing it sits above the OSM filter
 *  button, captioned "OSM": each says which side of the compare it narrows.
 *  In Flock's records view the OSM button is hidden, so this one and the
 *  Legend drop one slot (map-flock-slot-down) instead of leaving a hole. */
export function FlockLeakFilterControl() {
  const appMode = useAppModeStore((s) => s.appMode);
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const slotDown = useFlockLeakStore((s) => s.view === 'flock');
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const badge = activeFlockFilterCount({ groups, statuses });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (appMode !== 'leak') return null;

  // Open, the control stacks above its sibling map buttons: they share
  // z-10, so a later sibling would otherwise paint over this popover.
  return (
    <div ref={panelRef} className={`map-flock-filter-control ${slotDown ? 'map-flock-slot-down' : ''} absolute ${open ? 'z-20' : 'z-10'} flex flex-col items-start`}>
      {open && (
        <div className="absolute z-10 bottom-full left-0 mb-3 w-72 bg-dark-800 rounded-md border border-dark-600 shadow-xl shadow-black/40">
          <div className="px-3 py-2 border-b border-dark-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Filter Flock&apos;s records</span>
          </div>
          <div className="p-3">
            <FlockFilterChips />
            <p className="mt-3 pt-3 border-t border-dark-600 text-[11px] text-dark-500 leading-snug">
              Type and status are Flock&apos;s own labels, as of Dec 14, 2025.
            </p>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Flock device filters"
        aria-expanded={open}
        title="Flock device filters"
        className={`filter-trigger relative z-0 w-[40px] h-[40px] flex items-center justify-center rounded-md transition-colors
          bg-dark-800 border border-dark-600
          ${open || badge > 0 ? 'text-danger' : 'text-dark-300 hover:bg-dark-700'}`}
      >
        <span className="flex flex-col items-center gap-0.5 leading-none">
          <Filter className="w-4 h-4" />
          <span className="text-[8px] font-semibold uppercase tracking-wide">Flock</span>
        </span>
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center tabular-nums border-2 border-dark-900">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
