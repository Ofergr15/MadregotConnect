'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Shield } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';

// Local input primitive (kept local to this screen rather than promoted to
// the shared ui/index.tsx) — rounded-2xl, min-h-[44px], one consistent focus
// ring, replacing the copy-pasted `bg-slate-700 border ... rounded-lg` string
// duplicated across the auth/onboarding screens.
function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-2xl px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500',
        className
      )}
      {...rest}
    />
  );
}

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
        throw new Error(data.message || data.error || t('loginFailed'));
      }

      // Adopt the real Supabase session the route just minted, so bearer-gated
      // routes (/api/plans, POST /api/program-weeks) work from this login too.
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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-6">
          <Shield className="h-6 w-6 text-primary-400" />
          <h1 className="text-xl font-bold text-white">{th('adminLogin')}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">{ta('email')}</label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@madregot.club"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">{th('password')}</label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            {loading ? tc('signingIn') : th('signInAsAdmin')}
          </Button>
        </form>

        <p className="text-xs text-slate-500 text-center mt-4">
          {t('footnote')}
        </p>
      </Card>
    </div>
  );
}
