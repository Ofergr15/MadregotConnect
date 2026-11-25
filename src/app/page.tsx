'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';
import { loginErrorText, type LoginErrorText } from '@/lib/auth/login-error';
import { LoadingBlock } from '@/components/ui';
import { EmailCodeLogin } from '@/components/auth/EmailCodeLogin';
import { consumeSigninFlag } from '@/lib/auth/login-link';
import { InstallGuide } from '@/components/install/InstallGuide';
import { usePreviewOnboardingV2 } from '@/lib/install/v2';
import { detectInstallPlatform } from '@/lib/install/platform';

// /register reads `?onb=v2` (lib/install/v2) — the new joining journey.
const JOIN_HREF = '/register?onb=v2';

/**
 * The PWA's landing page IS the sign-in: email, then a 6-digit code (2026-11-25,
 * before the Frankfurt move signs everyone out once). One path, Hebrew, big.
 * Strava/Google/password are not offered here; their routes still serve deep links
 * (/admin/login, /api/strava, …). The "join" link shows only while the club-wide
 * `signups_open` switch is on (GET /api/features/public; default off).
 */
export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [signupsOpen, setSignupsOpen] = useState(false);
  // /login forwards here with ?signin=1 (lib/auth/login-link). The form is always
  // shown now, so the flag only needs stripping from the URL.
  useEffect(() => {
    const { open, rest } = consumeSigninFlag(window.location.search);
    if (open) window.history.replaceState({}, '', rest);
  }, []);
  const v2 = usePreviewOnboardingV2();
  const [installFirst, setInstallFirst] = useState(false);
  const [browserEscape, setBrowserEscape] = useState(false);
  useEffect(() => {
    const p = detectInstallPlatform();
    setInstallFirst(v2 && (p === 'ios-safari' || p === 'ios-safari-26' || p === 'ios-safari-compact' || p === 'ios-inapp'));
  }, [v2]);

  // /auth/resolve and the Strava callback bounce failures back here as
  // ?strava=error&reason=... (lib/auth/login-error).
  const [resolveError, setResolveError] = useState<LoginErrorText | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') !== 'error') return;
    setResolveError(loginErrorText(params.get('reason'), params.get('debug')));
    window.history.replaceState({}, '', '/');
  }, []);

  useEffect(() => {
    fetch('/api/features/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSignupsOpen(d?.features?.signups_open === true))
      .catch(() => {});
  }, []);

  // A member who is already in the app must never be shown the login screen.
  // Supabase sessions expire routinely — and iOS evicts them from a standalone
  // PWA's storage on its own schedule — so "no session" is normally not "logged
  // out", it's "session needs re-minting". Landing on the public page instead
  // was actively harmful, not just untidy: its only way back in is the Strava
  // button, and a cross-origin navigation from a standalone PWA opens iOS's
  // in-app browser, so the session gets established in a DIFFERENT storage jar
  // and the app itself is still logged out. Hence the "X" — an app that asked
  // you to leave it to log back into it.
  //
  // trySilentReauth re-mints from the signed httpOnly device cookie and returns
  // null when this browser genuinely never logged in, which is the only case
  // that should see the marketing page.
  useEffect(() => {
    let cancelled = false;
    let running = false;
    // Once the device cookie has come back empty, it will stay empty until a
    // login writes one, so don't ask again on every foreground.
    let reauthFailed = false;
    const supabase = getSupabase();

    /**
     * Collect a login that finished in iOS's in-app browser sheet.
     *
     * Returning from that sheet does not reload this page — the app was never
     * unloaded, it was covered — so this has to run on foreground, not just on
     * mount. A missing or stale verifier makes it a no-op, and a 404 from the
     * route is the ordinary answer when nothing is waiting.
     */
    const claimPendingLogin = async (): Promise<boolean> => {
      const { readPendingVerifier, clearPendingVerifier } = await import(
        '@/lib/auth/login-handoff'
      );
      const verifier = readPendingVerifier();
      if (!verifier) return false;
      try {
        const res = await fetch('/api/auth/claim-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verifier }),
        });
        if (res.status === 404) return false; // still authorising in the sheet
        const data = await res.json();
        if (!res.ok || !data.session?.access_token) {
          clearPendingVerifier();
          return false;
        }
        // Here is the whole point: setSession writes into the app's own storage,
        // which is the partition the sheet could never reach.
        const { error } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        clearPendingVerifier();
        return !error;
      } catch {
        return false;
      }
    };

    const settle = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (session) {
          router.replace('/auth/resolve');
          return;
        }
        if (await claimPendingLogin()) {
          if (!cancelled) router.replace('/auth/resolve');
          return;
        }
        if (reauthFailed) {
          setChecking(false);
          return;
        }
        const { trySilentReauth } = await import('@/lib/auth/silent-reauth');
        const token = await trySilentReauth();
        if (cancelled) return;
        if (token) {
          router.replace('/auth/resolve');
        } else {
          reauthFailed = true;
          setChecking(false);
        }
      } finally {
        running = false;
      }
    };

    void settle();

    // The sheet closes → the app is visible again → the login is waiting.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void settle();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [router]);

  // Onboarding v2 preview, install first: on an iPhone browser a Safari login does not
  // carry into the home-screen app, so the install guide comes before the form.
  if (!checking && installFirst && !browserEscape) {
    return <InstallGuide canPrompt={false} onLater={() => {}} blocking onEscape={() => setBrowserEscape(true)} />;
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f0f0f0] flex items-center justify-center">
        <LoadingBlock tone="ink" />
      </div>
    );
  }

  return (
    <main dir="rtl" className="safe-top flex min-h-screen flex-col items-center bg-[#f0f0f0] px-6 pb-10 pt-16 text-ink-900">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25">
            <img src="/images/logo-white.png" alt="" className="h-10 w-10 object-contain" />
          </span>
          <h1 className="text-3xl font-black">כניסה למדרגות</h1>
          <p className="text-base text-ink-500">מכניסים את המייל, מקבלים קוד, ונכנסים.</p>
        </div>

        {resolveError && (
          <div role="alert" className="w-full rounded-2xl border border-accent-red/20 bg-accent-red/5 px-4 py-3">
            <p className="text-sm font-semibold text-accent-red">{resolveError.text}</p>
            {resolveError.debug && <p className="mt-1 text-2xs text-ink-400">קוד לדיווח: <bdi dir="ltr">{resolveError.debug}</bdi></p>}
          </div>
        )}

        <EmailCodeLogin />

        {signupsOpen && (
          <a href={JOIN_HREF} className="text-base font-bold text-brand-600 underline">עוד לא חברים? מצטרפים למועדון</a>
        )}
      </div>
    </main>
  );
}
