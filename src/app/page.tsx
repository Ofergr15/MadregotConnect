'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Trophy, Users, Zap, Heart, Camera, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';

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
  const [checking, setChecking] = useState(true);
  const { signIn, loading: signingIn } = useGoogleLogin();

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
        <nav className="flex items-center justify-between px-4 sm:px-8 lg:px-20 py-4 sm:py-6">
          <div className="flex items-center gap-2">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-10 w-10 sm:h-12 sm:w-12 object-contain mix-blend-multiply" />
            <div className="flex flex-col leading-none">
              <span className="text-sm sm:text-base font-black uppercase tracking-tight">Madregot</span>
              <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-gray-500">After 2KM Running Club</span>
            </div>
          </div>
          <button
            onClick={signIn}
            disabled={signingIn}
            className="bg-[#4338ff] hover:bg-[#3730d4] text-white font-semibold px-4 py-2 sm:px-6 sm:py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
          >
            {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign In'}
          </button>
        </nav>

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
            {/* Left - Text */}
            <div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-8xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff]">
                Redefining<br />
                Running<br />
                Culture
              </h1>
              <div className="w-12 sm:w-16 h-1.5 bg-[#4338ff] mt-6 sm:mt-8 mb-4 sm:mb-6"></div>
              <p className="text-lg sm:text-xl md:text-2xl text-gray-700 font-light leading-relaxed">
                Connecting Runners.<br />
                Building Community.
              </p>
              <div
                className="inline-flex items-center gap-2 sm:gap-3 bg-gray-300 text-gray-500 font-bold px-5 py-3 sm:px-8 sm:py-4 rounded-xl mt-8 sm:mt-10 text-sm sm:text-lg cursor-not-allowed"
              >
                Join Us
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="text-[10px] sm:text-xs font-medium uppercase tracking-wide ml-1">Coming Soon</span>
              </div>
            </div>

            {/* Right - Visual (desktop only) */}
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

      {/* Who We Are */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-5xl md:text-6xl lg:text-8xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff] mb-8">
            Who<br />We Are
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-12">
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-black mb-6">
                From Two Runners to Israel&apos;s Leading Running Community
              </h3>
              <div className="w-16 h-1.5 bg-[#4338ff] mb-8"></div>
              <p className="text-lg text-gray-600 leading-relaxed mb-6">
                Founded in 2022 by two friends looking for training partners, Madregot has grown into Israel&apos;s leading running community.
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                Today, Madregot brings together Israel&apos;s fastest amateur marathoners, elite athletes, and committed runners, creating a culture where performance, community, and ambition push each other forward.
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
            Our<br />Journey
          </h2>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute top-8 left-0 right-0 h-0.5 bg-[#4338ff] hidden sm:block"></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="relative pt-12">
                <div className="absolute top-6 left-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">2022</div>
                <div className="text-sm font-bold mt-1">Founded</div>
                <div className="text-sm text-gray-500 mt-2">Two runners. One shared goal.</div>
              </div>
              <div className="relative pt-12">
                <div className="absolute top-6 left-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">2023</div>
                <div className="text-sm font-bold mt-1">First Team</div>
                <div className="text-sm text-gray-500 mt-2">First Valencia Marathon as a team.</div>
              </div>
              <div className="relative pt-12">
                <div className="absolute top-6 left-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">2025</div>
                <div className="text-sm font-bold mt-1">Historic Valencia</div>
                <div className="text-sm text-gray-500 mt-2">Fastest amateur marathon team in Israeli history.</div>
              </div>
              <div className="relative pt-12">
                <div className="absolute top-6 left-0 w-3 h-3 rounded-full bg-[#4338ff]"></div>
                <div className="text-2xl font-black">2026</div>
                <div className="text-sm font-bold mt-1">Next Level</div>
                <div className="text-sm text-gray-500 mt-2">Academy launch. Elite coaching. National expansion.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* More Than a Running Team */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl sm:text-4xl md:text-5xl lg:text-7xl font-black uppercase leading-[0.9] tracking-tight text-[#4338ff] mb-6">
            More Than a<br />Running Team
          </h2>
          <p className="text-xl text-gray-600 mb-16 max-w-3xl">
            A complete support system designed to help every athlete perform at their highest level.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-8">
            <div>
              <Trophy className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">Performance</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>Professional Coach</li>
                <li>Gym Access</li>
                <li>Personalized Programs</li>
              </ul>
            </div>
            <div>
              <Heart className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">Recovery</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>Physiotherapy</li>
                <li>Orthopedic Care</li>
                <li>Injury Prevention</li>
              </ul>
            </div>
            <div>
              <Zap className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">Nutrition</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>Sports Nutrition</li>
                <li>Energy Products</li>
                <li>Recovery Support</li>
              </ul>
            </div>
            <div>
              <Users className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">Community</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>Training Partners</li>
                <li>Race Travel</li>
                <li>Member Benefits</li>
              </ul>
            </div>
            <div>
              <Camera className="h-10 w-10 text-[#4338ff] mb-4 stroke-[1.5]" />
              <h3 className="text-lg font-bold mb-2">Content</h3>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>Professional Photography</li>
                <li>Social Media</li>
                <li>Race Coverage</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 lg:py-32 px-4 sm:px-8 lg:px-20 bg-[#4338ff]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl md:text-6xl font-black uppercase tracking-tight text-white mb-6">
            Ready to Run?
          </h2>
          <p className="text-xl text-white/80 mb-10">
            Join Israel&apos;s fastest growing running community.
          </p>
          <button
            onClick={signIn}
            disabled={signingIn}
            className="inline-flex items-center gap-3 bg-white hover:bg-gray-100 text-[#4338ff] font-bold px-6 py-4 sm:px-10 sm:py-5 rounded-xl transition-all text-lg disabled:opacity-50"
          >
            {signingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Sign In to Get Started'}
            <ArrowRight className="h-6 w-6" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 sm:px-8 lg:px-20 bg-black text-white">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-8 w-8 object-contain brightness-0 invert" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight">Madregot</span>
              <span className="text-xs font-medium tracking-wide text-gray-400">After 2KM Running Club</span>
            </div>
          </div>
          <p className="text-gray-500 text-sm">
            © 2026 Madregot After 2KM Running Club. EST. 2022
          </p>
        </div>
      </footer>
    </div>
  );
}
