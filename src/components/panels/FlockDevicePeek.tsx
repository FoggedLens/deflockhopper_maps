import { ChevronUp, X } from 'lucide-react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { flockSelectionSummary } from '../../utils/flockSelectionSummary';

/**
 * The tapped Flock device at the mobile peek, in place of the tab's
 * identity row (the Network tab's selected-agency idiom): type, group and
 * status, name, then the date or the nearby-OSM hint. The text opens the
 * sheet, where the full record leads; ✕ clears. No outbound links here
 * (user's call, 2026-09-25). Fits UNIFORM_PEEK_HEIGHT; never grow it.
 */
export function FlockDevicePeek({ onExpand }: { onExpand: () => void }) {
  const sel = useFlockLeakStore((s) => s.selection);
  const view = useFlockLeakStore((s) => s.view);
  const setSelection = useFlockLeakStore((s) => s.setSelection);
  if (!sel) return null;
  const s = flockSelectionSummary(sel, view);

  return (
    <div className="mt-2 animate-fade-in">
      <div className="flex items-start gap-3">
        <button
          onClick={onExpand}
          className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
          aria-label={`${s.title}. Open details`}
        >
          <p className="flex items-baseline gap-2 min-w-0">
            <span className="flex-shrink-0 text-[15px] font-display font-semibold text-white leading-snug">{s.title}</span>
            {s.meta && <span className="min-w-0 truncate text-xs text-dark-400">{s.meta}</span>}
          </p>
          {s.primary && <p className="mt-0.5 text-[13px] text-dark-200 truncate">{s.primary}</p>}
          {s.secondary && (
            <p className={`mt-1 text-xs truncate ${s.secondaryIsHint ? 'text-[#93CBFF]' : 'text-dark-500'}`}>{s.secondary}</p>
          )}
        </button>
        <button
          onClick={() => setSelection(null)}
          className="flex-shrink-0 w-11 h-8 -mr-2 rounded-lg flex items-center justify-center text-dark-400 active:text-dark-200 transition-colors"
          aria-label="Clear selected device"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <button
        onClick={onExpand}
        className="mt-2 w-full flex items-center justify-center gap-1 text-dark-400 active:text-dark-200 transition-colors"
      >
        <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-[11px] font-medium">Swipe up for details</span>
      </button>
    </div>
  );
}
