'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';

export default function AuthResolvePage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabase();

    // Listen for auth state change (handles token from URL fragment)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          await resolveRole(session.user);
          subscription.unsubscribe();
        }
      }
    );

    // Also check if session already exists
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        resolveRole(session.user);
        subscription.unsubscribe();
      }
    });

    // Timeout fallback
    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      router.replace('/');
    }, 10000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function resolveRole(user: any) {
    const email = user.email?.toLowerCase();

    if (!email) {
      router.replace('/');
      return;
    }

    const res = await fetch('/api/auth/resolve-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: user.user_metadata?.full_name || '' }),
    });

    const data = await res.json();

    if (data.role === 'coach' || data.role === 'admin') {
      localStorage.setItem('coach_email', email);
      localStorage.removeItem('athlete_id');
      localStorage.removeItem('athlete_name');
      localStorage.removeItem('athlete_email');
      localStorage.removeItem('athlete_group_id');
      router.replace('/dashboard');
    } else if (data.role === 'runner' && data.athlete) {
      if (data.needsOnboarding) {
        router.replace(`/join/onboard?email=${encodeURIComponent(email)}`);
        return;
      }
      localStorage.setItem('athlete_id', data.athlete.id);
      localStorage.setItem('athlete_name', data.athlete.name || '');
      localStorage.setItem('athlete_email', data.athlete.email || email);
      if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
      localStorage.removeItem('coach_email');
      router.replace('/dashboard/program');
    } else {
      // New user — redirect to onboard page
      router.replace(`/join/onboard?email=${encodeURIComponent(email)}&name=${encodeURIComponent(user.user_metadata?.full_name || '')}`);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
        <p className="text-slate-400 text-sm">Signing you in...</p>
      </div>
    </div>
  );
}
