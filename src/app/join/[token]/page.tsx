'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Users, Eye, EyeOff } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';

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
  const [step, setStep] = useState<'auth' | 'info' | 'garmin' | 'connecting' | 'done'>('auth');
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setName(session.user.user_metadata?.full_name || '');
        setEmail(session.user.email || '');
        setGarminEmail(session.user.email || '');
        setStep('info');
      }
      setAuthLoading(false);
    });

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

  const handleGoogleAuth = async () => {
    setAuthLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/join/${params.token}`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
      setAuthLoading(false);
    }
  };

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

      if (!authRes.ok) {
        const err = await authRes.json();
        throw new Error(err.error || 'Failed to connect to Garmin');
      }

      const { auth } = await authRes.json();
      await saveConnection(auth);
    } catch (err: any) {
      setError(err.message);
      setStep('garmin');
    }
  };

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 sm:p-8 w-full max-w-md animate-fade-in">
          {/* Logo */}
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 40 40" className="h-6 w-6 text-primary-500" fill="currentColor">
                <rect x="8" y="30" width="24" height="4"/>
                <rect x="12" y="24" width="20" height="4"/>
                <rect x="16" y="18" width="16" height="4"/>
                <rect x="20" y="12" width="12" height="4"/>
                <rect x="24" y="6" width="8" height="4"/>
              </svg>
              <span className="text-lg font-bold text-white uppercase tracking-tight">MADREGOT</span>
            </div>
            <span className="text-xs text-primary-400 uppercase tracking-wide font-medium">After 2KM Running Club</span>
          </div>

          {/* Success Icon */}
          <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-scale-in">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
          </div>

          {/* Success Message */}
          <h1 className="text-2xl font-bold text-white text-center">You&apos;re Connected!</h1>
          <p className="text-slate-400 mt-3 text-center">
            Your Garmin account is now linked. Your coach will push workouts directly to your Garmin training calendar.
          </p>

          {/* What's Next Section */}
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
                  Workouts appear in Training → My Workouts on your Garmin watch
                </p>
              </div>
            </div>
          </div>

          {/* Go to Dashboard */}
          <div className="mt-6">
            <a
              href="/dashboard/program"
              className="block w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors text-center"
            >
              View Training Program
            </a>
          </div>

          {/* Footer Note */}
          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-xs text-slate-500 text-center">
              Make sure Garmin Connect Mobile is running with Bluetooth enabled for automatic syncing
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 sm:p-8 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center justify-center mb-6">
          <div className="flex items-center gap-2 mb-2">
            <svg viewBox="0 0 40 40" className="h-6 w-6 text-primary-500" fill="currentColor">
              <rect x="8" y="30" width="24" height="4"/>
              <rect x="12" y="24" width="20" height="4"/>
              <rect x="16" y="18" width="16" height="4"/>
              <rect x="20" y="12" width="12" height="4"/>
              <rect x="24" y="6" width="8" height="4"/>
            </svg>
            <span className="text-lg font-bold text-white uppercase tracking-tight">MADREGOT</span>
          </div>
          <span className="text-xs text-primary-400 uppercase tracking-wide font-medium">After 2KM Running Club</span>
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
          <div className={`h-2 w-8 rounded-full ${step === 'auth' ? 'bg-primary-500' : 'bg-primary-500'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'auth' ? 'bg-slate-600' : step === 'info' ? 'bg-primary-500' : 'bg-primary-500'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'garmin' || step === 'connecting' ? 'bg-primary-500' : 'bg-slate-600'}`} />
        </div>

        {/* Step 1: Google Auth */}
        {step === 'auth' && (
          <div className="space-y-4">
            {authLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-400 text-center">
                  First, sign in with your Google account
                </p>
                <button
                  onClick={handleGoogleAuth}
                  className="w-full bg-white hover:bg-gray-100 text-gray-800 font-medium px-4 py-3.5 rounded-lg transition-colors flex items-center justify-center gap-3"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm text-center">
                    {error}
                  </div>
                )}
              </>
            )}
          </div>
        )}

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
                readOnly
                className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-3 text-base text-slate-300 cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">From your Google account</p>
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
                  placeholder="••••••••"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 pr-12 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
          </form>
        )}
      </div>
    </div>
  );
}
