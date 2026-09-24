import { useFlockLeakStore } from '../../store/flockLeakStore';
import { OsmDotMark } from './FlockLeakMarks';

/**
 * Turns the OSM cameras on under Flock's records (the Overlay view). The
 * one control the mobile peek carries. Comparing is a second layer, not a
 * different mode, so it is a switch rather than a set of tabs.
 */
export function FlockCompareToggle({ className = '' }: { className?: string }) {
  const on = useFlockLeakStore((s) => s.view === 'overlay');
  const setView = useFlockLeakStore((s) => s.setView);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setView(on ? 'flock' : 'overlay')}
      className={`w-full min-h-11 flex items-center gap-3 px-3 rounded-md border transition-colors ${
        on ? 'border-[#2196E8]/50 bg-[#2196E8]/[0.08]' : 'border-hairline active:bg-white/[0.04]'
      } ${className}`}
    >
      <OsmDotMark />
      <span className="flex-1 text-left text-sm text-white">Compare with OSM cameras</span>
      <Switch on={on} />
    </button>
  );
}

/** The visual half of a switch; the caller owns the role and the click. */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block w-9 h-5 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-accent' : 'bg-dark-600'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </span>
  );
}
