import { useRef, type KeyboardEvent } from 'react';
import { useFlockLeakStore, type FlockLeakView } from '../../store/flockLeakStore';
import { BothMark, FlockLensMark } from './FlockLeakMarks';

/** The two views, each with the plate-reader mark it draws. Labels live in
 *  the control (the panel copy table would be a circular import); the marks
 *  are the map's own. */
const VIEWS: ReadonlyArray<{ view: FlockLeakView; label: string; mark: JSX.Element }> = [
  { view: 'flock', label: "Flock's records", mark: <FlockLensMark size={16} /> },
  { view: 'overlay', label: 'Compare with OSM', mark: <BothMark size={16} /> },
];

/**
 * The Leak tab's view picker: Flock's records alone, or with the OSM cameras
 * laid underneath. A segmented control rather than a switch (approved
 * 2026-09-25): comparing changes what the marks mean and seeds both sides'
 * filters, so it reads as a view of the same map, and both states are
 * visible before anyone clicks. Selection shows by contrast, not color:
 * blue on this tab means OSM cameras. Leads the desktop panel, the mobile
 * sheet and the mobile peek. The whole control is 44 px on mobile (36 px
 * segments plus the container's padding and border): the peek has no slack
 * below the identity row, so anything taller is clipped at the sheet's edge.
 */
export function FlockCompareControl({ className = '' }: { className?: string }) {
  const view = useFlockLeakStore((s) => s.view);
  const setView = useFlockLeakStore((s) => s.setView);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  // Radio-group keys: arrows move the selection and focus together.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = VIEWS.findIndex((v) => v.view === view);
    const next = VIEWS[(i + dir + VIEWS.length) % VIEWS.length];
    setView(next.view);
    buttons.current[VIEWS.indexOf(next)]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Map view"
      onKeyDown={onKeyDown}
      className={`grid grid-cols-2 gap-0.5 p-[3px] rounded-[9px] border border-hairline bg-white/[0.02] ${className}`}
    >
      {VIEWS.map((v, i) => {
        const selected = v.view === view;
        return (
          <button
            key={v.view}
            ref={(el) => { buttons.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setView(v.view)}
            className={`flex items-center justify-center gap-2 min-h-9 lg:min-h-[34px] px-2 rounded-md text-[13px] font-medium transition-colors ${
              selected ? 'bg-white/[0.10] text-white' : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            {v.mark}
            <span className="truncate">{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}
