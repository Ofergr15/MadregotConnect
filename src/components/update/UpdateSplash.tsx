'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// The update's loading screen — "ring + fill", the one Ofer picked from four.
//
// It IS the app-open splash (AppSplash.tsx): the same white-to-grey field, the
// same logo filling with ink through the badge-as-mask, the same halo and the
// same exit (.app-splash-out, a fade with a slight zoom into the app), so an
// update reads as the app opening. Two differences: the fill level is the real
// progress of the update rather than a timer, and a ring around the logo closes
// with the percentage.
//
// `phase`:
//   boot — rendered on every load, hidden unless <html> carries .mc-updating
//          (set by the inline boot script when the page before the reload left
//          a note). That is what covers the gap between the reload and React
//          hydrating: the server paints this at the handover stage, the page is
//          never seen in between.
//   on   — live; the level eases toward `target`.
//   out  — the reveal.

const R = 96;
const C = 2 * Math.PI * R;

/** Eases the shown value toward the target, so a stage is a movement, not a jump. */
function useTween(target: number): number {
  const [shown, setShown] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      cur.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - last) / 190);
      last = now;
      const next = cur.current + (target - cur.current) * k;
      cur.current = Math.abs(target - next) < 0.003 ? target : next;
      setShown(cur.current);
      if (cur.current !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

const clamp = (x: number) => Math.min(Math.max(x, 0), 1);

export function UpdateSplash({
  phase, target, caption,
}: { phase: 'boot' | 'on' | 'out'; target: number; caption: string }) {
  const p = useTween(target);
  // The ink snaps solid and the halo blooms only at the very top, as at opening.
  const top = clamp((p - 0.93) / 0.07);
  return (
    <div
      role={phase === 'boot' ? undefined : 'status'}
      aria-hidden={phase === 'boot' ? true : undefined}
      className={cn('mc-update-splash fixed inset-0 z-[420] flex-col items-center justify-center overflow-hidden', {
        'mc-update-boot': phase === 'boot',
        'app-splash-out': phase === 'out',
      })}
      style={{ background: 'radial-gradient(120% 90% at 50% 42%, #FFFFFF 0%, #DFDFDF 60%, #D2D2D2 100%)' }}
    >
      <div className="relative flex h-[210px] w-[210px] items-center justify-center">
        <div
          className="absolute h-[230px] w-[230px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(29,30,38,.14) 0%, rgba(29,30,38,0) 70%)',
            filter: 'blur(8px)',
            opacity: top * 0.8,
            transform: `scale(${0.8 + 0.2 * top})`,
          }}
        />
        <svg viewBox="0 0 210 210" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="105" cy="105" r={R} fill="none" stroke="rgba(29,30,38,.1)" strokeWidth="5" />
          <circle
            cx="105" cy="105" r={R} fill="none" stroke="#1D1E26" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - p)}
          />
        </svg>
        <div className="relative h-[150px] w-[150px]">
          <img
            src="/images/logo.png"
            alt=""
            width={150}
            height={150}
            className="absolute inset-0 h-full w-full object-contain opacity-[0.14] brightness-0"
          />
          <div className="app-fill-mask absolute inset-0 overflow-hidden">
            {/* The splash's own fluid, minus its rise animation: here the
                height is the progress. */}
            <div className="mc-update-fluid absolute inset-x-0 bottom-0" style={{ height: `${p * 100}%` }} />
            <div className="absolute inset-0 bg-[#1D1E26]" style={{ opacity: clamp((p - 0.97) / 0.03) }} />
          </div>
        </div>
      </div>
      <p dir="ltr" className="mt-3.5 text-2xl font-black tabular-nums tracking-tight text-[#1D1E26]">
        {Math.round(p * 100)}%
      </p>
      <p className="mt-1.5 text-xs text-ink-500">{caption}</p>
    </div>
  );
}
