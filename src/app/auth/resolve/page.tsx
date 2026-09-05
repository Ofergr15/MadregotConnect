'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getSupabase } from '@/lib/supabase/client';

// How long the spinner is allowed to be the whole screen before we admit
// something is wrong. Every path off this page is a redirect, so under normal
// conditions nobody is here for even a second — but a Supabase token refresh
// that never resolves has no timeout of its own, and that showed up in the field
// as a 26-second blank spinner with no text, no error and no way out.
const STALL_MS = 12_000;

async function verifyEmailOtp(tokenHash: string) {
  return getSupabase().auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
}

// React Strict Mode mounts effects twice in development. A magic-link token is
// one-time use, so both mounts must share the same verification request.
const otpVerificationPromises = new Map<string, ReturnType<typeof verifyEmailOtp>>();

export default function AuthResolvePage() {
  const router = useRouter();
  const t = useTranslations('onboarding');
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;
    // Deliberately does NOT abort the sign-in — a slow login that still works is
    // better than one we cancelled out from under the user. It only stops the
    // screen from lying about being busy, and offers a way out.
    const stallTimer = setTimeout(() => setStalled(true), STALL_MS);

    const authLog = (
      debugId: string,
      event: string,
      details: Record<string, unknown> = {},
    ) => {
      console.info(`[auth-debug:${debugId}] ${event}`, details);
      // The mirror-to-terminal half only works in dev — the route 403s in
      // production by design. Firing it there anyway meant nine POSTs, all of
      // them rejected, on the single most latency-sensitive path in the app: the
      // one the user is staring at a spinner through. The console line above is
      // the part that survives to production, and it costs nothing.
      if (process.env.NODE_ENV === 'production') return;
      void fetch('/api/dev/auth-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugId, event, details }),
      }).catch(() => {});
    };

    const establishSession = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const tokenHash = hash.get('token_hash');
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const debugId = hash.get('debug_id') || crypto.randomUUID().slice(0, 8);
      const publicSupabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
        ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
        : 'missing';

      authLog(debugId, 'resolve:loaded', {
        publicSupabaseHost,
        hashKeys: [...hash.keys()],
        hasTokenHash: !!tokenHash,
        tokenHashLength: tokenHash?.length || 0,
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
      });

      try {
        let session = null;
        let error: Error | null = null;
        let method = 'existing_session';

        if (tokenHash) {
          method = 'verify_otp';
          let verification = otpVerificationPromises.get(tokenHash);
          const reused = !!verification;
          if (!verification) {
            verification = verifyEmailOtp(tokenHash);
            otpVerificationPromises.set(tokenHash, verification);
            setTimeout(() => otpVerificationPromises.delete(tokenHash), 60_000);
          }
          authLog(debugId, 'resolve:verify_otp_start', { reused });
          const result = await verification;
          session = result.data.session;
          error = result.error;
        } else if (accessToken && refreshToken) {
          method = 'set_session';
          authLog(debugId, 'resolve:set_session_start');
          const result = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          session = result.data.session;
          error = result.error;
        } else {
          authLog(debugId, 'resolve:get_session_start');
          const result = await supabase.auth.getSession();
          session = result.data.session;
          error = result.error;
        }

        authLog(debugId, 'resolve:session_result', {
          method,
          hasSession: !!session,
          hasUser: !!session?.user,
          userId: session?.user?.id || null,
          userEmail: session?.user?.email || null,
          errorName: error?.name || null,
          errorMessage: error?.message || null,
          errorStatus: 'status' in (error || {}) ? (error as any).status : null,
          errorCode: 'code' in (error || {}) ? (error as any).code : null,
        });

        if (cancelled) return;
        window.history.replaceState({}, '', '/auth/resolve');

        if (error || !session?.user) {
          console.error(`[auth-debug:${debugId}] Failed to establish Supabase session`, error);
          const params = new URLSearchParams({
            strava: 'error',
            reason: 'session_failed',
            debug: debugId,
            stage: method,
          });
          if ((error as any)?.code) params.set('code', (error as any).code);
          router.replace(`/?${params.toString()}`);
          return;
        }

        // Now that a real session exists, issue the httpOnly device cookie that
        // /api/auth/silent-session requires to re-mint one later. Best-effort:
        // failing only costs the silent self-heal, not this login.
        try {
          const issued = await fetch('/api/auth/device-token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          authLog(debugId, 'resolve:device_token', { ok: issued.ok, status: issued.status });
        } catch {
          authLog(debugId, 'resolve:device_token', { ok: false, status: 0 });
        }

        authLog(debugId, 'resolve:role_start');
        await resolveRole(session.user, debugId, authLog);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        authLog(debugId, 'resolve:exception', {
          name: err.name,
          message: err.message,
          stack: err.stack,
        });
        console.error(`[auth-debug:${debugId}] resolve exception`, err);
        router.replace(
          `/?strava=error&reason=session_exception&debug=${encodeURIComponent(debugId)}`,
        );
      }
    };

    void establishSession();

    return () => {
      cancelled = true;
      clearTimeout(stallTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolveRole(
    user: { email?: string | null; user_metadata?: Record<string, unknown> },
    debugId: string,
    authLog: (
      debugId: string,
      event: string,
      details?: Record<string, unknown>,
    ) => void,
  ) {
    const email = user.email?.toLowerCase();

    if (!email) {
      router.replace('/');
      return;
    }

    const meta = user.user_metadata || {};
    const avatarUrl = (meta.avatar_url || meta.picture || '') as string;
    const name = (meta.full_name || meta.name || '') as string;
    const res = await fetch('/api/auth/resolve-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, avatarUrl }),
    });

    const data = await res.json();
    authLog(debugId, 'resolve:role_result', {
      httpStatus: res.status,
      ok: res.ok,
      role: data.role || null,
      athleteId: data.athlete?.id || null,
      pendingApproval: !!data.pendingApproval,
      needsOnboarding: !!data.needsOnboarding,
      error: data.error || null,
    });

    if (data.role === 'coach' || data.role === 'admin') {
      // The athlete row's OWN address, not the session's. A Strava login signs in
      // as strava_<id>@strava.madregot.local, and coach_email is what the app
      // checks against SUPER_USER_EMAIL and the coaches table — storing the
      // synthetic address there left staff holding a coach_email that matched
      // nothing, so view-as and every coach-email gate quietly failed.
      localStorage.setItem('coach_email', data.athlete?.email || email);
      if (data.athlete) {
        localStorage.setItem('athlete_id', data.athlete.id);
        localStorage.setItem('athlete_name', data.athlete.name || '');
        localStorage.setItem('athlete_email', data.athlete.email || email);
        if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
        else localStorage.removeItem('athlete_group_id');
      } else {
        localStorage.removeItem('athlete_id');
        localStorage.removeItem('athlete_name');
        localStorage.removeItem('athlete_email');
        localStorage.removeItem('athlete_group_id');
      }
      router.replace('/feed');
    } else if (data.needsOnboarding && !data.athlete) {
      const params = new URLSearchParams({ email, name });
      if (data.missingGroup === false) params.set('skipGroup', '1');
      if (data.missingGarmin === false) params.set('skipGarmin', '1');
      router.replace(`/join/onboard?${params.toString()}`);
    } else if (data.athlete) {
      // Set athlete_id BEFORE the pendingApproval branch (not just the
      // dashboard branch below it) — otherwise a pending user's push opt-in
      // banner on /pending-approval has no athlete to subscribe, since it
      // gates on this exact key.
      localStorage.setItem('athlete_id', data.athlete.id);
      localStorage.setItem('athlete_name', data.athlete.name || '');
      localStorage.setItem('athlete_email', data.athlete.email || email);
      if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
      else localStorage.removeItem('athlete_group_id');
      if (data.pendingApproval) {
        router.replace('/pending-approval');
        return;
      }
      localStorage.removeItem('coach_email');
      router.replace('/feed');
    } else if (data.pendingApproval) {
      router.replace('/pending-approval');
    } else {
      const params = new URLSearchParams({ email, name });
      router.replace(`/join/onboard?${params.toString()}`);
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <div className="text-center px-6" role="status" dir="rtl">
        {/* Hidden because there is nothing to show — this screen always redirects,
            and visually it is one spinner. But it had no heading at all, so a
            screen reader arriving mid-sign-in got a page it could not name.
            `role="status"` above makes the spinner's caption announce itself. */}
        <h1 className="sr-only">{t('resolveConnecting')}</h1>
        {/* Monochrome, like AppSplash and the auth gate — this screen is part of
            the same cold-open sequence. */}
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink-900 mx-auto mb-4"></div>
        {stalled ? (
          <>
            <p className="text-ink-700 text-sm font-bold">{t('resolveStalledTitle')}</p>
            <p className="text-ink-400 text-13 mt-2 max-w-[280px] mx-auto leading-relaxed">
              {t('resolveStalledBody')}
            </p>
            {/* A full document load rather than a <Link>, which is why it is a
                button and not one: whatever state the client-side Supabase client
                has got itself into is exactly what we want to leave behind, and a
                soft navigation would carry it along. */}
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-pill bg-brand-600 px-6 text-[15px] font-bold text-white active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            >
              {t('resolveRetry')}
            </button>
          </>
        ) : (
          <p className="text-ink-400 text-sm" aria-hidden="true">{t('resolveConnecting')}</p>
        )}
      </div>
    </div>
  );
}
