import type { FlockLeakView, FlockSelection } from '../store/flockLeakStore';
import {
  FLOCK_GROUP_SHORT,
  FLOCK_GROUP_SINGULAR,
  FLOCK_STATUS_LABEL,
  flockTypeLabel,
  formatCreated,
  typeCountLine,
} from '../lib/flockInventory';
import { flockNearbyHint } from './flockNearby';

/** The tapped device in short, for the mobile peek: a title with a meta
 *  line beside it, then up to two lines. The full record is in the sheet. */
export interface FlockSelectionSummary {
  title: string;
  meta: string | null;
  primary: string | null;
  secondary: string | null;
  /** The secondary line is the nearby-OSM hint (drawn in the OSM blue). */
  secondaryIsHint: boolean;
}

export function flockSelectionSummary(sel: FlockSelection, view: FlockLeakView): FlockSelectionSummary {
  const lead = sel.devices[0];
  if (!lead) {
    // Below z9 the tiles carry merged points: group and status only.
    return {
      title: `Flock ${sel.g ? FLOCK_GROUP_SHORT[sel.g] : 'device'}`,
      meta: sel.s ? FLOCK_STATUS_LABEL[sel.s] : null,
      primary: 'Zoom in for device names and details.',
      secondary: null,
      secondaryIsHint: false,
    };
  }

  const hint = flockNearbyHint({
    zoom: sel.zoom,
    type: lead.g === 1 ? 'alpr' : 'other',
    nearestMeters: sel.nearestOsmMeters,
    osmVisible: view !== 'flock',
  });

  if (sel.devices.length > 1) {
    return {
      title: `${sel.devices.length} devices on one spot`,
      meta: null,
      primary: typeCountLine(sel.devices),
      secondary: hint ?? (lead.name || null),
      secondaryIsHint: hint !== null,
    };
  }

  const created = formatCreated(lead.created);
  return {
    title: flockTypeLabel(lead.type),
    meta: `${FLOCK_GROUP_SINGULAR[lead.g]} · ${FLOCK_STATUS_LABEL[lead.s]}`,
    primary: lead.name || null,
    secondary: hint ?? (created ? `Created ${created.replace(/^On or before/, 'on or before')}` : null),
    secondaryIsHint: hint !== null,
  };
}
