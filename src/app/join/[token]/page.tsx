'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Users, Eye, EyeOff, HelpCircle, LogIn, KeyRound } from 'lucide-react';

interface Group {
  id: string;
  name: string;
  paceOffsetSeconds: number;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

function getGarminSSOUrl() {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://madregot-connect.vercel.app';
  const serviceUrl = `${appUrl}/api/garmin/sso-callback`;
  return `https://sso.garmin.com/sso/signin?clientId=GarminConnect&locale=en&service=${encodeURIComponent(serviceUrl)}&webhost=https://connect.garmin.com&gateway=true&generateExtraServiceTicket=true&generateTwoExtraServiceTickets=true&generateNoServiceTicket=false&cssUrl=https://static.garmincdn.com/com.garmin.connect/ui/css/gauth-custom-v1.2-min.css`;
}

export default function JoinPage({ params }: { params: { token: string } }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'sso' | 'manual'>('sso');
  const [step, setStep] = useState<'info' | 'garmin' | 'connecting' | 'done'>('info');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  // Listen for messages from Garmin SSO iframe/popup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'garmin-ticket' && event.data?.ticket) {
        await handleTicketAuth(event.data.ticket);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [name, email, selectedGroup]);

  const openGarminSSO = () => {
    const url = getGarminSSOUrl();
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(url, 'garmin-sso', `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`);
  };

  const handleTicketAuth = async (ticket: string) => {
    setStep('connecting');
    setError(null);

    try {
      const authRes = await fetch('/api/garmin/ticket-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket }),
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
          <div className={`h-2 w-8 rounded-full ${step === 'info' ? 'bg-primary-500' : 'bg-primary-500'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'info' ? 'bg-slate-600' : step === 'garmin' || step === 'connecting' ? 'bg-primary-500' : 'bg-primary-500'}`} />
        </div>

        {/* Step 1: Basic info */}
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
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
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

        {/* Step 2: Garmin login */}
        {(step === 'garmin' || step === 'connecting') && (
          <div className="space-y-4">
            {step === 'connecting' && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                <span className="text-slate-300">Connecting to Garmin...</span>
              </div>
            )}

            {step === 'garmin' && (
              <>
                {/* Auth mode toggle */}
                <div className="flex gap-1 bg-slate-700/50 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setAuthMode('sso')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      authMode === 'sso'
                        ? 'bg-primary-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <LogIn className="h-4 w-4" />
                    Sign in to Garmin
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('manual')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      authMode === 'manual'
                        ? 'bg-primary-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <KeyRound className="h-4 w-4" />
                    Enter Credentials
                  </button>
                </div>

                {/* SSO Mode - Garmin popup login */}
                {authMode === 'sso' && (
                  <div className="space-y-4">
                    <div className="bg-slate-700/50 rounded-lg p-3 flex items-start gap-2">
                      <Shield className="h-4 w-4 text-primary-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-slate-400">
                        A Garmin login window will open. Sign in there and you&apos;ll be connected automatically. Your password goes directly to Garmin — not to us.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={openGarminSSO}
                      className="w-full bg-[#007CC3] hover:bg-[#006AAD] text-white font-medium px-4 py-4 rounded-lg transition-colors flex items-center justify-center gap-3"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/>
                      </svg>
                      Sign in with Garmin Connect
                    </button>

                    <p className="text-xs text-slate-500 text-center">
                      A popup will open with Garmin&apos;s login page. Allow popups if prompted.
                    </p>
                  </div>
                )}

                {/* Manual Mode - email/password form */}
                {authMode === 'manual' && (
                  <form onSubmit={handleGarminSubmit} className="space-y-4">
                    <div className="bg-slate-700/50 rounded-lg p-3 flex items-start gap-2">
                      <Shield className="h-4 w-4 text-primary-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-slate-400">
                        Use the same email and password you use for the Garmin Connect app or connect.garmin.com
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
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      Connect Garmin Account
                    </button>
                  </form>
                )}

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setStep('info')}
                  className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
                >
                  Back
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
