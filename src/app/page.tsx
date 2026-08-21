'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trophy, Users, Zap, Heart, Camera, Loader2, Shield, Route, Activity, Clock, GraduationCap } from 'lucide-react';
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

  const signIn = async () => {
    setLoading(true);
    try {
      // Drop Test Runner / stale JWT so /auth/resolve adopts the Strava user.
      const { clearLocalIdentity } = await import('@/lib/auth/clear-local-identity');
      await clearLocalIdentity();
      const res = await fetch('/api/strava?mode=login');
      const data = await res.json();
      if (!res.ok || !data.authUrl) throw new Error(data.error || 'Strava login unavailable');
      window.location.href = data.authUrl;
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return { signIn, loading };
}

/**
 * Google Sign-In (roadmap flow #22: Google creates the account; Strava/Garmin
 * connect is a separate, optional step from the dashboard/profile page).
 *
 * Uses Supabase's standard OAuth redirect. `getSupabase()` doesn't set an
 * explicit `flowType`, so it defaults to `implicit` — Supabase redirects back
 * with the session tokens in the URL *hash fragment*
 * (`#access_token=…&refresh_token=…`), which `/auth/resolve` already knows how
 * to consume (it's the same shape the Strava synthetic-session bootstrap
 * produces). Deliberately NOT routed through `/auth/callback` (the `?code=`
 * PKCE exchange route): that route builds a fresh server-side Supabase client
 * with no access to the browser's localStorage-held `code_verifier`, so the
 * exchange would fail with AuthPKCECodeVerifierMissingError regardless of
 * provider config. Landing straight on `/auth/resolve` reuses working,
 * already-tested plumbing instead.
 *
 * NOTE: this call will fail until the Supabase dashboard's Google provider is
 * enabled with a real Google Cloud OAuth Client ID/Secret + authorized
 * redirect URI (Authentication → Providers → Google) and `/auth/resolve` is
 * added to the dashboard's redirect URL allow-list — entirely outside this
 * codebase.
 */
function useGoogleLogin() {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    try {
      const { clearLocalIdentity } = await import('@/lib/auth/clear-local-identity');
      await clearLocalIdentity();
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/resolve` },
      });
      if (error) throw error;
      // On success the browser navigates away to Google; nothing else to do here.
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return { signIn, loading };
}

function GoogleBadge({ className = 'bg-white text-[#4285F4]' }: { className?: string }) {
  return (
    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black ${className}`}>
      G
    </span>
  );
}

/**
 * Apple Sign-In. Mirrors {@link useGoogleLogin} exactly (same implicit-flow
 * redirect to `/auth/resolve`, same "clear stale local identity first"
 * bootstrap) — only the OAuth `provider` differs. See the comment above
 * `useGoogleLogin` for why this deliberately lands on `/auth/resolve` rather
 * than `/auth/callback`.
 *
 * NOTE: like Google, this will fail until Supabase's Apple provider is
 * configured (Authentication → Providers → Apple, Sign in with Apple Services
 * ID + private key) and `/auth/resolve` is in the redirect URL allow-list.
 *
 * Known v1 edge case (accepted product decision, not handled here): an
 * existing member's first Apple sign-in via Apple's private-relay email won't
 * match their existing `athletes.email` row, so they'd go through onboarding
 * again rather than being linked to their old account.
 */
function useAppleLogin() {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    try {
      const { clearLocalIdentity } = await import('@/lib/auth/clear-local-identity');
      await clearLocalIdentity();
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: `${window.location.origin}/auth/resolve` },
      });
      if (error) throw error;
      // On success the browser navigates away to Apple; nothing else to do here.
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return { signIn, loading };
}

function AppleBadge({ className = 'text-black' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 384 512"
      aria-hidden="true"
      className={`h-4 w-4 ${className}`}
      fill="currentColor"
    >
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.4-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.5-90-61.5-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1-2 49.9-15.2 69.5-34.3z" />
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
  const { signIn, loading: signingIn } = useStravaLogin();
  const { signIn: signInWithGoogle, loading: signingInWithGoogle } = useGoogleLogin();
  const { signIn: signInWithApple, loading: signingInWithApple } = useAppleLogin();
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/auth/resolve');
      } else {
        setChecking(false);
      }
    });
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
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('coach_email', data.email);
      localStorage.setItem('admin_session', 'true');
      localStorage.removeItem('athlete_id');
      localStorage.removeItem('athlete_name');
      localStorage.removeItem('athlete_email');
      router.push('/dashboard');
    } catch (err: any) {
      setAdminError(err.message);
    } finally {
      setAdminLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f0f0f0] flex items-center justify-center">
        <LoadingBlock />
      </div>
    );
  }

  const hasBandData = !!stats && (stats.totalKm > 0 || stats.workouts > 0 || stats.totalHours > 0);

  return (
    <div className="min-h-screen bg-[#f0f0f0] text-black">
      {/* Hero Section */}
      <section className="relative flex flex-col overflow-hidden">
        {/* Decorative brand glow */}
        <div className="pointer-events-none absolute -top-40 end-[-10%] h-[520px] w-[520px] rounded-full bg-primary-600/10 blur-3xl" aria-hidden="true"></div>
        <div className="pointer-events-none absolute top-1/3 start-[-15%] h-[420px] w-[420px] rounded-full bg-primary-600/5 blur-3xl" aria-hidden="true"></div>

        {/* Nav — sticky glass bar, safe-area aware */}
        <nav className="sticky top-0 z-40 safe-top safe-inline-start safe-inline-end bg-[#f0f0f0]/80 backdrop-blur-md border-b border-black/5">
          <div className="flex items-center justify-between px-4 sm:px-8 lg:px-20 h-16">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-primary-600 shadow-lg shadow-primary-600/25">
                <img src="/images/logo-white.png" alt="Madregot After 2KM" className="h-6 w-6 sm:h-7 sm:w-7 object-contain" />
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-sm sm:text-base font-black uppercase tracking-tight">{t('madregot')}</span>
                <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 mt-0.5">{t('after2km')}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <LocaleSwitcher />
              <button
                onClick={signInWithGoogle}
                disabled={signingInWithGoogle}
                className="hidden sm:inline-flex whitespace-nowrap items-center justify-center gap-2 min-h-[40px] px-4 sm:px-5 rounded-full border-2 border-gray-300 hover:border-gray-400 active:scale-[0.98] text-gray-700 text-sm font-bold transition disabled:opacity-50"
              >
                {signingInWithGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    <GoogleBadge className="bg-gray-100 text-[#4285F4]" />
                    {t('signInWithGoogle')}
                  </>
                )}
              </button>
              <button
                onClick={signInWithApple}
                disabled={signingInWithApple}
                className="hidden sm:inline-flex whitespace-nowrap items-center justify-center gap-2 min-h-[40px] px-4 sm:px-5 rounded-full border-2 border-gray-300 hover:border-gray-400 active:scale-[0.98] text-gray-700 text-sm font-bold transition disabled:opacity-50"
              >
                {signingInWithApple ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    <AppleBadge className="text-black" />
                    {t('signInWithApple')}
                  </>
                )}
              </button>
              <button
                onClick={signIn}
                disabled={signingIn}
                className="whitespace-nowrap inline-flex items-center justify-center gap-2 min-h-[40px] px-4 sm:px-5 rounded-full bg-primary-600 hover:bg-primary-700 active:scale-[0.98] text-white text-sm font-bold shadow-lg shadow-primary-600/25 transition disabled:opacity-50"
              >
                {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#FC4C02] text-white text-[9px] font-black">S</span>
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
              className="w-full min-h-[44px] bg-slate-900/50 border border-slate-700/50 rounded-xl px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              placeholder="admin@madregot.club"
              required
            />
            <input
              type="password"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              className="w-full min-h-[44px] bg-slate-900/50 border border-slate-700/50 rounded-xl px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              placeholder={th('password')}
              required
            />
            {adminError && (
              <p className="text-xs text-red-400">{adminError}</p>
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
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-600/10 text-primary-600 px-3.5 py-1.5 mb-6 sm:mb-8">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-600"></span>
                <span className="text-[11px] sm:text-xs font-black uppercase tracking-[0.18em]">{t('after2km')}</span>
              </div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black uppercase leading-[0.9] tracking-tight text-primary-600 break-words hyphens-none">
                {t('redefining')}<br />
                {t('running')}<br />
                {t('culture')}
              </h1>
              <div className="w-12 sm:w-16 h-1.5 bg-primary-600 mt-6 sm:mt-8 mb-4 sm:mb-6 rounded-full"></div>
              <p className="text-lg sm:text-xl md:text-2xl text-gray-700 font-light leading-relaxed">
                {t('connectingRunners')}<br />
                {t('buildingCommunity')}
              </p>
              <div className="flex flex-col gap-3 mt-8 sm:mt-10 sm:max-w-sm">
                <button
                  onClick={signIn}
                  disabled={signingIn}
                  className="w-full inline-flex items-center justify-center gap-2.5 min-h-[52px] rounded-2xl bg-primary-600 hover:bg-primary-700 active:scale-[0.99] text-white text-base font-bold shadow-lg shadow-primary-600/25 transition disabled:opacity-50"
                >
                  {signingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-primary-600 text-xs font-black">G</span>
                      {t('signInWithStrava')}
                    </>
                  )}
                </button>
                <button
                  onClick={signInWithGoogle}
                  disabled={signingInWithGoogle}
                  className="w-full inline-flex items-center justify-center gap-2.5 min-h-[46px] rounded-2xl border-2 border-gray-300 hover:border-gray-400 bg-white active:scale-[0.99] text-gray-700 text-sm font-bold transition disabled:opacity-50"
                >
                  {signingInWithGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>
                      <GoogleBadge className="bg-gray-100 text-[#4285F4]" />
                      {t('signInWithGoogle')}
                    </>
                  )}
                </button>
                <button
                  onClick={signInWithApple}
                  disabled={signingInWithApple}
                  className="w-full inline-flex items-center justify-center gap-2.5 min-h-[46px] rounded-2xl border-2 border-gray-300 hover:border-gray-400 bg-white active:scale-[0.99] text-gray-700 text-sm font-bold transition disabled:opacity-50"
                >
                  {signingInWithApple ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>
                      <AppleBadge className="text-black" />
                      {t('signInWithApple')}
                    </>
                  )}
                </button>
                <div
                  aria-disabled="true"
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] rounded-2xl border-2 border-gray-300 text-gray-400 text-sm font-semibold cursor-not-allowed select-none"
                >
                  <GraduationCap className="h-4 w-4" />
                  {t('joinAcademy')}
                  <span className="text-[10px] font-black uppercase tracking-wider bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                    {t('comingSoon')}
                  </span>
                </div>
              </div>
            </div>

            {/* Visual (desktop only) */}
            <div className="relative hidden lg:block">
              <div className="absolute -inset-4 rounded-[2rem] bg-primary-600/10 blur-2xl" aria-hidden="true"></div>
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
                <p className="text-center text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] text-gray-400 mb-3 sm:mb-4">
                  {t('sinceLabel')} {fmtMonthYear(stats.since, locale)}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 sm:gap-6">
                <div className="group bg-white rounded-2xl sm:rounded-3xl border border-gray-100 p-3 sm:p-8 text-center shadow-sm transition-all sm:hover:-translate-y-1 sm:hover:shadow-lg">
                  <div className="mx-auto mb-2 sm:mb-4 flex h-8 w-8 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-primary-600/10 text-primary-600">
                    <Route className="h-4 w-4 sm:h-7 sm:w-7" />
                  </div>
                  <BigStat
                    value={<span dir="ltr">{fmtNum(stats.totalKm, locale)}</span>}
                    label={t('statKm')}
                    valueClassName="text-2xl sm:text-5xl text-primary-600"
                  />
                </div>
                <div className="group bg-white rounded-2xl sm:rounded-3xl border border-gray-100 p-3 sm:p-8 text-center shadow-sm transition-all sm:hover:-translate-y-1 sm:hover:shadow-lg">
                  <div className="mx-auto mb-2 sm:mb-4 flex h-8 w-8 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-primary-600/10 text-primary-600">
                    <Activity className="h-4 w-4 sm:h-7 sm:w-7" />
                  </div>
                  <BigStat
                    value={<span dir="ltr">{fmtNum(stats.workouts, locale)}</span>}
                    label={t('statWorkouts')}
                    valueClassName="text-2xl sm:text-5xl text-primary-600"
                  />
                </div>
                <div className="group bg-white rounded-2xl sm:rounded-3xl border border-gray-100 p-3 sm:p-8 text-center shadow-sm transition-all sm:hover:-translate-y-1 sm:hover:shadow-lg">
                  <div className="mx-auto mb-2 sm:mb-4 flex h-8 w-8 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-primary-600/10 text-primary-600">
                    <Clock className="h-4 w-4 sm:h-7 sm:w-7" />
                  </div>
                  <BigStat
                    value={<span dir="ltr">{fmtNum(stats.totalHours, locale)}</span>}
                    label={t('statHours')}
                    valueClassName="text-2xl sm:text-5xl text-primary-600"
                  />
                </div>
              </div>
              </>
            )}

            {stats.topResults.length > 0 && (
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-10 mt-3 sm:mt-6">
                <div className="flex flex-col items-center gap-1 mb-8 sm:mb-10">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-primary-600" />
                    <h3 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-black">
                      {stats.topResults[0].test} — {t('topThree')}
                    </h3>
                  </div>
                  {stats.testDate && (
                    <span className="text-[11px] sm:text-xs font-semibold text-gray-400">{fmtDate(stats.testDate, locale)}</span>
                  )}
                </div>
                <div className="flex items-end justify-center gap-3 sm:gap-8">
                  {/* 2nd place */}
                  {stats.topResults.length >= 2 && (
                    <div className="flex flex-1 max-w-[104px] flex-col items-center">
                      <span className="mb-2 text-sm sm:text-lg font-black tabular-nums text-slate-500">{fmtTime(stats.topResults[1].timeSeconds)}</span>
                      <div className="flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b from-slate-300 to-slate-400 pt-3 shadow-inner" style={{ height: '96px' }}>
                        <span className="text-lg font-black text-white/90">2</span>
                      </div>
                      <span className="mt-3 max-w-full truncate text-xs sm:text-sm font-bold text-black" dir="auto">{stats.topResults[1].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {/* 1st place */}
                  {stats.topResults.length >= 1 && (
                    <div className="flex flex-1 max-w-[104px] flex-col items-center">
                      <span className="mb-0.5 text-xl sm:text-2xl leading-none">👑</span>
                      <span className="mb-2 text-base sm:text-2xl font-black tabular-nums text-primary-600">{fmtTime(stats.topResults[0].timeSeconds)}</span>
                      <div className="flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b from-yellow-400 to-yellow-500 pt-3 shadow-md" style={{ height: '140px' }}>
                        <span className="text-xl font-black text-white">1</span>
                      </div>
                      <span className="mt-3 max-w-full truncate text-sm sm:text-base font-black text-black" dir="auto">{stats.topResults[0].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {/* 3rd place */}
                  {stats.topResults.length >= 3 && (
                    <div className="flex flex-1 max-w-[104px] flex-col items-center">
                      <span className="mb-2 text-sm sm:text-lg font-black tabular-nums text-amber-700">{fmtTime(stats.topResults[2].timeSeconds)}</span>
                      <div className="flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b from-amber-500 to-amber-600 pt-3 shadow-inner" style={{ height: '68px' }}>
                        <span className="text-lg font-black text-white/90">3</span>
                      </div>
                      <span className="mt-3 max-w-full truncate text-xs sm:text-sm font-bold text-black" dir="auto">{stats.topResults[2].name.split(' ')[0]}</span>
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
          <h2 className="text-3xl sm:text-5xl md:text-6xl lg:text-8xl font-black uppercase leading-[0.9] tracking-tight text-primary-600 mb-8">
            {t('whoWeAre')}<br />{t('weAre')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 mt-12 items-center">
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-black mb-6">
                {t('fromTwoRunners')}
              </h3>
              <div className="w-16 h-1.5 bg-primary-600 mb-8 rounded-full"></div>
              <p className="text-lg text-gray-600 leading-relaxed mb-6">
                {t('foundedDescription1')}
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
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
          <h2 className="text-3xl sm:text-5xl md:text-7xl font-black uppercase leading-[0.9] tracking-tight text-primary-600 mb-16">
            {t('our')}<br />{t('journey')}
          </h2>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute top-8 inset-x-0 h-0.5 bg-gradient-to-r from-primary-600 to-primary-600/20 hidden sm:block"></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 sm:start-4 w-3.5 h-3.5 rounded-full bg-primary-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-primary-600">{t('year2022')}</div>
                <div className="text-sm font-bold mt-1">{t('founded')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('foundedDesc')}</div>
              </div>
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 w-3.5 h-3.5 rounded-full bg-primary-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-primary-600">{t('year2023')}</div>
                <div className="text-sm font-bold mt-1">{t('firstTeam')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('firstTeamDesc')}</div>
              </div>
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 w-3.5 h-3.5 rounded-full bg-primary-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-primary-600">{t('year2025')}</div>
                <div className="text-sm font-bold mt-1">{t('historicValencia')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('historicValenciaDesc')}</div>
              </div>
              <div className="group relative pt-12 rounded-2xl p-4 -m-4 transition-colors hover:bg-[#f0f0f0]">
                <div className="absolute top-[26px] start-4 w-3.5 h-3.5 rounded-full bg-primary-600 ring-4 ring-white"></div>
                <div className="text-2xl font-black text-primary-600">{t('year2026')}</div>
                <div className="text-sm font-bold mt-1">{t('nextLevel')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('nextLevelDesc')}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* More Than a Running Team */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl sm:text-4xl md:text-5xl lg:text-7xl font-black uppercase leading-[0.9] tracking-tight text-primary-600 mb-6">
            {t('moreThanA')}<br />{t('runningTeam')}
          </h2>
          <p className="text-xl text-gray-600 mb-16 max-w-3xl">
            {t('supportSystem')}
          </p>

          {/* Two real-proof hero cards — actual numbers, not stock copy. */}
          <div className="grid sm:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
            <div className="group relative overflow-hidden rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="pointer-events-none absolute -top-10 -end-10 h-40 w-40 rounded-full bg-primary-600/[0.06] blur-2xl" aria-hidden="true" />
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600/10 text-primary-600">
                <Trophy className="h-6 w-6 stroke-[1.75]" />
              </div>
              <h3 className="text-lg font-bold mb-1">{t('performance')}</h3>
              <BigStat
                value={<span dir="ltr">17</span>}
                label={t('videoGuidedExercises')}
                className="flex-row items-baseline text-start gap-2 mb-3"
                valueClassName="text-4xl sm:text-5xl text-primary-600"
              />
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('professionalCoach')}</li>
                <li>{t('gymAccess')}</li>
                <li>{t('personalizedPrograms')}</li>
              </ul>
            </div>
            <div className="group relative overflow-hidden rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="pointer-events-none absolute -top-10 -end-10 h-40 w-40 rounded-full bg-primary-600/[0.06] blur-2xl" aria-hidden="true" />
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600/10 text-primary-600">
                <Users className="h-6 w-6 stroke-[1.75]" />
              </div>
              <h3 className="text-lg font-bold mb-1">{t('community')}</h3>
              <BigStat
                value={<span dir="ltr">{stats && stats.athletes > 0 ? fmtNum(stats.athletes, locale) : '20+'}</span>}
                label={t('activeRunnersThisSeason')}
                className="flex-row items-baseline text-start gap-2 mb-3"
                valueClassName="text-4xl sm:text-5xl text-primary-600"
              />
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('trainingPartners')}</li>
                <li>{t('raceTravel')}</li>
                <li>{t('memberBenefits')}</li>
              </ul>
            </div>
          </div>

          {/* Three smaller supporting cards. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <div className="group bg-white rounded-3xl border border-gray-100 p-5 sm:p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600">
                <Heart className="h-5 w-5 stroke-[1.75]" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('recovery')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('physiotherapy')}</li>
                <li>{t('orthopedicCare')}</li>
                <li>{t('injuryPrevention')}</li>
              </ul>
            </div>
            <div className="group bg-white rounded-3xl border border-gray-100 p-5 sm:p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
                <Zap className="h-5 w-5 stroke-[1.75]" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('nutrition')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('sportsNutrition')}</li>
                <li>{t('energyProducts')}</li>
                <li>{t('recoverySupport')}</li>
              </ul>
            </div>
            <div className="group bg-white rounded-3xl border border-gray-100 p-5 sm:p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600">
                <Camera className="h-5 w-5 stroke-[1.75]" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('content')}</h3>
              <p className="text-sm text-gray-500">{t('feedProof')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden py-24 lg:py-32 px-4 sm:px-8 lg:px-20 bg-primary-600">
        <div className="pointer-events-none absolute -top-24 -start-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden="true"></div>
        <div className="pointer-events-none absolute -bottom-32 -end-16 h-96 w-96 rounded-full bg-black/10 blur-3xl" aria-hidden="true"></div>
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-6">
            {t('readyToRun')}
          </h2>
          <p className="text-xl text-white/80 mb-10">
            {t('joinCommunity')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <div
              aria-disabled="true"
              className="inline-flex items-center gap-3 bg-white/40 text-primary-600/50 font-bold px-8 py-4 sm:px-10 sm:py-5 rounded-xl text-lg cursor-not-allowed select-none"
            >
              <GraduationCap className="h-5 w-5" />
              {t('joinAcademy')}
              <span className="text-xs font-black uppercase tracking-wider bg-white/30 text-primary-600/70 px-2 py-0.5 rounded-full">
                {t('comingSoon')}
              </span>
            </div>
            <button
              onClick={signIn}
              disabled={signingIn}
              className="inline-flex items-center justify-center gap-2.5 bg-white text-primary-600 hover:bg-white/90 active:scale-[0.99] font-bold px-8 py-4 sm:py-5 rounded-xl text-lg transition disabled:opacity-50"
            >
              {signingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white text-xs font-black">G</span>
                  {t('signInWithStrava')}
                </>
              )}
            </button>
            <button
              onClick={signInWithGoogle}
              disabled={signingInWithGoogle}
              className="inline-flex items-center justify-center gap-2.5 bg-white/10 hover:bg-white/20 border-2 border-white/30 active:scale-[0.99] text-white font-bold px-8 py-4 sm:py-5 rounded-xl text-lg transition disabled:opacity-50"
            >
              {signingInWithGoogle ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  <GoogleBadge />
                  {t('signInWithGoogle')}
                </>
              )}
            </button>
            <button
              onClick={signInWithApple}
              disabled={signingInWithApple}
              className="inline-flex items-center justify-center gap-2.5 bg-white/10 hover:bg-white/20 border-2 border-white/30 active:scale-[0.99] text-white font-bold px-8 py-4 sm:py-5 rounded-xl text-lg transition disabled:opacity-50"
            >
              {signingInWithApple ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  <AppleBadge className="text-white" />
                  {t('signInWithApple')}
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
              <span className="text-xs font-medium tracking-wide text-gray-400">{t('after2km')}</span>
            </div>
          </div>
          <div className="flex flex-col items-center sm:items-end gap-2">
            <p className="text-gray-500 text-sm" dir="ltr">
              {t('copyright')}
            </p>
            <button
              onClick={() => setShowAdminLogin(!showAdminLogin)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2 text-gray-500 hover:text-gray-300 text-xs font-medium transition-colors"
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
