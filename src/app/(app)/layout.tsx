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
import { ExecutionScoreProvider } from '@/components/activity/execution-context';
import { NotificationsStep } from '@/components/onboarding/NotificationsStep';
import { Spinner } from '@/components/ui';
import { AccessBlocked } from '@/components/AccessBlocked';
import { apiHeaders, useApi } from '@/lib/api';
import { BLOCKED_MEMBERSHIPS } from '@/lib/auth/membership';
import { getSupabase } from '@/lib/supabase/client';
import { REVIEW_LAST_PATH_KEY } from '@/lib/review-context';
import { APP_SCROLL_ID } from '@/lib/app-scroll';
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

  // Next scrolls the WINDOW to the top on every navigation, and the window no
  // longer scrolls — without this, tapping a link while scrolled halfway down
  // opens the next screen already halfway down. Keyed on pathname only, so
  // changing a tab via ?tab= (settings, profile) keeps your place as before.
  //
  // This is a plain reset rather than Next's push-to-top/pop-to-restore pair:
  // the router doesn't tell a layout which of the two it just did, and restoring
  // the wrong offset is worse than losing it. Back navigation therefore lands at
  // the top of the previous screen.
  useEffect(() => {
    const el = document.getElementById(APP_SCROLL_ID);
    if (el) el.scrollTop = 0;
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

  // Does this browser hold ANY claim to an identity? Read straight out of
  // localStorage, in the same effect flush as the mount, so it is known a full
  // async hop before `authorized` above is — that one waits on getSession(),
  // which takes auth-js's lock and can go to the network to refresh.
  //
  // It exists so the membership request below can START then, instead of being
  // gated on `authorized` and turning a cold open into a strict waterfall:
  // getSession → /api/auth/me → the shell → the screen's own requests. It is
  // deliberately the same pair of keys the fallback above trusts, so it can only
  // fire for a browser that would have been let in anyway — a logged-out visitor
  // still makes no request (and a 401 here is fail-open, see below, so a wrong
  // guess costs a request rather than a screen).
  const [hasLocalIdentity, setHasLocalIdentity] = useState(false);
  useEffect(() => {
    try {
      setHasLocalIdentity(
        !!(localStorage.getItem('athlete_id') || localStorage.getItem('coach_email')),
      );
    } catch { /* private mode — `authorized` will answer a moment later */ }
  }, []);

  // ── Is this session still a MEMBER? ───────────────────────────────────────
  //
  // The check above only proves a session exists. That is not the same question:
  // an account whose access was removed — or that never finished joining — keeps
  // its session and its localStorage identity, so it used to get this entire
  // shell and then watch every card inside it fail separately (the feed printed
  // the server's raw English "No membership found for this account" under a retry
  // button that could only fail again). The server answers it once, in the same
  // /api/auth/me the Header already fetches, so this costs no extra request.
  //
  // Fails OPEN on purpose: only an explicit non-active answer blocks. A network
  // error, a 401 on the legacy localStorage-only path, or an older deploy that
  // doesn't send `membership` all leave the shell exactly as it was — locking
  // members out of a working club because a fetch failed is the worse bug.
  //
  // A blocked screen POLLS, and only a blocked screen does. Someone waiting for
  // approval sits on that screen with the app open while the coach taps approve on
  // their own phone — and nothing told them. The answer arrived only on a reload,
  // so the real last step of joining the club was "close the app and open it
  // again": nobody thinks to do that, and nothing on screen suggested it. Members
  // poll never (`0`) — there is nothing to wait for, and this route stamps
  // last_seen_at on every call.
  const { data: me, isLoading: meLoading } = useApi<{ membership?: string }>(
    hasLocalIdentity || authorized ? '/api/auth/me' : null,
    { refreshInterval: (latest) => (latest?.membership && latest.membership !== 'active' ? 30_000 : 0) },
  );
  const blocked = BLOCKED_MEMBERSHIPS.find((m) => m === me?.membership) ?? null;

  // 'pending' is the one blocked state that has a screen of its OWN, and it is a
  // better screen than AccessBlocked: /pending-approval carries the claim form
  // (the way an existing member whose Strava name didn't match gets back to their
  // own account) and the add-to-home-screen card. Two waiting screens meant the
  // person's experience depended on which URL they happened to arrive at — the
  // polling was here and the way out was over there. Send them to the one that
  // has both. It cannot bounce back: that screen only ever navigates once
  // membership turns 'active', which is not a blocked state.
  //
  // The other two stay on AccessBlocked. 'inactive' and 'none' are not waiting for
  // anything, and a screen that promises an approval is coming would be a lie.
  useEffect(() => {
    if (blocked === 'pending') router.replace('/pending-approval');
  }, [blocked, router]);

  // Held behind the same spinner as the session check rather than swapped in
  // after the fact: a revoked member should never see a flash of the feed they
  // just lost.
  //
  // This is a full round trip with nothing on screen, so it used to be THE cost of
  // every reload. It isn't any more: the SWR cache is persistent (lib/swr-persist),
  // so `me` is already there on the second open onward and this gate passes
  // without waiting. Only a genuinely first open on a device pays it.
  if (!authorized || (meLoading && !me)) {
    return (
      // Ink, not brand: this is the frame immediately after AppSplash on a cold
      // open, and the splash is monochrome. A blue ring here was the one spot of
      // colour in the whole launch sequence.
      <div className="min-h-[100dvh] bg-page flex items-center justify-center">
        <Spinner size={32} tone="ink" />
      </div>
    );
  }

  // Held on the spinner rather than flashing AccessBlocked's "waiting" copy for
  // the frame before the effect above navigates — two different waiting screens in
  // quick succession is the kind of stutter that reads as a broken app.
  if (blocked === 'pending') {
    return (
      <div className="min-h-[100dvh] bg-page flex items-center justify-center">
        <Spinner size={32} tone="ink" />
      </div>
    );
  }
  if (blocked) return <AccessBlocked membership={blocked} />;

  return (
    // Wraps the whole shell so InstallPrompt, PushOptIn and FirstRunTour read
    // ONE answer to "has this device answered the add-to-home-screen step?".
    // That is what puts the three in order — install, then the tour, then the
    // setup checklist — instead of three components each deciding on a timer.
    <InstallStepProvider>
      <div
        // Exactly one viewport tall and never overflowing — the document does
        // not scroll inside the app, <main> does. That is what finally stops the
        // bottom tab bar drifting on iOS: a bar that is a flex sibling of the
        // scroll container is never aligned to a moving viewport edge. See
        // lib/app-scroll.ts for the full reasoning and for what it costs.
        // Run-chat has always had this shape; now every screen shares it.
        className="flex flex-col h-[100dvh] overflow-hidden"
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
          // THE scroll container for the whole app — see lib/app-scroll.ts.
          // `min-h-0` is load-bearing: without it a flex child refuses to shrink
          // below its content and the overflow escapes back to the document,
          // which is exactly the state this change exists to prevent.
          id={APP_SCROLL_ID}
          className={cn(
            'w-full flex-1 min-h-0 overscroll-contain',
            isRunChat
              // Run-chat manages its own internal panes and must NOT scroll here.
              ? 'overflow-hidden p-0 md:mx-auto md:max-w-7xl md:px-6 md:pt-5 md:pb-8 lg:px-8'
              // No bottom reservation for the bar: it is a flex sibling below
              // this box, so it occupies real layout space and can't overlap.
              : 'overflow-y-auto mx-auto max-w-7xl px-4 pt-5 pb-4 sm:px-6 md:pb-8 lg:px-8',
          )}
        >
          {/* One accuracy-ring cache for every signed-in screen. Mounted here, in
              the shell that survives a feed ↔ dashboard hop, so a page of cards
              fetches its scores in ONE request and keeps them across navigation. */}
          <ExecutionScoreProvider>
            {isRunChat ? children : <PageTransition>{children}</PageTransition>}
          </ExecutionScoreProvider>
        </main>
        {!isRunChat && <BottomTabBar />}
      </div>
    </InstallStepProvider>
  );
}
