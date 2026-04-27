import { ExternalLink } from 'lucide-react';
import { useMapStore } from '../../store/mapStore';

const LEGACY_MAP_BASE_URL = 'https://deflock.org/legacy-map';
const LEGACY_MAP_LABEL = 'DeFlock Legacy Map';

interface LegacyMapLinkProps {
  variant: 'header' | 'button' | 'menu-item';
  className?: string;
}

export function LegacyMapLink({ variant, className = '' }: LegacyMapLinkProps) {
  const { center, zoom } = useMapStore();
  const legacyMapUrl = `${LEGACY_MAP_BASE_URL}#map=${Math.round(zoom)}/${center[0].toFixed(6)}/${center[1].toFixed(6)}`;
  if (variant === 'header') {
    return (
      <a
        href={legacyMapUrl}
        className={`text-sm text-dark-400 hover:text-dark-200 transition-colors ${className}`}
      >
        {LEGACY_MAP_LABEL}
      </a>
    );
  }

  if (variant === 'menu-item') {
    return (
      <a
        href={legacyMapUrl}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-dark-400 hover:text-dark-200 transition-colors ${className}`}
      >
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
        <span>{LEGACY_MAP_LABEL}</span>
      </a>
    );
  }

  // variant === 'button'
  return (
    <a
      href={legacyMapUrl}
      className={`flex-1 inline-flex items-center justify-center gap-2 py-3 bg-dark-700 hover:bg-dark-600 text-white font-medium rounded-md transition-colors ${className}`}
    >
      <ExternalLink className="w-4 h-4" aria-hidden="true" />
      {LEGACY_MAP_LABEL}
    </a>
  );
}
