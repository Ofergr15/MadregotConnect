'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Calendar, Users, Layers, Clock, ClipboardList, User, LogOut, Settings, X, Route, MessageSquare, Bell, Dumbbell, GraduationCap, Eye, UserCheck, ClipboardCheck, BarChart3, Newspaper, Image, CalendarDays, Wrench, Search as SearchIcon } from 'lucide-react';
import { cn, resolveGroup } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, stopViewAs, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { InsetSection, InsetRow, Sheet } from '@/components/ui';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

const allNavItems = [
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Activity },
  { href: '/dashboard/feed', tab: 'feed', labelKey: 'feed', icon: Newspaper },
  { href: '/dashboard/review', tab: 'review', labelKey: 'review', icon: MessageSquare },
  { href: '/dashboard/plan/new', tab: 'plan/new', labelKey: 'planner', icon: Calendar },
  { href: '/dashboard/athletes', tab: 'athletes', labelKey: 'athletes', icon: Users },
  { href: '/dashboard/academy', tab: 'academy', labelKey: 'academy', icon: GraduationCap },
  { href: '/dashboard/groups', tab: 'groups', labelKey: 'groups', icon: Layers },
  { href: '/dashboard/activities', tab: 'activities', labelKey: 'activities', icon: Route },
  { href: '/dashboard/program', tab: 'program', labelKey: 'program', icon: ClipboardList },
  { href: '/dashboard/practice', tab: 'practice', labelKey: 'practice', icon: Dumbbell },
  { href: '/dashboard/practice-attendance', tab: 'practice-attendance', labelKey: 'practiceAttendance', icon: UserCheck },
  { href: '/dashboard/workout-feedback', tab: 'workout-feedback', labelKey: 'workoutFeedback', icon: ClipboardCheck },
  { href: '/dashboard/team-volume', tab: 'team-volume', labelKey: 'teamVolume', icon: BarChart3 },
  { href: '/dashboard/calendar', tab: 'calendar', labelKey: 'calendar', icon: CalendarDays },
  { href: '/dashboard/history', tab: 'history', labelKey: 'history', icon: Clock },
  { href: '/dashboard/photos', tab: 'photos', labelKey: 'photos', icon: Image },
  { href: '/dashboard/settings', tab: 'settings', labelKey: 'settings', icon: Settings },
  { href: '/dashboard/coach-tools', tab: 'coach-tools', labelKey: 'coachTools', icon: Wrench },
];

const profileNavItem = { href: '/dashboard/profile', tab: 'profile', labelKey: 'profile', icon: User };

interface TabPermission {
  role: string;
  tab: string;
  enabled: boolean;
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  const th = useTranslations('header');
  const tc = useTranslations('common');
  const [isAthlete, setIsAthlete] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [permissions, setPermissions] = useState<TabPermission[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [groupColor, setGroupColor] = useState<string>('#6366f1');
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [pendingResults, setPendingResults] = useState<Array<{ id: string; athlete_name: string; test_name: string; time_seconds: number }>>([]);
  const [inbox, setInbox] = useState<Array<{ id: string; title: string; body: string; url: string; sentAt: string; unread: boolean; actorAvatarUrl?: string | null }>>([]);
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    const athleteId = localStorage.getItem('athlete_id');
    const name = localStorage.getItem('athlete_name');
    const email = localStorage.getItem('athlete_email');
    const coachEmail = localStorage.getItem('coach_email');

    if (athleteId) {
      setIsAthlete(true);
      setUserName(name || '');
      setUserEmail(email || '');
    } else if (coachEmail) {
      setUserName('Coach');
      setUserEmail(coachEmail);
    }

    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const fullName = session.user.user_metadata?.full_name;
        if (fullName) setUserName(fullName);
        if (session.user.email) setUserEmail(session.user.email);
      }
    });

    fetch('/api/admin/tab-permissions')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.permissions) setPermissions(data.permissions);
        setPermissionsLoaded(true);
      })
      .catch(() => setPermissionsLoaded(true));

    const groupId = localStorage.getItem('athlete_group_id');
    if (groupId && athleteId) {
      const supabaseClient = getSupabase();
      supabaseClient.from('groups').select('name').eq('id', groupId).single()
        .then(({ data: g }) => {
          if (g?.name) {
            const rg = resolveGroup(g.name);
            setGroupName(rg.displayName);
            setGroupColor(rg.hex);
          }
        });
    }

    if (athleteId) {
      fetch('/api/groups').then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setAvailableGroups(data.groups || data || []); })
        .catch(() => {});
      // Athlete notification history for the bell inbox (unread count + preview).
      fetch(`/api/notifications/inbox?athleteId=${encodeURIComponent(athleteId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (Array.isArray(data?.items)) setInbox(data.items); })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    setIsSuper(isSuperUser(userEmail));
    fetch('/api/auth/me', { headers: { 'x-user-email': userEmail } })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.role) setUserRole(data.role); })
      .catch(() => {});
  }, [userEmail]);

  // Staff (admin/coach/academy_coach) get the pending benchmark-approval queue
  // surfaced in the header bell.
  useEffect(() => {
    if (!userRole || !['admin', 'coach', 'academy_coach'].includes(userRole)) return;
    fetch('/api/academy/benchmarks?status=pending')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.results) setPendingResults(data.results); })
      .catch(() => {});
  }, [userRole]);

  // Super-user "view as" override: while a role scenario is active, render the
  // nav as if we had that role (the maintenance scenario is handled by the gate,
  // not here — it leaves the role untouched).
  const viewMode = typeof window !== 'undefined' ? getViewMode() : null;
  const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
  // The super user (Ofer) always gets full admin-level nav, regardless of their
  // stored DB role (which may just be 'runner') — so admin-only tabs like
  // practice-attendance / workout-feedback are always reachable. A view-as role
  // scenario still overrides this so previews render correctly.
  const baseRole = isSuper ? 'admin' : userRole;
  const effectiveRole = previewRole || baseRole;

  const navReady = permissionsLoaded && !!effectiveRole;

  const navItems = (() => {
    if (!navReady) return [];
    const enabledTabs = permissions
      .filter(p => p.role === effectiveRole && p.enabled)
      .map(p => p.tab);
    if (effectiveRole === 'admin' && !enabledTabs.includes('settings')) {
      enabledTabs.push('settings');
    }
    const items = allNavItems.filter(item => enabledTabs.includes(item.tab));
    // Athlete-flavoured roles get the profile tab.
    if (isAthlete || (previewRole && !['admin', 'coach', 'academy_coach'].includes(previewRole))) {
      if (!items.some(i => i.tab === 'profile')) items.push(profileNavItem);
    }
    // Coach Tools hub — every staff account gets it, mirrors BottomTabBar.
    if (STAFF_ROLES.includes(effectiveRole || '') && !items.some(i => i.tab === 'coach-tools')) {
      items.push(allNavItems.find(i => i.tab === 'coach-tools')!);
    }
    return items.length > 0 ? items : [allNavItems.find(i => i.tab === 'dashboard')!, profileNavItem];
  })();

  const handleLogout = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    localStorage.removeItem('athlete_id');
    localStorage.removeItem('athlete_name');
    localStorage.removeItem('athlete_email');
    localStorage.removeItem('athlete_group_id');
    localStorage.removeItem('coach_email');
    localStorage.removeItem('admin_session');
    localStorage.removeItem('dashboard_synced');
    // Clear any active "view as" scenario.
    localStorage.removeItem('view_as_role');
    router.push('/');
  };

  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : userEmail ? userEmail[0].toUpperCase() : '?';

  return (
    <header className="bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-40 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo + Review */}
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <img src="/images/logo.png" alt="Madregot" className="h-9 w-9 object-contain brightness-0 invert" />
              <span className="text-base font-bold tracking-tight hidden sm:inline">Madregot</span>
            </Link>
            {navReady && navItems.some(i => i.tab === 'review') && (() => {
              const isActive = pathname === '/dashboard/review';
              return (
                <Link
                  href="/dashboard/review"
                  className={cn(
                    'hidden md:flex items-center gap-2 px-4 h-9 rounded-xl font-bold text-sm transition-all',
                    isActive
                      ? 'bg-amber-400 text-slate-900 shadow-md shadow-amber-400/25'
                      : 'bg-amber-400/15 text-amber-300 border border-amber-400/30 hover:bg-amber-400/25 hover:text-amber-200'
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-xs font-bold">{t('review')}</span>
                </Link>
              );
            })()}
          </div>

          {/* Desktop: Icon-only navigation with tooltips */}
          <nav className="hidden md:flex items-center gap-1.5">
            {!navReady ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-11 h-11 rounded-xl bg-slate-800/50 animate-pulse" />
                ))}
              </>
            ) : (
              navItems.filter(item => item.tab !== 'review').map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative group flex items-center justify-center w-11 h-11 rounded-xl transition-all',
                      isActive
                        ? 'bg-primary-600 text-white shadow-md shadow-primary-600/25'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="absolute -bottom-9 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2.5 py-1 bg-slate-800 border border-slate-600 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50">
                      {t(item.labelKey as any)}
                    </span>
                  </Link>
                );
              })
            )}
          </nav>

          {/* Desktop: User */}
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <LocaleSwitcher />
            <span className="text-sm text-slate-400 font-medium hidden lg:inline">{userName}</span>

            {groupName && (
              <div className="hidden lg:block">
                <button
                  onClick={() => { if (availableGroups.length > 0) { setShowGroupPicker(true); setShowNotifications(false); } }}
                  className="text-xs font-bold px-2.5 py-1 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ color: groupColor, borderColor: `${groupColor}40`, backgroundColor: `${groupColor}15` }}
                >
                  {groupName}
                </button>
                <Sheet open={showGroupPicker} onOpenChange={setShowGroupPicker} title={th('selectGroup')}>
                  <div className="space-y-1 pb-2">
                    {availableGroups.map(g => {
                      const rg = resolveGroup(g.name);
                      const color = rg.hex;
                      const displayName = rg.displayName;
                      return (
                        <button
                          key={g.id}
                          onClick={async () => {
                            localStorage.setItem('athlete_group_id', g.id);
                            const supabaseClient = getSupabase();
                            const athleteId = localStorage.getItem('athlete_id');
                            if (athleteId) {
                              await supabaseClient.from('athletes').update({ group_id: g.id }).eq('id', athleteId);
                            }
                            setShowGroupPicker(false);
                            window.location.reload();
                          }}
                          className="w-full min-h-[44px] text-start px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700/50 transition-colors flex items-center gap-2.5"
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span style={{ color }}>{displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                </Sheet>
              </div>
            )}

            {/* Desktop-only search entry point (roadmap #17) — mobile's
                equivalent lives as a static row in BottomTabBar's "More"
                sheet, since the mobile header has no room for another icon. */}
            <Link
              href="/dashboard/search"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title={t('search')}
              aria-label={t('search')}
            >
              <SearchIcon className="h-4.5 w-4.5" />
            </Link>

            {isSuper && (
              <button
                onClick={() => (viewMode ? stopViewAs() : window.dispatchEvent(new Event('open-view-as')))}
                className={cn(
                  'relative group p-2 rounded-lg transition-colors',
                  viewMode ? 'text-red-400 hover:text-red-300 hover:bg-slate-800' : 'text-amber-400 hover:text-amber-300 hover:bg-slate-800',
                )}
                title={viewMode ? th('exitViewAs') : th('viewAsUser')}
                aria-label={viewMode ? th('exitViewAs') : th('viewAsUser')}
              >
                {viewMode ? <LogOut className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                <span className="absolute -bottom-8 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-slate-800 border border-slate-600 text-white text-[10px] font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50">
                  {viewMode ? th('exitViewAs') : th('viewAsUser')}
                </span>
              </button>
            )}

            {(() => {
              const unreadInbox = inbox.filter(i => i.unread).length;
              const badge = pendingResults.length + unreadInbox;
              const empty = pendingResults.length === 0 && inbox.length === 0;
              return (
            <div>
              <button
                onClick={() => { setShowNotifications(!showNotifications); setShowGroupPicker(false); }}
                className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label={th('notifications')}
              >
                <Bell className="h-4.5 w-4.5" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </button>
              <Sheet open={showNotifications} onOpenChange={setShowNotifications} title={th('notifications')}>
                {empty ? (
                  <p className="text-xs text-slate-400 text-center py-6">{th('nothingNew')}</p>
                ) : (
                  <div className="space-y-1 pb-2">
                    {/* Staff: pending benchmark approvals. */}
                    {pendingResults.length > 0 && (
                      <>
                        <div className="px-1 py-2 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          <span className="text-xs font-bold text-white">{pendingResults.length} result{pendingResults.length !== 1 ? 's' : ''} awaiting approval</span>
                        </div>
                        <div className="max-h-40 overflow-y-auto py-1">
                          {pendingResults.map(r => (
                            <div key={r.id} className="px-1 py-2 flex items-center gap-2 text-xs">
                              <span className="flex-1 min-w-0 truncate text-slate-200" dir="auto">{r.athlete_name}</span>
                              <span className="text-slate-400">{r.test_name}</span>
                              <span className="font-bold text-white tabular-nums">
                                {Math.floor(r.time_seconds / 60)}:{(r.time_seconds % 60).toFixed(r.time_seconds % 1 ? 2 : 0).padStart(r.time_seconds % 1 ? 5 : 2, '0')}
                              </span>
                            </div>
                          ))}
                        </div>
                        <Link
                          href="/dashboard/academy?tab=results"
                          onClick={() => setShowNotifications(false)}
                          className="block min-h-[44px] flex items-center justify-center border-t border-slate-700/60 text-xs font-semibold text-primary-400 hover:text-primary-300 text-center"
                        >
                          Review in Academy → Results
                        </Link>
                      </>
                    )}

                    {/* Athlete: notification history preview. */}
                    {inbox.length > 0 && (
                      <>
                        <div className="max-h-64 overflow-y-auto py-1">
                          {inbox.slice(0, 6).map(n => (
                            <Link
                              key={n.id}
                              href={n.url || '/dashboard'}
                              onClick={() => setShowNotifications(false)}
                              className="flex items-start gap-2 px-1 py-2 rounded-lg hover:bg-slate-700/40 transition-colors"
                            >
                              {n.actorAvatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={n.actorAvatarUrl} alt="" className="mt-0.5 w-6 h-6 rounded-full object-cover shrink-0" />
                              ) : n.unread && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0" />}
                              <span className={`flex-1 min-w-0 ${n.unread || n.actorAvatarUrl ? '' : 'ps-3.5'}`}>
                                <span className={`block text-xs truncate ${n.unread ? 'font-bold text-white' : 'font-semibold text-slate-200'}`} dir="auto">{n.title}</span>
                                <span className="block text-[11px] text-slate-400 truncate" dir="auto">{n.body}</span>
                              </span>
                            </Link>
                          ))}
                        </div>
                        <Link
                          href="/dashboard/notifications"
                          onClick={() => setShowNotifications(false)}
                          className="block min-h-[44px] flex items-center justify-center border-t border-slate-700/60 text-xs font-semibold text-primary-400 hover:text-primary-300 text-center"
                        >
                          {th('viewAll')}
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </Sheet>
            </div>
              );
            })()}

            <div className="bg-primary-600/20 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-primary-300 ring-1 ring-primary-500/20">
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className="p-2.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              title={tc('signOut')}
              aria-label={tc('signOut')}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile: bell (→ notifications inbox) + avatar (→ account menu).
              Navigation lives in the bottom tab bar; these are the only header
              actions on the phone. */}
          <div className="md:hidden flex items-center gap-2">
            {isAthlete && (
              <Link
                href="/dashboard/notifications"
                aria-label={th('notifications')}
                className="relative flex items-center justify-center w-11 h-11 rounded-full text-slate-300 active:scale-95 transition-transform"
              >
                <Bell className="h-5 w-5" />
                {inbox.filter(i => i.unread).length > 0 && (
                  <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {inbox.filter(i => i.unread).length}
                  </span>
                )}
              </Link>
            )}
            <Link
              href="/dashboard/search"
              aria-label={t('search')}
              className="flex items-center justify-center w-11 h-11 rounded-full text-slate-300 active:scale-95 transition-transform"
            >
              <SearchIcon className="h-5 w-5" />
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-primary-600/20 ring-1 ring-primary-500/20 text-sm font-bold text-primary-300 active:scale-95 transition-transform"
              aria-label={mobileMenuOpen ? tc('close') : th('account')}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : initials}
            </button>
          </div>
        </div>

        {/* Mobile account menu (no nav — the tab bar owns navigation) */}
        <div
          className={cn(
            'md:hidden overflow-hidden transition-all duration-300 ease-in-out',
            mobileMenuOpen ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="py-3 px-4">
            {/* Identity header */}
            <div className="flex items-center gap-3 mb-4 px-1">
              <div className="bg-primary-600/30 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-primary-300">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-white truncate">{userName}</span>
                  {groupName && (
                    <span className="text-2xs font-bold px-2 py-0.5 rounded-md border flex-shrink-0" style={{ color: groupColor, borderColor: `${groupColor}40`, backgroundColor: `${groupColor}15` }}>
                      {groupName}
                    </span>
                  )}
                </div>
                {/* Strava/Garmin/dev accounts get a synthetic placeholder address
                    (e.g. strava_123@strava.madregot.local) — never a real email
                    the athlete recognizes, so it's hidden rather than shown. */}
                {userEmail && !userEmail.endsWith('.madregot.local') && (
                  <div className="text-xs text-slate-400 truncate" dir="ltr">{userEmail}</div>
                )}
              </div>
            </div>

            {/* Inset-grouped account actions */}
            <InsetSection>
              <InsetRow icon={User} iconBg="bg-slate-600" label={t('profile')} href="/dashboard/profile" onClick={() => setMobileMenuOpen(false)} />
              {isSuper && (
                <InsetRow icon={Eye} iconBg="bg-amber-500" label={th('viewAsUser')} onClick={() => { setMobileMenuOpen(false); window.dispatchEvent(new Event('open-view-as')); }} />
              )}
            </InsetSection>

            <div className="flex items-center justify-between px-1 mb-3">
              <span className="text-2xs font-bold uppercase tracking-wider text-slate-400">{tc('language') || 'Language'}</span>
              <LocaleSwitcher />
            </div>

            <InsetSection>
              <InsetRow icon={LogOut} iconBg="bg-red-500" label={tc('signOut')} danger onClick={() => { setMobileMenuOpen(false); handleLogout(); }} />
            </InsetSection>
          </div>
        </div>
      </div>
    </header>
  );
}
