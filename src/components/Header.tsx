'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, Calendar, Users, Layers, Clock, ClipboardList, User, LogOut, Settings, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';

const coachNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Activity },
  { href: '/dashboard/plan/new', label: 'New Plan', icon: Calendar },
  { href: '/dashboard/athletes', label: 'Athletes', icon: Users },
  { href: '/dashboard/groups', label: 'Groups', icon: Layers },
  { href: '/dashboard/program', label: 'Program', icon: ClipboardList },
  { href: '/dashboard/history', label: 'History', icon: Clock },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const athleteNavItems = [
  { href: '/dashboard/program', label: 'Program', icon: ClipboardList },
  { href: '/dashboard/profile', label: 'My Profile', icon: User },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAthlete, setIsAthlete] = useState(false);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

    // Try to get name from Supabase session
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const fullName = session.user.user_metadata?.full_name;
        if (fullName) setUserName(fullName);
        if (session.user.email) setUserEmail(session.user.email);
      }
    });
  }, []);

  const navItems = isAthlete ? athleteNavItems : coachNavItems;

  const handleLogout = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    localStorage.removeItem('athlete_id');
    localStorage.removeItem('athlete_name');
    localStorage.removeItem('athlete_email');
    localStorage.removeItem('athlete_group_id');
    localStorage.removeItem('coach_email');
    router.push('/');
  };

  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : userEmail ? userEmail[0].toUpperCase() : '?';

  return (
    <header className="bg-slate-800 border-b border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href={isAthlete ? '/dashboard/program' : '/dashboard'} className="flex items-center gap-3 shrink-0">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-10 w-10 object-contain brightness-0 invert" />
            <div className="flex flex-col leading-none hidden sm:flex">
              <span className="text-lg font-bold tracking-tight">Madregot</span>
              <span className="text-xs font-medium tracking-wide text-slate-400">After 2KM Running Club</span>
            </div>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0',
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Desktop user info + logout */}
          <div className="hidden md:flex items-center gap-3 shrink-0 ml-4">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-medium text-white leading-tight">{userName}</div>
              <div className="text-xs text-slate-400 leading-tight">{userEmail}</div>
            </div>
            <div className="bg-primary-600/30 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-primary-300">
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile hamburger button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
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
          <nav className="py-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-base font-medium transition-colors',
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

          {/* Mobile user info + logout */}
          <div className="border-t border-slate-700 py-4 px-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-primary-600/30 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-300">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{userName}</div>
                <div className="text-xs text-slate-400 truncate">{userEmail}</div>
              </div>
            </div>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                handleLogout();
              }}
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
