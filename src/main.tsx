import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ErrorBoundary } from './components/common';
import { useCameraStore } from './store/cameraStore';
import { parseCountryParam } from './utils/urlState';
import './index.css';

// Seed the camera country from the URL before anything triggers the lazy
// camera JSON load, so a ?country=ca link downloads only the Canadian dataset.
// (useUrlSync seeds it too, but MapPage is lazy-loaded and can mount later.)
const bootCountry = parseCountryParam(window.location.search);
if (bootCountry) {
  useCameraStore.setState({ country: bootCountry });
}

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
      {/* Mirrors the real MapPage header so the handoff is invisible */}
      <header className="h-[38px] lg:h-12 bg-dark-900 border-b border-hairline flex items-center shrink-0">
        <div className="w-full px-4 lg:px-5 flex items-center gap-2">
          <img src="/deflock-icon.png" alt="DeFlock Icon" className="h-5 lg:h-8 w-auto object-contain" />
          <img src="/deflock-logo.svg" alt="DeFlock Logo" className="h-5 lg:h-8 w-auto object-contain" />
        </div>
      </header>
      <div className="flex-1" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<MapPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/state/:stateSlug" element={<MapPage />} />
              <Route path="/explore" element={<MapPage />} />
              <Route path="/timeline" element={<MapPage />} />
              {/* Legacy alias for the retired Analysis tab; lands on Map (see urlState PATH_MODES) */}
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
