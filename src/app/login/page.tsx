'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ArrowLeft, ShieldAlert } from 'lucide-react';

const ADMIN_EMAILS = ['grosfeldofer@gmail.com'];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!ADMIN_EMAILS.includes(email.toLowerCase())) {
      setError('Access denied. Only authorized coaches can sign in.');
      setLoading(false);
      return;
    }

    localStorage.setItem('coach_email', email.toLowerCase());
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <button
        onClick={() => router.push('/')}
        className="absolute top-6 left-6 flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </button>

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
          <p className="text-slate-400 mt-3">
            Sign in to your coaching dashboard
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Coach Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
              autoFocus
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
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                Sign In
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-700">
          <p className="text-xs text-slate-500 text-center">
            Only authorized coaches can access the dashboard. Contact admin to get access.
          </p>
        </div>
      </div>
    </div>
  );
}
