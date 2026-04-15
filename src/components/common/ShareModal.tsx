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

  // Snapshot URL once when modal opens
  const [shareURL] = useState(buildShareURL);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const redditURL = `https://www.reddit.com/submit?url=${encodeURIComponent(shareURL)}&title=${encodeURIComponent('DeFlock Maps - ALPR Camera Locations')}`;

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
            <div className="flex gap-2">
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
              <a
                href={redditURL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#FF4500] text-white hover:bg-[#FF4500]/90 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                Reddit
              </a>
            </div>
          </section>

          {/* --- Embed on Your Site (Coming Soon) --- */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Code className="w-4 h-4 text-dark-300" />
              <span className="text-sm font-medium text-dark-100">Embed on Your Site (Coming Soon)</span>
            </div>
            <p className="text-xs text-dark-400 mb-3">Embed an interactive map on your website via iframe.</p>
            <button
              disabled
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium bg-dark-700 text-dark-500 border border-dark-600 cursor-not-allowed"
            >
              <Code className="w-3.5 h-3.5" />
              Coming Soon
            </button>
          </section>

          {/* --- Download All Data (Coming Soon) --- */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Download className="w-4 h-4 text-dark-300" />
              <span className="text-sm font-medium text-dark-100">Download All Data (Coming Soon)</span>
            </div>
            <p className="text-xs text-dark-400 mb-3">Get the complete dataset in GeoJSON format.</p>
            <button
              disabled
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium bg-dark-700 text-dark-500 border border-dark-600 cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              Coming Soon
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
