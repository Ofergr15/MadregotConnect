'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { InstallPrompt } from '@/components/InstallPrompt';
import { PushOptIn } from '@/components/PushOptIn';
import { PullToRefresh } from '@/components/PullToRefresh';
import { BottomTabBar } from '@/components/BottomTabBar';
import { PageTransition } from '@/components/PageTransition';
import { Spinner } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  // App-icon badge self-heal. iOS PWAs can't reliably set the badge from a
  // background push, but the foreground path IS reliable — so: clear it when the
  // app is open/foregrounded (notifications seen), and set the real unread count
  // when the app is backgrounded, so the icon is correct whenever you leave.
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const clear = () => navigator.clearAppBadge().catch(() => {});
    const setFromServer = async () => {
      const id = localStorage.getItem('athlete_id');
      if (!id) { clear(); return; }
      try {
        const res = await fetch(`/api/notifications/unread?athleteId=${id}`);
        const { count } = await res.json();
        if (count > 0) await navigator.setAppBadge(count);
        else await navigator.clearAppBadge();
      } catch { /* ignore */ }
    };
    clear(); // on mount (app opened)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') clear();
      else setFromServer(); // backgrounding → stamp the current unread count
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthorized(true);
      } else {
        const coachEmail = localStorage.getItem('coach_email');
        const athleteId = localStorage.getItem('athlete_id');
        if (coachEmail || athleteId) {
          setAuthorized(true);
        } else {
          router.replace('/');
        }
      }
    });
  }, [router]);

  if (!authorized) {
    return (
      <div className="min-h-[100dvh] bg-slate-900 flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <PullToRefresh />
      <Header />
      <InstallPrompt />
      <PushOptIn />
      {/* Bottom padding on mobile clears the fixed tab bar (~64px + safe area);
          md+ keeps the desktop header nav and needs no bar padding. */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-8">
        <PageTransition>{children}</PageTransition>
      </main>
      <BottomTabBar />
    </div>
  );
}
