import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { FLOCK_LEAK_LINKS, FLOCK_LEAK_RESEARCHER } from '../../services/flockLeakTilesService';
import { FLOCK_INVENTORY } from '../../lib/flockInventory';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { useCameraStore } from '../../store/cameraStore';
import {
  LEAK_COMPARE_FLOCK_GROUPS,
  LEAK_COMPARE_FLOCK_STATUSES,
  LEAK_OSM_DEFAULT_BRAND,
} from '../../utils/leakCompareDefaults';
import { FlockFilterChips } from '../map/FlockFilterChips';
import { Switch } from '../map/FlockCompareToggle';
import { BothMark, FlockRingMark, OsmDotMark } from '../map/FlockLeakMarks';

const DEVICES = FLOCK_INVENTORY.devices.toLocaleString();
const FLAGGED = FLOCK_INVENTORY.devicesFlagged.toLocaleString();

/**
 * Every user-facing string on the tab. Plain declarative sentences, no em
 * dashes. Facts are from the researcher's paper ("Never Hacked", Joshua
 * Michael, Sep 2, 2026): he retrieved 335,701 device and deployment records
 * from Flock's production environment on December 14, 2025, through a
 * credential flaw he had reported to Flock on November 13, 2025.
 */
export const FLOCK_LEAK_COPY = {
  title: 'Flock Leak',
  subtitle: "Flock's own device records, Dec 14, 2025",
  peek: "Flock's internal device records, obtained by a researcher on Dec 14, 2025.",
  lede: `This is Flock Safety's own list of its devices: ${DEVICES} records of plate readers, cameras, Raven audio sensors and drones, whether installed, planned or taken down.`,
  source: `Security researcher ${FLOCK_LEAK_RESEARCHER} downloaded the list from Flock's systems on December 14, 2025, through a flaw he had reported to Flock a month earlier. It is a snapshot and is never updated.`,
  compareTitle: 'Compare with OSM cameras',
  compareDetail: 'See which of these devices volunteers have already mapped.',
  compareSeed: `Showing Flock's plate readers and OSM cameras tagged ${LEAK_OSM_DEFAULT_BRAND}. Widen either side with its filter.`,
  caveat: "Flock's list stops at December 14, 2025, and OSM is live. A camera on one map and not the other is a lead, not proof. Check it in person before you add or remove anything.",
  ctaButton: 'Add a camera with the DeFlock app',
  hidden: `Not on the map: ${FLAGGED} records with an unknown status, factory test units, placeholder locations that stack many devices on one point, and positions outside North America.`,
  credit: `Records published by ${FLOCK_LEAK_RESEARCHER} at flocksurveillance.org. Types and statuses are Flock's own labels. DeFlock is not affiliated with Flock Safety.`,
  pillError: 'Flock data unavailable. Tap to retry.',
  pillLoading: 'Loading Flock data',
} as const;

const RESEARCH_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: FLOCK_LEAK_LINKS.paper, label: 'Read the research paper' },
  { href: FLOCK_LEAK_LINKS.table, label: `Search all ${DEVICES} records` },
  { href: FLOCK_LEAK_LINKS.site, label: 'Visit flocksurveillance.org' },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-2xs uppercase text-dark-500 mb-3">{children}</h3>;
}

const KEY: ReadonlyArray<{ mark: ReactNode; short: string }> = [
  { mark: <BothMark size={16} />, short: 'Both' },
  { mark: <FlockRingMark size={16} />, short: 'Flock only' },
  { mark: <OsmDotMark size={16} />, short: 'OSM only' },
];

/** One-line key for the mobile peek while comparing, in place of its
 *  description (desktop has the map legend). Spans only: the peek row is
 *  a button. */
export function FlockCompareKey({ className = '' }: { className?: string }) {
  return (
    <span className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-dark-200 ${className}`}>
      {KEY.map((k) => (
        <span key={k.short} className="flex items-center gap-1.5">{k.mark}{k.short}</span>
      ))}
    </span>
  );
}

const sameSet = <T,>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The page's main control: lay the OSM cameras under Flock's records. It is
 * the first thing in the panel and the one emphasized element in it. While
 * on, it carries the key for reading one map over the other and, while the
 * compare seed still holds, what the seed narrowed.
 */
function CompareControl() {
  const compare = useFlockLeakStore((s) => s.view === 'overlay');
  const setView = useFlockLeakStore((s) => s.setView);
  const groups = useFlockLeakStore((s) => s.groups);
  const statuses = useFlockLeakStore((s) => s.statuses);
  const osmBrands = useCameraStore((s) => s.filters.brands);
  const seedHolds = compare
    && sameSet(groups, LEAK_COMPARE_FLOCK_GROUPS)
    && sameSet(statuses, LEAK_COMPARE_FLOCK_STATUSES)
    && sameSet(osmBrands, [LEAK_OSM_DEFAULT_BRAND]);

  return (
    <section
      className={`rounded-xl border transition-colors ${
        compare ? 'border-[#2196E8]/70 bg-[#2196E8]/[0.10]' : 'border-[#2196E8]/40 bg-[#2196E8]/[0.05] hover:bg-[#2196E8]/[0.08]'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={compare}
        onClick={() => setView(compare ? 'flock' : 'overlay')}
        className="w-full flex items-center gap-3.5 p-4 text-left"
      >
        <BothMark size={32} />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-white">{FLOCK_LEAK_COPY.compareTitle}</span>
          <span className="block mt-0.5 text-xs text-dark-300 leading-relaxed">{FLOCK_LEAK_COPY.compareDetail}</span>
        </span>
        <Switch on={compare} large />
      </button>
      {compare && (
        <div className="px-4 pb-4">
          <ul className="pt-3 border-t border-[#2196E8]/25 space-y-2 text-sm text-dark-100" aria-label="How to read the map">
            <li className="flex items-center gap-3"><BothMark size={18} />On both maps</li>
            <li className="flex items-center gap-3"><FlockRingMark size={18} />Only in Flock&apos;s records</li>
            <li className="flex items-center gap-3"><OsmDotMark size={18} />Only on OSM</li>
          </ul>
          {seedHolds && <p className="mt-3 text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.compareSeed}</p>}
        </div>
      )}
    </section>
  );
}

/** The desktop side panel and the mobile full sheet. The OSM comparison
 *  leads, as the page's main control; then what this is and where it came
 *  from, how to narrow it, and what to do with it. The marks' legend is a
 *  button on the map (FlockLegendControl). */
export function FlockLeakPanelContent() {
  return (
    <div className="space-y-8">
      <CompareControl />

      <section>
        <p className="text-[15px] leading-relaxed text-dark-100">{FLOCK_LEAK_COPY.lede}</p>
        <p className="mt-3 text-sm leading-relaxed text-dark-300">{FLOCK_LEAK_COPY.source}</p>
        <ul className="mt-4 border-t border-hairline">
          {RESEARCH_LINKS.map((l) => (
            <li key={l.href} className="border-b border-hairline">
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 min-h-11 lg:min-h-10 text-sm text-accent-hover hover:text-white transition-colors"
              >
                {l.label}
                <ArrowUpRight className="w-4 h-4 flex-shrink-0 opacity-70" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionLabel>Filter Flock&apos;s records</SectionLabel>
        <FlockFilterChips showCounts />
      </section>

      <section>
        <SectionLabel>Before you edit OSM</SectionLabel>
        <p className="text-sm leading-relaxed text-dark-300">{FLOCK_LEAK_COPY.caveat}</p>
        <a
          href="https://deflock.org/app"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block w-full text-center px-4 py-3 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          {FLOCK_LEAK_COPY.ctaButton}
        </a>
      </section>

      <div className="space-y-3 text-xs text-dark-500 leading-relaxed">
        <p>{FLOCK_LEAK_COPY.hidden}</p>
        <p>{FLOCK_LEAK_COPY.credit}</p>
      </div>
    </div>
  );
}
