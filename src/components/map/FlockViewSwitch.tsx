import { useFlockLeakStore, type FlockLeakView } from '../../store/flockLeakStore';

const VIEWS: Array<{ id: FlockLeakView; label: string }> = [
  { id: 'flock', label: 'Flock' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'overlay', label: 'Overlay' },
];

/** Flock / Swipe / Overlay. The one control the mobile peek carries. */
export function FlockViewSwitch({ className = '' }: { className?: string }) {
  const view = useFlockLeakStore((s) => s.view);
  const setView = useFlockLeakStore((s) => s.setView);
  return (
    <div
      role="tablist"
      aria-label="Compare view"
      className={`flex rounded-md border border-hairline overflow-hidden text-xs font-semibold ${className}`}
    >
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          onClick={() => setView(v.id)}
          className={`flex-1 px-3 py-2 min-h-9 transition-colors ${
            view === v.id ? 'bg-accent text-white' : 'text-dark-400 hover:text-white active:text-white'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
