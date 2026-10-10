'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { Sheet } from '@/components/ui';
import {
  getViewMode,
  startViewAs,
  stopViewAs,
  useIsSuperUser,
  MAINTENANCE_MODE,
  VIEW_AS_SCENARIOS,
} from '@/lib/impersonation';
import { getViewedPerson, stopViewingAs, clearViewedPerson } from '@/lib/view-as-person';
import { ViewAsPersonPicker } from '@/components/ViewAsPersonPicker';

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
//
// Two tabs since 2026-10-09: "אדם" — view the whole app as one member, read-only
// (lib/view-as-person.ts, for any admin) — and "תפקיד", the role scenarios above,
// unchanged and still the super user's alone. The person tab's list is gated on
// the server, so the sheet itself can open for anybody who dispatched the event;
// only admins have a button that does.

/** `detail` of the 'open-view-as' event: which tab to open on. */
export type ViewAsTab = 'person' | 'role';

export function ImpersonationBar() {
  const t = useTranslations('viewAs');
  const isSuper = useIsSuperUser();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  // An active scenario keeps Exit reachable even if the super-user check hasn't
  // answered yet (or can't) — otherwise a preview could strand you in it.
  const [previewing, setPreviewing] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [tab, setTab] = useState<ViewAsTab>('person');
  const [viewingPerson, setViewingPerson] = useState(false);
  // True when the maintenance gate is currently blocking the REAL super user and
  // no scenario is active — then the Header eye button is hidden behind the gate.
  const [gateBlockingMe, setGateBlockingMe] = useState(false);

  useEffect(() => {
    setMounted(true);
    const current = getViewMode();
    setMode(current);
    if (current) setPreviewing(true);
    setViewingPerson(!!getViewedPerson());
  }, []);

  // Is the maintenance gate currently blocking the REAL super user? Only worth
  // asking when no scenario is active: the maintenance scenario shows the gate
  // with the trigger already up.
  //
  // The answer is the server's, for whoever holds the token. This used to send an
  // address out of localStorage and read the verdict for THAT address — the same
  // forgeable check the gate itself used to make (see MaintenanceGate).
  useEffect(() => {
    if (!isSuper || mode) return;
    let live = true;
    apiHeaders()
      .then((headers) => fetch('/api/maintenance', { headers }))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setGateBlockingMe(!!d.maintenance && !d.allowed);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [isSuper, mode]);

  // Open the chooser when the Header eye button (or the academy's ⚙) dispatches
  // 'open-view-as'; a CustomEvent's detail can name the tab.
  useEffect(() => {
    const open = (e: Event) => {
      const want = (e as CustomEvent<ViewAsTab | undefined>).detail;
      setTab(want === 'role' || want === 'person' ? want : 'person');
      setChooserOpen(true);
    };
    window.addEventListener('open-view-as', open);
    return () => window.removeEventListener('open-view-as', open);
  }, []);

  if (!mounted) return null;
  const roleTab = isSuper || previewing;
  const shownTab: ViewAsTab = roleTab ? tab : 'person';
  // A role scenario from inside a person view: end the person view first, or the
  // role would be drawn over somebody else's data.
  const pickRole = (m: string) => { clearViewedPerson(); startViewAs(m); };

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
          onClick={() => { setTab('role'); setChooserOpen(true); }}
          // Band 3 with white text: it floats over the maintenance gate, which is
          // now light, so the old dark amber gradient carried ink-700 text on a
          // brown fill — dark on dark. Kept a warning colour rather than the brand
          // blue so it still reads as admin chrome, not part of the app.
          className="fixed top-3 end-3 z-[300] flex items-center gap-1.5 px-3 py-2 rounded-full bg-band-3 text-white text-xs font-bold shadow-lg safe-top"
        >
          <Eye className="h-4 w-4" /> תצוגת משתמש
        </button>
      )}

      {/* Person / role chooser */}
      <Sheet open={chooserOpen} onOpenChange={setChooserOpen} title={t('title')}>
        <div dir="rtl">
          <p className="px-1 pt-1 text-center text-xs text-ink-400 leading-relaxed">{t('intro')}</p>

          {roleTab && (
            <div role="tablist" className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-page p-1">
              {(['person', 'role'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={shownTab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    'min-h-[36px] rounded-lg text-sm font-bold transition-colors',
                    shownTab === k ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400',
                  )}
                >
                  {k === 'person' ? t('segPerson') : t('segRole')}
                </button>
              ))}
            </div>
          )}

          {shownTab === 'person' && (
            <div className="pt-3">
              <ViewAsPersonPicker open={chooserOpen} />
              {viewingPerson && (
                <button
                  onClick={() => stopViewingAs()}
                  className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 border-t border-page text-sm font-bold text-ink-500 hover:text-ink-900 hover:bg-page/50 transition-colors"
                >
                  <LogOut className="h-4 w-4" /> {t('exit')}
                </button>
              )}
            </div>
          )}

          {shownTab === 'role' && (
          <div className="pt-3 grid grid-cols-2 gap-2">
            {VIEW_AS_SCENARIOS.map((s) => {
              const Icon = s.icon;
              const activeMode = mode === s.mode;
              const isMaint = s.mode === MAINTENANCE_MODE;
              return (
                <button
                  key={s.mode}
                  onClick={() => pickRole(s.mode)}
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

          )}

          {shownTab === 'role' && mode && (
            <button
              onClick={() => stopViewAs()}
              className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 border-t border-page text-sm font-bold text-ink-500 hover:text-ink-900 hover:bg-page/50 transition-colors"
            >
              <LogOut className="h-4 w-4" /> חזרה לתצוגה שלי
            </button>
          )}

          {shownTab === 'role' && (
            <div className="mt-3 px-4 py-2.5 border-t border-page text-[11px] text-ink-400 text-center leading-relaxed">
              תצוגה בלבד — שמירת נתונים מושבתת במצב זה.
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
