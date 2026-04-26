import { useEffect, useCallback, useState, useRef } from 'react';
import { X, Link, Code, Download, Check } from 'lucide-react';
import { buildShareURL } from '@/utils/urlParams';

interface ShareModalProps {
  onClose: () => void;
}

function useCopyFeedback() {
  const [copied, setCopied] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    clearTimeout(timerRef.current);
    setCopied(key);
    timerRef.current = setTimeout(() => setCopied(null), 2000);
  }, []);

  return { copied, copy };
}

export function ShareModal({ onClose }: ShareModalProps) {
  const { copied, copy } = useCopyFeedback();
  const [downloading, setDownloading] = useState(false);

  // Snapshot URL once when modal opens
  const [shareURL] = useState(buildShareURL);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      // Re-use browser cache (same URL / headers as preload — no network request)
      const response = await fetch('https://data.dontgetflocked.com/cameras.geojson.gz', {
        headers: { 'Accept': 'application/geo+json, application/json' },
        cache: 'default',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Browser decompresses via Content-Encoding: gzip, so blob is plain GeoJSON
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'cameras.geojson';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: open in new tab so the browser handles it
      window.open('https://data.dontgetflocked.com/cameras.geojson.gz', '_blank');
    } finally {
      setDownloading(false);
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Share This Map">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-dark-800 rounded-xl border border-dark-600 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-white">Share This Map</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-md text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-5">
          {/* --- Link to this Region --- */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Link className="w-4 h-4 text-dark-300" />
              <span className="text-sm font-medium text-dark-100">Link to this Region</span>
            </div>
            <button
              onClick={() => copy(shareURL, 'link')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                copied === 'link'
                  ? 'bg-green-600 text-white'
                  : 'bg-accent text-dark-900 hover:bg-accent/90'
              }`}
            >
              {copied === 'link' ? (
                <><Check className="w-3.5 h-3.5" /> Copied!</>
              ) : (
                <><Link className="w-3.5 h-3.5" /> Copy Link</>
              )}
            </button>
          </section>

          {/* --- Embed on Your Site --- */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Code className="w-4 h-4 text-dark-300" />
              <span className="text-sm font-medium text-dark-100">Embed on Your Site</span>
            </div>
            <p className="text-xs text-dark-400 mb-3">Embed an interactive map on your website via iframe.</p>
            <div className="bg-dark-900 rounded-md p-3 mb-3 font-mono text-xs text-dark-300 break-all select-all">
              {`<iframe src="${shareURL}" width="100%" height="600" style="border: none;"></iframe>`}
            </div>
            <button
              onClick={() => copy(`<iframe src="${shareURL}" width="100%" height="600" style="border: none;"></iframe>`, 'embed')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                copied === 'embed'
                  ? 'bg-green-600 text-white'
                  : 'bg-accent text-dark-900 hover:bg-accent/90'
              }`}
            >
              {copied === 'embed' ? (
                <><Check className="w-3.5 h-3.5" /> Copied!</>
              ) : (
                <><Code className="w-3.5 h-3.5" /> Copy Embed Code</>
              )}
            </button>
          </section>

          {/* --- Download All Data --- */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Download className="w-4 h-4 text-dark-300" />
              <span className="text-sm font-medium text-dark-100">Download All Data</span>
            </div>
            <p className="text-xs text-dark-400 mb-3">Get the current dataset in GeoJSON format.</p>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium bg-accent text-dark-900 hover:bg-accent/90 border border-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Preparing…' : 'Download GeoJSON'}
            </button>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-dark-600 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm font-medium text-dark-300 hover:text-white transition-colors uppercase tracking-wider"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
