import { Popup, Marker } from 'react-map-gl/maplibre';
import { useFlockLeakStore, type FlockLeakView, type FlockSelection } from '../../store/flockLeakStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  FLOCK_GROUP_SHORT,
  FLOCK_GROUP_SINGULAR,
  FLOCK_STATUS_LABEL,
  FLOCK_QUALITY_LABEL,
  FLOCK_FEATURE_LABEL,
  flockTypeLabel,
  formatCreated,
  typeCountLine,
  type FlockDeviceRecord,
} from '../../lib/flockInventory';
import { FLOCK_LEAK_SNAPSHOT_LABEL, FLOCK_LEAK_RESEARCHER, flockTableUrlAt } from '../../services/flockLeakTilesService';
import { flockNearbyHint } from '../../utils/flockNearby';
import { FLOCK_GROUP_COLOR } from './layers/flockLeakIcons';

const MAX_DEVICES = 8;

const streetViewUrl = (lat: number, lon: number): string =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;

const LINK_CLASS = 'flex-1 px-3 py-2 text-xs text-center bg-dark-600 hover:bg-dark-500 text-dark-200 rounded-lg transition-colors font-medium';

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-dark-600 text-dark-200"
      style={color ? { color, backgroundColor: `${color}26` } : undefined}
    >
      {children}
    </span>
  );
}

/** A device at the tapped spot. Only the lead device gets the detail rows;
 *  the rest (usually its compute box) stay one line of name and tags, so a
 *  stack fits on screen. "View in table" has every field. */
function DeviceRow({ d, showType, detailed }: { d: FlockDeviceRecord; showType: boolean; detailed: boolean }) {
  const created = formatCreated(d.created);
  return (
    <li className="py-2 border-t border-dark-600 first:border-t-0 first:pt-0">
      <p className="text-xs text-white font-medium break-words">{d.name || flockTypeLabel(d.type)}</p>
      <div className="flex flex-wrap gap-1 mt-1">
        {showType && <Tag color={FLOCK_GROUP_COLOR[d.g]}>{flockTypeLabel(d.type)}</Tag>}
        <Tag>{FLOCK_STATUS_LABEL[d.s]}</Tag>
        {d.q !== 0 && <Tag>{FLOCK_QUALITY_LABEL[d.q]}</Tag>}
      </div>
      {detailed && <dl className="mt-1.5 space-y-0.5 text-[11px]">
        {created && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Created</dt><dd className="text-dark-200">{created}</dd></div>
        )}
        {d.features.length > 0 && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Capabilities</dt><dd className="text-dark-200 text-right">{d.features.map((f) => FLOCK_FEATURE_LABEL[f] ?? f).join(', ')}</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt className="text-dark-400">Flock ID</dt><dd className="text-dark-300 font-mono">{d.id}</dd></div>
      </dl>}
    </li>
  );
}

/**
 * The tapped spot's full record: the desktop popup's body, and on phones
 * the top of the drawer sheet. The sheet leaves off the outbound links
 * (user's call, 2026-09-25) and lets the device list run at full length,
 * since the sheet scrolls; the popup caps the list and scrolls it.
 */
export function FlockSelectionDetails({ sel, view, variant = 'popup' }: { sel: FlockSelection; view: FlockLeakView; variant?: 'popup' | 'sheet' }) {
  const inPopup = variant === 'popup';
  const lead = sel.devices[0];
  const hint = flockNearbyHint({
    zoom: sel.zoom,
    type: lead && lead.g === 1 ? 'alpr' : 'other',
    nearestMeters: sel.nearestOsmMeters,
    osmVisible: view !== 'flock',
  });
  const color = sel.g ? FLOCK_GROUP_COLOR[sel.g] : undefined;

  return (
    <>
      {sel.devices.length === 0 ? (
        <>
          <h3 className="font-display font-semibold text-white text-base">
            Flock {sel.g ? FLOCK_GROUP_SHORT[sel.g] : 'device'}
          </h3>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {sel.s && <Tag color={color}>{FLOCK_STATUS_LABEL[sel.s]}</Tag>}
            {sel.q !== null && sel.q !== 0 && <Tag>{FLOCK_QUALITY_LABEL[sel.q]}</Tag>}
          </div>
          <p className="mt-3 text-xs text-dark-300">Zoom in for device names and details.</p>
        </>
      ) : (
        <>
          {sel.devices.length === 1 ? (
            <>
              <h3 className="font-display font-semibold text-white text-base">{flockTypeLabel(lead.type)}</h3>
              <p className="text-xs text-dark-400 mt-0.5">{FLOCK_GROUP_SINGULAR[lead.g]}</p>
            </>
          ) : (
            <>
              <h3 className="font-display font-semibold text-white text-base">{sel.devices.length} devices on one spot</h3>
              <p className="text-xs text-dark-400 mt-0.5">{typeCountLine(sel.devices)}</p>
            </>
          )}
          <ul className={`mt-3 ${inPopup ? 'max-h-64 overflow-y-auto' : ''}`}>
            {sel.devices.slice(0, MAX_DEVICES).map((d, i) => (
              <DeviceRow key={d.id} d={d} showType={sel.devices.length > 1} detailed={i === 0} />
            ))}
          </ul>
          {sel.devices.length > MAX_DEVICES && (
            <p className="text-[11px] text-dark-400 mt-1">and {sel.devices.length - MAX_DEVICES} more at this spot</p>
          )}
        </>
      )}
      <p className="mt-3 pt-3 border-t border-dark-600 text-xs text-dark-400 leading-relaxed">
        Flock&apos;s records as of {FLOCK_LEAK_SNAPSHOT_LABEL}, via {FLOCK_LEAK_RESEARCHER}. Agency fields were blank.
      </p>
      {hint && <p className="mt-2 text-xs text-[#93CBFF]">{hint}</p>}
      {inPopup && sel.devices.length > 0 && (
        <div className="flex gap-2 mt-3">
          <a
            href={flockTableUrlAt(sel.lat, sel.lon)}
            target="_blank"
            rel="noopener noreferrer"
            title={`These records in ${FLOCK_LEAK_RESEARCHER}'s table`}
            className={LINK_CLASS}
          >
            View in table
          </a>
          <a href={streetViewUrl(sel.lat, sel.lon)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            Street View
          </a>
        </div>
      )}
    </>
  );
}

/** A tap on the Flock layer. Desktop: a popup at the device. Phones: a ring
 *  on the device, with its details in the drawer peek (FlockDevicePeek),
 *  because a popup there slid under the search bar, the drawer and the map
 *  buttons. Rendered inside <Map>. */
export function FlockLeakPopup() {
  const sel = useFlockLeakStore((s) => s.selection);
  const setSelection = useFlockLeakStore((s) => s.setSelection);
  const view = useFlockLeakStore((s) => s.view);
  const isMobile = useIsMobile();
  if (!sel) return null;

  if (isMobile) {
    return (
      <Marker longitude={sel.lon} latitude={sel.lat} anchor="center" style={{ pointerEvents: 'none' }}>
        <span
          className="block w-[34px] h-[34px] rounded-full"
          style={{ boxShadow: '0 0 0 2px #fff, 0 0 0 5px rgba(0, 0, 0, 0.45)' }}
          aria-hidden="true"
        />
      </Marker>
    );
  }

  return (
    // No fixed anchor: MapLibre opens it downward near the top edge, so a
    // tall device list never slides under the search bar.
    <Popup
      longitude={sel.lon}
      latitude={sel.lat}
      onClose={() => setSelection(null)}
      closeOnClick={false}
      className="camera-popup-maplibre"
      maxWidth="300px"
    >
      <div className="min-w-[250px] max-w-[290px] p-4">
        <FlockSelectionDetails sel={sel} view={view} />
      </div>
    </Popup>
  );
}
