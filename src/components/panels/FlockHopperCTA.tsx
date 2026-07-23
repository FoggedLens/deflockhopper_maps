import { Navigation, Smartphone } from 'lucide-react';

export const APP_STORE_URL = 'https://apps.apple.com/us/app/flockhopper/id6762170253';
export const ANDROID_BETA_URL =
  'https://play.google.com/store/apps/details?id=com.dontgetflocked.flockhopper';
export const LEARN_MORE_URL = 'https://dontgetflocked.com';

const androidHref = ANDROID_BETA_URL || LEARN_MORE_URL;

/** Best store link for the current device: iOS → App Store, Android → beta, else learn-more. */
function getPlatformStoreUrl(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return APP_STORE_URL;
  if (/Android/i.test(ua)) return androidHref;
  return LEARN_MORE_URL;
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}

function PlayStoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 20.5V3.5c0-.59.34-1.11.84-1.35L13.69 12l-9.85 9.85c-.5-.24-.84-.76-.84-1.35zm13.81-5.38L6.05 21.34l8.49-8.49 2.27 2.27zm3.35-4.31c.34.27.59.68.59 1.19s-.22.9-.57 1.18l-2.29 1.32-2.5-2.5 2.5-2.5 2.27 1.31zM6.05 2.66l10.76 6.22-2.27 2.27-8.49-8.49z"/>
    </svg>
  );
}

/** App Store + Android Beta buttons, side by side. */
export function FlockHopperStoreButtons() {
  return (
    <div className="flex gap-2">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-white text-dark-900 text-xs font-bold hover:bg-gray-200 transition-colors"
      >
        <AppleIcon className="w-3.5 h-3.5" />
        App Store
      </a>
      <a
        href={androidHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-dark-800 border border-dark-500 text-gray-200 text-xs font-bold hover:bg-dark-700 transition-colors"
      >
        <PlayStoreIcon className="w-3.5 h-3.5" />
        Android Beta
      </a>
    </div>
  );
}

/** Centered "Learn more" link to dontgetflocked.com. */
export function FlockHopperLearnMore({ className = '' }: { className?: string }) {
  return (
    <a
      href={LEARN_MORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`block text-center text-xs font-medium text-accent hover:text-accent-hover transition-colors ${className}`}
    >
      Learn more at dontgetflocked.com →
    </a>
  );
}

interface FlockHopperCTAProps {
  variant: 'card' | 'row' | 'start' | 'banner';
  /** Card variant only */
  title?: string;
  /** Card variant only */
  description?: string;
}

/**
 * FlockHopper promotion.
 * - `card`: branded card with title, copy, both store buttons, learn-more link.
 * - `row`: slim one-row banner with a platform-aware "Get FlockHopper" link.
 *   Currently unused in src (kept dormant).
 * - `start`: wordmark + availability + red Start-navigation button
 *   (the route peek's whole content once routes exist).
 * - `banner`: logo wordmark + "Get the app" button row with a description
 *   below (used in the mobile route peek's no-routes state).
 */
export function FlockHopperCTA({ variant, title, description }: FlockHopperCTAProps) {
  if (variant === 'banner') {
    // App-install banner: logo and button share one row (common baseline),
    // caption runs beneath. #d80018 is the logo's own red.
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          {/* Trimmed wordmark (FlockHopper-2.webp carries ~20% transparent
              padding); rendered larger since the box is all artwork now */}
          <img
            src="/flockhopper-wordmark.webp"
            alt="FlockHopper"
            width={441}
            height={83}
            decoding="async"
            className="h-10 w-auto"
          />
          <a
            href={LEARN_MORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#d80018] active:bg-[#a80013] text-white text-xs font-bold flex-shrink-0 transition-colors"
          >
            <Smartphone className="w-4 h-4" aria-hidden="true" />
            Get the app
          </a>
        </div>
        <p className="text-xs text-dark-400 leading-snug mt-2.5">
          Real-time, turn-by-turn navigation that avoids ALPR cameras.
        </p>
      </div>
    );
  }

  if (variant === 'start') {
    // Honest ad styled like a nav app's primary action: the label promises
    // navigation in the app, so the store/website redirect is expected.
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <img
            src="/flockhopper-wordmark.webp"
            alt="FlockHopper"
            width={441}
            height={83}
            decoding="async"
            className="h-6 w-auto"
          />
          <span className="text-2xs text-dark-500 uppercase flex-shrink-0">
            Free · iOS &amp; Android
          </span>
        </div>
        <p className="text-xs text-dark-400 leading-snug mt-1.5">
          Real-time, turn-by-turn navigation that avoids ALPR cameras.
        </p>
        <a
          href={getPlatformStoreUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-[#d80018] active:bg-[#a80013] text-white font-display font-bold text-base transition-colors"
        >
          <Navigation className="w-4 h-4" aria-hidden="true" />
          Navigate this route in the app
        </a>
      </div>
    );
  }

  if (variant === 'row') {
    return (
      <a
        href={getPlatformStoreUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-accent-muted border border-accent/40 active:bg-accent/10 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <Navigation className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white">Drive it live</p>
          <p className="text-[11px] text-dark-400 truncate">Real-time navigation in the app</p>
        </div>
        <span className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-bold flex-shrink-0">
          Get FlockHopper
        </span>
      </a>
    );
  }

  return (
    <div className="rounded-xl p-4 bg-gradient-to-br from-blue-500/15 to-blue-500/5 border border-blue-500/40">
      <div className="flex items-center gap-2">
        <Navigation className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <p className="text-sm font-bold text-white">{title}</p>
      </div>
      <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{description}</p>
      <div className="mt-3">
        <FlockHopperStoreButtons />
      </div>
      <FlockHopperLearnMore className="mt-2.5" />
    </div>
  );
}
