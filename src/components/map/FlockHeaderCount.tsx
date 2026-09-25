import { useMapStore } from '../../store';
import { useFlockLeakStore } from '../../store/flockLeakStore';
import { formatFlockHeaderCount } from '../../utils/flockHeaderCount';

/** Leak-tab counterpart of HeaderCameraCount. Idle-driven counts only.
 *  In both headers: xs on phones, sm beside the desktop Share link. */
export function FlockHeaderCount({ className = '' }: { className?: string }) {
  const zoom = useMapStore((s) => s.zoom);
  const flockCount = useMapStore((s) => s.tileViewFlockCount);
  const osmCount = useMapStore((s) => s.tileViewCameraCount);
  const view = useFlockLeakStore((s) => s.view);
  return (
    <span className={`text-xs lg:text-sm text-dark-400 tabular-nums ${className}`}>
      {formatFlockHeaderCount({ zoom, view, flockCount, osmCount })}
    </span>
  );
}
