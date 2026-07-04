'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Users, Eye, EyeOff } from 'lucide-react';

interface Group {
  id: string;
  name: string;
  paceOffsetSeconds: number;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

export default function JoinPage({ params }: { params: { token: string } }) {
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

    fetch(`/api/join/groups?token=${params.token}`)
      .then(res => res.json())
      .then(data => {
        const fetchedGroups = data.groups || [];
        setGroups(fetchedGroups);
        if (fetchedGroups.length === 1) {
          setSelectedGroup(fetchedGroups[0].id);
        }
      })
      .catch(() => {});
  }, [params.token]);


  const saveConnection = async (auth: string) => {
    const saveRes = await fetch('/api/athletes/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: params.token,
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
  };

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        throw new Error(authData.error || 'Failed to connect to Garmin');
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
        throw new Error(authData.error || 'Verification failed');
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
            <span className="text-xs text-primary-400 uppercase tracking-wide font-medium">Running Club</span>
          </div>

          {/* Success Icon */}
          <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-scale-in">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
          </div>

          {/* Success Message */}
          <h1 className="text-2xl font-bold text-white text-center">
            {skippedGarmin ? 'Registration Complete!' : 'You\u0027re Connected!'}
          </h1>
          <p className="text-slate-400 mt-3 text-center">
            {skippedGarmin
              ? 'You can connect your Garmin watch anytime from your profile settings.'
              : 'Your Garmin account is now linked. Your coach will push workouts directly to your Garmin training calendar.'}
          </p>

          {/* What's Next Section */}
          {!skippedGarmin && (
            <div className="mt-8 space-y-3">
              <h2 className="text-sm font-semibold text-white mb-3">What&apos;s next?</h2>

              <div className="bg-slate-700/30 rounded-lg p-4 flex items-start gap-3">
                <div className="bg-primary-600/20 w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
                  <Calendar className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Receive Workouts</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Your coach will push workouts to your Garmin training calendar
                  </p>
                </div>
              </div>

              <div className="bg-slate-700/30 rounded-lg p-4 flex items-start gap-3">
                <div className="bg-primary-600/20 w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
                  <Smartphone className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Sync Your Phone</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Open Garmin Connect Mobile on your phone to sync the workouts
                  </p>
                </div>
              </div>

              <div className="bg-slate-700/30 rounded-lg p-4 flex items-start gap-3">
                <div className="bg-primary-600/20 w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
                  <Watch className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Find on Your Watch</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Workouts appear in Training &rarr; My Workouts on your Garmin watch
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Go to Dashboard */}
          <div className="mt-6">
            <a
              href="/dashboard/program"
              className="block w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors text-center"
            >
              {skippedGarmin ? 'Go to Dashboard' : 'View Training Program'}
            </a>
          </div>

          {!skippedGarmin && (
            <div className="mt-4 pt-4 border-t border-slate-700">
              <p className="text-xs text-slate-500 text-center">
                Make sure Garmin Connect Mobile is running with Bluetooth enabled for automatic syncing
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
          <span className="text-xs text-primary-400 uppercase tracking-wide font-medium">Running Club</span>
        </div>

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">Join Your Team</h1>
          <p className="text-slate-400 mt-2 text-sm">
            Connect your Garmin to receive workouts from your coach
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`h-2 w-8 rounded-full ${step === 'info' || step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
        </div>


        {/* Step 2: Basic info + group */}
        {step === 'info' && (
          <form onSubmit={handleInfoSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Your Name
              </label>
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
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            {groups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Users className="inline h-4 w-4 mr-1" />
                  Your Pace Group
                </label>
                <div className="space-y-2">
                  {groups.map(g => {
                    const isSelected = selectedGroup === g.id;
                    const levelColors = {
                      fast: 'border-green-500/50 bg-green-500/10 text-green-400',
                      medium: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400',
                      slow: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
                    };
                    const levelLabels = {
                      fast: 'SUB 2:30',
                      medium: 'SUB 2:35',
                      slow: 'SUB 2:45',
                    };
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSelectedGroup(g.id)}
                        className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/50'
                            : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-white">{g.name}</div>
                            {g.marathonGoal && (
                              <div className="text-xs text-slate-400 mt-0.5">
                                Marathon Goal: <span className="font-mono text-slate-300">{g.marathonGoal}</span>
                              </div>
                            )}
                          </div>
                          <div className={`px-2 py-1 rounded text-xs font-medium border ${levelColors[g.level]} ml-2`}>
                            {levelLabels[g.level]}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Your coach will assign workouts based on your group&apos;s pace offset
                </p>
              </div>
            )}
            <button
              type="submit"
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors"
            >
              Continue
            </button>
          </form>
        )}

        {/* Step 3: Garmin credentials (one-time special logic) */}
        {(step === 'garmin' || step === 'connecting') && (
          <form onSubmit={handleGarminSubmit} className="space-y-4">
            <div className="bg-slate-700/50 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-primary-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                <span className="text-white font-medium">One-time setup:</span> Enter your Garmin Connect credentials to link your watch. This is only needed once — you won&apos;t need to enter these again.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Garmin Connect Email
              </label>
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
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Garmin Connect Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={garminPassword}
                  onChange={(e) => setGarminPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 pr-12 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1.5"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Tap the eye to show your password and verify it
              </p>
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
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting to Garmin...
                </>
              ) : (
                'Connect Garmin Account'
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
                      inviteToken: params.token,
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
              className="w-full text-slate-500 hover:text-slate-300 text-sm py-2 transition-colors"
            >
              I&apos;ll connect Garmin later
            </button>
          </form>
        )}

        {/* Step 3b: MFA verification */}
        {step === 'mfa' && (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                <span className="text-amber-400 font-medium">Verification required:</span> A code was sent to your Garmin email. Enter it below to complete the connection.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Verification Code
              </label>
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="Enter 6-digit code"
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
              Verify & Connect
            </button>

            <button
              type="button"
              onClick={() => { setStep('garmin'); setMfaRequired(false); setMfaCode(''); }}
              className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
            >
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
