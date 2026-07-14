'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { GraduationCap, Loader2, CheckCircle2, Watch } from 'lucide-react';

/**
 * Academy onboarding — reached from the approval email link. Unlike the normal
 * invite flow, this goes STRAIGHT to Garmin auth (no pace-group step): the coach
 * already approved the applicant and assigns their group later.
 */
export default function AcademyJoinPage() {
  const params = useParams();
  const token = params.token as string;

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
      throw new Error(err.error || 'Failed to save connection');
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
      if (!res.ok) throw new Error(data.error || 'Failed to connect to Garmin');
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
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      await saveConnection(data.auth);
    } catch (err: any) {
      setError(err.message);
      setStep('mfa');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="bg-primary-600/20 w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-primary-500/20 mx-auto mb-3">
            <GraduationCap className="h-7 w-7 text-primary-300" />
          </div>
          <h1 className="text-xl font-bold text-white">Connect Your Garmin</h1>
          <p className="text-slate-400 mt-2 text-sm">
            You&apos;re approved for the academy. Connect your watch so your coach can send you workouts.
          </p>
        </div>

        {step === 'connecting' && (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 text-primary-500 animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Connecting to Garmin…</p>
          </div>
        )}

        {step === 'garmin' && (
          <form onSubmit={submitGarmin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Garmin email</label>
              <input type="email" value={garminEmail} onChange={e => setGarminEmail(e.target.value)} required
                placeholder="your@email.com"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Garmin password</label>
              <input type="password" value={garminPassword} onChange={e => setGarminPassword(e.target.value)} required
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-lg px-4 py-3 transition-colors">
              <Watch className="h-5 w-5" /> Connect Garmin
            </button>
            <p className="text-xs text-slate-500 text-center">
              We use your Garmin login only to link your account. Credentials aren&apos;t stored.
            </p>
          </form>
        )}

        {step === 'mfa' && (
          <form onSubmit={submitMfa} className="space-y-4">
            <p className="text-sm text-slate-300">Enter the verification code Garmin sent you.</p>
            <input type="text" inputMode="numeric" value={mfaCode} onChange={e => setMfaCode(e.target.value)} required
              placeholder="123456"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-base text-white text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-primary-500" />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" className="w-full bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-lg px-4 py-3 transition-colors">Verify</button>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center py-6">
            <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-white">You&apos;re connected!</h2>
            <p className="text-slate-400 text-sm mt-2">
              Your Garmin is linked. Your coach will push academy workouts to your watch.
            </p>
            <a href="/dashboard" className="mt-6 inline-block bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-lg px-5 py-3 transition-colors">
              Open Madregot →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
