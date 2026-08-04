'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, LogOut, Shield, Megaphone, Footprints, Glasses, Construction } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { isSuperUser } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import {
  getViewMode,
  startViewAs,
  stopViewAs,
  installViewGuard,
  MAINTENANCE_MODE,
} from '@/lib/impersonation';

// The scenarios the super user (Ofer) can preview. You stay signed in as
// yourself — this only changes which ROLE the app renders as, plus a scenario
// that force-shows the maintenance screen. See src/lib/impersonation.ts.
const SCENARIOS: Array<{ mode: string; label: string; icon: any; tone: string }> = [
  { mode: 'admin', label: 'מנהל', icon: Shield, tone: 'text-violet-300' },
  { mode: 'coach', label: 'מאמן', icon: Megaphone, tone: 'text-sky-300' },
  { mode: 'runner', label: 'רץ', icon: Footprints, tone: 'text-emerald-300' },
  { mode: 'viewer', label: 'צופה', icon: Glasses, tone: 'text-slate-300' },
  { mode: MAINTENANCE_MODE, label: 'מסך תחזוקה', icon: Construction, tone: 'text-amber-300' },
];

function labelFor(mode: string | null): string {
  if (!mode) return '';
  return SCENARIOS.find((s) => s.mode === mode)?.label || mode;
}

// Super-user "view as" control. Always mounted in the root layout (a sibling of
// MaintenanceGate, outside the intl provider) so it can overlay the maintenance
// screen and stay reachable everywhere. Renders:
//  - a persistent banner while a scenario is active ("Viewing as <role> — Exit"),
//    at z-[300] so it sits above the maintenance gate (z-200); and
//  - a scenario chooser (roles + maintenance screen), opened from the banner's
//    "Switch", the Header eye button ('open-view-as' event), or a floating
//    trigger shown above the gate when maintenance is blocking Ofer.
// Non-super-users get nothing.
export function ImpersonationBar() {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [canView, setCanView] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  // True when the maintenance gate is currently blocking the REAL super user and
  // no scenario is active — then the Header eye button is hidden behind the gate.
  const [gateBlockingMe, setGateBlockingMe] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    installViewGuard();
    setMounted(true);
    const current = getViewMode();
    setMode(current);

    // Determine whether the real signed-in user is Ofer (the super user).
    const gate = (email: string) => {
      // Only relevant when no scenario is active; a role scenario bypasses the
      // gate, and the maintenance scenario shows it with the banner already up.
      if (current) return;
      fetch(`/api/maintenance?email=${encodeURIComponent(email)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setGateBlockingMe(!!d.maintenance && !d.allowed);
        })
        .catch(() => {});
    };

    if (current) setCanView(true); // a scenario is active → keep Exit reachable

    const realEmail =
      localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    if (isSuperUser(realEmail)) {
      setCanView(true);
      gate(realEmail);
      return;
    }
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        const e = data.session?.user?.email || '';
        if (isSuperUser(e)) {
          setCanView(true);
          gate(e);
        }
      })
      .catch(() => {});
  }, []);

  // Open the chooser when the Header eye button dispatches 'open-view-as'.
  useEffect(() => {
    const open = () => setChooserOpen(true);
    window.addEventListener('open-view-as', open);
    return () => window.removeEventListener('open-view-as', open);
  }, []);

  // Push the page down by the banner height so it doesn't cover the sticky header.
  useEffect(() => {
    if (!mode) {
      document.body.style.paddingTop = '';
      return;
    }
    const apply = () => {
      const h = bannerRef.current?.offsetHeight || 0;
      document.body.style.paddingTop = h ? `${h}px` : '';
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.body.style.paddingTop = '';
    };
  }, [mode]);

  if (!mounted || !canView) return null;

  return (
    <>
      {/* Floating trigger above the maintenance gate: when maintenance blocks the
          super user and no scenario is active, the Header eye button is hidden
          behind the gate, so surface a reachable trigger here. */}
      {!mode && gateBlockingMe && (
        <button
          onClick={() => setChooserOpen(true)}
          className="fixed top-3 end-3 z-[300] flex items-center gap-1.5 px-3 py-2 rounded-full text-white text-xs font-bold shadow-lg safe-top"
          style={{ background: 'linear-gradient(90deg,#b45309,#d97706)' }}
        >
          <Eye className="h-4 w-4" /> תצוגת משתמש
        </button>
      )}

      {/* Persistent banner while a scenario is active — above the maintenance gate. */}
      {mode && (
        <div
          ref={bannerRef}
          className="fixed top-0 inset-x-0 z-[300] flex items-center gap-2 px-3 py-2 text-white text-sm font-semibold shadow-lg safe-top"
          style={{ background: 'linear-gradient(90deg,#b45309,#d97706)' }}
        >
          <Eye className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">
            תצוגה בתור <b>{labelFor(mode)}</b>
          </span>
          <div className="ms-auto flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setChooserOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors text-xs font-bold"
            >
              החלף
            </button>
            <button
              onClick={() => stopViewAs()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/25 hover:bg-black/40 transition-colors text-xs font-bold"
            >
              <LogOut className="h-3.5 w-3.5" /> יציאה
            </button>
          </div>
        </div>
      )}

      {/* Scenario chooser */}
      <Sheet open={chooserOpen} onOpenChange={setChooserOpen} title="תצוגה כמשתמש">
        <div dir="rtl">
          <p className="px-1 pt-1 text-xs text-slate-400 leading-relaxed">
            נשארים מחוברים כ‑Ofer — בוחרים איזו תצוגה לראות:
          </p>

          <div className="pt-3 grid grid-cols-2 gap-2">
            {SCENARIOS.map((s) => {
              const Icon = s.icon;
              const activeMode = mode === s.mode;
              const isMaint = s.mode === MAINTENANCE_MODE;
              return (
                <button
                  key={s.mode}
                  onClick={() => startViewAs(s.mode)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-2 py-4 rounded-xl border transition-colors',
                    isMaint ? 'col-span-2' : '',
                    activeMode
                      ? 'bg-amber-500/20 border-amber-500/50'
                      : 'bg-slate-900/60 border-slate-700 hover:border-slate-500 hover:bg-slate-900'
                  )}
                >
                  <Icon className={cn('h-6 w-6', s.tone)} />
                  <span className="text-sm font-bold text-white">{s.label}</span>
                </button>
              );
            })}
          </div>

          {mode && (
            <button
              onClick={() => stopViewAs()}
              className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 border-t border-slate-700 text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
            >
              <LogOut className="h-4 w-4" /> חזרה לתצוגה שלי
            </button>
          )}

          <div className="mt-3 px-4 py-2.5 border-t border-slate-700 text-[11px] text-slate-500 text-center leading-relaxed">
            תצוגה בלבד — שמירת נתונים מושבתת במצב זה.
          </div>
        </div>
      </Sheet>
    </>
  );
}
