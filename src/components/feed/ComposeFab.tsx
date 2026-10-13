'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PenSquare } from 'lucide-react';

// The feed's "write a post" button (feed redesign 2026-10-12). Rendered into
// <body>: inside the page it sat under PageTransition's transform while that
// played, so it was placed against the page and then jumped to the screen edge
// when the animation ended — the feed's only layout shift (lab, 2026-10-13).
export function ComposeFab({ label, onClick }: { label: string; onClick: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="md:hidden fixed left-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-white shadow-[0_12px_26px_rgba(0,0,0,0.28)] active:scale-95 transition-transform bottom-[calc(env(safe-area-inset-bottom)+92px)]"
      data-testid="compose-fab"
    >
      <PenSquare className="h-6 w-6" />
    </button>,
    document.body,
  );
}
