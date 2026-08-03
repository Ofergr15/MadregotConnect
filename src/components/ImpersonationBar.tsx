'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, X, Search, LogOut, Users } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { isSuperUser } from '@/lib/constants';
import { cn } from '@/lib/utils';
import {
  getActiveImpersonation,
  startImpersonation,
  stopImpersonation,
  installImpersonationGuard,
  type ViewAsTarget,
} from '@/lib/impersonation';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  groupId?: string | null;
  onboardingStatus?: string;
  approved?: boolean;
}

// Hebrew labels for the role filter chips / row tags.
const ROLE_LABELS: Record<string, string> = {
  admin: 'מנהל',
  coach: 'מאמן',
  academy_coach: 'מאמן אקדמיה',
  runner: 'רץ',
  core_runner: 'רץ ליבה',
  academy_user: 'אקדמיה',
  viewer: 'צופה',
};
const roleLabel = (r?: string) => ROLE_LABELS[r || 'runner'] || r || 'רץ';

// Filter-chip styling: highlighted when active; amber tone for the maintenance
// chip, slate for the rest.
const cnChip = (activeChip: boolean, tone: 'amber' | 'slate') =>
  cn(
    'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors',
    activeChip
      ? tone === 'amber'
        ? 'bg-amber-500/25 text-amber-200 border-amber-500/50'
        : 'bg-primary-600/30 text-primary-200 border-primary-500/50'
      : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
  );

// Super-user "view as" control. Always mounted in the root layout (a sibling of
// MaintenanceGate, outside the intl provider) so it can overlay the maintenance
// screen and stay reachable everywhere. Renders:
//  - a persistent amber banner while impersonating ("Viewing as … — Switch/Exit"),
//    at z-[300] so it sits above the maintenance gate (z-200); and
//  - a searchable member chooser, opened from the banner's "Switch" or from the
//    Header eye button via the 'open-view-as' window event.
// Non-super-users get nothing (the chooser refuses to open).
export function ImpersonationBar() {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<ViewAsTarget | null>(null);
  const [canView, setCanView] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  // Active filter: 'all', a role name, or '__blocked__' (would see maintenance).
  const [filter, setFilter] = useState<string>('all');
  // Lower-cased maintenance allowlist emails, to tag who is blocked vs allowed.
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [maintenanceOn, setMaintenanceOn] = useState(false);
  // True when the maintenance gate is currently blocking the REAL super user —
  // then the Header (and its eye button) is hidden behind the gate, so we
  // surface a floating trigger above the gate instead.
  const [gateBlockingMe, setGateBlockingMe] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Push the whole page down by the banner's height while impersonating, so the
  // fixed banner doesn't cover the sticky header. Restored on exit.
  useEffect(() => {
    if (!active) {
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
  }, [active]);

  // Determine whether the REAL signed-in user is the super user. While
  // impersonating, the identity keys hold the target, so read the pre-switch
  // snapshot to recover the real email.
  useEffect(() => {
    installImpersonationGuard();
    setMounted(true);
    const current = getActiveImpersonation();
    setActive(current);

    if (current) {
      // Impersonating → always allow the bar so Exit is reachable. (The snapshot
      // proves the real user was the super user, since only they can start it.)
      setCanView(true);
      return;
    }

    // Resolve the real signed-in email, then (if super user) check whether the
    // maintenance gate is currently blocking us — if so, the Header eye button
    // is hidden behind the gate and we show a floating trigger above it.
    const checkGate = (email: string) => {
      fetch(`/api/maintenance?email=${encodeURIComponent(email)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setGateBlockingMe(!!d.maintenance && !d.allowed);
          setMaintenanceOn(!!d.maintenance);
          setAllowlist((d.allowlist || []).map((e: string) => e.toLowerCase().trim()));
        })
        .catch(() => {});
    };

    let realEmail =
      localStorage.getItem('coach_email') ||
      localStorage.getItem('athlete_email') ||
      '';
    if (isSuperUser(realEmail)) {
      setCanView(true);
      checkGate(realEmail);
      return;
    }
    // Fall back to the Supabase session email (Google sign-in).
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        const e = data.session?.user?.email || '';
        if (isSuperUser(e)) {
          setCanView(true);
          checkGate(e);
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

  // Load the member list the first time the chooser opens, plus the maintenance
  // allowlist (so we can tag who is blocked) if we don't already have it.
  useEffect(() => {
    if (!chooserOpen || users.length > 0) return;
    setLoading(true);
    fetch('/api/admin/users')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.users) setUsers(data.users as AdminUser[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    if (allowlist.length === 0) {
      fetch('/api/maintenance')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setMaintenanceOn(!!d.maintenance);
          setAllowlist((d.allowlist || []).map((e: string) => e.toLowerCase().trim()));
        })
        .catch(() => {});
    }
  }, [chooserOpen, users.length, allowlist.length]);

  // A member is "blocked by maintenance" when maintenance is ON and their email
  // is not on the allowlist — i.e. they would see the maintenance screen.
  const isBlocked = (u: AdminUser) =>
    maintenanceOn && !allowlist.includes((u.email || '').toLowerCase().trim());

  // Roles present among the members, for the filter chips.
  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => set.add(u.role || 'runner'));
    return Array.from(set).sort();
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => u.id !== active?.id)
      .filter((u) => {
        if (filter === 'all') return true;
        if (filter === '__blocked__') return isBlocked(u);
        return (u.role || 'runner') === filter;
      })
      .filter(
        (u) =>
          !q ||
          (u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q)
      )
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', 'he'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, query, active?.id, filter, maintenanceOn, allowlist]);

  if (!mounted || !canView) return null;

  const pick = (u: AdminUser) => {
    startImpersonation({
      id: u.id,
      email: u.email,
      name: u.name,
      groupId: u.groupId ?? null,
      role: u.role,
    });
  };

  return (
    <>
      {/* Floating trigger above the maintenance gate: when maintenance blocks the
          super user, the Header eye button is hidden behind the gate, so surface
          a reachable "view as" button here (top-right, z above the gate). */}
      {!active && gateBlockingMe && (
        <button
          onClick={() => setChooserOpen(true)}
          className="fixed top-3 end-3 z-[300] flex items-center gap-1.5 px-3 py-2 rounded-full text-white text-xs font-bold shadow-lg safe-top"
          style={{ background: 'linear-gradient(90deg,#b45309,#d97706)' }}
        >
          <Eye className="h-4 w-4" /> צפייה כמשתמש
        </button>
      )}

      {/* Persistent banner while impersonating — above the maintenance gate. */}
      {active && (
        <div
          ref={bannerRef}
          className="fixed top-0 inset-x-0 z-[300] flex items-center gap-2 px-3 py-2 text-white text-sm font-semibold shadow-lg safe-top"
          style={{ background: 'linear-gradient(90deg,#b45309,#d97706)' }}
        >
          <Eye className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate" dir="auto">
            צופה בתור <b>{active.name || active.email}</b>
          </span>
          <div className="ms-auto flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setChooserOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors text-xs font-bold"
            >
              <Users className="h-3.5 w-3.5" /> החלף
            </button>
            <button
              onClick={() => stopImpersonation()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/25 hover:bg-black/40 transition-colors text-xs font-bold"
            >
              <LogOut className="h-3.5 w-3.5" /> יציאה
            </button>
          </div>
        </div>
      )}

      {/* Searchable member chooser */}
      {chooserOpen && (
        <div
          className="fixed inset-0 z-[320] flex items-start justify-center p-4 pt-[12vh] bg-black/60 backdrop-blur-sm"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
              <Eye className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white flex-1">צפייה כמשתמש</h2>
              <button
                onClick={() => setChooserOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 border-b border-slate-700">
              <div className="relative">
                <Search className="absolute top-1/2 -translate-y-1/2 end-3 h-4 w-4 text-slate-500 pointer-events-none" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="חיפוש לפי שם או אימייל…"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg ps-3 pe-9 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent"
                />
              </div>

              {/* Filter chips: All · (blocked-by-maintenance) · each role */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {(() => {
                  const chip = (key: string, label: string, count: number, tone: 'amber' | 'slate') => (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={cnChip(filter === key, tone)}
                    >
                      {label}
                      <span className="opacity-60">{count}</span>
                    </button>
                  );
                  const blockedCount = users.filter((u) => u.id !== active?.id && isBlocked(u)).length;
                  return (
                    <>
                      {chip('all', 'הכל', users.filter((u) => u.id !== active?.id).length, 'slate')}
                      {maintenanceOn &&
                        chip('__blocked__', '🚧 חסום בתחזוקה', blockedCount, 'amber')}
                      {roleOptions.map((r) =>
                        chip(r, roleLabel(r), users.filter((u) => (u.role || 'runner') === r && u.id !== active?.id).length, 'slate')
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto py-1">
              {loading ? (
                <p className="text-center text-sm text-slate-400 py-8">טוען משתמשים…</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">לא נמצאו משתמשים</p>
              ) : (
                filtered.map((u) => {
                  const initials = (u.name || u.email || '?')
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                  return (
                    <button
                      key={u.id}
                      onClick={() => pick(u)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700/60 transition-colors text-start"
                    >
                      <span className="w-9 h-9 rounded-full bg-primary-600/20 ring-1 ring-primary-500/20 flex items-center justify-center text-xs font-bold text-primary-300 shrink-0">
                        {initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-white truncate" dir="auto">
                            {u.name || u.email}
                          </span>
                          {isBlocked(u) && (
                            <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              🚧 חסום
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-400 truncate" dir="ltr">
                          {u.email}
                        </span>
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 shrink-0">
                        {roleLabel(u.role)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-slate-700 text-[11px] text-slate-500 text-center leading-relaxed">
              תצוגה בלבד — שמירת נתונים מושבתת במצב צפייה.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
