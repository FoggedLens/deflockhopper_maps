import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { FLOCK_LEAK_LINKS, FLOCK_LEAK_RESEARCHER } from '../../services/flockLeakTilesService';
import { FLOCK_SELECTABLE_GROUPS, FLOCK_GROUP_LABEL, FLOCK_INVENTORY } from '../../lib/flockInventory';
import { FlockFilterChips, GroupSwatch } from '../map/FlockFilterChips';
import { Switch } from '../map/FlockCompareToggle';
import { BothMark, FlockLensMark, FlockPlannedMark, FlockRingMark, OsmDotMark } from '../map/FlockLeakMarks';

const DEVICES = FLOCK_INVENTORY.devices.toLocaleString();

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
  lede: `This is Flock Safety's own list of its devices: ${DEVICES} records of plate readers, cameras, audio sensors and drones, whether installed, planned or taken down.`,
  source: `Security researcher ${FLOCK_LEAK_RESEARCHER} downloaded the list from Flock's systems on December 14, 2025, through a flaw he had reported to Flock a month earlier. It is a snapshot and is never updated.`,
  flockLayer: "Flock's records",
  flockLayerDetail: 'Snapshot of Dec 14, 2025. Never updated.',
  osmLayer: 'OSM cameras',
  osmLayerDetail: 'Mapped by volunteers on OpenStreetMap. Updated hourly.',
  statusNote: 'The map starts with devices in service. Show planned and decommissioned ones with the Flock filter.',
  compareNote: "Comparing starts with Flock's plate readers and OSM cameras tagged Flock Safety. Change either side with its filter.",
  caveat: "Flock's list stops at December 14, 2025, and OSM is live. A camera on one map and not the other is a lead, not proof. Check it in person before you add or remove anything.",
  ctaButton: 'Add a camera with the DeFlock app',
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

/** One dataset on the map: its mark, name and provenance line. Spans only,
 *  so the OSM row can sit inside its switch button. */
function LayerRow({ mark, title, detail, trailing }: { mark: ReactNode; title: string; detail: string; trailing?: ReactNode }) {
  return (
    <span className="flex items-start gap-3 py-3">
      <span className="mt-px">{mark}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="block text-xs text-dark-400 leading-relaxed">{detail}</span>
      </span>
      {trailing}
    </span>
  );
}

const KEY: ReadonlyArray<{ mark: ReactNode; label: string; short: string }> = [
  { mark: <BothMark size={16} />, label: 'On both maps', short: 'Both' },
  { mark: <FlockRingMark size={16} />, label: "Only in Flock's records", short: 'Flock only' },
  { mark: <OsmDotMark size={16} />, label: 'Only on OSM', short: 'OSM only' },
];

/** How to read one dataset over the other. `inline` is the one-line form
 *  the mobile peek shows in place of its description while comparing; it
 *  is spans only because the peek row is a button. */
export function FlockCompareKey({ inline = false, className = '' }: { inline?: boolean; className?: string }) {
  if (inline) {
    return (
      <span className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-dark-200 ${className}`}>
        {KEY.map((k) => (
          <span key={k.short} className="flex items-center gap-1.5">{k.mark}{k.short}</span>
        ))}
      </span>
    );
  }
  return (
    <ul aria-label="How to read the marks" className={`space-y-2.5 text-xs text-dark-200 ${className}`}>
      {KEY.map((k) => (
        <li key={k.short} className="flex items-center gap-3">{k.mark}{k.label}</li>
      ))}
    </ul>
  );
}

/** The two datasets as map layers. Flock's records are the tab and always
 *  on; the OSM row is the compare switch, and while it is on the key says
 *  how to read one mark over the other. */
function MapLayers() {
  const compare = useFlockLeakStore((s) => s.view === 'overlay');
  const setView = useFlockLeakStore((s) => s.setView);
  return (
    <section>
      <SectionLabel>On the map</SectionLabel>
      <div className="border-y border-hairline divide-y divide-hairline">
        <div>
          <LayerRow
            mark={compare ? <FlockRingMark /> : <FlockLensMark />}
            title={FLOCK_LEAK_COPY.flockLayer}
            detail={FLOCK_LEAK_COPY.flockLayerDetail}
          />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={compare}
          aria-label="Compare with OSM cameras"
          onClick={() => setView(compare ? 'flock' : 'overlay')}
          className="block w-full text-left"
        >
          <LayerRow
            mark={<OsmDotMark />}
            title={FLOCK_LEAK_COPY.osmLayer}
            detail={FLOCK_LEAK_COPY.osmLayerDetail}
            trailing={<span className="mt-0.5"><Switch on={compare} /></span>}
          />
        </button>
      </div>
      {compare && (
        <div className="mt-4">
          <FlockCompareKey />
          <p className="mt-3 text-xs text-dark-500 leading-relaxed">{FLOCK_LEAK_COPY.compareNote}</p>
        </div>
      )}
    </section>
  );
}

/** Legend for the mobile sheet, where the chips (which carry the marks on
 *  desktop) sit behind the map's filter button. */
function DeviceLegend() {
  return (
    <section>
      <SectionLabel>Device types</SectionLabel>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs text-dark-200">
        {FLOCK_SELECTABLE_GROUPS.map((g) => (
          <li key={g} className="flex items-center gap-2.5">
            <span className="w-3.5 flex justify-center"><GroupSwatch g={g} size={10} /></span>
            {FLOCK_GROUP_LABEL[g]}
          </li>
        ))}
      </ul>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-dark-200" aria-label="Status">
        <li className="flex items-center gap-1.5"><FlockLensMark size={14} />In service</li>
        <li className="flex items-center gap-1.5"><FlockPlannedMark size={14} />Planned</li>
        <li className="flex items-center gap-1.5"><FlockLensMark size={14} dimmed />Decommissioned</li>
      </ul>
      <p className="mt-3 text-xs text-dark-500 leading-relaxed">{FLOCK_LEAK_COPY.statusNote}</p>
    </section>
  );
}

interface FlockLeakPanelContentProps {
  /** Desktop: the Flock filters live here. Mobile keeps them on the map
   *  button and shows a plain legend instead. */
  showFilters?: boolean;
}

/** Shared by the desktop panel and the mobile full sheet. Reads top to
 *  bottom as: what this is, where it came from, what is on the map, and
 *  what to do with it. */
export function FlockLeakPanelContent({ showFilters = false }: FlockLeakPanelContentProps) {
  return (
    <div className="space-y-8">
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

      <MapLayers />

      {showFilters ? (
        <section>
          <SectionLabel>Filter Flock&apos;s records</SectionLabel>
          <FlockFilterChips showCounts />
        </section>
      ) : (
        <DeviceLegend />
      )}

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

      <p className="text-xs text-dark-500 leading-relaxed">{FLOCK_LEAK_COPY.credit}</p>
    </div>
  );
}
