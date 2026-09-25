import { useState, useRef, useEffect } from 'react';
import { Shapes } from 'lucide-react';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_DEVICE_CLASSES,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_STATUS_LABEL,
  type FlockGroup,
  type FlockStatus,
} from '../../lib/flockInventory';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';
import { FlockGroupMark, FlockLensMark, FlockPlannedMark, FlockRingMark } from './FlockLeakMarks';

function StatusMark({ s, hollow }: { s: FlockStatus; hollow: boolean }) {
  if (s === 2) return <FlockPlannedMark size={16} open={hollow} />;
  if (hollow) return <span className={s === 3 ? 'opacity-35' : undefined}><FlockRingMark size={16} /></span>;
  return <FlockLensMark size={16} dimmed={s === 3} />;
}

/**
 * The Flock marks' legend, behind a button in the left control column (the
 * Map tab's layers slot, unused here), opening like the filter popovers.
 * The list never changes length: every device type and status is always
 * listed, drawn in the map's current mark style, and the ones the filters
 * hide are dimmed. How to read the OSM comparison lives with its switch in
 * the side panel, so nothing here repeats it.
 */
export function FlockLegendControl() {
  const appMode = useAppModeStore((s) => s.appMode);
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const compare = useFlockLeakStore((s) => s.view === 'overlay');
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (appMode !== 'leak') return null;

  const classShown = (gs: readonly FlockGroup[]) => groups.length === 0 || gs.some((g) => groups.includes(g));
  const anyHidden = FLOCK_DEVICE_CLASSES.some((c) => !classShown(c.groups))
    || FLOCK_SELECTABLE_STATUSES.some((s) => !statuses.includes(s));

  return (
    <div ref={panelRef} className="map-flock-legend-control absolute z-10 flex flex-col items-start">
      {open && (
        <section
          aria-label="Legend"
          className="absolute z-10 bottom-full left-0 mb-3 w-72 bg-dark-800 rounded-md border border-dark-600 shadow-xl shadow-black/40 text-xs"
        >
          <div className="px-3 py-2 border-b border-dark-600 flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Flock&apos;s records</span>
            <span className="text-dark-500">{FLOCK_LEAK_SNAPSHOT_LABEL}</span>
          </div>
          <div className="p-3">
            <ul className="space-y-2" aria-label="Device type">
              {FLOCK_DEVICE_CLASSES.map((c) => (
                <li key={c.key} className={`flex items-center gap-2.5 text-dark-200 ${classShown(c.groups) ? '' : 'opacity-35'}`}>
                  <FlockGroupMark g={c.groups[0]} hollow={compare} size={16} />
                  {c.label}
                </li>
              ))}
            </ul>
            <ul className="mt-3 pt-3 border-t border-dark-600 space-y-2" aria-label="Status">
              {FLOCK_SELECTABLE_STATUSES.map((s) => (
                <li key={s} className={`flex items-center gap-2.5 text-dark-200 ${statuses.includes(s) ? '' : 'opacity-35'}`}>
                  <StatusMark s={s} hollow={compare} />
                  {FLOCK_STATUS_LABEL[s]}
                </li>
              ))}
            </ul>
            {anyHidden && (
              <p className="mt-3 text-[11px] text-dark-500 leading-snug">Dimmed entries are hidden by the Flock filter.</p>
            )}
          </div>
        </section>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Legend"
        aria-expanded={open}
        title="Legend"
        className={`relative z-0 w-[40px] h-[40px] flex items-center justify-center rounded-md transition-colors
          bg-dark-800 border border-dark-600
          ${open ? 'text-white bg-dark-700' : 'text-dark-300 hover:bg-dark-700'}`}
      >
        <span className="flex flex-col items-center gap-0.5 leading-none">
          <Shapes className="w-4 h-4" />
          <span className="text-[8px] font-semibold uppercase tracking-wide">Legend</span>
        </span>
      </button>
    </div>
  );
}
