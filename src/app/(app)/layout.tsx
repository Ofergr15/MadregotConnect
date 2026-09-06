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
import { FirstRunTour } from '@/components/onboarding/FirstRunTour';
import { InstallStepProvider } from '@/components/onboarding/InstallStepProvider';
import { NotificationsStep } from '@/components/onboarding/NotificationsStep';
import { Spinner } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { getSupabase } from '@/lib/supabase/client';
import { REVIEW_LAST_PATH_KEY } from '@/lib/review-context';
import { cn } from '@/lib/utils';

// Shared shell for every signed-in surface — /dashboard/* and /feed — via the
// (app) route group, so navigating between them keeps one mounted layout
// (no auth-spinner flash or Header refetch on feed ↔ dashboard hops).
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isRunChat = pathname.startsWith('/dashboard/run-chat/');
  const [authorized, setAuthorized] = useState(false);
  // The first-run tour owns the screen while it runs. The three popups below all
  // ask for something the tour is in the middle of explaining (install, push
  // permission, connect a watch) and any of them can appear on a timer — landing
  // one on top of a spotlight would talk over it, and the push prompt in
  // particular burns a permission you only get to ask for once.
  const [tourActive, setTourActive] = useState(false);
  const popupsAllowed = !isRunChat && !tourActive;

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

  // Breadcrumb for the review screen ("where did it happen?"). Every screen
  // except /dashboard/review itself, so what's stored is always the last screen
  // the user was actually LOOKING at when they decided to report something — by
  // the time the review page mounts, that pathname is gone, and asking somebody
  // to remember which screen broke is exactly the friction that turns a bug
  // report into "something is broken somewhere".
  useEffect(() => {
    if (pathname === '/dashboard/review') return;
    try { sessionStorage.setItem(REVIEW_LAST_PATH_KEY, pathname); } catch { /* private mode */ }
  }, [pathname]);

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
      // Ink, not brand: this is the frame immediately after AppSplash on a cold
      // open, and the splash is monochrome. A blue ring here was the one spot of
      // colour in the whole launch sequence.
      <div className="min-h-[100dvh] bg-page flex items-center justify-center">
        <Spinner size={32} tone="ink" />
      </div>
    );
  }

  return (
    // Wraps the whole shell so InstallPrompt, PushOptIn and FirstRunTour read
    // ONE answer to "has this device answered the add-to-home-screen step?".
    // That is what puts the three in order — install, then the tour, then the
    // setup checklist — instead of three components each deciding on a timer.
    <InstallStepProvider>
      <div
        // min-h-[100dvh] is what makes the page grey cover the viewport, so a
        // short screen doesn't end in a band of raw background.
        className={cn('flex flex-col', isRunChat ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]')}
      >
        <PullToRefresh />
        <div className={isRunChat ? 'hidden md:contents' : 'contents'}>
          <Header />
        </div>
        {popupsAllowed && <InstallPrompt />}
        {/* Step 3 of the first run. Ordered after InstallPrompt for the same
            reason it checks `installAnswered` itself: on iOS a subscription made
            from a Safari tab is page-origin forever. It can't collide with
            PushOptIn below — that banner additionally requires the
            `push_optin_trigger` flag, which only the feedback page sets, long
            after onboarding. */}
        {popupsAllowed && <NotificationsStep />}
        {popupsAllowed && <PushOptIn />}
        {popupsAllowed && <ConnectDataSourcePopup />}
        {!isRunChat && <FirstRunTour onActiveChange={setTourActive} />}
        <main
          className={cn(
            'w-full',
            isRunChat
              ? 'h-full min-h-0 overflow-hidden p-0 md:mx-auto md:h-auto md:max-w-7xl md:flex-1 md:px-6 md:pt-5 md:pb-8 lg:px-8'
              // No 72px bottom reservation any more: BottomTabBar is `sticky`
              // rather than `fixed` (see the comment there), so it occupies real
              // layout space at the end of the column and carries the safe-area
              // padding itself. Keeping both put a bar's height of dead space
              // under the last card on every screen.
              : 'mx-auto max-w-7xl flex-1 px-4 pt-5 pb-4 sm:px-6 md:pb-8 lg:px-8',
          )}
        >
          {isRunChat ? children : <PageTransition>{children}</PageTransition>}
        </main>
        {!isRunChat && <BottomTabBar />}
      </div>
    </InstallStepProvider>
  );
}
