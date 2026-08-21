'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Shield } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const t = useTranslations('adminLogin');
  const th = useTranslations('header');
  const tc = useTranslations('common');
  const ta = useTranslations('athletes');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t('loginFailed'));
      }

      localStorage.setItem('coach_email', data.email);
      localStorage.setItem('admin_session', 'true');
      localStorage.removeItem('athlete_id');
      localStorage.removeItem('athlete_name');
      localStorage.removeItem('athlete_email');
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-6">
          <Shield className="h-6 w-6 text-primary-400" />
          <h1 className="text-xl font-bold text-white">{th('adminLogin')}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">{ta('email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="admin@madregot.club"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">{th('password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-500 text-white font-medium px-4 py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            {loading ? tc('signingIn') : th('signInAsAdmin')}
          </button>
        </form>

        <p className="text-xs text-slate-500 text-center mt-4">
          {t('footnote')}
        </p>
      </div>
    </div>
  );
}
