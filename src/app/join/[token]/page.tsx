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
        'w-full min-h-[44px] bg-page border border-ink-300 rounded-2xl px-4 py-3 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600',
        className
      )}
      {...rest}
    />
  );
}

/**
 * Strava's official mark. Duplicated from src/app/page.tsx rather than
 * promoted — same reason as the `Input` above: two callers, no third in sight,
 * and the landing page's copy is the one Strava's brand guidelines were checked
 * against. Keep the paths identical if either changes.
 */
function StravaMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="m15.387 17.944-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M10.463 8.392l2.835 5.436h4.173L10.463 0l-7 13.828h4.169" />
    </svg>
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
  // The invite's athlete row already has a watch connected. Most people this
  // link goes to are NOT new: the club has been running for a while, their
  // Garmin credentials are on file and syncing. Asking them for that password
  // again is both pointless and the step most likely to make them give up — so
  // they still walk the whole flow, but the Garmin step shows "connected".
  const [garminConnected, setGarminConnected] = useState(false);
  // …unless they say otherwise. Someone who changed their Garmin account needs
  // the credential form back, which this reveals.
  const [reconnect, setReconnect] = useState(false);
  // Strava is the primary way in, so the credential form starts hidden behind
  // "I have a Garmin watch" — most people arriving here own no Garmin, and a
  // password field is the wrong first thing to show them.
  const [garminForm, setGarminForm] = useState(false);
  const [stravaLoading, setStravaLoading] = useState(false);
  // What the Strava callback said when it bounced us back — 'invalid' (the
  // invite token no longer resolves) or 'error' (the link itself failed).
  const [stravaReturn, setStravaReturn] = useState<string | null>(null);
  const [step, setStep] = useState<'auth' | 'info' | 'garmin' | 'mfa' | 'connecting' | 'done'>('auth');
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Skip auth check — this is a public join page for new runners
    // They will enter their info fresh regardless of any existing session
    setStep('info');
    setAuthLoading(false);

    // Coming back from a Strava round trip that didn't complete. Land them on
    // the connect step, not back at the top: their name and group were saved
    // before we sent them out, so there is nothing to re-enter — only the
    // connection to retry. Read off the URL rather than useSearchParams so the
    // page keeps rendering without a Suspense boundary.
    const returned = new URLSearchParams(window.location.search).get('strava');
    if (returned === 'invalid' || returned === 'error') {
      setStravaReturn(returned);
      setStep('garmin');
      window.history.replaceState({}, '', window.location.pathname);
    }

    fetch(`/api/join/groups?token=${token}`)
      .then(res => res.json())
      .then(data => {
        const fetchedGroups = data.groups || [];
        setGroups(fetchedGroups);
        // What the athlete already has on file, so the form asks only for what
        // is genuinely missing. `name` comes back empty when it is still the
        // placeholder derived from their address (see /api/join/groups).
        const me = data.athlete;
        if (me) {
          if (me.name) setName(me.name);
          if (me.email) setEmail(me.email);
          if (me.groupId) setSelectedGroup(me.groupId);
          setGarminConnected(!!me.garminConnected);
        }
        if (fetchedGroups.length === 1 && !me?.groupId) {
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

  /**
   * Write name / email / group onto the invited row without touching Garmin.
   * /api/athletes/connect leaves an existing garmin_auth alone when the request
   * carries none, so this is safe for an athlete who already has a watch.
   */
  const persistProfile = async () => {
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
      const err = await saveRes.json().catch(() => ({}));
      throw new Error(err.message || err.error || to('failedToSave'));
    }
    const data = await saveRes.json();
    if (data.athlete) {
      localStorage.setItem('athlete_id', data.athlete.id);
      localStorage.setItem('athlete_name', data.athlete.name || name);
      localStorage.setItem('athlete_email', data.athlete.email || email);
      if (data.athlete.group_id) localStorage.setItem('athlete_group_id', data.athlete.group_id);
    }
  };

  /**
   * Finish the join without posting Garmin credentials. Two callers, and the
   * only difference is what the done screen says: `skipped` means "I'll do it
   * later" (nothing is connected), while the already-connected athlete gets the
   * full "you're connected" screen.
   */
  const finishWithoutCredentials = async (skipped: boolean) => {
    setStep('connecting');
    setError(null);
    try {
      await persistProfile();
      setSkippedGarmin(skipped);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('garmin');
    }
  };

  /**
   * Hand off to Strava, which finishes the whole registration in one round trip:
   * the callback links the tokens onto this invite's row, flips it to active and
   * mints a real Supabase session, then drops them on the feed where the in-app
   * guide picks them up. So there is no `done` screen on this path — by the time
   * they come back, they are inside the app.
   *
   * The profile is saved FIRST because leaving for Strava destroys this
   * component: whatever name or group they picked lives only in React state, and
   * the callback has no way to recover it.
   */
  const handleStravaConnect = async () => {
    setStravaLoading(true);
    setError(null);
    setStravaReturn(null);
    try {
      await persistProfile();
      const res = await fetch(`/api/strava?inviteToken=${token}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authUrl) {
        throw new Error(data.message || data.error || t('stravaConnectFailed'));
      }
      // assign, not replace: bailing out of Strava's authorize page should bring
      // them back here rather than off the end of their history.
      window.location.assign(data.authUrl);
    } catch (err: any) {
      setError(err.message || t('stravaConnectFailed'));
      setStravaLoading(false);
    }
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

  /**
   * The connect step has two faces, and every branch below keys off these rather
   * than re-deriving the condition inline:
   *
   *   showGarminForm  the credential form — asked for, or switching accounts
   *   otherwise       the Strava button, with a "already connected" banner on top
   *                   when `garminReady`
   */
  const onConnectStep = step === 'garmin' || step === 'connecting';
  const garminReady = garminConnected && !reconnect;
  const showGarminForm = garminForm || reconnect;
  // A failed Strava return has no live `error` behind it — the failure happened
  // in another request, in another page load.
  const displayError =
    error ||
    (stravaReturn
      ? t(stravaReturn === 'invalid' ? 'stravaInviteInvalid' : 'stravaConnectFailed')
      : null);

  /** Back out of the Garmin form to wherever it was opened from. */
  const backFromGarminForm = () => {
    setError(null);
    if (garminForm) {
      setGarminForm(false);
      return;
    }
    if (reconnect) {
      setReconnect(false);
      return;
    }
    setStep('info');
  };

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4">
        <div className="bg-card rounded-card border border-page p-6 sm:p-8 w-full max-w-md animate-fade-in">
          {/* Logo */}
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="flex items-center gap-3 mb-2">
              <img src="/images/logo.png" alt="Madregot After 2KM" className="h-8 w-8 object-contain invert" />
              <span className="text-lg font-bold text-ink-700 uppercase tracking-tight">Madregot After 2KM</span>
            </div>
            <span className="text-xs text-brand-600 uppercase tracking-wide font-medium">{t('runningClub')}</span>
          </div>

          {/* Success Icon */}
          <div className="bg-accent-600/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-scale-in">
            <CheckCircle2 className="h-8 w-8 text-accent-600" />
          </div>

          {/* Success Message */}
          <h1 className="text-2xl font-bold text-ink-700 text-center">
            {skippedGarmin ? to('registrationComplete') : t('youreConnected')}
          </h1>
          <p className="text-ink-400 mt-3 text-center">
            {skippedGarmin
              ? to('canConnectLater')
              : t('garminLinkedCoach')}
          </p>

          {/* What's Next Section */}
          {!skippedGarmin && (
            <div className="mt-8">
              <InsetSection header={t('whatsNext')}>
                <InsetRow icon={Calendar} iconBg="bg-brand-600" label={t('receiveWorkouts')} sublabel={t('receiveWorkoutsDesc')} />
                <InsetRow icon={Smartphone} iconBg="bg-brand-600" label={t('syncPhone')} sublabel={t('syncPhoneDesc')} />
                <InsetRow icon={Watch} iconBg="bg-brand-600" label={t('findOnWatch')} sublabel={t('findOnWatchDesc')} />
              </InsetSection>
            </div>
          )}

          {/* Go to Dashboard */}
          <div className="mt-6">
            <a
              href="/dashboard/program"
              className="block w-full bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-3 rounded-lg transition-colors text-center"
            >
              {skippedGarmin ? t('goToDashboard') : t('viewProgram')}
            </a>
          </div>

          {!skippedGarmin && (
            <div className="mt-4 pt-4 border-t border-page">
              <p className="text-xs text-ink-400 text-center">
                {t('bluetoothNote')}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="bg-card rounded-card border border-page p-6 sm:p-8 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center justify-center mb-6">
          <div className="flex items-center gap-3 mb-2">
            <img src="/images/logo.png" alt="Madregot After 2KM" className="h-10 w-10 object-contain brightness-0 invert" />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold text-ink-700 tracking-tight">Madregot</span>
              <span className="text-xs font-medium tracking-wide text-ink-400">After 2KM Running Club</span>
            </div>
          </div>
          <span className="text-xs text-brand-600 uppercase tracking-wide font-medium">{t('runningClub')}</span>
        </div>

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-ink-700">{t('joinYourTeam')}</h1>
          {/* "Connect your Garmin to get workouts" is the wrong promise twice
              over: for someone whose watch has been connected for months (they
              are here to finish an account, not set one up), and for everyone on
              the Strava path, who may well own no Garmin at all. */}
          <p className="text-ink-400 mt-2 text-sm">
            {garminReady
              ? t('resumeDesc')
              : !onConnectStep
                ? t('joinDesc')
                : showGarminForm
                  ? t('connectGarminDesc')
                  : t('connectStravaDesc')}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`h-2 w-8 rounded-full ${step === 'info' || step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-brand-600' : 'bg-ink-300'}`} />
          <div className={`h-2 w-8 rounded-full ${step === 'garmin' || step === 'mfa' || step === 'connecting' ? 'bg-brand-600' : 'bg-ink-300'}`} />
        </div>


        {/* Step 2: Basic info + group */}
        {step === 'info' && (
          <form onSubmit={handleInfoSubmit} className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-sm font-medium text-ink-500 mb-1">
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
              <label className="block text-sm font-medium text-ink-500 mb-1">
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
                      fast: 'text-accent-900 bg-accent-600/10',
                      medium: 'text-band-3-ink bg-band-3/10',
                      slow: 'text-band-3-ink bg-band-3/10',
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
                            {isSelected && <Check className="h-4 w-4 text-brand-600" />}
                          </span>
                        }
                      />
                    );
                  })}
                </InsetSection>
                <p className="text-xs text-ink-400 -mt-3 mb-1">
                  {t('groupPaceNote')}
                </p>
              </div>
            )}
            {error && step === 'info' && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-accent-red-ink text-sm">
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full">
              {tc('continue')}
            </Button>
          </form>
        )}

        {/* Step 3: connect a training account.
            One button, Strava, for everyone — including the athletes whose watch
            has been syncing for months. That is not a nicety: Strava is the app's
            ONLY sign-in door (the landing page has no other, and there is no
            password anywhere), so an athlete who never links it can finish this
            page and then never get back into the app. What the Garmin banner
            above it is for is telling them the WATCH half is already done, so
            they don't hunt for a password we don't need.
            Garmin stays reachable underneath for watch owners who haven't
            connected one — only Garmin can RECEIVE the coach's pushed workouts,
            which Strava's read-only API cannot do. */}
        {onConnectStep && !showGarminForm && (
          <div className="space-y-4 animate-fade-in">
            {garminReady && (
              <div className="bg-accent-600/10 border border-accent-600/30 rounded-2xl p-4 flex items-start gap-3">
                <span className="bg-accent-600/20 w-9 h-9 rounded-full flex items-center justify-center shrink-0">
                  <Watch className="h-4 w-4 text-accent-600" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink-700">{t('garminAlreadyConnected')}</p>
                  <p className="text-xs text-ink-400 mt-1 leading-relaxed">{t('garminAlreadyConnectedDesc')}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-accent-600 shrink-0" />
              </div>
            )}

            <button
              type="button"
              onClick={handleStravaConnect}
              disabled={stravaLoading || step === 'connecting'}
              className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#FC4C02] px-6 text-base font-bold text-white transition hover:bg-[#e34402] active:scale-[0.99] disabled:opacity-50"
            >
              {stravaLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <StravaMark className="h-5 w-5" />
                  {t('connectWithStrava')}
                </>
              )}
            </button>
            <p className="text-xs text-ink-400 leading-relaxed text-center">
              {garminReady ? t('stravaWhyGarmin') : t('stravaWhy')}
            </p>

            {displayError && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-accent-red-ink text-sm">
                {displayError}
              </div>
            )}

            <div className="pt-2 border-t border-page space-y-1">
              <button
                type="button"
                onClick={() => {
                  // Same form either way; `reconnect` is the one that means
                  // "replace a credential that is already on the row".
                  if (garminReady) setReconnect(true);
                  else setGarminForm(true);
                  setError(null);
                  setStravaReturn(null);
                }}
                disabled={stravaLoading || step === 'connecting'}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 text-sm font-medium text-ink-500 hover:text-ink-700 transition-colors disabled:opacity-50"
              >
                <Watch className="h-4 w-4" />
                {garminReady ? t('connectDifferentGarmin') : t('haveGarmin')}
              </button>
              <button
                type="button"
                // `false` when a watch is already on the row: the done screen
                // must not tell them nothing is connected.
                onClick={() => finishWithoutCredentials(!garminConnected)}
                disabled={stravaLoading || step === 'connecting'}
                className="w-full min-h-[44px] text-xs font-medium text-ink-400 hover:text-ink-700 transition-colors disabled:opacity-50"
              >
                {step === 'connecting' ? tc('loading') : t('connectLater')}
              </button>
            </div>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setStep('info')}
              disabled={stravaLoading || step === 'connecting'}
            >
              {tc('back')}
            </Button>
          </div>
        )}

        {/* Step 3: Garmin credentials (one-time special logic) */}
        {onConnectStep && showGarminForm && (
          <form onSubmit={handleGarminSubmit} className="space-y-4 animate-fade-in">
            <div className="bg-page/50 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-brand-600 mt-0.5 shrink-0" />
              <p className="text-xs text-ink-400">
                <span className="text-ink-700 font-medium">{to('oneTimeSetup')}</span> {to('garminHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-500 mb-1">
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
              <label className="block text-sm font-medium text-ink-500 mb-1">
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
                  className="absolute end-1.5 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-900 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="text-xs text-ink-400 mt-1.5">
                {t('tapEye')}
              </p>
            </div>

            {displayError && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-accent-red-ink text-sm">
                {displayError}
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

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={backFromGarminForm}
            >
              {tc('back')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              // `false` when a watch is already on the row: they backed out of
              // switching accounts, so the done screen must not tell them
              // nothing is connected.
              onClick={() => finishWithoutCredentials(!garminConnected)}
              disabled={step === 'connecting'}
            >
              {to('connectLater')}
            </Button>
          </form>
        )}

        {/* Step 3b: MFA verification */}
        {step === 'mfa' && (
          <form onSubmit={handleMfaSubmit} className="space-y-4 animate-fade-in">
            <div className="bg-band-3/10 border border-band-3/30 rounded-lg p-3 flex items-start gap-2">
              <Shield className="h-4 w-4 text-band-3 mt-0.5 shrink-0" />
              <p className="text-xs text-ink-500">
                <span className="text-band-3 font-medium">{to('verificationRequired')}</span> {to('mfaHelper')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-500 mb-1">
                {to('verificationCode')}
              </label>
              <Input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={to('enterCode')}
                maxLength={6}
                className="border-band-3/50 focus:ring-band-3 text-center text-xl tracking-widest"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-accent-red-ink text-sm">
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
