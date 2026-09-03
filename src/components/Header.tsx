'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Calendar, Users, Layers, Clock, ClipboardList, User, LogOut, Settings, X, Route, MessageSquare, Bell, Dumbbell, GraduationCap, Eye, UserCheck, ClipboardCheck, BarChart3, Newspaper, CalendarDays, Wrench, Search as SearchIcon } from 'lucide-react';
import { cn, resolveGroup } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { getSupabase } from '@/lib/supabase/client';
import { clearIdentityKeys } from '@/lib/auth/identity-keys';
import { getViewMode, stopViewAs, useIsSuperUser, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { InsetSection, InsetRow, Sheet } from '@/components/ui';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

const allNavItems = [
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Activity },
  { href: '/feed', tab: 'feed', labelKey: 'feed', icon: Newspaper },
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
  // Photos is still being built — nav entry and route disabled for now. Restore
  // this line (+ re-add the lucide Image import) alongside the BottomTabBar
  // MoreCard and the page itself (see photos/page.tsx).
  // { href: '/dashboard/photos', tab: 'photos', labelKey: 'photos', icon: Image },
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
  const [groupColor, setGroupColor] = useState<string>('#159AFF');
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [pendingResults, setPendingResults] = useState<Array<{ id: string; athlete_name: string; test_name: string; time_seconds: number }>>([]);
  const [inbox, setInbox] = useState<Array<{ id: string; title: string; body: string; url: string; sentAt: string; unread: boolean; actorAvatarUrl?: string | null }>>([]);
  // Two independent answers to "is this the super user?", either of which is
  // enough: the local one (useIsSuperUser, available immediately) and the one
  // /api/auth/me derives from the verified session below. Neither alone was
  // reliable — see the hook's comment.
  const localSuper = useIsSuperUser();
  const [serverSuper, setServerSuper] = useState(false);
  const isSuper = localSuper || serverSuper;

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
      // apiHeaders() is async (it reads the session for the bearer token), hence
      // the IIFE rather than a bare fetch().then chain.
      (async () => {
        const res = await fetch(`/api/notifications/inbox?athleteId=${encodeURIComponent(athleteId)}`, {
          headers: await apiHeaders(),
        }).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (Array.isArray(data?.items)) setInbox(data.items);
      })();
    }
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    // The route reads the role off the session now, not off userEmail — sending
    // an address was enough to be handed that address's role. apiHeaders() is
    // async (it reads the session for the bearer token), hence the IIFE.
    (async () => {
      const res = await fetch('/api/auth/me', { headers: await apiHeaders() }).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (data?.role) setUserRole(data.role);
      if (data?.isSuper) setServerSuper(true);
    })();
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
    // Includes any active "view as" scenario — see IDENTITY_KEYS.
    clearIdentityKeys();
    router.push('/');
  };

  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : userEmail ? userEmail[0].toUpperCase() : '?';

  return (
    // The frames give the header no bar of its own — it floats on the page grey
    // with no rule under it, and the round white icon buttons carry the chrome.
    <header className="backdrop-blur-md sticky top-0 z-40 safe-top bg-page/95">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo + Review */}
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/feed" className="flex items-center gap-2.5">
              {/* The mark is a dark PNG; `brightness-0` flattens it to solid
                  black, which is what the page grey wants. */}
              <img src="/images/logo.png" alt="Madregot" className="h-9 w-9 object-contain brightness-0" />
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
                      ? 'bg-band-3 text-ink-900 shadow-md shadow-band-3/25'
                      : 'bg-band-3/15 text-band-3 border border-band-3/30 hover:bg-band-3/25'
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
                  <div key={i} className={cn('w-11 h-11 rounded-xl animate-pulse', 'bg-card')} />
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
                      'relative group flex items-center justify-center w-11 h-11 transition-all',
                      'rounded-pill',
                      isActive
                        ? 'bg-brand-600 text-white'
                        : 'text-ink-400 hover:text-brand-600 hover:bg-card',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className={cn('absolute -bottom-9 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2.5 py-1 text-ink-700 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50', 'bg-ink-900')}>
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
            <span className={cn('text-sm font-medium hidden lg:inline', 'text-ink-500')}>{userName}</span>

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
                          className="w-full min-h-[44px] text-start px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-page/50 transition-colors flex items-center gap-2.5"
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

            {/* Search (roadmap #17). Mobile has its own entry below — the round
                icon button next to the bell — plus a row in BottomTabBar's
                "More" sheet. */}
            <Link
              href="/dashboard/search"
              className={cn('p-2 rounded-lg transition-colors', 'text-ink-400 hover:text-brand-600 hover:bg-card')}
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
                  viewMode ? 'text-accent-red hover:text-accent-red hover:bg-page' : 'text-band-3 hover:text-band-3 hover:bg-page',
                )}
                title={viewMode ? th('exitViewAs') : th('viewAsUser')}
                aria-label={viewMode ? th('exitViewAs') : th('viewAsUser')}
              >
                {viewMode ? <LogOut className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                {viewMode && (
                  <span className="absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-accent-red ring-2 ring-page" />
                )}
                <span className="absolute -bottom-8 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-card border border-ink-300 text-ink-700 text-[10px] font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50">
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
                className={cn('relative p-2 rounded-lg transition-colors', 'text-ink-400 hover:text-brand-600 hover:bg-card')}
                aria-label={th('notifications')}
              >
                <Bell className="h-4.5 w-4.5" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent-red text-white text-[10px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </button>
              <Sheet open={showNotifications} onOpenChange={setShowNotifications} title={th('notifications')}>
                {empty ? (
                  <p className="text-xs text-ink-400 text-center py-6">{th('nothingNew')}</p>
                ) : (
                  <div className="space-y-1 pb-2">
                    {/* Staff: pending benchmark approvals. */}
                    {pendingResults.length > 0 && (
                      <>
                        <div className="px-1 py-2 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                          <span className="text-xs font-bold text-ink-700">{pendingResults.length} result{pendingResults.length !== 1 ? 's' : ''} awaiting approval</span>
                        </div>
                        <div className="max-h-40 overflow-y-auto py-1">
                          {pendingResults.map(r => (
                            <div key={r.id} className="px-1 py-2 flex items-center gap-2 text-xs">
                              <span className="flex-1 min-w-0 truncate text-ink-700" dir="auto">{r.athlete_name}</span>
                              <span className="text-ink-400">{r.test_name}</span>
                              <span className="font-bold text-ink-700 tabular-nums">
                                {Math.floor(r.time_seconds / 60)}:{(r.time_seconds % 60).toFixed(r.time_seconds % 1 ? 2 : 0).padStart(r.time_seconds % 1 ? 5 : 2, '0')}
                              </span>
                            </div>
                          ))}
                        </div>
                        <Link
                          href="/dashboard/academy?tab=results"
                          onClick={() => setShowNotifications(false)}
                          className="block min-h-[44px] flex items-center justify-center border-t border-page/60 text-xs font-semibold text-brand-600 hover:text-brand-700 text-center"
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
                              className="flex items-start gap-2 px-1 py-2 rounded-lg hover:bg-page/40 transition-colors"
                            >
                              {n.actorAvatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={n.actorAvatarUrl} alt="" className="mt-0.5 w-6 h-6 rounded-full object-cover shrink-0" />
                              ) : n.unread && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-600 shrink-0" />}
                              <span className={`flex-1 min-w-0 ${n.unread || n.actorAvatarUrl ? '' : 'ps-3.5'}`}>
                                <span className={`block text-xs truncate ${n.unread ? 'font-bold text-ink-700' : 'font-semibold text-ink-700'}`} dir="auto">{n.title}</span>
                                <span className="block text-[11px] text-ink-400 truncate" dir="auto">{n.body}</span>
                              </span>
                            </Link>
                          ))}
                        </div>
                        <Link
                          href="/dashboard/notifications"
                          onClick={() => setShowNotifications(false)}
                          className="block min-h-[44px] flex items-center justify-center border-t border-page/60 text-xs font-semibold text-brand-600 hover:text-brand-700 text-center"
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

            <div className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold',
              'bg-brand-600 text-white',
            )}>
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className={cn('p-2.5 rounded-lg transition-colors', 'text-ink-400 hover:text-accent-red hover:bg-card')}
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
                className={cn(
                  'relative flex items-center justify-center w-11 h-11 rounded-full active:scale-95 transition-transform',
                  'bg-card text-brand-600',
                )}
              >
                <Bell className="h-5 w-5" />
                {inbox.filter(i => i.unread).length > 0 && (
                  <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent-red text-white text-[10px] font-bold flex items-center justify-center">
                    {inbox.filter(i => i.unread).length}
                  </span>
                )}
              </Link>
            )}
            <Link
              href="/dashboard/search"
              aria-label={t('search')}
              className={cn(
                'flex items-center justify-center w-11 h-11 rounded-full active:scale-95 transition-transform',
                'bg-card text-brand-600',
              )}
            >
              <SearchIcon className="h-5 w-5" />
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={cn(
                'flex items-center justify-center w-11 h-11 rounded-full text-sm font-bold active:scale-95 transition-transform',
                'bg-brand-600 text-white',
              )}
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
              <div className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold',
                'bg-brand-600 text-white',
              )}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('text-base font-semibold truncate', 'text-ink-700')}>{userName}</span>
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
                  <div className={cn('text-xs truncate', 'text-ink-400')} dir="ltr">{userEmail}</div>
                )}
              </div>
            </div>

            {/* Inset-grouped account actions */}
            <InsetSection>
              <InsetRow icon={User} iconBg={'bg-brand-600'} label={t('profile')} href="/dashboard/profile" onClick={() => setMobileMenuOpen(false)} />
              {isSuper && (
                <InsetRow
                  icon={viewMode ? LogOut : Eye}
                  iconBg={viewMode ? 'bg-accent-red' : 'bg-band-3'}
                  label={th('viewAsUser')}
                  sublabel={viewMode ? th('viewAsActive') : undefined}
                  onClick={() => { setMobileMenuOpen(false); window.dispatchEvent(new Event('open-view-as')); }}
                />
              )}
            </InsetSection>

            <div className="flex items-center justify-between px-1 mb-3">
              <span className={cn('text-2xs font-bold uppercase tracking-wider', 'text-ink-400')}>{tc('language') || 'Language'}</span>
              <LocaleSwitcher />
            </div>

            <InsetSection>
              <InsetRow icon={LogOut} iconBg="bg-accent-red" label={tc('signOut')} danger onClick={() => { setMobileMenuOpen(false); handleLogout(); }} />
            </InsetSection>
          </div>
        </div>
      </div>
    </header>
  );
}
