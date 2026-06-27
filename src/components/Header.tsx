'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Calendar, Users, Layers, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Activity },
  { href: '/dashboard/plan/new', label: 'New Plan', icon: Calendar },
  { href: '/dashboard/athletes', label: 'Athletes', icon: Users },
  { href: '/dashboard/groups', label: 'Groups', icon: Layers },
  { href: '/dashboard/history', label: 'History', icon: Clock },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="bg-slate-800 border-b border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Activity className="h-8 w-8 text-primary-500" />
            <span className="text-xl font-bold">MadregotConnect</span>
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
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
