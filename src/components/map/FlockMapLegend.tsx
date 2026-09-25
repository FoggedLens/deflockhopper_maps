import { useFlockLeakStore } from '../../store/flockLeakStore';
import { useCameraStore } from '../../store/cameraStore';
import {
  FLOCK_DEVICE_CLASSES,
  FLOCK_SELECTABLE_STATUSES,
  FLOCK_STATUS_LABEL,
  type FlockStatus,
} from '../../lib/flockInventory';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';
import {
  LEAK_COMPARE_FLOCK_GROUPS,
  LEAK_COMPARE_FLOCK_STATUSES,
  LEAK_OSM_DEFAULT_BRAND,
} from '../../utils/leakCompareDefaults';
import { BothMark, FlockGroupMark, FlockLensMark, FlockPlannedMark, FlockRingMark, OsmDotMark } from './FlockLeakMarks';
import { Switch } from './FlockCompareToggle';

const sameSet = <T,>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

function StatusMark({ s, hollow }: { s: FlockStatus; hollow: boolean }) {
  if (s === 2) return <FlockPlannedMark size={14} open={hollow} />;
  if (hollow) return <span className={s === 3 ? 'opacity-35' : undefined}><FlockRingMark size={14} /></span>;
  return <FlockLensMark size={14} dimmed={s === 3} />;
}

/**
 * The Leak tab's map key, top right on desktop. It lists only what the map
 * draws (the device classes and statuses the filters leave on) in the mark
 * style the map is using, and it carries the OSM compare switch: comparing
 * adds a map layer, so its control sits with the map's key. Each mark is
 * named once: Flock's marks above, the OSM dot on the switch, and one line
 * for the overlap.
 */
export function FlockMapLegend() {
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const compare = useFlockLeakStore((s) => s.view === 'overlay');
  const setView = useFlockLeakStore((s) => s.setView);
  const osmBrands = useCameraStore((s) => s.filters.brands);

  const classes = groups.length === 0
    ? FLOCK_DEVICE_CLASSES
    : FLOCK_DEVICE_CLASSES.filter((c) => c.groups.some((g) => groups.includes(g)));
  const shownStatuses = FLOCK_SELECTABLE_STATUSES.filter((s) => statuses.includes(s));
  // The compare seed narrows both sides silently; say so while it holds.
  const seedHolds = compare
    && sameSet(groups, LEAK_COMPARE_FLOCK_GROUPS)
    && sameSet(statuses, LEAK_COMPARE_FLOCK_STATUSES)
    && sameSet(osmBrands, [LEAK_OSM_DEFAULT_BRAND]);

  return (
    <section
      aria-label="Map key"
      className="absolute top-4 right-4 z-20 w-[288px] rounded-md border border-dark-600 bg-dark-800/95 backdrop-blur shadow-xl shadow-black/40 text-xs"
    >
      <div className="px-3 pt-3 pb-3">
        <h2 className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-white">Flock&apos;s records</span>
          <span className="text-dark-500">{FLOCK_LEAK_SNAPSHOT_LABEL}</span>
        </h2>
        <ul className="mt-2.5 space-y-2">
          {classes.map((c) => (
            <li key={c.key} className="flex items-center gap-2.5 text-dark-200">
              <FlockGroupMark g={c.groups[0]} hollow={compare} size={16} />
              {c.label}
            </li>
          ))}
        </ul>
        {shownStatuses.length === 1 ? (
          // One status: its mark would repeat the rows above, so say it.
          <p className="mt-3 pt-2.5 border-t border-dark-600 text-dark-400">
            {FLOCK_STATUS_LABEL[shownStatuses[0]]} only
          </p>
        ) : shownStatuses.length > 1 && (
          <ul className="mt-3 pt-2.5 border-t border-dark-600 flex flex-wrap gap-x-3 gap-y-1.5 text-dark-300" aria-label="Status">
            {shownStatuses.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <StatusMark s={s} hollow={compare} />
                {FLOCK_STATUS_LABEL[s]}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={compare}
        onClick={() => setView(compare ? 'flock' : 'overlay')}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 border-t text-left transition-colors ${
          compare ? 'border-[#2196E8]/40 bg-[#2196E8]/[0.08]' : 'border-dark-600 hover:bg-white/[0.04]'
        }`}
      >
        <OsmDotMark size={16} />
        <span className="flex-1 min-w-0">
          <span className="block font-medium text-white">Compare with OSM cameras</span>
          <span className="block text-dark-400">Mapped by volunteers. Updated hourly.</span>
        </span>
        <Switch on={compare} />
      </button>

      {compare && (
        <div className="px-3 py-2.5 space-y-2 border-t border-dark-600">
          <p className="flex items-center gap-2.5 text-dark-200">
            <BothMark size={16} />
            Blue dot in a red ring: on both maps
          </p>
          {seedHolds && (
            <p className="text-dark-500 leading-relaxed">
              Showing Flock&apos;s plate readers in service and OSM cameras tagged {LEAK_OSM_DEFAULT_BRAND}. Widen either side with its filter.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
