'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Trophy, Users, Zap, Heart, Camera, Loader2, Shield, Route, Activity, Medal, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getSupabase } from '@/lib/supabase/client';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

interface PublicStats {
  athletes: number;
  totalKm: number;
  workouts: number;
  topResults: { name: string; timeSeconds: number; test: string }[];
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const whole = Math.floor(s);
  const frac = s - whole;
  const fracStr = frac > 0 ? frac.toFixed(2).slice(1).replace(/0+$/, '').replace(/\.$/, '') : '';
  return `${m}:${whole.toString().padStart(2, '0')}${fracStr}`;
}
function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function useGoogleLogin() {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/resolve`,
      },
    });
  };

  return { signIn, loading };
}

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const th = useTranslations('header');
  const [checking, setChecking] = useState(true);
  const { signIn, loading: signingIn } = useGoogleLogin();
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4338ff]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f0f0] text-black">
      {/* Hero Section */}
      <section className="flex flex-col">
        {/* Nav */}
        <nav className="relative flex items-center justify-between px-4 sm:px-8 lg:px-20 py-4 sm:py-6">
          <div className="flex items-center gap-2">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-10 w-10 sm:h-12 sm:w-12 object-contain mix-blend-multiply" />
            <div className="flex flex-col leading-none">
              <span className="text-sm sm:text-base font-black uppercase tracking-tight">{t('madregot')}</span>
              <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-gray-500">{t('after2km')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Link
              href="/academy-register"
              className="hidden sm:inline-flex items-center gap-1.5 border-2 border-[#4338ff] text-[#4338ff] hover:bg-[#4338ff] hover:text-white font-semibold px-4 py-2 sm:px-5 sm:py-2 rounded-lg transition-colors text-sm"
            >
              <GraduationCap className="h-4 w-4" /> Join the Academy
            </Link>
            <button
              onClick={signIn}
              disabled={signingIn}
              className="bg-[#4338ff] hover:bg-[#3730d4] text-white font-semibold px-4 py-2 sm:px-6 sm:py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
            >
              {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : tc('signIn')}
            </button>
            <button
              onClick={() => setShowAdminLogin(!showAdminLogin)}
              className="p-2 text-gray-400 hover:text-[#4338ff] transition-colors rounded-lg hover:bg-gray-200"
              title={th('adminLogin')}
            >
              <Shield className="h-5 w-5" />
            </button>
          </div>
        </nav>

        {/* Admin Login Dropdown */}
        {showAdminLogin && (
          <div className="absolute top-16 end-4 sm:end-8 lg:end-20 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-5 w-80">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="h-4 w-4 text-[#4338ff]" />
              <span className="text-sm font-bold text-gray-800">{th('adminLogin')}</span>
            </div>
            <form onSubmit={handleAdminLogin} className="space-y-3">
              <input
                type="email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4338ff]"
                placeholder="admin@madregot.club"
                required
              />
              <input
                type="password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4338ff]"
                placeholder={th('password')}
                required
              />
              {adminError && (
                <p className="text-xs text-red-500">{adminError}</p>
              )}
              <button
                type="submit"
                disabled={adminLoading}
                className="w-full bg-[#4338ff] hover:bg-[#3730d4] text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                {adminLoading ? tc('signingIn') : th('signInAsAdmin')}
              </button>
            </form>
          </div>
        )}

        {/* Mobile Hero Image */}
        <div className="lg:hidden px-4 sm:px-8 pt-2 pb-6">
          <div className="rounded-2xl overflow-hidden aspect-[16/9]">
            <img
              src="/images/hero-running.jpg"
              alt="Madregot runners"
              className="w-full h-full object-cover object-center"
            />
          </div>
        </div>

        {/* Hero Content */}
        <div className="flex-1 flex items-center px-4 sm:px-8 lg:px-20 py-8 lg:py-0 lg:min-h-[70vh]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-20 items-center w-full max-w-7xl mx-auto">
            {/* Text */}
            <div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-8xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff]">
                {t('redefining')}<br />
                {t('running')}<br />
                {t('culture')}
              </h1>
              <div className="w-12 sm:w-16 h-1.5 bg-[#4338ff] mt-6 sm:mt-8 mb-4 sm:mb-6"></div>
              <p className="text-lg sm:text-xl md:text-2xl text-gray-700 font-light leading-relaxed">
                {t('connectingRunners')}<br />
                {t('buildingCommunity')}
              </p>
              <Link
                href="/academy-register"
                className="inline-flex items-center gap-2 sm:gap-3 bg-[#4338ff] hover:bg-[#3730d4] text-white font-bold px-5 py-3 sm:px-8 sm:py-4 rounded-xl mt-8 sm:mt-10 text-sm sm:text-lg transition-colors"
              >
                {t('joinUs')}
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 rtl:rotate-180" />
              </Link>
            </div>

            {/* Visual (desktop only) */}
            <div className="relative hidden lg:block">
              <div className="aspect-[3/4] rounded-2xl overflow-hidden">
                <img
                  src="/images/hero-running.jpg"
                  alt="Madregot runners"
                  className="w-full h-full object-cover object-center"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live stats band + top-3 teaser (only when we have real data) */}
      {stats && (stats.athletes > 0 || stats.totalKm > 0 || stats.topResults.length > 0) && (
        <section className="px-4 sm:px-8 lg:px-20 pb-4">
          <div className="max-w-7xl mx-auto">
            {(stats.athletes > 0 || stats.totalKm > 0 || stats.workouts > 0) && (
              <div className="grid grid-cols-3 gap-3 sm:gap-6">
                <div className="bg-white rounded-2xl p-4 sm:p-6 text-center">
                  <Users className="h-6 w-6 text-[#4338ff] mx-auto mb-2" />
                  <div className="text-2xl sm:text-4xl font-black text-[#4338ff] tabular-nums">{fmtNum(stats.athletes)}</div>
                  <div className="text-[11px] sm:text-sm font-semibold text-gray-500 uppercase tracking-wide mt-1">Athletes</div>
                </div>
                <div className="bg-white rounded-2xl p-4 sm:p-6 text-center">
                  <Route className="h-6 w-6 text-[#4338ff] mx-auto mb-2" />
                  <div className="text-2xl sm:text-4xl font-black text-[#4338ff] tabular-nums">{fmtNum(stats.totalKm)}</div>
                  <div className="text-[11px] sm:text-sm font-semibold text-gray-500 uppercase tracking-wide mt-1">KM Run</div>
                </div>
                <div className="bg-white rounded-2xl p-4 sm:p-6 text-center">
                  <Activity className="h-6 w-6 text-[#4338ff] mx-auto mb-2" />
                  <div className="text-2xl sm:text-4xl font-black text-[#4338ff] tabular-nums">{fmtNum(stats.workouts)}</div>
                  <div className="text-[11px] sm:text-sm font-semibold text-gray-500 uppercase tracking-wide mt-1">Workouts</div>
                </div>
              </div>
            )}

            {stats.topResults.length > 0 && (
              <div className="bg-white rounded-2xl p-5 sm:p-8 mt-3 sm:mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="h-5 w-5 text-[#4338ff]" />
                  <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-black">
                    {stats.topResults[0].test} — Top 3
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {stats.topResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 bg-[#f0f0f0] rounded-xl p-3">
                      <Medal className={`h-6 w-6 shrink-0 ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : 'text-orange-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-gray-400">#{i + 1}</div>
                        <div className="text-sm font-bold text-black truncate" dir="auto">{r.name}</div>
                      </div>
                      <div className="text-lg font-black text-[#4338ff] tabular-nums">{fmtTime(r.timeSeconds)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Who We Are */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-5xl md:text-6xl lg:text-8xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff] mb-8">
            {t('whoWeAre')}<br />{t('weAre')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-12">
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-black mb-6">
                {t('fromTwoRunners')}
              </h3>
              <div className="w-16 h-1.5 bg-[#4338ff] mb-8"></div>
              <p className="text-lg text-gray-600 leading-relaxed mb-6">
                {t('foundedDescription1')}
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                {t('foundedDescription2')}
              </p>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden aspect-[16/9]">
                <img src="/images/team-race.jpg" alt="Madregot team running on track" className="w-full h-full object-cover" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl overflow-hidden aspect-[3/4]">
                  <img src="/images/team-group.jpg" alt="Madregot team at golden hour" className="w-full h-full object-cover" />
                </div>
                <div className="rounded-xl overflow-hidden aspect-[3/4]">
                  <img src="/images/runners-group.jpg" alt="Athlete checking watch" className="w-full h-full object-cover" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Journey Timeline */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20 bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-5xl md:text-7xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff] mb-16">
            {t('our')}<br />{t('journey')}
          </h2>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute top-8 inset-x-0 h-0.5 bg-[#4338ff] hidden sm:block"></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="relative pt-12">
                <div className="absolute top-6 start-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">{t('year2022')}</div>
                <div className="text-sm font-bold mt-1">{t('founded')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('foundedDesc')}</div>
              </div>
              <div className="relative pt-12">
                <div className="absolute top-6 start-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">{t('year2023')}</div>
                <div className="text-sm font-bold mt-1">{t('firstTeam')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('firstTeamDesc')}</div>
              </div>
              <div className="relative pt-12">
                <div className="absolute top-6 start-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">{t('year2025')}</div>
                <div className="text-sm font-bold mt-1">{t('historicValencia')}</div>
                <div className="text-sm text-gray-500 mt-2">{t('historicValenciaDesc')}</div>
              </div>
              <div className="relative pt-12">
                <div className="absolute top-6 start-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">{t('year2026')}</div>
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
          <h2 className="text-2xl sm:text-4xl md:text-5xl lg:text-7xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff] mb-6">
            {t('moreThanA')}<br />{t('runningTeam')}
          </h2>
          <p className="text-xl text-gray-600 mb-16 max-w-3xl">
            {t('supportSystem')}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-8">
            <div>
              <Trophy className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">{t('performance')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('professionalCoach')}</li>
                <li>{t('gymAccess')}</li>
                <li>{t('personalizedPrograms')}</li>
              </ul>
            </div>
            <div>
              <Heart className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">{t('recovery')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('physiotherapy')}</li>
                <li>{t('orthopedicCare')}</li>
                <li>{t('injuryPrevention')}</li>
              </ul>
            </div>
            <div>
              <Zap className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">{t('nutrition')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('sportsNutrition')}</li>
                <li>{t('energyProducts')}</li>
                <li>{t('recoverySupport')}</li>
              </ul>
            </div>
            <div>
              <Users className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">{t('community')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('trainingPartners')}</li>
                <li>{t('raceTravel')}</li>
                <li>{t('memberBenefits')}</li>
              </ul>
            </div>
            <div>
              <Camera className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">{t('content')}</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>{t('professionalPhotography')}</li>
                <li>{t('socialMedia')}</li>
                <li>{t('raceCoverage')}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20 bg-[#4338ff]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-6">
            {t('readyToRun')}
          </h2>
          <p className="text-xl text-white/80 mb-10">
            {t('joinCommunity')}
          </p>
          <button
            onClick={signIn}
            disabled={signingIn}
            className="inline-flex items-center gap-3 bg-white hover:bg-gray-100 text-[#4338ff] font-bold px-6 py-4 sm:px-10 sm:py-5 rounded-xl transition-all text-lg disabled:opacity-50"
          >
            {signingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : t('signInToStart')}
            <ArrowRight className="h-6 w-6 rtl:rotate-180" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 sm:px-8 lg:px-20 bg-black text-white">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-8 w-8 object-contain brightness-0 invert" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight">{t('madregot')}</span>
              <span className="text-xs font-medium tracking-wide text-gray-400">{t('after2km')}</span>
            </div>
          </div>
          <p className="text-gray-500 text-sm">
            {t('copyright')}
          </p>
        </div>
      </footer>
    </div>
  );
}
