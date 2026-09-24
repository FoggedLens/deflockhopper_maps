import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';

/**
 * Swipe view controls, rendered over the map area. The divider line and the
 * range input follow the store without React commits (direct DOM writes from
 * a store subscription). On touch the line is not grabbable, so it never
 * fights the pan; the track above the drawer moves it. On desktop the line
 * also carries a grab handle.
 */
export function SwipeTrack() {
  const view = useFlockLeakStore((s) => s.view);
  const setDivider = useFlockLeakStore((s) => s.setDivider);
  const isMobile = useIsMobile();
  const lineRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view !== 'swipe') return;
    const paint = (d: number) => {
      if (lineRef.current) lineRef.current.style.left = `${d * 100}%`;
      const input = inputRef.current;
      if (input) {
        input.style.setProperty('--swipe-pct', `${d * 100}%`);
        if (document.activeElement !== input) input.value = String(Math.round(d * 1000));
      }
    };
    paint(useFlockLeakStore.getState().divider);
    return useFlockLeakStore.subscribe((s, prev) => {
      if (s.divider !== prev.divider) paint(s.divider);
    });
  }, [view]);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const host = lineRef.current?.parentElement;
    if (!host) return;
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => setDivider((ev.clientX - rect.left) / rect.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (view !== 'swipe') return null;

  return (
    <>
      <div
        ref={lineRef}
        className="swipe-divider absolute top-0 bottom-0 z-20 w-px bg-white/85 shadow-[0_0_8px_rgba(0,0,0,0.8)] pointer-events-none"
        style={{ left: '50%' }}
        aria-hidden="true"
      >
        {!isMobile && (
          <button
            type="button"
            aria-label="Drag to compare"
            onPointerDown={onHandlePointerDown}
            className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white text-dark-900 shadow-lg shadow-black/60 flex items-center justify-center cursor-ew-resize"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 7l-5 5 5 5V7zm8 0v10l5-5-5-5z" />
            </svg>
          </button>
        )}
      </div>
      <div className="swipe-chip swipe-chip-osm">OSM · live</div>
      <div className="swipe-chip swipe-chip-flock">Flock · {FLOCK_LEAK_SNAPSHOT_LABEL}</div>
      <div className="swipe-track">
        <span className="swipe-track-label text-[#93CBFF]">OSM</span>
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={1000}
          defaultValue={500}
          aria-label="Compare divider"
          onInput={(e) => setDivider(Number(e.currentTarget.value) / 1000)}
          className="swipe-range"
        />
        <span className="swipe-track-label text-right text-[#fca5a5]">Flock</span>
      </div>
    </>
  );
}
