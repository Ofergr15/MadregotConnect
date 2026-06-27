'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Watch, Users, Calendar, Zap, Target, ArrowRight, ChevronRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

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

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        @keyframes gradient-shift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        @keyframes aurora {
          0%, 100% {
            opacity: 0.3;
            transform: translate(0, 0) scale(1);
          }
          33% {
            opacity: 0.5;
            transform: translate(10%, -5%) scale(1.1);
          }
          66% {
            opacity: 0.4;
            transform: translate(-5%, 10%) scale(0.95);
          }
        }

        @keyframes glow-pulse {
          0%, 100% {
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.3), 0 0 40px rgba(139, 92, 246, 0.2);
          }
          50% {
            box-shadow: 0 0 30px rgba(139, 92, 246, 0.5), 0 0 60px rgba(139, 92, 246, 0.3);
          }
        }

        @keyframes streak {
          0% {
            transform: translateX(-100%) translateY(-100%) rotate(-15deg);
            opacity: 0;
          }
          50% {
            opacity: 0.3;
          }
          100% {
            transform: translateX(100vw) translateY(100vh) rotate(-15deg);
            opacity: 0;
          }
        }

        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient-shift 8s ease infinite;
        }

        .animate-aurora {
          animation: aurora 12s ease-in-out infinite;
        }

        .animate-glow-pulse {
          animation: glow-pulse 3s ease-in-out infinite;
        }

        .streak-line {
          animation: streak 10s linear infinite;
        }

        .bg-dot-pattern {
          background-image: radial-gradient(circle, rgba(139, 92, 246, 0.15) 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}</style>

      <div className="min-h-screen bg-slate-950 text-white relative overflow-hidden">
        {/* Animated Background Layers */}
        <div className="fixed inset-0 pointer-events-none">
          {/* Base gradient */}
          <div
            className="absolute inset-0 animate-gradient"
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 25%, #312e81 50%, #1e1b4b 75%, #0f172a 100%)',
            }}
          />

          {/* Aurora effect - multiple layers */}
          <div
            className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full blur-[120px] animate-aurora"
            style={{
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.4) 0%, rgba(99, 102, 241, 0.2) 50%, transparent 100%)',
            }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 w-[800px] h-[800px] rounded-full blur-[140px] animate-aurora"
            style={{
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, rgba(139, 92, 246, 0.15) 50%, transparent 100%)',
              animationDelay: '3s',
              animationDuration: '15s',
            }}
          />

          {/* Dot pattern overlay */}
          <div className="absolute inset-0 bg-dot-pattern opacity-30" />

          {/* Diagonal streaks */}
          <div
            className="absolute top-0 left-0 w-[2px] h-[400px] streak-line"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(139, 92, 246, 0.5), transparent)',
              animationDelay: '0s',
            }}
          />
          <div
            className="absolute top-0 left-0 w-[2px] h-[300px] streak-line"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(99, 102, 241, 0.4), transparent)',
              animationDelay: '4s',
            }}
          />

          {/* Vignette effect */}
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at center, transparent 0%, rgba(15, 23, 42, 0.4) 100%)',
            }}
          />
        </div>

        {/* Hero Section */}
        <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8">
          {/* Spotlight effect */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[160px] opacity-40"
            style={{
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.6) 0%, rgba(99, 102, 241, 0.3) 40%, transparent 70%)',
            }}
          />

          <div className="max-w-6xl mx-auto text-center relative z-10">
            {/* Main Headline - Massive & Bold */}
            <h1 className="text-7xl sm:text-8xl md:text-9xl lg:text-[12rem] font-black mb-6 uppercase tracking-tighter leading-none">
              <span className="block bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-slate-300">
                MADRE
              </span>
              <span className="block bg-clip-text text-transparent bg-gradient-to-r from-primary-400 via-primary-500 to-violet-500 animate-gradient">
                GOT
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-sm sm:text-base md:text-lg font-bold mb-8 uppercase tracking-[0.4em] text-primary-400/90">
              After 2KM Running Club
            </p>

            {/* Tagline */}
            <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light text-slate-300 mb-16 max-w-4xl mx-auto leading-tight">
              Marathon training,<br className="sm:hidden" /> delivered to your wrist
            </p>

            {/* CTA Button */}
            <Link
              href="/login"
              className="inline-flex items-center gap-3 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white font-bold px-12 py-5 rounded-2xl transition-all hover:scale-105 animate-glow-pulse text-xl shadow-2xl"
            >
              Sign In
              <ArrowRight className="h-6 w-6" />
            </Link>
          </div>
        </section>

        {/* Features Section */}
        <section className="relative py-32 px-4 sm:px-6 lg:px-8 border-t border-slate-800/50">
          <div className="max-w-7xl mx-auto relative z-10">
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-black text-center mb-20 uppercase tracking-tight">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                Built for Runners
              </span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Feature 1 */}
              <div className="group relative bg-slate-900/50 backdrop-blur-sm border border-slate-800 hover:border-primary-500/50 rounded-2xl p-8 transition-all hover:scale-105 hover:bg-slate-900/80">
                <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="bg-gradient-to-br from-primary-600 to-primary-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-primary-500/30">
                    <Watch className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Workouts on Watch</h3>
                  <p className="text-slate-400 leading-relaxed">
                    Coach pushes training directly to your Garmin. No manual entry needed.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="group relative bg-slate-900/50 backdrop-blur-sm border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-8 transition-all hover:scale-105 hover:bg-slate-900/80">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="bg-gradient-to-br from-emerald-600 to-emerald-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/30">
                    <Users className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Pace Groups</h3>
                  <p className="text-slate-400 leading-relaxed">
                    Train with athletes at your level. SUB 2:30 to SUB 2:45 half-marathon targets.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="group relative bg-slate-900/50 backdrop-blur-sm border border-slate-800 hover:border-primary-500/50 rounded-2xl p-8 transition-all hover:scale-105 hover:bg-slate-900/80">
                <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="bg-gradient-to-br from-primary-600 to-primary-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-primary-500/30">
                    <Calendar className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Weekly Programs</h3>
                  <p className="text-slate-400 leading-relaxed">
                    Structured training plans that progress with your fitness level.
                  </p>
                </div>
              </div>

              {/* Feature 4 */}
              <div className="group relative bg-slate-900/50 backdrop-blur-sm border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-8 transition-all hover:scale-105 hover:bg-slate-900/80">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="bg-gradient-to-br from-emerald-600 to-emerald-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/30">
                    <Zap className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Fully Automated</h3>
                  <p className="text-slate-400 leading-relaxed">
                    Connect once, receive workouts forever. Zero setup after joining.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="relative py-32 px-4 sm:px-6 lg:px-8 bg-slate-950/70 border-y border-slate-800/50">
          <div className="max-w-6xl mx-auto relative z-10">
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-black text-center mb-24 uppercase tracking-tight">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                How It Works
              </span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16">
              {/* Step 1 */}
              <div className="relative text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-primary-600 to-primary-500 text-white text-3xl font-black mb-8 shadow-xl shadow-primary-500/40">
                  1
                </div>
                <h3 className="text-2xl font-bold mb-4">Join</h3>
                <p className="text-slate-400 text-lg leading-relaxed">
                  Choose the half-marathon target that matches your goals
                </p>
                {/* Connector line */}
                <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-primary-500 to-transparent" />
              </div>

              {/* Step 2 */}
              <div className="relative text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-600 to-emerald-500 text-white text-3xl font-black mb-8 shadow-xl shadow-emerald-500/40">
                  2
                </div>
                <h3 className="text-2xl font-bold mb-4">Connect Garmin</h3>
                <p className="text-slate-400 text-lg leading-relaxed">
                  One-time setup to link your Garmin watch
                </p>
                {/* Connector line */}
                <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-emerald-500 to-transparent" />
              </div>

              {/* Step 3 */}
              <div className="relative text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-primary-600 to-primary-500 text-white text-3xl font-black mb-8 shadow-xl shadow-primary-500/40">
                  3
                </div>
                <h3 className="text-2xl font-bold mb-4">Train</h3>
                <p className="text-slate-400 text-lg leading-relaxed">
                  Workouts appear on your watch. Just run.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Bar */}
        <section className="relative py-32 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto relative z-10">
            <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-3xl p-12 sm:p-16 overflow-hidden">
              {/* Glow effect */}
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.3), transparent 70%)',
                }}
              />

              <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-12 sm:divide-x divide-slate-700">
                <div className="text-center">
                  <div className="text-6xl lg:text-7xl font-black bg-clip-text text-transparent bg-gradient-to-br from-primary-400 to-primary-600 mb-3">
                    3
                  </div>
                  <div className="text-slate-400 uppercase tracking-wider text-base font-semibold">
                    Pace Groups
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-6xl lg:text-7xl font-black bg-clip-text text-transparent bg-gradient-to-br from-emerald-400 to-emerald-600 mb-3">
                    5
                  </div>
                  <div className="text-slate-400 uppercase tracking-wider text-base font-semibold">
                    Workouts / Week
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-6xl lg:text-7xl font-black bg-clip-text text-transparent bg-gradient-to-br from-primary-400 to-primary-600 mb-3">
                    100%
                  </div>
                  <div className="text-slate-400 uppercase tracking-wider text-base font-semibold">
                    Automated
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative py-32 px-4 sm:px-6 lg:px-8 bg-slate-950/70 border-t border-slate-800/50">
          <div className="max-w-5xl mx-auto text-center relative z-10">
            <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-8 uppercase tracking-tight leading-tight">
              <span className="block bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                Ready to Train
              </span>
              <span className="block bg-clip-text text-transparent bg-gradient-to-r from-primary-400 via-primary-500 to-violet-500">
                Like a Pro?
              </span>
            </h2>
            <p className="text-xl sm:text-2xl text-slate-300 mb-12 leading-relaxed max-w-3xl mx-auto">
              Join the team and get coached workouts delivered to your wrist.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-4 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white font-bold px-14 py-6 rounded-2xl transition-all hover:scale-105 animate-glow-pulse text-xl shadow-2xl"
            >
              Sign In to Get Started
              <ArrowRight className="h-7 w-7" />
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="relative py-12 px-4 sm:px-6 lg:px-8 border-t border-slate-800/50">
          <div className="max-w-7xl mx-auto text-center relative z-10">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="bg-gradient-to-br from-primary-600 to-primary-500 w-8 h-8 rounded-lg flex items-center justify-center">
                <Target className="h-5 w-5 text-white" />
              </div>
              <span className="text-2xl font-black uppercase tracking-tight">MADREGOT</span>
              <span className="text-slate-700">•</span>
              <span className="text-primary-400 text-sm font-bold uppercase tracking-wider">After 2KM</span>
            </div>
            <p className="text-slate-600 text-sm">
              © 2026 MADREGOT. Marathon training, perfected.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
