import { useState, useEffect, useCallback } from 'react';
import { useRouteStore } from '../../store';
import { BottomSheet, type SnapPoint } from '../common/BottomSheet';
import { RoutePanelContent } from './RoutePanelContent';
import { MobileRoutePreview } from './MobileRoutePreview';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function RoutePanel() {
  const [isMobile, setIsMobile] = useState(false);
  const [snapPoint, setSnapPoint] = useState<SnapPoint>('minimized');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [didAutoExpand, setDidAutoExpand] = useState(false);

  const { normalRoute, avoidanceRoute } = useRouteStore();
  const hasRoutes = !!(normalRoute && avoidanceRoute);

  // Check if we're on mobile/tablet (below lg breakpoint)
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Enable animations only after first render to prevent initial glitch
  useEffect(() => {
    // Small delay to ensure the initial state is rendered without animation
    const timer = setTimeout(() => setHasAnimated(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Auto-expand to full when routes are first calculated
  useEffect(() => {
    if (hasRoutes && isMobile && !didAutoExpand) {
      setSnapPoint('full');
      setDidAutoExpand(true);
    }
    if (!hasRoutes && didAutoExpand) {
      setDidAutoExpand(false);
    }
  }, [hasRoutes, isMobile, didAutoExpand]);

  // Callback to expand sheet
  const handleExpandSheet = useCallback(() => {
    setSnapPoint('full');
  }, []);

  // Expand to full for input interaction
  const handleExpandToFull = useCallback(() => {
    setSnapPoint('full');
  }, []);

  // Collapse to minimized (e.g., when picking location from map)
  const handleCollapseSheet = useCallback(() => {
    setSnapPoint('minimized');
  }, []);

  // Mobile/Tablet: Bottom Sheet
  if (isMobile) {
    return (
      <BottomSheet
        snapPoint={snapPoint}
        onSnapPointChange={setSnapPoint}
        minimizedHeight={80}
        peekHeight={80}
        fullHeight={90}
        headerContent={
          <MobileRoutePreview
            hasRoutes={hasRoutes}
            onExpand={handleExpandSheet}
          />
        }
      >
        {/* Main content - only visible when fully expanded */}
        {snapPoint === 'full' && (
          <div className="pb-8">
            <RoutePanelContent
              isBottomSheet={true}
              onExpandSheet={handleExpandToFull}
              onCollapseSheet={handleCollapseSheet}
            />

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
          </div>
        )}
      </BottomSheet>
    );
  }

  // Desktop: Side Panel
  return (
    <div className="hidden lg:block relative h-full">
      {/* Panel Content */}
      <div className={`flex flex-col h-full bg-dark-900 border-r border-dark-700/50 ${
        hasAnimated ? 'transition-all duration-300' : ''
      } ${isCollapsed ? 'w-0 overflow-hidden' : 'w-[400px]'}`}>
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <RoutePanelContent isBottomSheet={false} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-dark-700/50 bg-dark-800/50">
          <p className="text-[10px] text-dark-500 text-center">
            Maps by{' '}
            <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
          </p>
        </div>
      </div>

      {/* Expand/Collapse Toggle Button - positioned on the edge */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`absolute z-50 top-1/2 -translate-y-1/2 ${
          hasAnimated ? 'transition-all duration-300' : ''
        } ${isCollapsed ? 'left-0' : 'left-[400px]'} w-6 h-16 bg-dark-800 hover:bg-dark-700 border border-dark-600 border-l-0 rounded-r-lg flex items-center justify-center group`}
        aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-dark-300 group-hover:text-white transition-colors" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-dark-300 group-hover:text-white transition-colors" />
        )}
      </button>
    </div>
  );
}
