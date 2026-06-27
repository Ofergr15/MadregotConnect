'use client';

import { useState, useEffect } from 'react';
import { Activity, CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Users } from 'lucide-react';

interface Group {
  id: string;
  name: string;
}

export default function JoinPage({ params }: { params: { token: string } }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [step, setStep] = useState<'info' | 'garmin' | 'connecting' | 'done'>('info');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/join/groups?token=${params.token}`)
      .then(res => res.json())
      .then(data => setGroups(data.groups || []))
      .catch(() => {});
  }, [params.token]);

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

      setStep('done');
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
          <div className="flex items-center justify-center gap-2 mb-6">
            <Activity className="h-6 w-6 text-primary-500" />
            <span className="text-lg font-bold text-white">MadregotConnect</span>
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

          {/* Footer Note */}
          <div className="mt-6 pt-6 border-t border-slate-700">
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
        <div className="flex items-center justify-center gap-2 mb-6">
          <Activity className="h-6 w-6 text-primary-500" />
          <span className="text-lg font-bold text-white">MadregotConnect</span>
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
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  <Users className="inline h-4 w-4 mr-1" />
                  Your Pace Group
                </label>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="">Select your pace group</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Your coach will assign workouts based on your group&apos;s pace
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

        {/* Step 2: Garmin credentials */}
        {(step === 'garmin' || step === 'connecting') && (
          <form onSubmit={handleGarminSubmit} className="space-y-4">
            <div className="bg-slate-700/50 rounded-lg p-3 flex items-start gap-2 mb-2">
              <Shield className="h-4 w-4 text-primary-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                Your Garmin credentials are encrypted and only used to push workouts to your training calendar. We never store your password.
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
              <input
                type="password"
                value={garminPassword}
                onChange={(e) => setGarminPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
