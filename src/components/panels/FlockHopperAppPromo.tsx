const APP_STORE_URL = 'https://apps.apple.com/us/app/flockhopper/id6762170253';

export function FlockHopperAppPromo() {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-dark-700/60 border border-dark-600/50 hover:bg-dark-700 hover:border-dark-500 transition-all duration-200"
    >
      <svg className="w-3 h-3 text-dark-300 group-hover:text-dark-100 transition-colors" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
      <span className="text-[11px] font-medium text-dark-400 group-hover:text-dark-200 transition-colors">
        Get the iOS App
      </span>
    </a>
  );
}
