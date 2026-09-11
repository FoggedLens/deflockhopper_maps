import { useEffect, useState } from 'react';
import { loadCameraTileJson, type CameraTileCountry, type CameraTileJson } from '../services/cameraTilesService';
import { useTilesHostStore } from '../store/tilesHostStore';

/**
 * The camera TileJSON for a country from the active tile host, or null while
 * it loads / when unavailable. Re-resolves after a host failover (epoch).
 * Consumers use its build-pinned companion URLs (filter tileset etc.) and
 * fall back to the unversioned aliases while this is null.
 */
export function useCameraTileJson(country: CameraTileCountry): CameraTileJson | null {
  const epoch = useTilesHostStore((s) => s.epoch);
  const [doc, setDoc] = useState<CameraTileJson | null>(null);
  useEffect(() => {
    let live = true;
    setDoc(null);
    void loadCameraTileJson(country).then((d) => {
      if (live) setDoc(d);
    });
    return () => {
      live = false;
    };
  }, [country, epoch]);
  return doc;
}
