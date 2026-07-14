import { ReactNode, useEffect, useCallback, useRef, useState } from 'react';

export type SnapPoint = 'minimized' | 'peek' | 'full';

interface BottomSheetProps {
  children: ReactNode;
  snapPoint?: SnapPoint;
  onSnapPointChange?: (snapPoint: SnapPoint) => void;
  /** Content to show in the drag header area (visible in minimized/peek states) */
  headerContent?: ReactNode;
  /** When true, tapping the header does NOT toggle the sheet (drag still works) */
  disableHeaderTap?: boolean;
  minimizedHeight?: number;
  peekHeight?: number;
  fullHeight?: number;
}

// Default heights
const DEFAULT_MINIMIZED_HEIGHT = 72; // px - just the header
const DEFAULT_PEEK_HEIGHT = 220; // px - shows route summary
const DEFAULT_FULL_HEIGHT = 85; // vh percentage

const EASE_OUT_QUART = 'cubic-bezier(0.25, 1, 0.5, 1)';

export function BottomSheet({
  children,
  snapPoint = 'minimized',
  onSnapPointChange,
  headerContent,
  disableHeaderTap = false,
  minimizedHeight = DEFAULT_MINIMIZED_HEIGHT,
  peekHeight = DEFAULT_PEEK_HEIGHT,
  fullHeight = DEFAULT_FULL_HEIGHT,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Height managed as inline style; null means "let CSS handle it" (post-snap)
  const [currentHeight, setCurrentHeight] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const getSnapPointHeight = useCallback((point: SnapPoint): number => {
    const vh = window.innerHeight;
    switch (point) {
      case 'minimized': return minimizedHeight;
      case 'peek':      return peekHeight;
      case 'full':      return (fullHeight / 100) * vh;
    }
  }, [minimizedHeight, peekHeight, fullHeight]);

  // Snap to a point with CSS transition
  const snapTo = useCallback((point: SnapPoint, notify = true) => {
    const target = getSnapPointHeight(point);
    setCurrentHeight(target);
    setIsAnimating(true);
    if (notify) onSnapPointChange?.(point);
  }, [getSnapPointHeight, onSnapPointChange]);

  // Sync externally-controlled snapPoint
  useEffect(() => {
    snapTo(snapPoint, false);
  }, [snapPoint, snapTo]);

  // Re-snap on resize
  useEffect(() => {
    const onResize = () => snapTo(snapPoint, false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [snapPoint, snapTo]);

  // Active snap points — skip peek when it equals minimized
  const activeSnapPoints = useCallback((): SnapPoint[] => {
    if (getSnapPointHeight('peek') === getSnapPointHeight('minimized')) {
      return ['minimized', 'full'];
    }
    return ['minimized', 'peek', 'full'];
  }, [getSnapPointHeight]);

  const getClosestSnapPoint = useCallback((h: number): SnapPoint => {
    const points = activeSnapPoints();
    return points.reduce((closest, point) =>
      Math.abs(h - getSnapPointHeight(point)) < Math.abs(h - getSnapPointHeight(closest))
        ? point : closest
    );
  }, [getSnapPointHeight, activeSnapPoints]);

  const getNextSnapPoint = useCallback((current: SnapPoint, direction: 'up' | 'down'): SnapPoint => {
    const order = activeSnapPoints();
    const idx = order.indexOf(current);
    if (idx === -1) return order[0];
    return direction === 'up'
      ? order[Math.min(idx + 1, order.length - 1)]
      : order[Math.max(idx - 1, 0)];
  }, [activeSnapPoints]);

  // Drag state — using refs so pointer handlers don't need to be recreated
  const drag = useRef({
    active: false,
    startY: 0,
    startHeight: 0,
    lastY: 0,
    lastTime: 0,
    velocityY: 0, // px/ms — positive = moving finger down (collapsing)
  });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // left click only for mouse
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = sheetRef.current?.offsetHeight ?? getSnapPointHeight(snapPoint);
    drag.current = {
      active: true,
      startY: e.clientY,
      startHeight: h,
      lastY: e.clientY,
      lastTime: e.timeStamp,
      velocityY: 0,
    };
    setIsAnimating(false); // disable CSS transition while dragging
  }, [getSnapPointHeight, snapPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const dt = e.timeStamp - drag.current.lastTime;
    if (dt > 0) {
      drag.current.velocityY = (e.clientY - drag.current.lastY) / dt; // px/ms
    }
    drag.current.lastY = e.clientY;
    drag.current.lastTime = e.timeStamp;

    const delta = e.clientY - drag.current.startY;
    const newH = drag.current.startHeight - delta; // drag down = smaller height
    const minH = getSnapPointHeight('minimized');
    const maxH = getSnapPointHeight('full');
    setCurrentHeight(Math.max(minH, Math.min(maxH * 1.05, newH)));
  }, [getSnapPointHeight]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const currentH = sheetRef.current?.offsetHeight ?? drag.current.startHeight;
    const dragDistance = currentH - drag.current.startHeight;
    const velocityPxMs = drag.current.velocityY; // positive = moving down = collapsing

    const hasSignificantVelocity = Math.abs(velocityPxMs) > 0.2; // 200px/s
    const hasSignificantDrag = Math.abs(dragDistance) > 40;

    let newPoint: SnapPoint;
    if (hasSignificantVelocity || hasSignificantDrag) {
      const direction = hasSignificantVelocity
        ? (velocityPxMs < 0 ? 'up' : 'down')
        : (dragDistance > 0 ? 'up' : 'down');
      const startPoint = getClosestSnapPoint(drag.current.startHeight);
      newPoint = getNextSnapPoint(startPoint, direction);
    } else {
      newPoint = getClosestSnapPoint(currentH);
    }

    setIsAnimating(true);
    const target = getSnapPointHeight(newPoint);
    setCurrentHeight(target);
    onSnapPointChange?.(newPoint);
  }, [getClosestSnapPoint, getNextSnapPoint, getSnapPointHeight, onSnapPointChange]);

  const handleHeaderTap = useCallback((e: React.MouseEvent) => {
    // Only treat as tap if there was negligible movement
    if (Math.abs(drag.current.startHeight - (sheetRef.current?.offsetHeight ?? 0)) > 5) return;
    e.stopPropagation();
    const next = snapPoint === 'full' ? 'minimized' : 'full';
    onSnapPointChange?.(next);
  }, [snapPoint, onSnapPointChange]);

  const showBackdrop = snapPoint === 'full';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black z-[55] lg:hidden"
        style={{
          opacity: showBackdrop ? 0.5 : 0,
          pointerEvents: showBackdrop ? 'auto' : 'none',
          transition: `opacity 0.3s ${EASE_OUT_QUART}`,
        }}
        onClick={() => onSnapPointChange?.('minimized')}
      />

      {/* Bottom Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-[60] lg:hidden bg-dark-900 rounded-t-xl flex flex-col"
        role="dialog"
        aria-label="Panel"
        style={{
          height: currentHeight ?? getSnapPointHeight(snapPoint),
          maxHeight: '95vh',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          boxSizing: 'content-box',
          transition: isAnimating ? `height 0.3s ${EASE_OUT_QUART}` : 'none',
        }}
        onTransitionEnd={() => setIsAnimating(false)}
      >
        {/* Drag Header */}
        <div
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={disableHeaderTap ? undefined : handleHeaderTap}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-8 h-[3px] rounded-full bg-dark-500" />
          </div>

          {headerContent && (
            <div className="px-4 pb-3">
              {headerContent}
            </div>
          )}

          {!headerContent && <div className="h-6" />}
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6 touch-pan-y">
          {children}
          <div className="flex-shrink-0 h-safe-bottom" />
        </div>
      </div>
    </>
  );
}

// Hook for controlling bottom sheet from child components
export function useBottomSheet() {
  return {
    expand: () => {},
    collapse: () => {},
    setSnapPoint: (_point: SnapPoint) => {},
  };
}


