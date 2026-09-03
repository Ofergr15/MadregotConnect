'use client';

import { useEffect, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import {
  getViewMode,
  startViewAs,
  stopViewAs,
  useIsSuperUser,
  MAINTENANCE_MODE,
  VIEW_AS_SCENARIOS,
} from '@/lib/impersonation';

// Super-user "view as" control. Always mounted in the root layout (a sibling of
// MaintenanceGate, outside the intl provider) so it can overlay the maintenance
// screen and stay reachable everywhere. Renders only a scenario chooser (roles +
// maintenance screen), opened from the Header eye button / "צפייה כמשתמש" row
// ('open-view-as' event), MaintenanceGate's own button when the gate is up, or a
// floating trigger shown above the gate when maintenance is blocking Ofer with no
// scenario active. No separate persistent banner.
//
// It is not the only way to switch any more: the tab bar's "More" sheet renders
// the roles from VIEW_AS_SCENARIOS directly, so on a phone switching role is one
// tap instead of avatar → menu → row → this sheet. This chooser stays as the
// desktop entry point and as the only route to the maintenance-screen scenario.
// Non-super-users get nothing.
export function ImpersonationBar() {
  const isSuper = useIsSuperUser();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  // An active scenario keeps Exit reachable even if the super-user check hasn't
  // answered yet (or can't) — otherwise a preview could strand you in it.
  const [previewing, setPreviewing] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  // True when the maintenance gate is currently blocking the REAL super user and
  // no scenario is active — then the Header eye button is hidden behind the gate.
  const [gateBlockingMe, setGateBlockingMe] = useState(false);

  useEffect(() => {
    setMounted(true);
    const current = getViewMode();
    setMode(current);
    if (current) setPreviewing(true);
  }, []);

  // Is the maintenance gate currently blocking the REAL super user? Only worth
  // asking when no scenario is active: a role scenario bypasses the gate, and the
  // maintenance scenario shows it with the trigger already up.
  useEffect(() => {
    if (!isSuper || mode) return;
    const email =
      localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    if (!email) return;
    fetch(`/api/maintenance?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setGateBlockingMe(!!d.maintenance && !d.allowed);
      })
      .catch(() => {});
  }, [isSuper, mode]);

  // Open the chooser when the Header eye button dispatches 'open-view-as'.
  useEffect(() => {
    const open = () => setChooserOpen(true);
    window.addEventListener('open-view-as', open);
    return () => window.removeEventListener('open-view-as', open);
  }, []);

  if (!mounted || !(isSuper || previewing)) return null;

  return (
    <>
      {/* The one-tap exit while a preview is active now lives on the Header's
          eye icon itself (it swaps to a red LogOut icon and exits directly)
          instead of a separate floating banner — Ofer asked for the banner
          removed. The chooser Sheet below still has its own exit row too. */}

      {/* Floating trigger above the maintenance gate: when maintenance blocks the
          super user and no scenario is active, the Header eye button is hidden
          behind the gate, so surface a reachable trigger here. */}
      {!mode && gateBlockingMe && (
        <button
          onClick={() => setChooserOpen(true)}
          // Band 3 with white text: it floats over the maintenance gate, which is
          // now light, so the old dark amber gradient carried ink-700 text on a
          // brown fill — dark on dark. Kept a warning colour rather than the brand
          // blue so it still reads as admin chrome, not part of the app.
          className="fixed top-3 end-3 z-[300] flex items-center gap-1.5 px-3 py-2 rounded-full bg-band-3 text-white text-xs font-bold shadow-lg safe-top"
        >
          <Eye className="h-4 w-4" /> תצוגת משתמש
        </button>
      )}

      {/* Scenario chooser */}
      <Sheet open={chooserOpen} onOpenChange={setChooserOpen} title="תצוגה כמשתמש">
        <div dir="rtl">
          <p className="px-1 pt-1 text-xs text-ink-400 leading-relaxed">
            נשארים מחוברים כ‑Ofer — בוחרים איזו תצוגה לראות:
          </p>

          <div className="pt-3 grid grid-cols-2 gap-2">
            {VIEW_AS_SCENARIOS.map((s) => {
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
                      ? 'bg-band-3/20 border-band-3/50'
                      : 'bg-page/60 border-page hover:border-ink-300 hover:bg-ink-300/40'
                  )}
                >
                  <Icon className={cn('h-6 w-6', s.tone)} />
                  <span className="text-sm font-bold text-ink-700">{s.label}</span>
                </button>
              );
            })}
          </div>

          {mode && (
            <button
              onClick={() => stopViewAs()}
              className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 border-t border-page text-sm font-bold text-ink-500 hover:text-ink-900 hover:bg-page/50 transition-colors"
            >
              <LogOut className="h-4 w-4" /> חזרה לתצוגה שלי
            </button>
          )}

          <div className="mt-3 px-4 py-2.5 border-t border-page text-[11px] text-ink-400 text-center leading-relaxed">
            תצוגה בלבד — שמירת נתונים מושבתת במצב זה.
          </div>
        </div>
      </Sheet>
    </>
  );
}
