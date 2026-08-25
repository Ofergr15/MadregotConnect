'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Check, Eye, EyeOff } from 'lucide-react';
import { InsetSection, InsetRow, Button } from '@/components/ui';
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

interface Group {
  id: string;
  name: string;
  paceOffsetSeconds: number;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const t = useTranslations('join');
  const to = useTranslations('onboarding');
  const tc = useTranslations('common');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSessionId, setMfaSessionId] = useState('');
  const [skippedGarmin, setSkippedGarmin] = useState(false);
  const [step, setStep] = useState<'auth' | 'info' | 'garmin' | 'mfa' | 'connecting' | 'done'>('auth');
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Skip auth check — this is a public join page for new runners
    // They will enter their info fresh regardless of any existing session
    setStep('info');
    setAuthLoading(false);

    fetch(`/api/join/groups?token=${token}`)
      .then(res => res.json())
      .then(data => {
        const fetchedGroups = data.groups || [];
        setGroups(fetchedGroups);
        if (fetchedGroups.length === 1) {
          setSelectedGroup(fetchedGroups[0].id);
        }
      })
      .catch(() => {});
  }, [token]);


  const saveConnection = async (auth: string) => {
    const saveRes = await fetch('/api/athletes/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: token,
        garminAuth: auth,
        name,
        email,
        groupId: selectedGroup || undefined,
      }),
    });

    if (!saveRes.ok) {
      const err = await saveRes.json();
      throw new Error(err.message || err.error || to('failedToSaveConnection'));
    }

    const data = await saveRes.json();
    if (data.athlete) {
      localStorage.setItem('athlete_id', data.athlete.id);
      localStorage.setItem('athlete_name', data.athlete.name || name);
      localStorage.setItem('athlete_email', data.athlete.email || email);
      if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
    }

    setStep('done');
  };

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (groups.length > 0 && !selectedGroup) {
      setError(t('selectPaceGroupError'));
      return;
    }
    setError(null);
    if (!garminEmail) setGarminEmail(email);
    setStep('garmin');
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
        throw new Error(authData.message || authData.error || to('failedToConnectGarmin'));
      }

      await saveConnection(authData.auth);
    } catch (err: any) {
      setError(err.message);
      setStep('garmin');
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
        throw new Error(authData.message || authData.error || to('verificationFailed'));
      }

      await saveConnection(authData.auth);
    } catch (err: any) {
      setError(err.message);
      setStep('mfa');
    }
  };

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 sm:p-8 w-full max-w-md animate-fade-in">
          {/* Logo */}
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="flex items-center gap-3 mb-2">
              <img src="/images/logo.png" alt="Madregot After 2KM" className="h-8 w-8 object-contain invert" />
              <span className="text-lg font-bold text-white uppercase tracking-tight">Madregot After 2KM</span>
            </div>
            <span className="text-xs text-primary-400 uppercase tracking-wide font-medium">{t('runningClub')}</span>
          </div>

          {/* Success Icon */}
          <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-scale-in">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
          </div>

          {/* Success Message */}
          <h1 className="text-2xl font-bold text-white text-center">
            {skippedGarmin ? to('registrationComplete') : t('youreConnected')}
          </h1>
          <p className="text-slate-400 mt-3 text-center">
            {skippedGarmin
              ? to('canConnectLater')
              : t('garminLinkedCoach')}
          </p>

          {/* What's Next Section */}
          {!skippedGarmin && (
            <div className="mt-8">
              <InsetSection header={t('whatsNext')}>
                <InsetRow icon={Calendar} iconBg="bg-primary-600" label={t('receiveWorkouts')} sublabel={t('receiveWorkoutsDesc')} />
                <InsetRow icon={Smartphone} iconBg="bg-primary-600" label={t('syncPhone')} sublabel={t('syncPhoneDesc')} />
                <InsetRow icon={Watch} iconBg="bg-primary-600" label={t('findOnWatch')} sublabel={t('findOnWatchDesc')} />
              </InsetSection>
            </div>
          )}

          {/* Go to Dashboard */}
          <div className="mt-6">
            <a
              href="/dashboard/program"
              className="block w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors text-center"
            >
              {skippedGarmin ? t('goToDashboard') : t('viewProgram')}
            </a>
          </div>

          {!skippedGarmin && (
            <div className="mt-4 pt-4 border-t border-slate-700">
              <p className="text-xs text-slate-500 text-center">
                {t('bluetoothNote')}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 sm:p-8 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center justify-center mb-6">
          <div className="flex items-center gap-3 mb-2">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-10 w-10 object-contain brightness-0 invert" />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold text-white tracking-tight">Madregot</span>
              <span className="text-xs font-medium tracking-wide text-slate-400">After 2KM Running Club</span>
            </div>
          </div>
          <span className="text-xs text-primary-400 uppercase tracking-wide font-medium">{t('runningClub')}</span>
        </div>

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">{t('joinYourTeam')}</h1>
          <p className="text-slate-400 mt-2 text-sm">
            {t('connectGarminDesc')}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`h-2 w-8 rounded-full ${step === 'info' || step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
        </div>


        {/* Step 2: Basic info + group */}
        {step === 'info' && (
          <form onSubmit={handleInfoSubmit} className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {to('yourName')}
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Yossi Cohen"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {to('emailLabel')}
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>
            {groups.length > 0 && (
              <div>
                <InsetSection header={to('yourPaceGroup')}>
                  {groups.map(g => {
                    const isSelected = selectedGroup === g.id;
                    const levelColors = {
                      fast: 'text-green-400 bg-green-500/10',
                      medium: 'text-yellow-400 bg-yellow-500/10',
                      slow: 'text-orange-400 bg-orange-500/10',
                    };
                    const levelLabels = {
                      fast: 'SUB 2:30',
                      medium: 'SUB 2:35',
                      slow: 'SUB 2:45',
                    };
                    return (
                      <InsetRow
                        key={g.id}
                        label={g.name}
                        sublabel={g.marathonGoal ? `${to('marathonGoal')} ${g.marathonGoal}` : undefined}
                        onClick={() => setSelectedGroup(g.id)}
                        trailing={
                          <span className="flex items-center gap-2 shrink-0">
                            <span className={cn('px-2 py-1 rounded text-xs font-medium', levelColors[g.level])}>
                              {levelLabels[g.level]}
                            </span>
                            {isSelected && <Check className="h-4 w-4 text-primary-400" />}
                          </span>
                        }
                      />
                    );
                  })}
                </InsetSection>
                <p className="text-xs text-slate-500 -mt-3 mb-1">
                  {t('groupPaceNote')}
                </p>
              </div>
            )}
            {error && step === 'info' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full">
              {tc('continue')}
            </Button>
          </form>
        )}

        {/* Step 3: Garmin credentials (one-time special logic) */}
        {(step === 'garmin' || step === 'connecting') && (
          <form onSubmit={handleGarminSubmit} className="space-y-4 animate-fade-in">
            <div className="bg-slate-700/50 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-primary-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                <span className="text-white font-medium">{to('oneTimeSetup')}</span> {to('garminHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {to('garminEmail')}
              </label>
              <Input
                type="email"
                value={garminEmail}
                onChange={(e) => setGarminEmail(e.target.value)}
                placeholder="your-garmin@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {to('garminPassword')}
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={garminPassword}
                  onChange={(e) => setGarminPassword(e.target.value)}
                  placeholder={to('enterPassword')}
                  className="pe-12"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-1.5 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                {t('tapEye')}
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={step === 'connecting'}>
              {step === 'connecting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {to('connectingGarmin')}
                </>
              ) : (
                to('connectGarmin')
              )}
            </Button>

            <Button type="button" variant="ghost" className="w-full" onClick={() => setStep('info')}>
              {tc('back')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={async () => {
                setStep('connecting');
                try {
                  const saveRes = await fetch('/api/athletes/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      inviteToken: token,
                      name,
                      email,
                      groupId: selectedGroup || undefined,
                    }),
                  });
                  if (!saveRes.ok) {
                    const err = await saveRes.json();
                    throw new Error(err.message || err.error || to('failedToSave'));
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
            >
              {to('connectLater')}
            </Button>
          </form>
        )}

        {/* Step 3b: MFA verification */}
        {step === 'mfa' && (
          <form onSubmit={handleMfaSubmit} className="space-y-4 animate-fade-in">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                <span className="text-amber-400 font-medium">{to('verificationRequired')}</span> {to('mfaHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {to('verificationCode')}
              </label>
              <Input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={to('enterCode')}
                maxLength={6}
                className="border-amber-500/50 focus:ring-amber-500 text-center text-xl tracking-widest"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!mfaCode || mfaCode.length < 6}>
              {to('verifyConnect')}
            </Button>

            <Button type="button" variant="ghost" className="w-full" onClick={() => { setStep('garmin'); setMfaRequired(false); setMfaCode(''); }}>
              {to('backToLogin')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
