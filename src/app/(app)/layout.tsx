'use client';

import { useEffect, useRef, useState } from 'react';
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
import { shouldSyncOnOpen, stravaOpenSyncKey } from '@/lib/providers/open-sync';
import { getSupabase } from '@/lib/supabase/client';
import { REVIEW_LAST_PATH_KEY } from '@/lib/review-context';
import {
  APP_SCROLL_ID,
  consumeBackNavigation,
  recallAppScroll,
  rememberAppScroll,
  restoreAppScroll,
} from '@/lib/app-scroll';
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

  // ── SCROLL: TOP ON THE WAY IN, WHERE YOU LEFT IT ON THE WAY BACK ──────────
  // Next scrolls the WINDOW to the top on every navigation, and the window no
  // longer scrolls (see lib/app-scroll.ts) — without a reset here, tapping a
  // link while scrolled halfway down opens the next screen already halfway down.
  // Keyed on pathname only, so changing a tab via ?tab= (settings, profile)
  // keeps your place as before.
  //
  // Forward is a reset and BACK is a restore. This used to be a plain reset in
  // both directions, on the grounds that the router doesn't tell a layout which
  // of the two it just did — but the browser does: `popstate` fires for back and
  // forward and for nothing else. The flag is a timestamp rather than a boolean
  // because a pop that only changes the query string never reaches the effect
  // below (it is keyed on pathname), and a boolean left standing would spend
  // itself on the next forward navigation instead. Stale means expired.
  const poppedAtRef = useRef(0);
  useEffect(() => {
    const onPop = () => { poppedAtRef.current = Date.now(); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Record the offset while the user scrolls, not on the way out: by the time
  // the pathname has changed React has already re-rendered and the container is
  // being reset, so there is nothing left to read. One rAF-coalesced write per
  // frame at most.
  //
  // Listening on the document in the CAPTURE phase rather than on <main>
  // directly, because <main> does not exist yet on a cold open — this layout
  // returns a spinner until the session and /api/auth/me have both answered, and
  // an effect that looked the element up at attach time would find nothing and
  // never look again, losing the offset of the very first screen you land on
  // (which is the one you scroll). Scroll events don't bubble, but they do reach
  // the document in capture, so this survives the element appearing later.
  useEffect(() => {
    let frame = 0;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.id !== APP_SCROLL_ID) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        rememberAppScroll(pathname, el.scrollTop);
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useEffect(() => {
    // Consumed unconditionally rather than short-circuited behind the popstate
    // test: an intent left standing would spend itself on the next forward
    // navigation instead of on this one.
    const wasBackIntent = consumeBackNavigation();
    const wasPop = wasBackIntent || Date.now() - poppedAtRef.current < 1000;
    poppedAtRef.current = 0;
    // restoreAppScroll(0) is the plain reset, so both directions go through it.
    const cancel = restoreAppScroll(wasPop ? recallAppScroll(pathname) : 0);
    return cancel;
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

  // ── PULL IN NEW STRAVA RUNS WHEN THE APP OPENS ────────────────────────────
  //
  // Strava has no server-side schedule behind it — the 5-minute cron syncs Garmin
  // and only REPAIRS existing Strava rows, and the webhook that was supposed to
  // replace the dropped poll has never delivered an event (the numbers are in
  // lib/providers/open-sync.ts). So this request is the whole mechanism by which
  // a Strava member's runs reach the club, and until now it existed only inside
  // /dashboard's own effect — a screen the installed app never opens, because the
  // manifest's start_url is /feed. A member who lives in the feed got their
  // history the day they connected and then nothing, with no error anywhere,
  // which is exactly how it was reported: "my workouts aren't coming in".
  //
  // It belongs in the shell rather than on the feed page for the same reason the
  // shell owns the app badge above: every signed-in surface is an app open, and a
  // fix pinned to one more page would break again the next time the front door
  // moves. /dashboard is the one exception — it runs the same sync itself, around
  // a before/after snapshot it needs for the "customize your post" sheet, and both
  // sides now share one cooldown stamp so only one of them spends it.
  //
  // Deliberately fire-and-forget: nothing on screen waits for it, the route is a
  // no-op returning `{synced:0}` for a member with no Strava credential, and a new
  // run appearing needs the next render pass anyway (the feed's own SWR read), not
  // a response body. Failure re-arms rather than being surfaced — a member cannot
  // act on "Strava didn't answer", and the profile screen's connection pill is
  // where a genuinely refused credential gets said out loud (migration 101).
  useEffect(() => {
    if (!authorized || blocked || pathname === '/dashboard') return;
    let cancelled = false;
    (async () => {
      let key: string | null = null;
      try {
        const athleteId = localStorage.getItem('athlete_id');
        // No athlete row (a pure-admin account) records no runs anywhere, and the
        // super user's "view as" preview is read-only — the sync POST is blocked
        // for it, so asking would only ever collect a 403.
        if (!athleteId || localStorage.getItem('view_as_role')) return;
        key = stravaOpenSyncKey(athleteId);
        if (!shouldSyncOnOpen(localStorage.getItem(key), Date.now())) return;
        // Stamped BEFORE the request, so React Strict Mode's double effect and a
        // fast feed↔profile hop cannot each launch their own sync.
        localStorage.setItem(key, String(Date.now()));
      } catch {
        return; // private mode: no stamp to read and none to write, so don't ask
      }
      try {
        const res = await fetch('/api/strava/sync-activities', {
          method: 'POST',
          headers: await apiHeaders(),
          body: JSON.stringify({ athleteId: localStorage.getItem('athlete_id') }),
        });
        if (!res.ok) throw new Error(`Strava sync ${res.status}`);
      } catch {
        // Re-arm so the next app open tries again instead of waiting out a
        // cooldown that bought nothing.
        if (!cancelled && key) {
          try { localStorage.removeItem(key); } catch { /* private mode */ }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authorized, blocked, pathname]);

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
