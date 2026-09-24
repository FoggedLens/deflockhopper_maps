import { StatusPill } from '@/components/common/StatusPill';
import { useFlockLeakStore } from '@/store/flockLeakStore';
import { FLOCK_LEAK_COPY } from '@/components/panels/FlockLeakPanelContent';

/** Leak-tab pill: TileJSON or tile failure is a tap-to-retry, never a blank map. */
export function FlockLeakStatusPill() {
  const loadPhase = useFlockLeakStore((s) => s.loadPhase);
  const tilesFailed = useFlockLeakStore((s) => s.tilesFailed);
  const retry = useFlockLeakStore((s) => s.retry);

  if (loadPhase === 'error' || tilesFailed) {
    return <StatusPill loading={false} text="" error={FLOCK_LEAK_COPY.pillError} onRetry={retry} />;
  }
  return <StatusPill loading={loadPhase === 'loading'} text={FLOCK_LEAK_COPY.pillLoading} />;
}
