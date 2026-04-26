import { useRef, useState, useEffect } from 'react';
import { LayoutGrid, Check } from 'lucide-react';

export function ProductSwitcher() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(prev => !prev)}
        aria-label="Switch product"
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex items-center justify-center w-8 h-8 rounded text-dark-300 hover:text-white hover:bg-dark-700 transition-colors duration-150"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 w-52 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-[70] overflow-hidden"
          role="menu"
        >
          <div className="px-3 pt-2.5 pb-1">
            <span className="text-dark-400 text-[10px] font-medium tracking-[0.18em] uppercase">
              Products
            </span>
          </div>

          {/* DeFlock Maps — current product */}
          <div
            className="flex items-center gap-2.5 px-3 py-2 mx-1 mb-0.5 rounded-md"
            role="menuitem"
            aria-current="true"
          >
            <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-accent leading-tight">DeFlock Maps</span>
              <span className="text-[10px] text-dark-400 leading-tight">Current</span>
            </div>
          </div>

          <div className="mx-3 mb-1 h-px bg-dark-600" />

          {/* DeFlock — main site */}
          <a
            href="https://deflock.org"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 mx-1 mb-1 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors duration-150 group"
          >
            <div className="w-3.5 h-3.5 flex-shrink-0" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium leading-tight">DeFlock</span>
              <span className="text-[10px] text-dark-400 leading-tight group-hover:text-dark-300 transition-colors">
                deflock.org
              </span>
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
