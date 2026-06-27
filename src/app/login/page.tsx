'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2, ShieldAlert } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';

const ADMIN_EMAILS = ['grosfeldofer@gmail.com'];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
      setGoogleLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const lowerEmail = email.toLowerCase();

    // Coach login
    if (ADMIN_EMAILS.includes(lowerEmail)) {
      localStorage.setItem('coach_email', lowerEmail);
      localStorage.removeItem('athlete_id');
      localStorage.removeItem('athlete_name');
      localStorage.removeItem('athlete_email');
      localStorage.removeItem('athlete_group_id');
      router.push('/dashboard');
      return;
    }

    // Try athlete login
    try {
      const res = await fetch('/api/auth/athlete-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lowerEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('athlete_id', data.athlete.id);
      localStorage.setItem('athlete_name', data.athlete.name);
      localStorage.setItem('athlete_email', data.athlete.email);
      if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
      localStorage.removeItem('coach_email');

      router.push('/dashboard/program');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="bg-primary-600/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 40 40" className="h-9 w-9 text-primary-400" fill="currentColor">
              <rect x="8" y="30" width="24" height="4"/>
              <rect x="12" y="24" width="20" height="4"/>
              <rect x="16" y="18" width="16" height="4"/>
              <rect x="20" y="12" width="12" height="4"/>
              <rect x="24" y="6" width="8" height="4"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-tight">MADREGOT</h1>
          <p className="text-primary-400 text-sm font-medium mt-1 uppercase tracking-wide">
            After 2KM Running Club
          </p>
        </div>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="w-full bg-white hover:bg-gray-100 text-gray-800 font-medium px-4 py-3 rounded-lg transition-colors flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {googleLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          )}
          Continue with Google
        </button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 bg-slate-800 text-slate-500">or sign in with email</span>
          </div>
        </div>

        {/* Email login */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white text-base placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-red-400 text-sm">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            Sign In
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-700">
          <p className="text-xs text-slate-500 text-center">
            Athletes: use the email you registered with when joining your team
          </p>
        </div>
      </div>
    </div>
  );
}
