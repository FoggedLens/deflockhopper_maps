import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FlockLeakPanelContent, FLOCK_LEAK_COPY } from './FlockLeakPanelContent';

/** Desktop side panel for the Flock Leak tab (MapPage mounts it only above lg). */
export function FlockLeakPanel() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHasAnimated(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <div
        className={`h-full border-r border-dark-700/50 bg-dark-900 flex flex-col transition-all duration-300 ease-out overflow-hidden ${
          hasAnimated ? '' : 'opacity-0 -translate-x-4'
        }`}
        style={{ width: isCollapsed ? 0 : 400, minWidth: isCollapsed ? 0 : 400 }}
      >
        {/* Title only, like the Map tab: no icon tile (user's call, 2026-09-25). */}
        <div className="flex-shrink-0 px-6 py-5 border-b border-dark-700/50">
          <h2 className="text-base font-semibold text-white">{FLOCK_LEAK_COPY.title}</h2>
          <p className="text-xs text-dark-400">{FLOCK_LEAK_COPY.subtitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <FlockLeakPanelContent />
        </div>

        <div className="flex-shrink-0 px-6 py-3 border-t border-dark-700/50 bg-dark-800/50">
          <p className="text-[10px] text-dark-500 text-center">
            Maps by{' '}
            <a href="https://openroadlabs.org" target="_blank" rel="noopener noreferrer" className="hover:text-dark-300 transition-colors">OpenRoad Labs LLC</a>
          </p>
        </div>
      </div>

      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute top-1/2 -translate-y-1/2 z-20 w-6 h-16 bg-dark-800 border border-dark-700/50 rounded-r-lg flex items-center justify-center hover:bg-dark-700 transition-colors"
        style={{ left: isCollapsed ? 0 : 400 }}
        aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4 text-dark-400" /> : <ChevronLeft className="w-4 h-4 text-dark-400" />}
      </button>
    </>
  );
}
