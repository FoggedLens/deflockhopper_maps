import { useDelayedFlag } from '@/hooks/useDelayedFlag';

/** Shared shell for pills floating over the map: bottom-center, above the
 *  mobile drawer via --drawer-height. Also imported by LoadingPill. */
export const PILL_BASE =
  'absolute bottom-[calc(var(--drawer-height,80px)+var(--swipe-track-height,0px)+12px)] lg:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 ' +
  'bg-dark-800/95 backdrop-blur rounded-full pl-3 pr-4 py-2 text-sm text-dark-100 whitespace-nowrap';

interface StatusPillProps {
  loading: boolean;
  text: string;
  /** Optional trailing progress, e.g. "42%" or "2.1 MB" */
  progressText?: string | null;
  /** When set, renders the error variant (wins over loading) */
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Generic loading/error pill for mode data downloads (Network).
 * Delayed appearance so fast loads never flash a spinner; error state is a
 * tap-to-retry button matching the camera LoadingPill's treatment.
 */
export function StatusPill({ loading, text, progressText, error, onRetry }: StatusPillProps) {
  const show = useDelayedFlag(loading);

  if (error) {
    return (
      <button
        role="status"
        onClick={onRetry}
        className={`${PILL_BASE} border border-danger/40 hover:border-danger transition-colors`}
      >
        <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
        {error}
      </button>
    );
  }

  if (!show) return null;

  return (
    <div className={`${PILL_BASE} border border-hairline`} role="status" aria-live="polite">
      <span className="w-3.5 h-3.5 border-2 border-dark-600 border-t-accent rounded-full animate-spin shrink-0" />
      {text}
      {progressText && (
        <span className="text-xs text-dark-300 tabular-nums">{progressText}</span>
      )}
    </div>
  );
}
