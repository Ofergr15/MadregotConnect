'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Watch, Users, Calendar, Zap, Target, ArrowRight } from 'lucide-react';
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] bg-primary-500/5 rounded-full blur-[80px] pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative">
          {/* Logo */}
          <div className="mb-10">
            <div className="bg-slate-800/80 backdrop-blur-sm w-24 h-24 rounded-3xl flex items-center justify-center mx-auto border border-slate-700/50 shadow-2xl shadow-primary-600/10">
              <svg viewBox="0 0 40 40" className="h-14 w-14 text-primary-400" fill="currentColor">
                <rect x="8" y="30" width="24" height="4"/>
                <rect x="12" y="24" width="20" height="4"/>
                <rect x="16" y="18" width="16" height="4"/>
                <rect x="20" y="12" width="12" height="4"/>
                <rect x="24" y="6" width="8" height="4"/>
              </svg>
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-7xl sm:text-8xl lg:text-9xl font-black mb-4 uppercase tracking-tighter">
            <span className="text-white">MADRE</span><span className="text-primary-400">GOT</span>
          </h1>
          <p className="text-primary-400/80 text-base sm:text-lg font-semibold mb-10 uppercase tracking-[0.3em]">
            After 2KM Running Club
          </p>

          <p className="text-xl sm:text-2xl lg:text-3xl font-light text-slate-400 mb-14 max-w-2xl mx-auto">
            Marathon training, delivered to your wrist
          </p>

          {/* CTA */}
          <Link
            href="/login"
            className="inline-flex items-center gap-3 bg-primary-600 hover:bg-primary-500 text-white font-semibold px-10 py-4 rounded-xl transition-all hover:scale-105 shadow-xl shadow-primary-600/25 text-lg"
          >
            Sign In
            <ArrowRight className="h-5 w-5" />
          </Link>

          {/* Subtle scroll hint */}
          <div className="mt-20">
            <div className="flex flex-col items-center gap-2 text-slate-600">
              <span className="text-xs uppercase tracking-widest">Scroll</span>
              <div className="w-px h-8 bg-gradient-to-b from-slate-600 to-transparent"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16 uppercase tracking-tight">
            Training That Adapts to You
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-primary-500/50 transition-colors">
              <div className="bg-primary-600/20 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Watch className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">Workouts on Your Watch</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Coach pushes training directly to your Garmin. No manual entry needed.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-green-500/50 transition-colors">
              <div className="bg-green-500/20 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Target className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">Pace-Matched Groups</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Half-marathon targets from SUB 2:30 to SUB 2:45. Train at your level.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-primary-500/50 transition-colors">
              <div className="bg-primary-600/20 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Calendar className="h-6 w-6 text-primary-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">Weekly Programs</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Structured training and nutrition plans that progress with your fitness.
              </p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-green-500/50 transition-colors">
              <div className="bg-green-500/20 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Zap className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">Fully Automated</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Connect once, receive workouts forever. Zero setup after joining.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8 bg-slate-950/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16 uppercase tracking-tight">
            How It Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <div className="text-center">
              <div className="bg-primary-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold shadow-lg shadow-primary-600/30">
                1
              </div>
              <h3 className="text-lg font-bold mb-3">Join Your Pace Group</h3>
              <p className="text-slate-400 leading-relaxed">
                Choose the half-marathon target that matches your goals
              </p>
            </div>

            <div className="text-center">
              <div className="bg-green-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold shadow-lg shadow-green-500/30">
                2
              </div>
              <h3 className="text-lg font-bold mb-3">Connect Garmin</h3>
              <p className="text-slate-400 leading-relaxed">
                One-time setup to link your Garmin watch
              </p>
            </div>

            <div className="text-center">
              <div className="bg-primary-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold shadow-lg shadow-primary-600/30">
                3
              </div>
              <h3 className="text-lg font-bold mb-3">Start Training</h3>
              <p className="text-slate-400 leading-relaxed">
                Workouts appear on your watch. Just run.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-10 sm:p-12">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:divide-x divide-slate-700">
              <div className="text-center">
                <div className="text-4xl lg:text-5xl font-bold text-primary-400 mb-2">3</div>
                <div className="text-slate-400 uppercase tracking-wide text-sm">Pace Groups</div>
              </div>
              <div className="text-center">
                <div className="text-4xl lg:text-5xl font-bold text-green-400 mb-2">5</div>
                <div className="text-slate-400 uppercase tracking-wide text-sm">Workouts / Week</div>
              </div>
              <div className="text-center">
                <div className="text-4xl lg:text-5xl font-bold text-primary-400 mb-2">100%</div>
                <div className="text-slate-400 uppercase tracking-wide text-sm">Automated</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8 bg-slate-950/50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 uppercase tracking-tight">
            Ready to Train Smarter?
          </h2>
          <p className="text-xl text-slate-300 mb-10 leading-relaxed">
            Join the team and get coached workouts delivered to your wrist.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold px-10 py-5 rounded-xl transition-all hover:scale-105 shadow-lg shadow-primary-600/30 text-lg"
          >
            Sign In to Get Started
            <ArrowRight className="h-6 w-6" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 sm:px-6 lg:px-8 border-t border-slate-800">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <svg viewBox="0 0 40 40" className="h-5 w-5 text-primary-500" fill="currentColor">
              <rect x="8" y="30" width="24" height="4"/>
              <rect x="12" y="24" width="20" height="4"/>
              <rect x="16" y="18" width="16" height="4"/>
              <rect x="20" y="12" width="12" height="4"/>
              <rect x="24" y="6" width="8" height="4"/>
            </svg>
            <span className="text-lg font-bold uppercase tracking-tight">MADREGOT</span>
            <span className="text-slate-600">•</span>
            <span className="text-primary-400 text-sm font-medium uppercase tracking-wide">After 2KM</span>
          </div>
          <p className="text-slate-600 text-sm">
            © 2026 MADREGOT. Marathon training, perfected.
          </p>
        </div>
      </footer>
    </div>
  );
}
