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
      const res = await fetch('/api/strava?mode=login');
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
                onClick={signIn}
                disabled={signingIn}
                className="inline-flex min-h-10 items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-[#FC4C02] px-4 text-sm font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-[#e34402] active:scale-[0.98] disabled:opacity-50 sm:px-5"
              >
                {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    <StravaMark className="h-4 w-4 text-white" />
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
                  className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-[#FC4C02] px-6 text-base font-bold text-white shadow-xl shadow-orange-600/20 transition hover:bg-[#e34402] active:scale-[0.99] disabled:opacity-50"
                >
                  {signingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                    <>
                      <StravaMark className="h-5 w-5 text-white" />
                      {t('signInWithStrava')}
                    </>
                  )}
                </button>
                {displayError && (
                  <p className="text-sm text-red-600 text-center" dir="rtl">{displayError}</p>
                )}
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
      <section className="bg-[#f0f0f0] px-4 py-16 sm:px-8 sm:py-20 lg:px-20 lg:py-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-16 text-center shadow-2xl sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -end-20 -top-24 h-72 w-72 rounded-full bg-[#FC4C02]/25 blur-3xl" aria-hidden="true"></div>
          <div className="pointer-events-none absolute -bottom-28 -start-16 h-72 w-72 rounded-full bg-primary-600/20 blur-3xl" aria-hidden="true"></div>
          <div className="relative mx-auto max-w-3xl">
            <h2 className="text-3xl font-black uppercase tracking-tight text-white sm:text-5xl md:text-6xl">
              {t('readyToRun')}
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-slate-300 sm:text-lg">
              {t('joinCommunity')}
            </p>
            <button
              onClick={signIn}
              disabled={signingIn}
              className="mt-9 inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-3 rounded-full bg-[#FC4C02] px-8 text-base font-bold text-white shadow-xl shadow-orange-950/30 transition hover:bg-[#e34402] active:scale-[0.99] disabled:opacity-50 sm:text-lg"
            >
              {signingIn ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <StravaMark className="h-5 w-5 text-white" />
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
