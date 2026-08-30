'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { InstallPrompt } from '@/components/InstallPrompt';
import { PushOptIn } from '@/components/PushOptIn';
import { ConnectDataSourcePopup } from '@/components/ConnectDataSourcePopup';
import { PullToRefresh } from '@/components/PullToRefresh';
import { BottomTabBar } from '@/components/BottomTabBar';
import { PageTransition } from '@/components/PageTransition';
import { Spinner } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { getSupabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isRunChat = pathname.startsWith('/dashboard/run-chat/');
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
        // `keepalive` because this runs while the page is being torn down
        // (pagehide/backgrounding) and apiHeaders() has to await the session
        // first — without it the request can be cancelled before it leaves.
        const res = await fetch(`/api/notifications/unread?athleteId=${id}`, {
          headers: await apiHeaders(),
          keepalive: true,
        });
        if (!res.ok) return; // don't clear the badge on an auth/network failure
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
    // `pagehide` as a second trigger alongside `visibilitychange` — some iOS
    // app-switch gestures (fully closing the PWA rather than just backgrounding
    // it) don't reliably fire visibilitychange first, so this is a second
    // chance to stamp the badge before the page context is torn down.
    window.addEventListener('pagehide', setFromServer);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', setFromServer);
    };
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
    <div className={cn('flex flex-col', isRunChat ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]')}>
      <PullToRefresh />
      <div className={isRunChat ? 'hidden md:contents' : 'contents'}>
        <Header />
      </div>
      {!isRunChat && <InstallPrompt />}
      {!isRunChat && <PushOptIn />}
      {!isRunChat && <ConnectDataSourcePopup />}
      <main
        className={cn(
          'w-full',
          isRunChat
            ? 'h-full min-h-0 overflow-hidden p-0 md:mx-auto md:h-auto md:max-w-7xl md:flex-1 md:px-6 md:pt-5 md:pb-8 lg:px-8'
            : 'mx-auto max-w-7xl flex-1 px-4 pt-5 pb-[calc(72px+env(safe-area-inset-bottom))] sm:px-6 md:pb-8 lg:px-8',
        )}
      >
        {isRunChat ? children : <PageTransition>{children}</PageTransition>}
      </main>
      {!isRunChat && <BottomTabBar />}
    </div>
  );
}
