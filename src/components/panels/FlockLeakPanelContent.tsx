import { ExternalLink } from 'lucide-react';
import { FLOCK_LEAK_STORY_URL } from '../../services/flockLeakTilesService';
import { FLOCK_SELECTABLE_GROUPS, FLOCK_GROUP_SHORT } from '../../lib/flockInventory';
import { FlockFilterChips, GroupSwatch } from '../map/FlockFilterChips';
import { FlockViewSwitch } from '../map/FlockViewSwitch';

/** Every user-facing string on the tab (spec section 9, v2 totals). No em dashes. */
export const FLOCK_LEAK_COPY = {
  title: 'Flock Leak',
  subtitle: 'Leaked Flock device inventory, December 14, 2025',
  peek: "Flock's own device list, leaked Dec 2025.",
  osmTitle: 'OpenStreetMap',
  osm: 'Crowdsourced by volunteers. Updated hourly. Can be incomplete or mis-tagged.',
  flockTitle: 'Flock leak',
  flock: "Flock's own device inventory, exported December 14, 2025 and published by a security researcher. Snapshot only, never updated. Agency fields were blank in the export.",
  totals: '335,701 devices in the export, including planned, decommissioned and flagged records. 163,540 clean locations in service.',
  warning: 'Nine months separate these datasets. A device on one side and not the other proves nothing. Verify in person before editing OSM.',
  noHeading: 'Direction cones come from OSM only. The leak records how a housing is mounted, not where it points.',
  about: "This data comes from a security researcher's disclosure of Flock Safety's internal device inventory, published at flocksurveillance.org. DeFlock is not affiliated with Flock Safety.",
  aboutLink: 'Read the story',
  cta: 'Found a camera that is not on OSM? Verify it in person, then add it with the DeFlock app.',
  ctaButton: 'Download the DeFlock App',
  pillError: 'Flock data unavailable. Tap to retry.',
  pillLoading: 'Loading Flock data',
} as const;

function OsmDot() {
  return <span className="w-2.5 h-2.5 rounded-full bg-[#2196E8] border border-[#93CBFF] shadow-[0_0_6px_rgba(77,166,255,0.6)] inline-block flex-shrink-0" aria-hidden="true" />;
}

/** The plate-reader mark: the OSM lens in red (flockCompareStyle). */
function FlockLens() {
  return <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626] border border-[#fca5a5] shadow-[0_0_6px_rgba(248,113,113,0.6)] inline-block flex-shrink-0" aria-hidden="true" />;
}

export function FlockLeakLegend() {
  return (
    <div className="space-y-1.5 text-xs text-dark-300">
      <div className="flex items-center gap-2"><OsmDot /><span>OSM camera (crowdsourced, live)</span></div>
      <div className="flex items-center gap-3 flex-wrap">
        {FLOCK_SELECTABLE_GROUPS.map((g) => (
          <span key={g} className="flex items-center gap-1.5"><GroupSwatch g={g} />{FLOCK_GROUP_SHORT[g]}</span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border border-dashed border-danger inline-block" aria-hidden="true" />Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-danger/35 inline-block" aria-hidden="true" />Decommissioned
        </span>
      </div>
      <p className="text-[11px] text-dark-500 leading-snug">{FLOCK_LEAK_COPY.noHeading}</p>
    </div>
  );
}

interface FlockLeakPanelContentProps {
  showViewSwitch?: boolean;
  showFilters?: boolean;
}

/** Shared by the desktop panel and the mobile full sheet. */
export function FlockLeakPanelContent({ showViewSwitch = false, showFilters = false }: FlockLeakPanelContentProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-hairline bg-dark-800/60">
          <span className="mt-1"><OsmDot /></span>
          <div>
            <p className="text-sm font-semibold text-white">{FLOCK_LEAK_COPY.osmTitle}</p>
            <p className="text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.osm}</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-hairline bg-dark-800/60">
          <span className="mt-1"><FlockLens /></span>
          <div>
            <p className="text-sm font-semibold text-white">{FLOCK_LEAK_COPY.flockTitle}</p>
            <p className="text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.flock}</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-dark-300 leading-relaxed">{FLOCK_LEAK_COPY.totals}</p>

      {showViewSwitch && <FlockViewSwitch />}

      {showFilters && <FlockFilterChips showCounts />}

      <FlockLeakLegend />

      <div className="p-3 rounded-lg border border-danger/30 bg-danger/[0.08]">
        <p className="text-xs text-dark-200 leading-relaxed">{FLOCK_LEAK_COPY.warning}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-dark-400 leading-relaxed">{FLOCK_LEAK_COPY.about}</p>
        <a
          href={FLOCK_LEAK_STORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          {FLOCK_LEAK_COPY.aboutLink}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>

      <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 space-y-3">
        <p className="text-xs text-dark-300 leading-relaxed">{FLOCK_LEAK_COPY.cta}</p>
        <a
          href="https://deflock.org/app"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center px-4 py-2.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          {FLOCK_LEAK_COPY.ctaButton}
        </a>
      </div>
    </div>
  );
}
