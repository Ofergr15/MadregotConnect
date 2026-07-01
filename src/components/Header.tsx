'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, Calendar, Users, Layers, Clock, ClipboardList, User, LogOut, Settings, Menu, X, Route, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';

const allNavItems = [
  { href: '/dashboard', tab: 'dashboard', label: 'Dashboard', icon: Activity },
  { href: '/dashboard/plan/new', tab: 'plan/new', label: 'Planner', icon: Calendar },
  { href: '/dashboard/athletes', tab: 'athletes', label: 'Athletes', icon: Users },
  { href: '/dashboard/groups', tab: 'groups', label: 'Groups', icon: Layers },
  { href: '/dashboard/activities', tab: 'activities', label: 'Activities', icon: Route },
  { href: '/dashboard/program', tab: 'program', label: 'Program', icon: ClipboardList },
  { href: '/dashboard/races', tab: 'races', label: 'Races', icon: Trophy },
  { href: '/dashboard/history', tab: 'history', label: 'History', icon: Clock },
  { href: '/dashboard/settings', tab: 'settings', label: 'Settings', icon: Settings },
];

const profileNavItem = { href: '/dashboard/profile', tab: 'profile', label: 'Profile', icon: User };

interface TabPermission {
  role: string;
  tab: string;
  enabled: boolean;
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAthlete, setIsAthlete] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [permissions, setPermissions] = useState<TabPermission[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [groupColor, setGroupColor] = useState<string>('#6366f1');

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
            setGroupName(g.name);
            const n = g.name.toLowerCase();
            if (n.includes('group a') || n.includes('sub 2:30')) setGroupColor('#3b82f6');
            else if (n.includes('group b') || n.includes('sub 2:35')) setGroupColor('#a855f7');
            else if (n.includes('group c') || n.includes('sub 2:45')) setGroupColor('#14b8a6');
            else setGroupColor('#6366f1');
          }
        });
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
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <img src="/images/logo.png" alt="Madregot" className="h-9 w-9 object-contain brightness-0 invert" />
            <span className="text-base font-bold tracking-tight hidden sm:inline">Madregot</span>
          </Link>

          {/* Desktop: Icon-only navigation with tooltips */}
          <nav className="hidden md:flex items-center gap-1.5">
            {!navReady ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-11 h-11 rounded-xl bg-slate-800/50 animate-pulse" />
                ))}
              </>
            ) : (
              navItems.map((item) => {
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
                    <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-slate-800 border border-slate-600 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50">
                      {item.label}
                    </span>
                  </Link>
                );
              })
            )}
          </nav>

          {/* Desktop: User */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 hidden lg:flex">
              <span className="text-sm text-slate-400 font-medium">{userName}</span>
              {groupName && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ color: groupColor, borderColor: `${groupColor}40`, backgroundColor: `${groupColor}15` }}>
                  {groupName.replace(/^Group\s*/i, '').split(' - ')[0]}
                </span>
              )}
            </div>
            <div className="bg-primary-600/20 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-primary-300 ring-1 ring-primary-500/20">
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className="p-2.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              title="Sign out"
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
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-base font-medium rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
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
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0" style={{ color: groupColor, borderColor: `${groupColor}40`, backgroundColor: `${groupColor}15` }}>
                      {groupName.replace(/^Group\s*/i, '').split(' - ')[0]}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 truncate">{userEmail}</div>
              </div>
            </div>
            <button
              onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <LogOut className="h-5 w-5" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
