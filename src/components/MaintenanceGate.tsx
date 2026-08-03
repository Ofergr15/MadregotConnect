'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';

// Full-screen "under renovation" gate. Mounted in the root layout so it covers
// the whole app (landing + dashboard). Shows the overlay when maintenance is on
// and the viewer's email is NOT on the approver allowlist. Fails open on error.
//
// Super-user "view as" override: the '__maintenance__' scenario force-shows this
// screen (preview what a blocked member sees); any role scenario bypasses it
// (so Ofer can actually explore the app as that role).
export function MaintenanceGate() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const viewMode = getViewMode();
      if (viewMode === MAINTENANCE_MODE) { setBlocked(true); return; } // force preview
      if (viewMode) { setBlocked(false); return; } // role scenario → bypass gate

      // Best-effort viewer email: localStorage (coach/athlete) or Supabase session.
      let email = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
      if (!email) {
        try {
          const { data } = await getSupabase().auth.getSession();
          email = data.session?.user?.email || '';
        } catch { /* ignore */ }
      }
      try {
        const res = await fetch(`/api/maintenance?email=${encodeURIComponent(email)}`);
        const { maintenance, allowed } = await res.json();
        if (!cancelled) setBlocked(!!maintenance && !allowed);
      } catch {
        if (!cancelled) setBlocked(false); // fail open
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!blocked) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center text-white text-center px-6 pt-24 pb-8 safe-top safe-bottom overflow-hidden"
      style={{ background: 'radial-gradient(130% 80% at 50% 8%, #16213b 0%, #0f172a 46%, #0b1120 100%)' }}
    >
      {/* drifting dust */}
      <div className="mg-dust absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span /><span />
      </div>

      {/* logo hero: breathing glow + light-sweep polishing the stairs */}
      <div className="relative z-[2] mt-3 flex items-center justify-center">
        <div className="mg-glow absolute" aria-hidden="true" />
        <div className="relative w-40 h-40 flex items-center justify-center z-[2]">
          <img src="/images/logo-white.png" alt="Madregot — After 2KM Running Club"
            className="w-full h-full object-contain" style={{ filter: 'drop-shadow(0 8px 18px rgba(8,12,25,.55))' }} />
          <div className="mg-sweep absolute inset-0 pointer-events-none" aria-hidden="true"><i /></div>
        </div>
      </div>

      {/* copy */}
      <div className="relative z-[3] mt-7">
        <h1 className="text-2xl font-bold leading-snug" dir="rtl">בונים מחדש את המדרגות 🚧</h1>
        <p className="mt-3 max-w-[250px] mx-auto text-[15px] leading-relaxed text-slate-400" dir="rtl">הצוות שלנו עובד על שדרוג. נחזור בקרוב!</p>
        <p className="mt-4 text-xs tracking-wide text-slate-500" dir="ltr">We&apos;re rebuilding the stairs — back soon.</p>
      </div>

      {/* climbing staircase that builds up + a runner ascending to the top, then holds */}
      <div className="relative z-[3] mt-auto w-full flex flex-col items-center gap-3.5 pb-1.5">
        <div className="mg-climb" aria-hidden="true">
          {[
            { left: 2, h: 20, d: 0 },
            { left: 38, h: 38, d: 0.28 },
            { left: 74, h: 56, d: 0.56 },
            { left: 110, h: 74, d: 0.84 },
            { left: 146, h: 92, d: 1.12 },
            { left: 182, h: 110, d: 1.4 },
          ].map((s, i) => (
            <div key={i} className="mg-cstep" style={{ left: s.left, height: s.h, animationDelay: `${s.d}s` }}>
              <i />
            </div>
          ))}
          <div className="mg-runner"><span>🏃</span></div>
        </div>
        <div className="flex items-center gap-2.5 text-xs font-semibold text-slate-300" dir="rtl">
          <svg className="mg-hat w-6 h-6" viewBox="0 0 48 48" aria-hidden="true">
            <defs>
              <linearGradient id="mgHat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fbbf24" /><stop offset="1" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <rect x="5" y="33" width="38" height="6" rx="3" fill="url(#mgHat)" />
            <path d="M13 34 C13 21 18 15 24 15 C30 15 35 21 35 34 Z" fill="url(#mgHat)" />
            <rect x="22" y="15" width="4" height="19" rx="2" fill="#d97706" opacity=".85" />
          </svg>
          <span>עדכון מערכת בתהליך</span>
        </div>
      </div>
    </div>
  );
}

