import { useState, useEffect } from 'react';
import { useNetworkStore } from '../../store/networkStore';
import { BottomSheet, type SnapPoint } from '../common/BottomSheet';
import { ChevronLeft, ChevronRight, Network, AlertTriangle } from 'lucide-react';
import { NetworkPanelContent } from './NetworkPanelContent';

export function NetworkPanel() {
  const [isMobile, setIsMobile] = useState(false);
  const [snapPoint, setSnapPoint] = useState<SnapPoint>('minimized');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);

  const { nodesArray, selectedNode, adjacency } = useNetworkStore();

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setHasAnimated(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Mobile: BottomSheet
  if (isMobile) {
    const isNonSharingPortal = selectedNode?.isPortal &&
      (adjacency[selectedNode.id]?.length ?? 0) === 0;
    const showWarning = isNonSharingPortal && snapPoint !== 'full';

    return (
      <>
      {showWarning && (
        <button
          onClick={() => setSnapPoint('full')}
          className="fixed bottom-[100px] right-4 z-[52] flex items-center justify-center w-10 h-10 rounded-full bg-amber-500 shadow-lg shadow-amber-500/30 active:bg-amber-600 transition-colors"
          aria-label="View sharing disclaimer"
        >
          <AlertTriangle className="w-5 h-5 text-white" />
        </button>
      )}
      <BottomSheet
        snapPoint={snapPoint}
        onSnapPointChange={setSnapPoint}
        minimizedHeight={84}
        peekHeight={84}
        fullHeight={85}
        headerContent={
          <button
            onClick={() => setSnapPoint('full')}
            className="w-full flex items-center justify-between py-1"
          >
            <div className="flex items-center gap-3">
              <Network className="w-5 h-5 text-blue-400" />
              <div className="text-left">
                <p className="text-sm font-semibold text-white">Network Explorer</p>
                <p className="text-xs text-dark-400">
                  {selectedNode ? selectedNode.name : `${nodesArray.length.toLocaleString()} agencies`}
                </p>
              </div>
            </div>
          </button>
        }
      >
        {snapPoint === 'full' && (
          <div className="p-4 pb-8">
            <NetworkPanelContent />
            <div className="mt-6 pt-4 border-t border-dark-700/50">
              <p className="text-[10px] text-dark-500 text-center">
                Maps by{' '}
                <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
              </p>
            </div>
          </div>
        )}
      </BottomSheet>
      </>
    );
  }

  // Desktop: Left sidebar
  return (
    <>
      <div
        className={`h-full border-r border-dark-700/50 bg-dark-900 flex flex-col transition-all duration-300 ease-out overflow-hidden ${
          hasAnimated ? '' : 'opacity-0 -translate-x-4'
        }`}
        style={{ width: isCollapsed ? 0 : 400, minWidth: isCollapsed ? 0 : 400 }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-5 border-b border-dark-700/50">
          <div className="flex items-center gap-3">
            <Network className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-base font-semibold text-white">Network Explorer</h2>
              <p className="text-xs text-dark-400">ALPR data-sharing relationships</p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          <NetworkPanelContent />
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-dark-700/50 bg-dark-800/50">
          <p className="text-[10px] text-dark-500 text-center">
            Maps by{' '}
            <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
          </p>
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute top-1/2 -translate-y-1/2 z-20 w-6 h-16 bg-dark-800 border border-dark-700/50 rounded-r-lg flex items-center justify-center hover:bg-dark-700 transition-colors"
        style={{ left: isCollapsed ? 0 : 400 }}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-dark-400" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-dark-400" />
        )}
      </button>
    </>
  );
}
