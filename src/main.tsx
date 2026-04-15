import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ErrorBoundary } from './components/common';
import { useCameraStore } from './store/cameraStore';
import './index.css';

// Polyfill for Safari (doesn't support requestIdleCallback)
if (typeof window !== 'undefined' && !window.requestIdleCallback) {
  window.requestIdleCallback = (callback: IdleRequestCallback): number => {
    const start = Date.now();
    return window.setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, 1) as unknown as number;
  };
  window.cancelIdleCallback = (id: number) => clearTimeout(id);
}

// Lazy load pages for code splitting
const MapPage = lazy(() => import('./pages/MapPage').then(m => ({ default: m.MapPage })));
const NotFound = lazy(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));

function PageLoader() {
  return (
    <div className="h-screen w-screen flex flex-col bg-dark-900 overflow-hidden">
      {/* Match MapLoadingScreen header layout exactly for seamless transition */}
      <header className="h-14 lg:h-16 bg-dark-900 border-b border-dark-600 flex items-center z-50 shrink-0">
        <div className="w-full px-3 lg:px-6">
          <div className="flex items-center justify-between h-14 lg:h-16">
            <div className="flex items-center gap-2">
              <img src="/deflock-icon.png" alt="DeFlock Icon" className="h-8 lg:h-10 w-auto object-contain" />
              <img src="/deflock-logo.svg" alt="DeFlock Logo" className="h-8 lg:h-10 w-auto object-contain" />
            </div>
            <div className="flex items-center gap-2 bg-dark-800 rounded-full px-3 py-1.5">
              <div className="w-3 h-3 border-2 border-dark-600 border-t-accent rounded-full animate-spin" />
              <span className="text-sm text-dark-300">Loading...</span>
            </div>
            <div className="hidden lg:flex items-center gap-4 flex-shrink-0" />
          </div>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center relative pb-14 lg:pb-16">
        <div className="relative z-10 flex flex-col items-center gap-6 lg:gap-8">
          <div className="flex items-center gap-2 lg:gap-3">
            <img src="/deflock-icon.png" alt="DeFlock Icon" className="h-12 lg:h-24 w-auto object-contain" />
            <img src="/deflock-logo.svg" alt="DeFlock" className="h-12 lg:h-24 w-auto object-contain" />
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-dark-700 border-t-accent rounded-full animate-spin" />
            <span className="text-dark-300 text-sm">Initializing...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * PreloadManager - Starts camera data fetch in the background.
 * Uses requestIdleCallback to avoid blocking user interactions.
 */
function PreloadManager() {
  const preloadCameras = useCameraStore((state) => state.preloadCameras);
  const isInitialized = useCameraStore((state) => state.isInitialized);

  useEffect(() => {
    if (!isInitialized) {
      // Start camera fetch immediately — no idle delay.
      // The map loads tiles in parallel, so no reason to wait.
      preloadCameras();
    }
  }, [isInitialized, preloadCameras]);

  useEffect(() => {
    if (!document.querySelector('link[href="/cameras-us.json"]')) {
      const prefetchLink = document.createElement('link');
      prefetchLink.rel = 'prefetch';
      prefetchLink.href = '/cameras-us.json';
      prefetchLink.as = 'fetch';
      prefetchLink.crossOrigin = 'anonymous';
      document.head.appendChild(prefetchLink);
    }
  }, []);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <BrowserRouter>
          <PreloadManager />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<MapPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/explore" element={<MapPage />} />
              <Route path="/timeline" element={<MapPage />} />
              <Route path="/analysis" element={<MapPage />} />
              <Route path="/network" element={<MapPage />} />
              <Route path="/route" element={<MapPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </HelmetProvider>
    </ErrorBoundary>
  </StrictMode>
);
