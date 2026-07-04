'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Users, Eye, EyeOff } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';

interface Group {
  id: string;
  name: string;
  paceOffsetSeconds: number;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

export default function OnboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    }>
      <OnboardContent />
    </Suspense>
  );
}

function OnboardContent() {
  const t = useTranslations('onboarding');
  const searchParams = useSearchParams();
  const skipGroup = searchParams.get('skipGroup') === '1';
  const skipGarmin = searchParams.get('skipGarmin') === '1';
  const [name, setName] = useState(searchParams.get('name') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [garminEmail, setGarminEmail] = useState(searchParams.get('email') || '');
  const [garminPassword, setGarminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSessionId, setMfaSessionId] = useState('');
  const [skippedGarmin, setSkippedGarmin] = useState(false);
  const [step, setStep] = useState<'info' | 'garmin' | 'mfa' | 'connecting' | 'done'>('info');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skipGroup) {
      fetch('/api/groups')
        .then(res => res.json())
        .then(data => {
          const fetchedGroups = data.groups || [];
          setGroups(fetchedGroups);
          if (fetchedGroups.length === 1) {
            setSelectedGroup(fetchedGroups[0].id);
          }
        })
        .catch(() => {});
    }
  }, [skipGroup]);

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!skipGroup && groups.length > 0 && !selectedGroup) {
      setError('Please select a pace group');
      return;
    }
    setError(null);
    if (!garminEmail) setGarminEmail(email);
    if (skipGarmin) {
      handleSaveGroupOnly();
    } else {
      setStep('garmin');
    }
  };

  const handleSaveGroupOnly = async () => {
    setStep('connecting');
    try {
      const saveRes = await fetch('/api/athletes/update-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, groupId: selectedGroup }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || 'Failed to save');
      }
      const data = await saveRes.json();
      if (data.athlete) {
        localStorage.setItem('athlete_id', data.athlete.id);
        localStorage.setItem('athlete_name', data.athlete.name || name);
        localStorage.setItem('athlete_email', data.athlete.email || email);
        if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
      }
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('info');
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('connecting');
    setError(null);

    try {
      const authRes = await fetch('/api/garmin/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail, mfaCode, sessionId: mfaSessionId }),
      });

      const authData = await authRes.json();
      if (!authRes.ok) {
        throw new Error(authData.error || 'Verification failed');
      }

      const auth = authData.auth;
      const saveRes = await fetch('/api/athletes/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garminAuth: auth, name, email, groupId: selectedGroup || undefined }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || 'Failed to save connection');
      }
      const data = await saveRes.json();
      if (data.athlete) {
        localStorage.setItem('athlete_id', data.athlete.id);
        localStorage.setItem('athlete_name', data.athlete.name || name);
        localStorage.setItem('athlete_email', data.athlete.email || email);
        if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
      }
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('mfa');
    }
  };

  const handleGarminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('connecting');
    setError(null);

    try {
      const authRes = await fetch('/api/garmin/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail, password: garminPassword }),
      });

      const authData = await authRes.json();

      if (authData.mfaRequired) {
        setMfaRequired(true);
        setMfaSessionId(authData.sessionId);
        setStep('mfa');
        return;
      }

      if (!authRes.ok) {
        throw new Error(authData.error || 'Failed to connect to Garmin');
      }

      const auth = authData.auth;

      const saveRes = await fetch('/api/athletes/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          garminAuth: auth,
          name,
          email,
          groupId: selectedGroup || undefined,
        }),
      });

      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || 'Failed to save connection');
      }

      const data = await saveRes.json();
      if (data.athlete) {
        localStorage.setItem('athlete_id', data.athlete.id);
        localStorage.setItem('athlete_name', data.athlete.name || name);
        localStorage.setItem('athlete_email', data.athlete.email || email);
        if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
      }

      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('garmin');
    }
  };

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 sm:p-8 w-full max-w-md">
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="flex items-center gap-3 mb-2">
              <img src="/images/logo.png" alt="Madregot After 2KM" className="h-8 w-8 object-contain invert" />
              <span className="text-lg font-bold text-white uppercase tracking-tight">Madregot After 2KM</span>
            </div>
          </div>

          <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
          </div>

          <h1 className="text-2xl font-bold text-white text-center">
            {skippedGarmin ? t('registrationComplete') : t('garminConnected')}
          </h1>
          <p className="text-slate-400 mt-3 text-center">
            {skippedGarmin
              ? t('canConnectLater')
              : t('garminLinked')}
          </p>

          <div className="mt-6 bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 text-center">
            <div className="bg-amber-500/20 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
              <Shield className="h-6 w-6 text-amber-400" />
            </div>
            <h2 className="text-base font-bold text-white">{t('waitingApproval')}</h2>
            <p className="text-sm text-slate-400 mt-2">
              {t('approvalMessage')}
            </p>
          </div>

          {!skippedGarmin && (
            <div className="mt-6 space-y-3">
              <div className="bg-slate-700/30 rounded-lg p-4 flex items-start gap-3">
                <Watch className="h-5 w-5 text-primary-400 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-white">{t('inTheMeantime')}</h3>
                  <p className="text-xs text-slate-400 mt-1">{t('syncGarminTip')}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={async () => {
                const supabase = getSupabase();
                await supabase.auth.signOut();
                window.location.href = '/';
              }}
              className="block w-full bg-slate-700 hover:bg-slate-600 text-white font-medium px-4 py-3 rounded-lg transition-colors text-center"
            >
              {t('backHome')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 sm:p-8 w-full max-w-md">
        <div className="flex flex-col items-center justify-center mb-6">
          <div className="flex items-center gap-3 mb-2">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-10 w-10 object-contain brightness-0 invert" />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold text-white tracking-tight">Madregot</span>
              <span className="text-xs font-medium tracking-wide text-slate-400">After 2KM Running Club</span>
            </div>
          </div>
        </div>

        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">{t('completeSetup')}</h1>
          <p className="text-slate-400 mt-2 text-sm">
            {t('chooseGroup')}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`h-2 w-8 rounded-full ${step === 'info' || step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
        </div>

        {step === 'info' && (
          <form onSubmit={handleInfoSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{t('yourName')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Yossi Cohen"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{t('emailLabel')}</label>
              <input
                type="email"
                value={email}
                readOnly
                className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-3 text-base text-slate-300 cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">{t('fromGoogle')}</p>
            </div>
            {groups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Users className="inline h-4 w-4 me-1" />
                  {t('yourPaceGroup')}
                </label>
                <div className="space-y-2">
                  {groups.map(g => {
                    const isSelected = selectedGroup === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSelectedGroup(g.id)}
                        className={`w-full text-start px-4 py-3 rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/50'
                            : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-white">{g.name}</div>
                            {g.marathonGoal && (
                              <div className="text-xs text-slate-400 mt-0.5">
                                {t('marathonGoal')} <span className="font-mono text-slate-300">{g.marathonGoal}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {error && step === 'info' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors"
            >
              {t('continue')}
            </button>
            <button
              type="button"
              onClick={async () => {
                const supabase = getSupabase();
                await supabase.auth.signOut();
                window.location.href = '/';
              }}
              className="block w-full text-center text-sm text-slate-500 hover:text-slate-300 transition-colors mt-3"
            >
              {t('backToHome')}
            </button>
          </form>
        )}

        {(step === 'garmin' || step === 'connecting') && (
          <form onSubmit={handleGarminSubmit} className="space-y-4">
            <div className="bg-slate-700/50 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-primary-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                <span className="text-white font-medium">{t('oneTimeSetup')}</span> {t('garminHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{t('garminEmail')}</label>
              <input
                type="email"
                value={garminEmail}
                onChange={(e) => setGarminEmail(e.target.value)}
                placeholder="your-garmin@email.com"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{t('garminPassword')}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={garminPassword}
                  onChange={(e) => setGarminPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 pe-12 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1.5"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={step === 'connecting'}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {step === 'connecting' ? (
                <><Loader2 className="h-4 w-4 animate-spin" />{t('connectingGarmin')}</>
              ) : (
                t('connectGarmin')
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('info')}
              className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
            >
              Back
            </button>

            <button
              type="button"
              onClick={async () => {
                setStep('connecting');
                try {
                  const saveRes = await fetch('/api/athletes/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name,
                      email,
                      groupId: selectedGroup || undefined,
                    }),
                  });
                  if (!saveRes.ok) {
                    const err = await saveRes.json();
                    throw new Error(err.error || 'Failed to save');
                  }
                  const data = await saveRes.json();
                  if (data.athlete) {
                    localStorage.setItem('athlete_id', data.athlete.id);
                    localStorage.setItem('athlete_name', data.athlete.name || name);
                    localStorage.setItem('athlete_email', data.athlete.email || email);
                    if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
                  }
                  setSkippedGarmin(true);
                  setStep('done');
                } catch (err: any) {
                  setError(err.message);
                  setStep('garmin');
                }
              }}
              disabled={step === 'connecting'}
              className="w-full border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
            >
              {t('connectLater')}
            </button>
          </form>
        )}

        {/* MFA verification step */}
        {step === 'mfa' && (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                <span className="text-amber-400 font-medium">{t('verificationRequired')}</span> {t('mfaHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {t('verificationCode')}
              </label>
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={t('enterCode')}
                maxLength={6}
                className="w-full bg-slate-700 border border-amber-500/50 rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 text-center text-xl tracking-widest"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!mfaCode || mfaCode.length < 6}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {t('verifyConnect')}
            </button>

            <button
              type="button"
              onClick={() => { setStep('garmin'); setMfaRequired(false); setMfaCode(''); }}
              className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
            >
              {t('backToLogin')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
