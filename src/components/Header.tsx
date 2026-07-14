'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Calendar, Users, Layers, Clock, ClipboardList, User, LogOut, Settings, Menu, X, Route, Trophy, MessageSquare, Watch, Bell, Dumbbell, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

const allNavItems = [
  { href: '/dashboard', tab: 'dashboard', labelKey: 'dashboard', icon: Activity },
  { href: '/dashboard/review', tab: 'review', labelKey: 'review', icon: MessageSquare },
  { href: '/dashboard/plan/new', tab: 'plan/new', labelKey: 'planner', icon: Calendar },
  { href: '/dashboard/athletes', tab: 'athletes', labelKey: 'athletes', icon: Users },
  { href: '/dashboard/academy', tab: 'academy', labelKey: 'academy', icon: GraduationCap },
  { href: '/dashboard/groups', tab: 'groups', labelKey: 'groups', icon: Layers },
  { href: '/dashboard/activities', tab: 'activities', labelKey: 'activities', icon: Route },
  { href: '/dashboard/program', tab: 'program', labelKey: 'program', icon: ClipboardList },
  { href: '/dashboard/practice', tab: 'practice', labelKey: 'practice', icon: Dumbbell },
  { href: '/dashboard/races', tab: 'races', labelKey: 'races', icon: Trophy },
  { href: '/dashboard/history', tab: 'history', labelKey: 'history', icon: Clock },
  { href: '/dashboard/settings', tab: 'settings', labelKey: 'settings', icon: Settings },
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
  const [hasGarmin, setHasGarmin] = useState<boolean | null>(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [showNotifications, setShowNotifications] = useState(false);

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
            const n = g.name.toLowerCase();
            if (n.includes('group a') || n.includes('group 1') || n.includes('sub 2:30')) { setGroupName('Group 1'); setGroupColor('#22c55e'); }
            else if (n.includes('group b') || n.includes('group 2') || n.includes('sub 2:35')) { setGroupName('Group 2'); setGroupColor('#eab308'); }
            else if (n.includes('group c') || n.includes('group 3') || n.includes('sub 2:45')) { setGroupName('Group 3'); setGroupColor('#f97316'); }
            else { setGroupName(g.name); setGroupColor('#6366f1'); }
          }
        });
    }

    if (athleteId) {
      const supabaseClient = getSupabase();
      supabaseClient.from('athletes').select('garmin_auth').eq('id', athleteId).single()
        .then(({ data }) => { setHasGarmin(!!data?.garmin_auth); });
      fetch('/api/groups').then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setAvailableGroups(data.groups || data || []); })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    fetch('/api/auth/me', { headers: { 'x-user-email': userEmail } })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.role) setUserRole(data.role); })
      .catch(() => {});
  }, [userEmail]);

  const navReady = permissionsLoaded && !!userRole;

  const navItems = (() => {
    if (!navReady) return [];
    const enabledTabs = permissions
      .filter(p => p.role === userRole && p.enabled)
      .map(p => p.tab);
    if (userRole === 'admin' && !enabledTabs.includes('settings')) {
      enabledTabs.push('settings');
    }
    const items = allNavItems.filter(item => enabledTabs.includes(item.tab));
    if (isAthlete) items.push(profileNavItem);
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
    router.push('/');
  };

  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : userEmail ? userEmail[0].toUpperCase() : '?';

  return (
    <header className="bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-40">
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
              <div className="relative hidden lg:block">
                <button
                  onClick={() => { setShowGroupPicker(!showGroupPicker); setShowNotifications(false); }}
                  className="text-xs font-bold px-2.5 py-1 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ color: groupColor, borderColor: `${groupColor}40`, backgroundColor: `${groupColor}15` }}
                >
                  {groupName}
                </button>
                {showGroupPicker && availableGroups.length > 0 && (
                  <div className="absolute end-0 top-full mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-2 min-w-[160px] z-50">
                    {availableGroups.map(g => {
                      const n = g.name.toLowerCase();
                      const color = n.includes('group a') || n.includes('group 1') || n.includes('sub 2:30') ? '#3b82f6'
                        : n.includes('group b') || n.includes('group 2') || n.includes('sub 2:35') ? '#a855f7'
                        : n.includes('group c') || n.includes('group 3') || n.includes('sub 2:45') ? '#14b8a6'
                        : '#6366f1';
                      const displayName = n.includes('group a') || n.includes('group 1') || n.includes('sub 2:30') ? 'Group 1'
                        : n.includes('group b') || n.includes('group 2') || n.includes('sub 2:35') ? 'Group 2'
                        : n.includes('group c') || n.includes('group 3') || n.includes('sub 2:45') ? 'Group 3'
                        : g.name;
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
                          className="w-full text-start px-4 py-2.5 text-xs font-semibold hover:bg-slate-700/50 transition-colors flex items-center gap-2"
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span style={{ color }}>{displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {isAthlete && hasGarmin !== null && (
              <div className={cn('relative group p-2 rounded-lg', hasGarmin ? 'text-emerald-400' : 'text-red-400')}>
                <Watch className="h-4.5 w-4.5" />
                <span className="absolute -bottom-8 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-slate-800 border border-slate-600 text-white text-[10px] font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50">
                  {hasGarmin ? th('garminConnected') : th('garminNotConnected')}
                </span>
              </div>
            )}

            <div className="relative">
              <button
                onClick={() => { setShowNotifications(!showNotifications); setShowGroupPicker(false); }}
                className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <Bell className="h-4.5 w-4.5" />
              </button>
              {showNotifications && (
                <div className="absolute end-0 top-full mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-4 px-5 min-w-[200px] z-50">
                  <p className="text-xs text-slate-400 text-center">{th('nothingNew')}</p>
                </div>
              )}
            </div>

            <div className="bg-primary-600/20 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-primary-300 ring-1 ring-primary-500/20">
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className="p-2.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              title={tc('signOut')}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        <div
          className={cn(
            'md:hidden overflow-hidden transition-all duration-300 ease-in-out',
            mobileMenuOpen ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <nav className="py-3 space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              const isReview = item.tab === 'review';
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-base font-medium rounded-lg transition-colors',
                    isReview
                      ? isActive
                        ? 'bg-amber-400 text-slate-900 font-bold'
                        : 'bg-amber-400/10 text-amber-300 border border-amber-400/30 font-bold'
                      : isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{t(item.labelKey as any)}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-700 py-4 px-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-primary-600/30 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-300">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{userName}</span>
                  {groupName && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-lg border flex-shrink-0" style={{ color: groupColor, borderColor: `${groupColor}40`, backgroundColor: `${groupColor}15` }}>
                      {groupName}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 truncate">{userEmail}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <LocaleSwitcher />
            </div>
            <button
              onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <LogOut className="h-5 w-5" />
              <span className="font-medium">{tc('signOut')}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
