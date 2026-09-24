import { Popup } from 'react-map-gl/maplibre';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import {
  FLOCK_GROUP_LABEL,
  FLOCK_STATUS_LABEL,
  FLOCK_QUALITY_LABEL,
  FLOCK_FEATURE_LABEL,
  flockTypeLabel,
  formatCreated,
  typeCountLine,
  type FlockDeviceRecord,
} from '../../lib/flockInventory';
import { FLOCK_LEAK_SNAPSHOT_LABEL } from '../../services/flockLeakTilesService';
import { flockNearbyHint } from '../../utils/flockNearby';
import { FLOCK_GROUP_COLOR } from './layers/flockLeakIcons';

const MAX_DEVICES = 8;

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

function DeviceRow({ d }: { d: FlockDeviceRecord }) {
  const created = formatCreated(d.created);
  return (
    <li className="py-2 border-t border-dark-600 first:border-t-0 first:pt-0">
      <p className="text-xs text-white font-medium break-words">{d.name || flockTypeLabel(d.type)}</p>
      <div className="flex flex-wrap gap-1 mt-1">
        <Tag color={FLOCK_GROUP_COLOR[d.g]}>{flockTypeLabel(d.type)}</Tag>
        <Tag>{FLOCK_STATUS_LABEL[d.s]}</Tag>
        {d.q !== 0 && <Tag>{FLOCK_QUALITY_LABEL[d.q]}</Tag>}
      </div>
      <dl className="mt-1.5 space-y-0.5 text-[11px]">
        {created && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Created</dt><dd className="text-dark-200">{created}</dd></div>
        )}
        {d.features.length > 0 && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Capabilities</dt><dd className="text-dark-200 text-right">{d.features.map((f) => FLOCK_FEATURE_LABEL[f] ?? f).join(', ')}</dd></div>
        )}
        {d.rotationAngle !== null && (
          <div className="flex justify-between gap-3"><dt className="text-dark-400">Mount angle</dt><dd className="text-dark-200">{Math.round(d.rotationAngle)}°</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt className="text-dark-400">Flock ID</dt><dd className="text-dark-300 font-mono">{d.id}</dd></div>
      </dl>
    </li>
  );
}

/** Popup for a tap on the Flock layer. Rendered inside <Map>. */
export function FlockLeakPopup() {
  const sel = useFlockLeakStore((s) => s.selection);
  const setSelection = useFlockLeakStore((s) => s.setSelection);
  const view = useFlockLeakStore((s) => s.view);
  if (!sel) return null;

  const lead = sel.devices[0];
  const hint = flockNearbyHint({
    zoom: sel.zoom,
    type: lead && lead.g === 1 ? 'alpr' : 'other',
    nearestMeters: sel.nearestOsmMeters,
    osmVisible: view !== 'flock',
  });
  const color = sel.g ? FLOCK_GROUP_COLOR[sel.g] : undefined;

  return (
    <Popup
      longitude={sel.lon}
      latitude={sel.lat}
      anchor="bottom"
      onClose={() => setSelection(null)}
      closeOnClick={false}
      className="camera-popup-maplibre"
      maxWidth="300px"
    >
      <div className="min-w-[250px] max-w-[290px] p-4">
        {sel.devices.length === 0 ? (
          <>
            <h3 className="font-display font-semibold text-white text-base">
              Flock {sel.g ? FLOCK_GROUP_LABEL[sel.g].toLowerCase() : 'device'}
            </h3>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {sel.s && <Tag color={color}>{FLOCK_STATUS_LABEL[sel.s]}</Tag>}
              {sel.q !== null && sel.q !== 0 && <Tag>{FLOCK_QUALITY_LABEL[sel.q]}</Tag>}
            </div>
            <p className="mt-3 text-xs text-dark-300">Zoom in for device names and details.</p>
          </>
        ) : (
          <>
            <h3 className="font-display font-semibold text-white text-base">
              {sel.devices.length === 1 ? '1 device here' : `${sel.devices.length} devices at this exact coordinate`}
            </h3>
            {sel.devices.length > 1 && <p className="text-xs text-dark-400 mt-0.5">{typeCountLine(sel.devices)}</p>}
            <ul className="mt-3 max-h-64 overflow-y-auto">
              {sel.devices.slice(0, MAX_DEVICES).map((d) => <DeviceRow key={d.id} d={d} />)}
            </ul>
            {sel.devices.length > MAX_DEVICES && (
              <p className="text-[11px] text-dark-400 mt-1">and {sel.devices.length - MAX_DEVICES} more at this spot</p>
            )}
          </>
        )}
        <p className="mt-3 pt-3 border-t border-dark-600 text-xs text-dark-400">
          Leaked inventory. Position as of {FLOCK_LEAK_SNAPSHOT_LABEL}. Agency fields were blank in the export.
        </p>
        {hint && <p className="mt-2 text-xs text-[#93CBFF]">{hint}</p>}
      </div>
    </Popup>
  );
}
