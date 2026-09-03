'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Eye, LogIn } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';
import { isSuperUser } from '@/lib/constants';
import { useApi } from '@/lib/api';

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
  const pathname = usePathname();
  // Force-preview / role-bypass / public-path short circuits resolve
  // synchronously; only the "who is this + is maintenance on" check needs a
  // network round trip, and only when none of those short circuits apply.
  const forcedBlocked = !isPublicPath(pathname) && getViewMode() === MAINTENANCE_MODE;
  const bypassed = isPublicPath(pathname) || (!!getViewMode() && getViewMode() !== MAINTENANCE_MODE);

  // Best-effort viewer email: localStorage (coach/athlete) first (sync,
  // covers the common case with no network call at all), else the live
  // Supabase session.
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (bypassed || forcedBlocked) return;
    const stored = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    if (stored) { setEmail(stored); return; }
    getSupabase().auth.getSession()
      .then(({ data }) => setEmail(data.session?.user?.email || ''))
      .catch(() => setEmail(''));
  }, [bypassed, forcedBlocked]);

  // Shared SWR cache (dedupingInterval 4s in useApi's defaults) — this is what
  // actually fixes the "re-checks maintenance on every single tab switch"
  // cost: rapid navigation reuses the cached response for the same email
  // instead of re-hitting the network, and ImpersonationBar's own maintenance
  // check (same endpoint, same key shape) shares this exact cache entry too.
  const { data, error } = useApi<{ maintenance: boolean; allowed: boolean }>(
    !bypassed && !forcedBlocked && email !== null ? `/api/maintenance?email=${encodeURIComponent(email)}` : null,
  );

  const superUser = isSuperUser(email);
  const noIdentity = email === '';
  const isAsaf = (email || '').toLowerCase().trim() === ASAF_EMAIL;
  // Fail open on a fetch error, same as the original try/catch.
  const blocked = forcedBlocked || (!bypassed && !error && !superUser && !!data?.maintenance && !data?.allowed);
  const isSuper = !bypassed && superUser;

  if (!blocked) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center text-ink-700 text-center px-6 pt-24 pb-8 safe-top safe-bottom overflow-hidden"
      // On the light system like every other screen. This one had to move: with
      // maintenance mode on, it's the FIRST thing most people see, right after a
      // light splash — a dark navy field here would read as a different app. The
      // same white-to-page-grey vignette as AppSplash, so splash -> gate is one
      // continuous surface with no flash between them.
      style={{ background: 'radial-gradient(130% 80% at 50% 8%, #FFFFFF 0%, #DFDFDF 46%, #D2D2D2 100%)' }}
    >
      {/* drifting dust */}
      <div className="mg-dust absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span /><span />
      </div>

      {/* logo hero: breathing glow + light-sweep polishing the stairs */}
      <div className="relative z-[2] mt-3 flex items-center justify-center">
        <div className="mg-glow absolute" aria-hidden="true" />
        <div className="relative w-40 h-40 flex items-center justify-center z-[2]">
          {/* The dark mark (logo.png is black shaped by its alpha channel), same as
              the Header and the splash — the white one is invisible on page grey.
              The sweep's mask uses this same file so the shimmer stays inside the
              silhouette, and screen-blending white over a black mark is what makes
              the highlight visible at all. */}
          <img src="/images/logo.png" alt="Madregot — After 2KM Running Club"
            className="w-full h-full object-contain" style={{ filter: 'drop-shadow(0 8px 18px rgba(29,30,38,.18))' }} />
          <div className="mg-sweep absolute inset-0 pointer-events-none" aria-hidden="true"><i /></div>
        </div>
      </div>

      {/* copy — standard for everyone, a custom private message for Asaf */}
      <div className="relative z-[3] mt-7">
        {isAsaf ? (
          <>
            <h1 className="text-2xl font-bold leading-snug text-ink-900" dir="rtl">רגע, אסף 💨</h1>
            <p className="mt-3 max-w-[300px] mx-auto text-[15px] leading-relaxed text-ink-500" dir="rtl">{ASAF_MESSAGE}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold leading-snug text-ink-900" dir="rtl">בונים מחדש את המדרגות 🚧</h1>
            {/* ink-500, not ink-400: #969696 is only ~2.2:1 on the page grey — it
                was tuned to sit on the old navy. */}
            <p className="mt-3 max-w-[250px] mx-auto text-[15px] leading-relaxed text-ink-500" dir="rtl">הצוות שלנו עובד על שדרוג. נחזור בקרוב!</p>
            <p className="mt-4 text-xs tracking-wide text-ink-500" dir="ltr">We&apos;re rebuilding the stairs — back soon.</p>
          </>
        )}

        {/* Super-user only: a clear "view as" button right on the gate, so Ofer
            can switch scenarios without hunting for the tiny floating pill. */}
        {isSuper && (
          <button
            onClick={() => window.dispatchEvent(new Event('open-view-as'))}
            // The light system's primary button (same as ui/Button's `primary`) —
            // the old amber outline was a warning colour on a dark field, and on
            // white it both loses contrast and reads as an alert rather than the
            // one thing you're meant to tap.
            className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-pill bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-colors"
            dir="rtl"
          >
            <Eye className="h-4 w-4" /> תצוגה כמשתמש אחר
          </button>
        )}

        {/* No resolvable identity at all (fresh install, cleared session) — the
            allowlist can't recognize a viewer it knows nothing about, so the
            only way through is to actually sign back in. */}
        {!isSuper && noIdentity && (
          <Link
            href="/"
            // ui/Button's `secondary`: an outline pill on the page grey. (A
            // translucent page-grey fill on a page-grey background was invisible.)
            className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-pill bg-card border border-brand-600 text-brand-600 text-sm font-bold hover:bg-brand-600/5 transition-colors"
            dir="rtl"
          >
            <LogIn className="h-4 w-4" /> התחברות מחדש
          </Link>
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
        <div className="flex items-center gap-2.5 text-xs font-semibold text-ink-500" dir="rtl">
          <svg className="mg-hat w-6 h-6" viewBox="0 0 48 48" aria-hidden="true">
            <defs>
              {/* Band 3 — the light system's one warning colour, and orange is a
                  real hard-hat colour, so the icon still reads as a hard hat.
                  (The old amber #fbbf24 was near-invisible on the page grey.) */}
              <linearGradient id="mgHat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FF6A33" /><stop offset="1" stopColor="#FF5315" />
              </linearGradient>
            </defs>
            <rect x="5" y="33" width="38" height="6" rx="3" fill="url(#mgHat)" />
            <path d="M13 34 C13 21 18 15 24 15 C30 15 35 21 35 34 Z" fill="url(#mgHat)" />
            <rect x="22" y="15" width="4" height="19" rx="2" fill="#C43C0B" opacity=".85" />
          </svg>
          <span>עדכון מערכת בתהליך</span>
        </div>
      </div>
    </div>
  );
}

