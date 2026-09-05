'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trophy, Users, Zap, Heart, Camera, Loader2, Shield, Route, Activity, Clock } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { getSupabase } from '@/lib/supabase/client';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Figure } from '@/components/Figure';
import { Sheet, Button, LoadingBlock, BigStat } from '@/components/ui';

interface PublicStats {
  since?: string;
  athletes: number;
  totalKm: number;
  workouts: number;
  totalHours: number;
  topResults: { name: string; timeSeconds: number; test: string }[];
  testDate?: string | null;
}

function fmtMonthYear(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return '';
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtDate(dateStr: string | null | undefined, locale: string): string {
  if (!dateStr) return '';
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const whole = Math.floor(s);
  const frac = s - whole;
  const fracStr = frac > 0 ? frac.toFixed(2).slice(1).replace(/0+$/, '').replace(/\.$/, '') : '';
  return `${m}:${whole.toString().padStart(2, '0')}${fracStr}`;
}
function fmtNum(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

function useStravaLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      // Drop Test Runner / stale JWT so /auth/resolve adopts the Strava user.
      const { clearLocalIdentity } = await import('@/lib/auth/clear-local-identity');
      await clearLocalIdentity();

      // Ask for the session to be handed back rather than established wherever
      // this navigation ends up. On a standalone PWA it does not end up here: iOS
      // refuses to let the app leave its origin and opens an in-app browser sheet
      // with its own storage partition, so a session created there is invisible
      // to the app and the member stays logged out no matter how often they log
      // in. The verifier below stays in THIS partition and is what proves, on the
      // way back, that this app is the one that started the login.
      //
      // Stored after clearLocalIdentity, not before — that call clears keys.
      const { newVerifier, challengeFor, storePendingVerifier } = await import(
        '@/lib/auth/login-handoff'
      );
      const verifier = newVerifier();
      const challenge = await challengeFor(verifier);
      storePendingVerifier(verifier);

      const res = await fetch(`/api/strava?mode=login&challenge=${encodeURIComponent(challenge)}`);
      const data = await res.json();
      if (!res.ok || !data.authUrl) throw new Error(data.message || data.error || 'Strava login unavailable');
      window.location.href = data.authUrl;
    } catch (err) {
      console.error(err);
      // Previously silent — the spinner just stopped with zero explanation.
      setError('ההתחברות דרך Strava נכשלה. נסו שוב.');
      setLoading(false);
    }
  };

  return { signIn, loading, error };
}

function StravaMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="m15.387 17.944-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M10.463 8.392l2.835 5.436h4.173L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const th = useTranslations('header');
  const locale = useLocale();
  const [checking, setChecking] = useState(true);
  const { signIn, loading: signingIn, error: stravaError } = useStravaLogin();
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [stats, setStats] = useState<PublicStats | null>(null);

  // /auth/resolve and the Strava callback both bounce failures back here as
  // ?strava=error&reason=... — previously never read at all, so a failed
  // login just silently dropped the user back on the landing page with the
  // spinner gone and zero explanation of what happened or what to do next.
  const [resolveError, setResolveError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') !== 'error') return;
    const reason = params.get('reason');
    setResolveError(
      reason === 'not_configured'
        ? 'ההתחברות דרך Strava עדיין לא מוגדרת. פנו למאמן.'
        : reason === 'no_athlete'
          ? 'לא נמצא חשבון מתאים להתחברות הזו.'
          : 'ההתחברות נכשלה. נסו שוב.',
    );
    window.history.replaceState({}, '', '/');
  }, []);
  const displayError = resolveError || stravaError;

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

  useEffect(() => {
    fetch('/api/public/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {});
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setAdminError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Login failed');
      // Adopt the real Supabase session the route just minted, so bearer-gated
      // routes work from the password login too (see /api/admin/login).
      if (data.session?.access_token && data.session?.refresh_token) {
        await getSupabase().auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }
      localStorage.setItem('coach_email', data.email);
      localStorage.setItem('admin_session', 'true');
      if (data.athleteId) {
        localStorage.setItem('athlete_id', data.athleteId);
        localStorage.setItem('athlete_name', data.name || '');
        localStorage.setItem('athlete_email', data.email);
        if (data.groupId) localStorage.setItem('athlete_group_id', data.groupId);
        else localStorage.removeItem('athlete_group_id');
      } else {
        localStorage.removeItem('athlete_id');
        localStorage.removeItem('athlete_name');
        localStorage.removeItem('athlete_email');
        localStorage.removeItem('athlete_group_id');
      }
      router.push('/feed');
    } catch (err: any) {
      setAdminError(err.message);
    } finally {
      setAdminLoading(false);
    }
  };

  if (checking) {
    return (
      // The "do we already have a session?" frame, so it's part of the cold-open
      // sequence and follows AppSplash's monochrome, not the brand ring the rest
      // of this page's loading states use.
      <div className="min-h-screen bg-[#f0f0f0] flex items-center justify-center">
        <LoadingBlock tone="ink" />
      </div>
    );
  }

  const hasBandData = !!stats && (stats.totalKm > 0 || stats.workouts > 0 || stats.totalHours > 0);

  return (
    <div className="min-h-screen bg-[#f0f0f0] text-ink-900">
      {/* Hero Section */}
      <section className="relative flex flex-col overflow-hidden">
        {/* Decorative brand glow */}
        <div className="pointer-events-none absolute -top-40 end-[-10%] h-[520px] w-[520px] rounded-full bg-brand-600/10 blur-3xl" aria-hidden="true"></div>
        <div className="pointer-events-none absolute top-1/3 start-[-15%] h-[420px] w-[420px] rounded-full bg-brand-600/5 blur-3xl" aria-hidden="true"></div>

        {/* Nav — sticky glass bar, safe-area aware */}
        <nav className="sticky top-0 z-40 safe-top safe-inline-start safe-inline-end bg-[#f0f0f0]/80 backdrop-blur-md border-b border-black/5">
          <div className="flex items-center justify-between px-4 sm:px-8 lg:px-20 h-16">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-brand-600 shadow-lg shadow-brand-600/25">
                <img src="/images/logo-white.png" alt="Madregot After 2KM" className="h-6 w-6 sm:h-7 sm:w-7 object-contain" />
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-sm sm:text-base font-black uppercase tracking-tight">{t('madregot')}</span>
                <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400 mt-0.5">{t('after2km')}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <LocaleSwitcher />
              <button
                onClick={signIn}
                disabled={signingIn}
                className="inline-flex min-h-10 items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-[#FC4C02] px-4 text-sm font-bold text-white shadow-lg shadow-band-3/20 transition hover:bg-[#e34402] active:scale-[0.98] disabled:opacity-50 sm:px-5"
              >
                {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    <StravaMark className="h-4 w-4 text-ink-700" />
                    {t('signInWithStrava')}
                  </>
                )}
              </button>
            </div>
          </div>
        </nav>

        {/* Admin Login Sheet (triggered from footer) */}
        <Sheet open={showAdminLogin} onOpenChange={setShowAdminLogin} title={th('adminLogin')}>
          <form onSubmit={handleAdminLogin} className="space-y-3 pb-2">
            <input
              type="email"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              className="w-full min-h-[44px] bg-page/50 border border-page/50 rounded-xl px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
              placeholder="admin@madregot.club"
              required
            />
            <input
              type="password"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              className="w-full min-h-[44px] bg-page/50 border border-page/50 rounded-xl px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
              placeholder={th('password')}
              required
            />
            {adminError && (
              <p className="text-xs text-accent-red">{adminError}</p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={adminLoading}>
              {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              {adminLoading ? tc('signingIn') : th('signInAsAdmin')}
            </Button>
          </form>
        </Sheet>

        {/* Mobile Hero Image */}
        <div className="lg:hidden px-4 sm:px-8 pt-4 pb-6 relative z-10">
          <Figure
            src="/images/hero-running.jpg"
            alt={t('heroAlt')}
            ratio="aspect-[16/9]"
            priority
            className="rounded-3xl shadow-xl ring-1 ring-black/5"
          />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 flex-1 flex items-center px-4 sm:px-8 lg:px-20 py-8 lg:py-0 lg:min-h-[74vh]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-20 items-center w-full max-w-7xl mx-auto">
            {/* Text */}
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-600/10 text-brand-600 px-3.5 py-1.5 mb-6 sm:mb-8">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-600"></span>
                <span className="text-[11px] sm:text-xs font-black uppercase tracking-[0.18em]">{t('after2km')}</span>
              </div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black uppercase leading-[0.9] tracking-tight text-brand-600 break-words hyphens-none">
                {t('redefining')}<br />
                {t('running')}<br />
                {t('culture')}
              </h1>
              <div className="w-12 sm:w-16 h-1.5 bg-brand-600 mt-6 sm:mt-8 mb-4 sm:mb-6 rounded-full"></div>
              <p className="text-lg sm:text-xl md:text-2xl text-ink-900 font-light leading-relaxed">
                {t('connectingRunners')}<br />
                {t('buildingCommunity')}
              </p>
              <div className="flex flex-col gap-3 mt-8 sm:mt-10 sm:max-w-sm">
                <button
                  onClick={signIn}
                  disabled={signingIn}
                  className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-[#FC4C02] px-6 text-base font-bold text-white shadow-xl shadow-band-3/20 transition hover:bg-[#e34402] active:scale-[0.99] disabled:opacity-50"
                >
                  {signingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>
                      <StravaMark className="h-5 w-5 text-ink-700" />
                      {t('signInWithStrava')}
                    </>
                  )}
                </button>
                {displayError && (
                  <p className="text-sm text-accent-red text-center" dir="rtl">{displayError}</p>
                )}
              </div>
            </div>

            {/* Visual (desktop only) */}
            <div className="relative hidden lg:block">
              <div className="absolute -inset-4 rounded-[2rem] bg-brand-600/10 blur-2xl" aria-hidden="true"></div>
              <Figure
                src="/images/hero-running.jpg"
                alt={t('heroAlt')}
                ratio="aspect-[3/4]"
                className="relative rounded-[2rem] shadow-2xl ring-1 ring-black/5"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Live stats band + top-3 podium (only when we have real data) */}
      {stats && (hasBandData || stats.topResults.length > 0) && (
        <section className="px-4 sm:px-8 lg:px-20 pb-4 sm:pb-6 -mt-2">
          <div className="max-w-7xl mx-auto">
            {hasBandData && (
              <>
              {stats.since && (
                <p className="text-center text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] text-ink-400 mb-3 sm:mb-4">
                  {t('sinceLabel')} {fmtMonthYear(stats.since, locale)}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 sm:gap-6">
                <div className="group bg-white rounded-2xl sm:rounded-3xl border border-page p-3 sm:p-8 text-center shadow-sm transition-all sm:hover:-translate-y-1 sm:hover:shadow-lg">
                  <div className="mx-auto mb-2 sm:mb-4 flex h-8 w-8 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-brand-600/10 text-brand-600">
                    <Route className="h-4 w-4 sm:h-7 sm:w-7" />
                  </div>
                  <BigStat
                    value={<span dir="ltr">{fmtNum(stats.totalKm, locale)}</span>}
                    label={t('statKm')}
                    valueClassName="text-2xl sm:text-5xl text-brand-600"
                  />
                </div>
                <div className="group bg-white rounded-2xl sm:rounded-3xl border border-page p-3 sm:p-8 text-center shadow-sm transition-all sm:hover:-translate-y-1 sm:hover:shadow-lg">
                  <div className="mx-auto mb-2 sm:mb-4 flex h-8 w-8 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-brand-600/10 text-brand-600">
                    <Activity className="h-4 w-4 sm:h-7 sm:w-7" />
                  </div>
                  <BigStat
                    value={<span dir="ltr">{fmtNum(stats.workouts, locale)}</span>}
                    label={t('statWorkouts')}
                    valueClassName="text-2xl sm:text-5xl text-brand-600"
                  />
                </div>
                <div className="group bg-white rounded-2xl sm:rounded-3xl border border-page p-3 sm:p-8 text-center shadow-sm transition-all sm:hover:-translate-y-1 sm:hover:shadow-lg">
                  <div className="mx-auto mb-2 sm:mb-4 flex h-8 w-8 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-brand-600/10 text-brand-600">
                    <Clock className="h-4 w-4 sm:h-7 sm:w-7" />
                  </div>
                  <BigStat
                    value={<span dir="ltr">{fmtNum(stats.totalHours, locale)}</span>}
                    label={t('statHours')}
                    valueClassName="text-2xl sm:text-5xl text-brand-600"
                  />
                </div>
              </div>
              </>
            )}

            {stats.topResults.length > 0 && (
              <div className="bg-white rounded-3xl border border-page shadow-sm p-6 sm:p-10 mt-3 sm:mt-6">
                <div className="flex flex-col items-center gap-1 mb-8 sm:mb-10">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-brand-600" />
                    <h3 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-ink-900">
                      {stats.topResults[0].test} — {t('topThree')}
                    </h3>
                  </div>
                  {stats.testDate && (
                    <span className="text-[11px] sm:text-xs font-semibold text-ink-400">{fmtDate(stats.testDate, locale)}</span>
                  )}
                </div>
                <div className="flex items-end justify-center gap-3 sm:gap-8">
                  {/* 2nd place */}
                  {stats.topResults.length >= 2 && (
                    <div className="flex flex-1 max-w-[104px] flex-col items-center">
                      <span className="mb-2 text-sm sm:text-lg font-black tabular-nums text-ink-400">{fmtTime(stats.topResults[1].timeSeconds)}</span>
                      <div className="flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b from-page to-ink-300 pt-3 shadow-inner" style={{ height: '96px' }}>
                        <span className="text-lg font-black text-ink-700/90">2</span>
                      </div>
                      <span className="mt-3 max-w-full truncate text-xs sm:text-sm font-bold text-ink-900" dir="auto">{stats.topResults[1].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {/* 1st place */}
                  {stats.topResults.length >= 1 && (
                    <div className="flex flex-1 max-w-[104px] flex-col items-center">
                      <span className="mb-0.5 text-xl sm:text-2xl leading-none">👑</span>
                      <span className="mb-2 text-base sm:text-2xl font-black tabular-nums text-brand-600">{fmtTime(stats.topResults[0].timeSeconds)}</span>
                      {/* Gold: the brightest step on the podium. Band 3 lightened
                          rather than a token pair, because the designer's palette
                          has exactly one orange — and 1st and 3rd both collapsing
                          onto it is how gold and bronze became the same step. */}
                      <div className="flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b from-[#FF8A4D] to-[#FF5315] pt-3 shadow-md" style={{ height: '140px' }}>
                        <span className="text-xl font-black text-ink-700">1</span>
                      </div>
                      <span className="mt-3 max-w-full truncate text-sm sm:text-base font-black text-ink-900" dir="auto">{stats.topResults[0].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {/* 3rd place */}
                  {stats.topResults.length >= 3 && (
                    <div className="flex flex-1 max-w-[104px] flex-col items-center">
                      <span className="mb-2 text-sm sm:text-lg font-black tabular-nums text-[#C43C0B]">{fmtTime(stats.topResults[2].timeSeconds)}</span>
                      {/* Bronze: band 3 darkened, so the podium still reads
                          gold / silver / bronze at a glance. White numeral —
                          ink on this deep burnt orange is only 2.6:1. */}
                      <div className="flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b from-[#C43C0B] to-[#9E3009] pt-3 shadow-inner" style={{ height: '68px' }}>
                        <span className="text-lg font-black text-white/95">3</span>
                      </div>
                      <span className="mt-3 max-w-full truncate text-xs sm:text-sm font-bold text-ink-900" dir="auto">{stats.topResults[2].name.split(' ')[0]}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Who We Are */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-5xl md:text-6xl lg:text-8xl font-black uppercase leading-[0.9] tracking-tight text-brand-600 mb-8">
            {t('whoWeAre')}<br />{t('weAre')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 mt-12 items-center">
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-ink-900 mb-6">
                {t('fromTwoRunners')}
              </h3>
              <div className="w-16 h-1.5 bg-brand-600 mb-8 rounded-full"></div>
              <p className="text-lg text-ink-400 leading-relaxed mb-6">
                {t('foundedDescription1')}
              </p>
              <p className="text-lg text-ink-400 leading-relaxed">
                {t('foundedDescription2')}
              </p>
            </div>
            <div className="space-y-4">
              <Figure src="/images/team-race.jpg" alt={t('teamRaceAlt')} ratio="aspect-[16/9]" className="rounded-3xl shadow-lg ring-1 ring-black/5" imgClassName="motion-safe:transition-transform motion-safe:duration-500 sm:hover:scale-105" />
              <div className="grid grid-cols-2 gap-4">
                <Figure src="/images/team-group.jpg" alt={t('teamGroupAlt')} ratio="aspect-[3/4]" className="rounded-3xl shadow-lg ring-1 ring-black/5" imgClassName="motion-safe:transition-transform motion-safe:duration-500 sm:hover:scale-105" />
                <Figure src="/images/runners-group.jpg" alt={t('runnersGroupAlt')} ratio="aspect-[3/4]" className="rounded-3xl shadow-lg ring-1 ring-black/5" imgClassName="motion-safe:transition-transform motion-safe:duration-500 sm:hover:scale-105" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Journey Timeline */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20 bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-5xl md:text-7xl font-black uppercase leading-[0.9] tracking-tight text-brand-600 mb-16">
            {t('our')}<br />{t('journey')}
          </h2>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute top-8 inset-x-0 h-0.5 bg-gradient-to-r from-brand-600 to-brand-600/20 hidden sm:block"></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 sm:start-4 w-3.5 h-3.5 rounded-full bg-brand-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-brand-600">{t('year2022')}</div>
                <div className="text-sm font-bold mt-1">{t('founded')}</div>
                <div className="text-sm text-ink-400 mt-2">{t('foundedDesc')}</div>
              </div>
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 w-3.5 h-3.5 rounded-full bg-brand-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-brand-600">{t('year2023')}</div>
                <div className="text-sm font-bold mt-1">{t('firstTeam')}</div>
                <div className="text-sm text-ink-400 mt-2">{t('firstTeamDesc')}</div>
              </div>
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 w-3.5 h-3.5 rounded-full bg-brand-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-brand-600">{t('year2025')}</div>
                <div className="text-sm font-bold mt-1">{t('historicValencia')}</div>
                <div className="text-sm text-ink-400 mt-2">{t('historicValenciaDesc')}</div>
              </div>
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 w-3.5 h-3.5 rounded-full bg-brand-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-brand-600">{t('year2026')}</div>
                <div className="text-sm font-bold mt-1">{t('nextLevel')}</div>
                <div className="text-sm text-ink-400 mt-2">{t('nextLevelDesc')}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* More Than a Running Team */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl sm:text-4xl md:text-5xl lg:text-7xl font-black uppercase leading-[0.9] tracking-tight text-brand-600 mb-6">
            {t('moreThanA')}<br />{t('runningTeam')}
          </h2>
          <p className="text-xl text-ink-400 mb-16 max-w-3xl">
            {t('supportSystem')}
          </p>

          {/* Two real-proof hero cards — actual numbers, not stock copy. */}
          <div className="grid sm:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
            <div className="group relative overflow-hidden rounded-3xl border border-page bg-white p-6 sm:p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="pointer-events-none absolute -top-10 -end-10 h-40 w-40 rounded-full bg-brand-600/[0.06] blur-2xl" aria-hidden="true" />
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600">
                <Trophy className="h-6 w-6 stroke-[1.75]" />
              </div>
              <h3 className="text-lg font-bold mb-1">{t('performance')}</h3>
              <BigStat
                value={<span dir="ltr">17</span>}
                label={t('videoGuidedExercises')}
                className="flex-row items-baseline text-start gap-2 mb-3"
                valueClassName="text-4xl sm:text-5xl text-brand-600"
              />
              <ul className="text-sm text-ink-400 space-y-1">
                <li>{t('professionalCoach')}</li>
                <li>{t('gymAccess')}</li>
                <li>{t('personalizedPrograms')}</li>
              </ul>
            </div>
            <div className="group relative overflow-hidden rounded-3xl border border-page bg-white p-6 sm:p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="pointer-events-none absolute -top-10 -end-10 h-40 w-40 rounded-full bg-brand-600/[0.06] blur-2xl" aria-hidden="true" />
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600">
                <Users className="h-6 w-6 stroke-[1.75]" />
              </div>
              <h3 className="text-lg font-bold mb-1">{t('community')}</h3>
              <BigStat
                value={<span dir="ltr">{stats && stats.athletes > 0 ? fmtNum(stats.athletes, locale) : '20+'}</span>}
                label={t('activeRunnersThisSeason')}
                className="flex-row items-baseline text-start gap-2 mb-3"
                valueClassName="text-4xl sm:text-5xl text-brand-600"
              />
              <ul className="text-sm text-ink-400 space-y-1">
                <li>{t('trainingPartners')}</li>
                <li>{t('raceTravel')}</li>
                <li>{t('memberBenefits')}</li>
              </ul>
            </div>
          </div>

          {/* Three smaller supporting cards. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <div className="group bg-white rounded-3xl border border-page p-5 sm:p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-red/10 text-accent-red-ink">
                <Heart className="h-5 w-5 stroke-[1.75]" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('recovery')}</h3>
              <ul className="text-sm text-ink-400 space-y-1">
                <li>{t('physiotherapy')}</li>
                <li>{t('orthopedicCare')}</li>
                <li>{t('injuryPrevention')}</li>
              </ul>
            </div>
            <div className="group bg-white rounded-3xl border border-page p-5 sm:p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-band-3/10 text-band-3-ink">
                <Zap className="h-5 w-5 stroke-[1.75]" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('nutrition')}</h3>
              <ul className="text-sm text-ink-400 space-y-1">
                <li>{t('sportsNutrition')}</li>
                <li>{t('energyProducts')}</li>
                <li>{t('recoverySupport')}</li>
              </ul>
            </div>
            <div className="group bg-white rounded-3xl border border-page p-5 sm:p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600">
                <Camera className="h-5 w-5 stroke-[1.75]" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('content')}</h3>
              <p className="text-sm text-ink-400">{t('feedProof')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#f0f0f0] px-4 py-16 sm:px-8 sm:py-20 lg:px-20 lg:py-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-page px-6 py-16 text-center shadow-2xl sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -end-20 -top-24 h-72 w-72 rounded-full bg-[#FC4C02]/25 blur-3xl" aria-hidden="true"></div>
          <div className="pointer-events-none absolute -bottom-28 -start-16 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl" aria-hidden="true"></div>
          <div className="relative mx-auto max-w-3xl">
            <h2 className="text-3xl font-black uppercase tracking-tight text-ink-700 sm:text-5xl md:text-6xl">
              {t('readyToRun')}
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-ink-500 sm:text-lg">
              {t('joinCommunity')}
            </p>
            <button
              onClick={signIn}
              disabled={signingIn}
              className="mt-9 inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-3 rounded-full bg-[#FC4C02] px-8 text-base font-bold text-white shadow-xl shadow-band-3/30 transition hover:bg-[#e34402] active:scale-[0.99] disabled:opacity-50 sm:text-lg"
            >
              {signingIn ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <StravaMark className="h-5 w-5 text-ink-700" />
                  {t('signInWithStrava')}
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 sm:px-8 lg:px-20 bg-black text-white safe-bottom safe-inline-start safe-inline-end">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo-white.png" alt="Madregot After 2KM" className="h-8 w-8 object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight">{t('madregot')}</span>
              <span className="text-xs font-medium tracking-wide text-ink-400">{t('after2km')}</span>
            </div>
          </div>
          <div className="flex flex-col items-center sm:items-end gap-2">
            <p className="text-ink-400 text-sm" dir="ltr">
              {t('copyright')}
            </p>
            <button
              onClick={() => setShowAdminLogin(!showAdminLogin)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 text-ink-400 hover:text-ink-500 text-xs font-medium transition-colors"
            >
              <Shield className="h-3.5 w-3.5" />
              {t('adminSignIn')}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
