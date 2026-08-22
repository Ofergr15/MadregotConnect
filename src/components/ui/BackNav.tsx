'use client';

import { useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Native-feeling "back" affordance for a drill-in detail screen (Profile's
// Personal Info, Settings' sub-tabs, a teammate's profile, ...) — was a bare
// text link before; now a real button (background + press feedback), plus an
// iOS-style edge-swipe-back gesture: a swipe starting near either screen edge
// that travels left fires the same `onBack`, so the gesture works regardless
// of which edge feels like "back" to a given reader.
export function BackNav({ label, onBack, className }: { label: string; onBack: () => void; className?: string }) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const EDGE = 40; // px from either screen edge to arm the gesture
    const THRESHOLD = 70; // px of net leftward travel to fire
    let startX: number | null = null;
    let armed = false;

    const onTouchStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX;
      armed = x < EDGE || x > window.innerWidth - EDGE;
      startX = armed ? x : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!armed || startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      armed = false;
      if (dx < -THRESHOLD) onBackRef.current();
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <button
      onClick={onBack}
      dir="rtl"
      className={cn(
        'mb-1 -ms-1 flex items-center gap-1 min-h-[44px] py-1.5 pe-3.5 ps-1.5 rounded-full',
        'bg-slate-800/60 border border-slate-700/50 text-primary-300',
        'hover:text-white hover:bg-slate-800 active:scale-[0.97] transition-all text-sm font-semibold',
        className,
      )}
    >
      <span className="flex items-center justify-center h-7 w-7 rounded-full bg-slate-900/60">
        <ChevronRight className="h-4 w-4 rotate-180" />
      </span>
      <span>{label}</span>
    </button>
  );
}
