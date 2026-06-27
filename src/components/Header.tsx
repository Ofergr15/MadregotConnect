'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Calendar, Users, Layers, Clock, ClipboardList, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const coachNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Activity },
  { href: '/dashboard/plan/new', label: 'New Plan', icon: Calendar },
  { href: '/dashboard/athletes', label: 'Athletes', icon: Users },
  { href: '/dashboard/groups', label: 'Groups', icon: Layers },
  { href: '/dashboard/program', label: 'Program', icon: ClipboardList },
  { href: '/dashboard/history', label: 'History', icon: Clock },
];

const athleteNavItems = [
  { href: '/dashboard/program', label: 'Program', icon: ClipboardList },
  { href: '/dashboard/profile', label: 'My Profile', icon: User },
];

export function Header() {
  const pathname = usePathname();
  const [isAthlete, setIsAthlete] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const athleteId = localStorage.getItem('athlete_id');
    const name = localStorage.getItem('athlete_name');
    if (athleteId) {
      setIsAthlete(true);
      setUserName(name || '');
    }
  }, []);

  const navItems = isAthlete ? athleteNavItems : coachNavItems;

  const handleLogout = () => {
    localStorage.removeItem('athlete_id');
    localStorage.removeItem('athlete_name');
    localStorage.removeItem('athlete_email');
    localStorage.removeItem('athlete_group_id');
    window.location.href = '/';
  };

  return (
    <header className="bg-slate-800 border-b border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href={isAthlete ? '/dashboard/program' : '/dashboard'} className="flex items-center gap-3">
            <div className="text-primary-500">
              <svg viewBox="0 0 40 40" className="h-8 w-8" fill="currentColor">
                <rect x="8" y="30" width="24" height="4"/>
                <rect x="12" y="24" width="20" height="4"/>
                <rect x="16" y="18" width="16" height="4"/>
                <rect x="20" y="12" width="12" height="4"/>
                <rect x="24" y="6" width="8" height="4"/>
              </svg>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold tracking-tight uppercase">MADREGOT</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">After 2KM</span>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
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
            {isAthlete && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700 transition-colors ml-2"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
