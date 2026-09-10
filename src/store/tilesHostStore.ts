import { create } from 'zustand';

/**
 * DeFlock tile hosts (verified 2026-09-09). Both serve identical alias paths
 * and every TileJSON carries absolute tile URLs on the host that served it,
 * so switching hosts is switching the TileJSON URL only.
 *
 *  primary: Hetzner origin behind Cloudflare CDN
 *  backup:  the old Cloudflare Worker + R2 — fallback only
 *
 * Every tile-related URL in the app is built from the active host via
 * `getTilesHost()`. The choice is session-local and never persisted: each
 * page load starts on primary again.
 */
export const TILES_HOSTS = {
  primary: 'https://deflock.dontgetflocked.com',
  backup: 'https://tiles.dontgetflocked.com',
} as const;

export type TilesHostId = keyof typeof TILES_HOSTS;

interface TilesHostState {
  hostId: TilesHostId;
  host: string;
  /** Bumps on every host switch. Source components key on it so a switch
   *  remounts them against the new host. */
  epoch: number;
  /** Switch to the backup host. Returns true if a switch happened, false if
   *  already on backup (callers then treat the failure as final). */
  failover: (reason: string) => boolean;
}

export const useTilesHostStore = create<TilesHostState>((set, get) => ({
  hostId: 'primary',
  host: TILES_HOSTS.primary,
  epoch: 0,
  failover: (reason: string) => {
    if (get().hostId === 'backup') return false;
    console.warn(`[tiles] primary host failed (${reason}); switching to backup ${TILES_HOSTS.backup}`);
    set((s) => ({ hostId: 'backup', host: TILES_HOSTS.backup, epoch: s.epoch + 1 }));
    return true;
  },
}));

/** Active tile host origin, no trailing slash. */
export const getTilesHost = (): string => useTilesHostStore.getState().host;

export const failoverTilesHost = (reason: string): boolean =>
  useTilesHostStore.getState().failover(reason);

/** Test hook — not for app code. */
export function _resetTilesHostForTests(): void {
  useTilesHostStore.setState({ hostId: 'primary', host: TILES_HOSTS.primary, epoch: 0 });
}
