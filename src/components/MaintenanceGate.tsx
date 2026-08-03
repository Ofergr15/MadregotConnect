'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Eye } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';
import { isSuperUser } from '@/lib/constants';

// Public routes the gate must NEVER cover — otherwise a logged-out user (e.g.
// Ofer in the installed PWA, which has its own session separate from Safari)
// can't reach the login screen to sign in, a dead end. The gate still blocks
// the actual app (/dashboard/*) after login.
const PUBLIC_PATHS = ['/', '/login', '/auth', '/garmin-callback', '/join'];
const isPublicPath = (p: string) =>
  PUBLIC_PATHS.some((pub) => p === pub || p.startsWith(pub + '/'));

// Full-screen "under renovation" gate. Mounted in the root layout so it covers
// the whole app (landing + dashboard). Shows the overlay when maintenance is on
// and the viewer's email is NOT on the approver allowlist. Fails open on error.
//
// Super-user "view as" override: the '__maintenance__' scenario force-shows this
// screen (preview what a blocked member sees); any role scenario bypasses it
// (so Ofer can actually explore the app as that role).
// A private joke for one specific blocked user: instead of the normal
// "rebuilding" copy, Asaf gets his own message. Everyone else sees the standard
// screen. Keyed by email (lower-cased).
const ASAF_EMAIL = 'akonsta1313@gmail.com';
const ASAF_MESSAGE = 'עליך להוציא פחות גזים על מנת לצפות בפורמט החדש של האפליקציה - אנא עדכן במידה ומתאפשר 💨';

export function MaintenanceGate() {
  const [blocked, setBlocked] = useState(false);
  const [isAsaf, setIsAsaf] = useState(false);
  // The super user (Ofer) gets a prominent "view as" button ON the gate itself,
  // so switching scenarios is obvious even while the maintenance screen is up
  // (the tiny floating pill was easy to miss).
  const [isSuper, setIsSuper] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Never gate the public login/landing routes.
      if (isPublicPath(pathname)) { setBlocked(false); return; }

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
      // The super user (Ofer) is NEVER blocked by maintenance — otherwise, in the
      // installed PWA (separate storage/session from Safari), being blocked on the
      // login screen means he can't sign in, can't become super user, and can't
      // reach view-as: a dead end. He previews the maintenance screen on demand
      // via the view-as 'מסך תחזוקה' scenario instead (handled above).
      const superUser = isSuperUser(email);
      try {
        const res = await fetch(`/api/maintenance?email=${encodeURIComponent(email)}`);
        const { maintenance, allowed } = await res.json();
        if (!cancelled) {
          setIsAsaf(email.toLowerCase().trim() === ASAF_EMAIL);
          setIsSuper(superUser);
          setBlocked(!superUser && !!maintenance && !allowed);
        }
      } catch {
        if (!cancelled) setBlocked(false); // fail open
      }
    })();
    return () => { cancelled = true; };
  }, [pathname]);

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

      {/* copy — standard for everyone, a custom private message for Asaf */}
      <div className="relative z-[3] mt-7">
        {isAsaf ? (
          <>
            <h1 className="text-2xl font-bold leading-snug" dir="rtl">רגע, אסף 💨</h1>
            <p className="mt-3 max-w-[300px] mx-auto text-[15px] leading-relaxed text-slate-300" dir="rtl">{ASAF_MESSAGE}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold leading-snug" dir="rtl">בונים מחדש את המדרגות 🚧</h1>
            <p className="mt-3 max-w-[250px] mx-auto text-[15px] leading-relaxed text-slate-400" dir="rtl">הצוות שלנו עובד על שדרוג. נחזור בקרוב!</p>
            <p className="mt-4 text-xs tracking-wide text-slate-500" dir="ltr">We&apos;re rebuilding the stairs — back soon.</p>
          </>
        )}

        {/* Super-user only: a clear "view as" button right on the gate, so Ofer
            can switch scenarios without hunting for the tiny floating pill. */}
        {isSuper && (
          <button
            onClick={() => window.dispatchEvent(new Event('open-view-as'))}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-200 text-sm font-bold hover:bg-amber-500/30 transition-colors"
            dir="rtl"
          >
            <Eye className="h-4 w-4" /> תצוגה כמשתמש אחר
          </button>
        )}
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

