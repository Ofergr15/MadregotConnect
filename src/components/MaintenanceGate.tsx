'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';

// Full-screen "under renovation" gate. Mounted in the root layout so it covers
// the whole app (landing + dashboard). Shows the overlay when maintenance is on
// and the viewer's email is NOT on the approver allowlist. Fails open on error.
export function MaintenanceGate() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0f172a] text-white text-center px-6 safe-top safe-bottom">
      <img src="/images/logo-white.png" alt="" className="h-20 w-20 mb-6 opacity-90" />
      <h1 className="text-2xl font-black mb-2" dir="rtl">האתר בשיפוצים 🚧</h1>
      <p className="text-slate-400 max-w-xs" dir="rtl">אנחנו משדרגים את מדרגות. נחזור בקרוב!</p>
      <p className="text-slate-500 text-sm mt-4">We&apos;re upgrading Madregot — back soon.</p>
    </div>
  );
}
