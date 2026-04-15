import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { ShareModal } from './ShareModal';

interface ShareButtonProps {
  variant: 'header' | 'menu-item';
  className?: string;
}

export function ShareButton({ variant, className = '' }: ShareButtonProps) {
  const [open, setOpen] = useState(false);

  if (variant === 'header') {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className={`text-sm text-dark-400 hover:text-dark-200 transition-colors flex items-center gap-1.5 ${className}`}
          aria-label="Share this map view"
        >
          <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
          Share
        </button>
        {open && <ShareModal onClose={() => setOpen(false)} />}
      </>
    );
  }

  // variant === 'menu-item'
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-dark-400 hover:text-dark-200 transition-colors ${className}`}
        aria-label="Share this map view"
      >
        <Share2 className="w-4 h-4" aria-hidden="true" />
        <span>Share View</span>
      </button>
      {open && <ShareModal onClose={() => setOpen(false)} />}
    </>
  );
}
