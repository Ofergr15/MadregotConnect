'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// ═════════════════════════════════════════════════════════════════════════════
// PHOTOS, LOADING (mockup loading-photos-v4, option 1; Ofer 10-19)
//
// Not a white screen and not a spinner: the club's own photo of all of us
// (public/images/photos-loading.jpg), starting pale and soft and getting sharper
// and more colourful every second, over a progress line. The timings are the
// whole point:
//   0–0.5 s  nothing, so a fast answer never flashes a loader;
//   0.5 s    the photo fades in;
//   5 s      a bug is filed by itself, silently (the client-event reporter's
//            'mc:blank' channel, detail "slow:…"), so a slow day shows up in the
//            bug list without anyone writing in;
//   8 s      a card: it is taking longer than usual, try again, and that it has
//            been reported to the app's admin.
// ═════════════════════════════════════════════════════════════════════════════

const SHOW_AFTER_MS = 500;
const REPORT_AFTER_MS = 5000;
const SLOW_AFTER_MS = 8000;
const LINES = ['מביאים את התמונות…', 'מסדרים לפי אימונים…', 'עוד רגע 📸'];

export function PhotosLoading({ what, onRetry }: { what: 'home' | 'folder'; onRetry: () => void }) {
  const path = usePathname();
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    const t2 = setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent('mc:blank', { detail: `slow:${what}:5s` })); } catch { /* never break the page */ }
    }, REPORT_AFTER_MS);
    const t3 = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const t4 = setInterval(() => setLine((n) => (n + 1) % LINES.length), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(t4); };
  }, [what, path]);

  if (!shown) return null;
  return (
    <div className="mcl-in px-3 pb-6 pt-1" dir="rtl" role="status" aria-label={LINES[0]}>
      <div className="relative h-[300px] overflow-hidden rounded-[24px] shadow-[0_18px_34px_-18px_rgba(20,24,60,0.5)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/photos-loading.jpg" alt="" className="mcl-sharpen h-full w-full object-cover" />
        <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/45" />
        <span className="absolute bottom-3.5 right-3.5 text-white">
          <b className="block text-[17px]">מדרגות</b>
          <small className="text-[12.5px] opacity-85">כל התמונות של המועדון</small>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="" className="absolute bottom-3 left-3 h-10 w-10 rounded-full bg-white object-contain p-0.5" />
      </div>
      <div className="mx-1 mt-3.5 h-1 overflow-hidden rounded-full bg-[#E3E3EA]"><i className="mcl-progress block h-full rounded-full bg-gradient-to-l from-[#5BC0EB] to-[#1525FF]" /></div>
      <p className="mx-1 mt-2 text-12 font-semibold text-ink-400">{LINES[line]}</p>
      {slow && (
        <div className="mcl-in mt-4 rounded-[18px] bg-card px-4 py-3.5 shadow-[0_10px_24px_-12px_rgba(0,0,0,0.35)]">
          <b className="block text-[15px] text-ink-900">משהו לוקח יותר מהרגיל</b>
          <p className="mt-0.5 text-13 leading-snug text-ink-500">התמונות עדיין בדרך. אפשר לחכות עוד רגע או לנסות שוב.</p>
          <button type="button" onClick={onRetry} className="mt-2.5 flex min-h-[44px] w-full items-center justify-center rounded-[13px] bg-brand-600 text-[15px] font-extrabold text-white">לנסות שוב</button>
          <p className="mt-2 text-12 font-bold text-[#12A150]">✓ דיווחנו על זה אוטומטית למנהל האפליקציה</p>
        </div>
      )}
    </div>
  );
}
