import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useCameraStore, useMapStore } from '../../store';
import { useAppModeStore } from '../../store/appModeStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  US_STATES,
  getStateName,
  loadStateGeometry,
  getCachedStateGeometry,
  getStateBounds,
  loadStateCameraCounts,
} from '../../services/stateFilterService';
import { Filter, X, ChevronDown, Search } from 'lucide-react';

// ─── Constants (moved from MapPanel) ────────────────────────────────────────
const SURVEILLANCE_ZONES = [
  { value: 'traffic', label: 'Traffic' },
  { value: 'town', label: 'Town' },
  { value: 'parking', label: 'Parking' },
  { value: 'other', label: 'Other' },
] as const;

const MOUNT_TYPES = [
  { value: 'pole', label: 'Pole' },
  { value: 'wall', label: 'Wall' },
  { value: 'street_light', label: 'Street Light' },
  { value: 'other', label: 'Other' },
] as const;

// ─── Searchable Multi-Select (Staged) ───────────────────────────────────────
function SearchableMultiSelect({
  label,
  items,
  selected,
  onToggle,
  maxVisible = 50,
  note,
  roomy = false,
  defaultExpanded = false,
}: {
  label: string;
  items: string[];
  selected: string[];
  onToggle: (item: string) => void;
  maxVisible?: number;
  note?: string;
  /** Larger type + touch targets (mobile sheet) */
  roomy?: boolean;
  defaultExpanded?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => item.toLowerCase().includes(q)).slice(0, maxVisible);
  }, [items, search, maxVisible]);

  const rowText = roomy ? 'text-sm' : 'text-xs';
  const rowPad = roomy ? 'px-3 py-2.5' : 'px-2.5 py-1.5';

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className={`w-full flex items-center justify-between ${roomy ? 'py-3' : 'py-2'}`}
      >
        <span className={`${roomy ? 'text-[13px]' : 'text-xs'} font-medium text-dark-300 uppercase tracking-wider`}>
          {label}
          {selected.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold normal-case tracking-normal">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-dark-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 mb-3">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className={`w-full pl-8 pr-3 ${roomy ? 'py-2.5 text-sm' : 'py-1.5 text-xs'} bg-dark-800 border border-dark-600 rounded-lg text-white placeholder:text-dark-500 focus:outline-none focus:border-accent/50`}
            />
          </div>

          {note && <p className="text-xs text-dark-500 mb-2">{note}</p>}

          <div className={`${roomy ? 'max-h-none' : 'max-h-60'} overflow-y-auto space-y-0.5 scrollbar-thin`}>
            {filtered.length === 0 ? (
              <p className="text-xs text-dark-500 py-2 text-center">No results</p>
            ) : (
              filtered.map((item) => {
                const isChecked = selected.includes(item);
                return (
                  <button
                    key={item}
                    onClick={() => onToggle(item)}
                    className={`w-full flex items-center gap-2.5 ${rowPad} rounded-lg text-left transition-colors ${
                      isChecked
                        ? 'bg-accent/10 text-white'
                        : 'text-dark-300 hover:bg-dark-800'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'bg-accent border-accent'
                          : 'border-dark-500 bg-dark-800'
                      }`}
                    >
                      {isChecked && (
                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className={`${rowText} truncate`}>{item}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── State Single-Select (Staged) ───────────────────────────────────────────
function StateSelect({
  selected,
  onSelect,
  roomy = false,
}: {
  selected: string | null;
  onSelect: (postal: string | null) => void;
  roomy?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [counts, setCounts] = useState<Map<string, number> | null>(null);

  // Per-state camera counts from the bundled metrics — cosmetic, lazy
  useEffect(() => {
    if (!isExpanded || counts) return;
    void loadStateCameraCounts().then(setCounts).catch(() => {});
  }, [isExpanded, counts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return US_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.postal.toLowerCase() === q
    );
  }, [search]);

  const rowText = roomy ? 'text-sm' : 'text-xs';
  const rowPad = roomy ? 'px-3 py-2.5' : 'px-2.5 py-1.5';

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className={`w-full flex items-center justify-between ${roomy ? 'py-3' : 'py-2'}`}
      >
        <span className={`${roomy ? 'text-[13px]' : 'text-xs'} font-medium text-dark-300 uppercase tracking-wider`}>
          State
          {selected && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold normal-case tracking-normal">
              {getStateName(selected)}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-dark-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 mb-3">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search states..."
              className={`w-full pl-8 pr-3 ${roomy ? 'py-2.5 text-sm' : 'py-1.5 text-xs'} bg-dark-800 border border-dark-600 rounded-lg text-white placeholder:text-dark-500 focus:outline-none focus:border-accent/50`}
            />
          </div>

          <div className={`${roomy ? 'max-h-72' : 'max-h-60'} overflow-y-auto space-y-0.5 scrollbar-thin`}>
            {selected && (
              <button
                onClick={() => onSelect(null)}
                className={`w-full flex items-center gap-2.5 ${rowPad} rounded-lg text-left text-dark-400 hover:bg-dark-800 hover:text-dark-200 transition-colors`}
              >
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                <span className={rowText}>All states</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="text-xs text-dark-500 py-2 text-center">No results</p>
            ) : (
              filtered.map((s) => {
                const isChecked = selected === s.postal;
                const count = counts?.get(s.postal);
                return (
                  <button
                    key={s.postal}
                    onClick={() => onSelect(isChecked ? null : s.postal)}
                    className={`w-full flex items-center gap-2.5 ${rowPad} rounded-lg text-left transition-colors ${
                      isChecked
                        ? 'bg-accent/10 text-white'
                        : 'text-dark-300 hover:bg-dark-800'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'border-accent'
                          : 'border-dark-500'
                      }`}
                    >
                      {isChecked && <div className="w-2 h-2 rounded-full bg-accent" />}
                    </div>
                    <span className={`${rowText} flex-1 truncate`}>{s.name}</span>
                    {count !== undefined && (
                      <span className="text-[11px] text-dark-500 tabular-nums">
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Collapsible Checkbox Group (Staged) ────────────────────────────────────
function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
  roomy = false,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  roomy?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const rowText = roomy ? 'text-sm' : 'text-xs';
  const rowPad = roomy ? 'px-3 py-2.5' : 'px-2.5 py-1.5';

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className={`w-full flex items-center justify-between ${roomy ? 'py-3' : 'py-2'}`}
      >
        <span className={`${roomy ? 'text-[13px]' : 'text-xs'} font-medium text-dark-300 uppercase tracking-wider`}>
          {label}
          {selected.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold normal-case tracking-normal">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-dark-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 mb-3 space-y-0.5">
          {options.map(({ value, label: optLabel }) => {
            const isChecked = selected.includes(value);
            return (
              <button
                key={value}
                onClick={() => onToggle(value)}
                className={`w-full flex items-center gap-2.5 ${rowPad} rounded-lg text-left transition-colors ${
                  isChecked
                    ? 'bg-accent/10 text-white'
                    : 'text-dark-300 hover:bg-dark-800'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                    isChecked
                      ? 'bg-accent border-accent'
                      : 'border-dark-500 bg-dark-800'
                  }`}
                >
                  {isChecked && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={rowText}>{optLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Gates the filter controls on the few-KB manifest instead of the full
 * dataset. Legacy fallback: if the manifest fails, load the GeoJSON and
 * derive the option lists from it (today's behavior).
 */
function FilterDataGate({ children }: { children: React.ReactNode }) {
  const manifestPhase = useCameraStore((s) => s.manifestPhase);
  const ensureManifestLoaded = useCameraStore((s) => s.ensureManifestLoaded);
  const isInitialized = useCameraStore((s) => s.isInitialized);
  const loadPhase = useCameraStore((s) => s.loadPhase);
  const ensureCamerasLoaded = useCameraStore((s) => s.ensureCamerasLoaded);
  const retryCameraLoad = useCameraStore((s) => s.retryCameraLoad);

  useEffect(() => {
    void ensureManifestLoaded();
  }, [ensureManifestLoaded]);

  // Manifest failed → legacy path: full dataset download + derived lists
  useEffect(() => {
    if (manifestPhase === 'error') void ensureCamerasLoaded().catch(() => {});
  }, [manifestPhase, ensureCamerasLoaded]);

  const ready = manifestPhase === 'ready' || isInitialized;
  if (!ready) {
    const bothFailed = manifestPhase === 'error' && loadPhase === 'error';
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        {bothFailed ? (
          <>
            <span className="text-xs text-dark-400">Couldn't load camera data</span>
            <button
              onClick={() => void retryCameraLoad().catch(() => {})}
              className="text-xs text-accent hover:underline"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <div className="w-5 h-5 border-2 border-dark-600 border-t-accent rounded-full animate-spin" />
            <span className="text-xs text-dark-400">Loading filters…</span>
          </>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Floating filter button on the map surface (map mode only). Desktop opens a
 * popover anchored above the button; mobile opens a full-width bottom sheet
 * (portal + backdrop) matching the app's sheet language. Staged UX is
 * unchanged: selections are pending until Apply.
 */
export function CameraFilterControl() {
  const appMode = useAppModeStore((s) => s.appMode);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Swipe-down-to-close: drag starts only from the handle/header so the
  // scrollable body keeps its own touch gestures.
  const sheetDragControls = useDragControls();

  const filters = useCameraStore((s) => s.filters);
  const availableBrands = useCameraStore((s) => s.availableBrands);
  const availableOperators = useCameraStore((s) => s.availableOperators);
  const pendingFilters = useCameraStore((s) => s.pendingFilters);
  const togglePendingFilter = useCameraStore((s) => s.togglePendingFilter);
  const setPendingState = useCameraStore((s) => s.setPendingState);
  const applyPendingFilters = useCameraStore((s) => s.applyPendingFilters);
  const resetAllFilters = useCameraStore((s) => s.resetAllFilters);
  const manifest = useCameraStore((s) => s.manifest);

  const brandOptions = useMemo(
    () => (manifest ? manifest.brands.map((b) => b.label) : availableBrands),
    [manifest, availableBrands]
  );
  const operatorOptions = useMemo(
    () => (manifest ? manifest.operators.map((o) => o.label) : availableOperators),
    [manifest, availableOperators]
  );

  // Re-stage pending filters from the applied set each time the UI opens
  useEffect(() => {
    if (!open) return;
    const applied = useCameraStore.getState().filters;
    useCameraStore.setState({
      pendingFilters: {
        brands: [...applied.brands],
        operators: [...applied.operators],
        surveillanceZones: [...applied.surveillanceZones],
        mountTypes: [...applied.mountTypes],
        state: applied.state ?? null,
      },
    });
  }, [open]);

  // Desktop popover: close on outside click (mobile sheet closes via backdrop)
  useEffect(() => {
    if (!open || isMobile) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, isMobile]);

  const pendingChangeCount = useMemo(() => {
    let count = 0;
    for (const key of ['brands', 'operators', 'surveillanceZones', 'mountTypes'] as const) {
      const pending = new Set(pendingFilters[key]);
      const applied = new Set(filters[key]);
      for (const v of pending) if (!applied.has(v)) count++;
      for (const v of applied) if (!pending.has(v)) count++;
    }
    if ((pendingFilters.state ?? null) !== (filters.state ?? null)) count++;
    return count;
  }, [pendingFilters, filters]);

  const appliedFilterCount =
    filters.brands.length +
    filters.operators.length +
    filters.surveillanceZones.length +
    filters.mountTypes.length +
    (filters.state ? 1 : 0);

  // Apply, and when the state selection changed, frame the state on the map.
  // The boundary polygon loads before apply so both render paths (tile
  // `within` expression + geojson point-in-polygon scan) have it cached.
  const handleApply = async () => {
    const pendingState = useCameraStore.getState().pendingFilters.state;
    const prevState = useCameraStore.getState().filters.state ?? null;
    if (pendingState) await loadStateGeometry(pendingState).catch(() => {});
    applyPendingFilters();
    if (pendingState && pendingState !== prevState) {
      const feature = getCachedStateGeometry(pendingState);
      if (feature) {
        useMapStore.getState().requestFitBounds(getStateBounds(feature));
      }
    }
  };

  // Map and Flock Leak: on the Leak tab the OSM filters narrow the OSM side of
  // the compare (for example, OSM cameras tagged Flock).
  if (appMode !== 'map' && appMode !== 'leak') return null;

  const filterGroups = (roomy: boolean) => (
    <FilterDataGate>
      <div className={roomy ? 'divide-y divide-dark-700/40' : 'space-y-1'}>
        <StateSelect
          selected={pendingFilters.state}
          onSelect={setPendingState}
          roomy={roomy}
        />
        <SearchableMultiSelect
          label="Brand"
          items={brandOptions}
          selected={pendingFilters.brands}
          onToggle={(v) => togglePendingFilter('brands', v)}
          roomy={roomy}
        />
        <SearchableMultiSelect
          label="Operator"
          items={operatorOptions}
          selected={pendingFilters.operators}
          onToggle={(v) => togglePendingFilter('operators', v)}
          note="~28% of cameras have operator data"
          roomy={roomy}
        />
        <CheckboxGroup
          label="Surveillance Zone"
          options={SURVEILLANCE_ZONES}
          selected={pendingFilters.surveillanceZones}
          onToggle={(v) => togglePendingFilter('surveillanceZones', v)}
          roomy={roomy}
        />
        <CheckboxGroup
          label="Mount Type"
          options={MOUNT_TYPES}
          selected={pendingFilters.mountTypes}
          onToggle={(v) => togglePendingFilter('mountTypes', v)}
          roomy={roomy}
        />
      </div>
    </FilterDataGate>
  );

  return (
    <div ref={rootRef} className="map-filter-control absolute z-20 flex flex-col items-start">
      {/* Desktop popover */}
      {open && !isMobile && (
        <div className="absolute bottom-full left-0 mb-2 w-[320px] bg-dark-900/95 backdrop-blur-md rounded-xl border border-dark-600 shadow-xl shadow-black/40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/50">
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-semibold text-white tracking-tight">Filters</span>
              {appliedFilterCount > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-md bg-accent/15 text-accent text-[11px] font-bold flex items-center justify-center tabular-nums">
                  {appliedFilterCount}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close filters"
              className="w-7 h-7 rounded-md flex items-center justify-center text-dark-400 hover:text-white hover:bg-dark-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-2 max-h-[min(60vh,480px)] overflow-y-auto scrollbar-thin">
            {filterGroups(false)}
          </div>

          <div className="flex gap-2 px-4 py-3 border-t border-dark-700/50">
            <button
              onClick={resetAllFilters}
              className="flex-1 px-3 py-2 rounded-lg text-[11px] font-medium text-dark-400 hover:text-dark-200 hover:bg-dark-800 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => void handleApply()}
              disabled={pendingChangeCount === 0}
              className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-150 ${
                pendingChangeCount > 0
                  ? 'bg-accent text-white hover:bg-accent/90'
                  : 'bg-dark-800 text-dark-600 cursor-not-allowed'
              }`}
            >
              Apply{pendingChangeCount > 0 ? ` (${pendingChangeCount})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* Mobile bottom sheet (portal above the app's drawer) */}
      {isMobile &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  key="filter-backdrop"
                  className="fixed inset-0 z-[70] bg-black/50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setOpen(false)}
                />
                <motion.div
                  key="filter-sheet"
                  role="dialog"
                  aria-label="Camera filters"
                  className="fixed inset-x-0 bottom-0 z-[71] flex flex-col max-h-[85dvh] bg-dark-900 border-t border-dark-600 rounded-t-2xl shadow-2xl shadow-black/60"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 32, stiffness: 360 }}
                  drag="y"
                  dragListener={false}
                  dragControls={sheetDragControls}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 1 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 80 || info.velocity.y > 500) setOpen(false);
                  }}
                >
                  {/* Grab handle + header — dragging here swipes the sheet closed */}
                  <div
                    className="flex-shrink-0 touch-none select-none"
                    onPointerDown={(e) => sheetDragControls.start(e)}
                  >
                    <div className="flex justify-center pt-2.5 pb-1">
                      <div className="w-9 h-1 rounded-full bg-dark-600" />
                    </div>
                    <div className="flex items-center justify-between px-5 pb-3 pt-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base font-semibold text-white tracking-tight">Filters</span>
                        {appliedFilterCount > 0 && (
                          <span className="min-w-[22px] h-[22px] px-1.5 rounded-md bg-accent/15 text-accent text-xs font-bold flex items-center justify-center tabular-nums">
                            {appliedFilterCount}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setOpen(false)}
                        aria-label="Close filters"
                        className="w-9 h-9 -mr-1.5 rounded-lg flex items-center justify-center text-dark-400 hover:text-white active:bg-dark-800 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="h-px bg-dark-700/50" />
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-1">
                    {filterGroups(true)}
                  </div>

                  {/* Sticky footer */}
                  <div className="flex-shrink-0 flex gap-3 px-5 pt-3 border-t border-dark-700/50 safe-area-inset-bottom">
                    <button
                      onClick={resetAllFilters}
                      className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-dark-300 bg-dark-800 active:bg-dark-700 transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => {
                        void handleApply();
                        setOpen(false);
                      }}
                      disabled={pendingChangeCount === 0}
                      className={`flex-[2] px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-150 ${
                        pendingChangeCount > 0
                          ? 'bg-accent text-white active:bg-accent/90'
                          : 'bg-dark-800 text-dark-600'
                      }`}
                    >
                      Apply{pendingChangeCount > 0 ? ` (${pendingChangeCount})` : ''}
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Filter cameras"
        aria-expanded={open}
        title="Filters"
        className={`filter-trigger relative w-[40px] h-[40px] flex items-center justify-center rounded-md transition-colors
          bg-dark-800 border border-dark-600
          ${open ? 'text-accent' : 'text-dark-300 hover:bg-dark-700 hover:text-white'}`}
      >
        <Filter className="w-4 h-4" fill={appliedFilterCount > 0 ? 'currentColor' : 'none'} />
        {appliedFilterCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center tabular-nums border-2 border-dark-900">
            {appliedFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
