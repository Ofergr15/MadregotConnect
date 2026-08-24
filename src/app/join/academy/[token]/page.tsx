'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { GraduationCap, CheckCircle2, Watch } from 'lucide-react';
import { Card, Button, LoadingBlock } from '@/components/ui';
import { cn } from '@/lib/utils';

// Local input primitive — see src/app/admin/login/page.tsx for why this is
// duplicated locally instead of promoted to the shared ui/index.tsx.
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

/**
 * Academy onboarding — reached from the approval email link. Unlike the normal
 * invite flow, this goes STRAIGHT to Garmin auth (no pace-group step): the coach
 * already approved the applicant and assigns their group later.
 */
export default function AcademyJoinPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const t = useTranslations('joinAcademy');
  const to = useTranslations('onboarding');

  const [step, setStep] = useState<'garmin' | 'mfa' | 'connecting' | 'done'>('garmin');
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSessionId, setMfaSessionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveConnection = async (auth: string) => {
    const res = await fetch('/api/athletes/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: token, garminAuth: auth }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || to('failedToSaveConnection'));
    }
    const data = await res.json();
    if (data.athlete) {
      localStorage.setItem('athlete_id', data.athlete.id);
      localStorage.setItem('athlete_name', data.athlete.name || '');
      localStorage.setItem('athlete_email', data.athlete.email || '');
      if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
    }
    setStep('done');
  };

  const submitGarmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('connecting');
    setError(null);
    try {
      const res = await fetch('/api/garmin/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail, password: garminPassword }),
      });
      const data = await res.json();
      if (data.mfaRequired) { setMfaSessionId(data.sessionId); setStep('mfa'); return; }
      if (!res.ok) throw new Error(data.message || data.error || to('failedToConnectGarmin'));
      await saveConnection(data.auth);
    } catch (err: any) {
      setError(err.message);
      setStep('garmin');
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('connecting');
    setError(null);
    try {
      const res = await fetch('/api/garmin/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail, mfaCode, sessionId: mfaSessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || to('verificationFailed'));
      await saveConnection(data.auth);
    } catch (err: any) {
      setError(err.message);
      setStep('mfa');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="bg-primary-600/20 w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-primary-500/20 mx-auto mb-3">
            <GraduationCap className="h-7 w-7 text-primary-300" />
          </div>
          <h1 className="text-xl font-bold text-white">{t('title')}</h1>
          <p className="text-slate-400 mt-2 text-sm">
            {t('description')}
          </p>
        </div>

        {step === 'connecting' && (
          <div className="text-center py-8">
            <LoadingBlock size={32} className="py-0 mb-3" />
            <p className="text-slate-400 text-sm">{to('connectingGarmin')}</p>
          </div>
        )}

        {step === 'garmin' && (
          <form onSubmit={submitGarmin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{t('garminEmailLabel')}</label>
              <Input type="email" value={garminEmail} onChange={e => setGarminEmail(e.target.value)} required
                placeholder="your@email.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{t('garminPasswordLabel')}</label>
              <Input type="password" value={garminPassword} onChange={e => setGarminPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full">
              <Watch className="h-5 w-5" /> {t('connectButton')}
            </Button>
            <p className="text-xs text-slate-500 text-center">
              {t('privacyNote')}
            </p>
          </form>
        )}

        {step === 'mfa' && (
          <form onSubmit={submitMfa} className="space-y-4">
            <p className="text-sm text-slate-300">{t('mfaPrompt')}</p>
            <Input type="text" inputMode="numeric" value={mfaCode} onChange={e => setMfaCode(e.target.value)} required
              placeholder="123456" className="text-center tracking-widest" />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full">{t('verifyButton')}</Button>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center py-6">
            <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-white">{t('connectedTitle')}</h2>
            <p className="text-slate-400 text-sm mt-2">
              {t('connectedDesc')}
            </p>
            <Button variant="primary" className="mt-6" onClick={() => router.push('/dashboard')}>
              {t('openApp')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
