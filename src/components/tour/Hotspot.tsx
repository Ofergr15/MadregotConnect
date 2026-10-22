'use client';

import { useState, type ReactNode } from 'react';
import { useTour } from '@/lib/tour/store';
import { useTourPrefs } from '@/lib/tour/use-prefs';
import { hotspotVisible } from '@/lib/tour/hotspots';

// A blue "new here" dot (mockups/coach-intro/v2.html, after the tour): on a feature the
// first time someone reaches it. A tap says what it does in a sentence; "הבנתי" puts it away
// for good (lib/tour/prefs.ts). Hidden while a tour runs, so the two never talk at once.
// The wrapper is `relative`: the dot sits on the wrapped control's corner.
export function Hotspot({ id, title, body, children, className, off = false }: {
  id: string;
  /** Not offered here (e.g. a control that is disabled on this screen). */
  off?: boolean;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  const tour = useTour();
  const { prefs, ready, on, save } = useTourPrefs();
  const [open, setOpen] = useState(false);
  const show = !off && hotspotVisible(id, { ready, prefs, on, tourRunning: tour.phase !== 'idle' && tour.phase !== 'done' });
  return (
    <div className={`relative ${className ?? ''}`}>
      {children}
      {show && (
        <>
          <button type="button" aria-label={`חדש: ${title}`} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="mc-hotspot absolute -end-4 -top-4 z-10 grid h-11 w-11 place-items-center">
            <span className="block h-[18px] w-[18px] rounded-full border-[3px] border-white bg-[#1525FF]" />
          </button>
          {open && (
            <div dir="rtl" role="dialog" className="absolute end-0 top-full z-20 mt-2 w-[min(300px,calc(100vw-32px))] rounded-[18px] bg-[#111827] px-4 py-3 text-white shadow-[0_14px_30px_rgba(0,0,0,.3)]">
              <b className="block text-[15.5px] font-black">✨ {title}</b>
              <p className="mb-2 mt-1 text-[14px] leading-relaxed text-[#E5E7EB]">{body}</p>
              <button type="button" onClick={(e) => { e.stopPropagation(); save({ hotspot: id }); setOpen(false); }}
                className="min-h-[40px] text-[14px] font-black text-[#93C5FD]">הבנתי</button>
            </div>
          )}
          <style>{`.mc-hotspot span{animation:mcHot 1.6s infinite}@keyframes mcHot{0%{box-shadow:0 0 0 0 rgba(21,37,255,.6)}70%{box-shadow:0 0 0 14px rgba(21,37,255,0)}100%{box-shadow:0 0 0 0 rgba(21,37,255,0)}}@media (prefers-reduced-motion: reduce){.mc-hotspot span{animation:none}}`}</style>
        </>
      )}
    </div>
  );
}
