'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Shield, Watch, Smartphone, Calendar, Check, Eye, EyeOff } from 'lucide-react';
import { InsetSection, InsetRow, Button } from '@/components/ui';
import { cn, resolveGroup } from '@/lib/utils';
import { InstallGuide, INSTALL_GUIDE_SEEN_KEY } from '@/components/install/InstallGuide';
import { ContinueOnPhone } from '@/components/install/ContinueOnPhone';
import { useIsComputer } from '@/lib/install/use-computer';
import { usePreviewOnboardingV2 } from '@/lib/install/v2';
import { isStandalone } from '@/lib/pwa';
import { trackOnb } from '@/lib/onboarding/track';
import {
  JOURNEY, JourneyCard, JourneyHero, JourneyRow, JourneyScreen, JourneyTracker, NextCard, PrimaryButton, SecondaryButton,
} from '@/components/onboarding/journey-ui';

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

type T = ReturnType<typeof useTranslations>;

/** A pace group's member-facing name: "קבוצה N" (never the English "Group N"), or the club's own name. */
function groupNameHe(name: string, t: T): string {
  const i = resolveGroup(name).index;
  return i >= 0 ? t('groupN', { n: i + 1 }) : name;
}

/** "SUB 2:30" → "יעד מרתון תת 2:30"; empty when the group has no goal set. */
function goalHe(goal: string | undefined, t: T): string {
  const g = (goal || '').trim();
  return g ? t('goal', { goal: g.replace(/^sub\s*/i, t('subPrefix') + ' ') }) : '';
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
  const computer = useIsComputer();
  // The illustrated install guide over the done screen, while it is tried (lib/install/v2).
  const guideV2 = usePreviewOnboardingV2();
  // A phone that already went through the guide (on the landing) is not walked
  // through it again in full: it gets the "saved" screen, which offers it once more.
  const [guideClosed, setGuideClosed] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem(INSTALL_GUIDE_SEEN_KEY) === '1'; } catch { return false; }
  });
  // "סיימתי" at the guide's last step: they say it is on the home screen now.
  const [guideDone, setGuideDone] = useState(false);
  useEffect(() => { trackOnb('join_open', { token, once: true }); }, [token]);
  // Which end screen this member got, once it is on screen.
  useEffect(() => {
    if (step === 'done' && guideV2 && !guideClosed) trackOnb(computer ? 'continue_on_phone_shown' : 'install_guide_shown', { token, once: true });
  }, [step, guideV2, guideClosed, computer, token]);
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // What the groups API said about this link: 'invalid' = it knows no athlete for it.
  const [linkState, setLinkState] = useState<'loading' | 'ok' | 'invalid'>('loading');
  // v2: the details on file are shown read-only to confirm; `editing` is the form.
  // Starts as the form whenever something required is missing.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // Opened from the home-screen icon (a phone that saved this address rather than
    // the manifest's start_url): this is the first open of the installed app, so
    // it belongs on the welcome screen, not on the form again.
    if (isStandalone()) {
      window.location.replace(`/welcome?t=${encodeURIComponent(token)}`);
      return;
    }
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
    if (returned === 'invalid' || returned === 'error' || returned === 'duplicate') {
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
        const hasGroup = fetchedGroups.length === 0 || !!me?.groupId || fetchedGroups.length === 1;
        setEditing(!(me?.name && me?.email && hasGroup));
        setLinkState(me ? 'ok' : 'invalid');
      })
      // A failed read is not a dead link: show the form, as before.
      .catch(() => { setEditing(true); setLinkState('ok'); });
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

  // Also the confirm step's "הכול נכון, ממשיכים" (no event there).
  const handleInfoSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (groups.length > 0 && !selectedGroup) {
      setError(t('selectPaceGroupError'));
      setEditing(true);
      return;
    }
    setError(null);
    // Onboarding v2: install FIRST, sign in once inside the app afterwards (an
    // iPhone's home-screen app does not share Safari's login). So the details are
    // saved and the guide comes next — no Strava or Garmin here.
    if (guideV2) {
      setStep('connecting');
      persistProfile()
        // Nothing was connected on this path, so the done screen must not say
        // "you're connected — your Garmin is linked" (it did, 2026-10-09).
        .then(() => { trackOnb('join_saved', { token }); setSkippedGarmin(true); setStep('done'); })
        .catch((err) => { setError(err instanceof Error ? err.message : String(err)); setStep('info'); });
      return;
    }
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
    (stravaReturn === 'invalid'
      ? t('stravaInviteInvalid')
      : stravaReturn === 'duplicate'
        ? t('stravaAlreadyLinked')
        : stravaReturn
          ? t('stravaConnectFailed')
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

  const first = (name || '').split(/\s+/)[0] || '';
  const welcomeTitle = first ? t('welcomeName', { name: first }) : t('welcome');
  const tracker = <JourneyTracker done={2} computer={computer} />;
  const selected = groups.find(g => g.id === selectedGroup);

  if (step === 'done') {
    return (
      <>
      {guideV2 && !guideClosed && (computer
        // On a computer: no home-screen guide. Invite them to the phone, never block (ContinueOnPhone).
        ? <ContinueOnPhone token={token} firstName={(name || '').split(/\s+/)[0] || null} onContinueHere={() => { trackOnb('continue_on_computer', { token }); window.location.assign(`/welcome?t=${encodeURIComponent(token)}`); }} />
        : <InstallGuide canPrompt={false} onLater={() => setGuideClosed(true)} onDone={() => { setGuideDone(true); setGuideClosed(true); }} memberName={name || null} />)}
      {/* What is under the guide, and what "לא עכשיו" lands on. It used to be a
          "registration complete → to the dashboard" card, which contradicted the
          guide (there is no session yet on this path: v2 signs in once, at
          /welcome). Now it says the one true thing — saved, the install is next —
          and offers the guide again or the browser sign-in. */}
      {guideV2 && guideDone ? (
        <JourneyScreen
          hero={<JourneyHero eyebrow={t('approvedEyebrow')} title={t('installedTitle')} subtitle={t('installedSub')} />}
          actions={<SecondaryButton href={`/welcome?t=${encodeURIComponent(token)}`}>{t('savedBrowserCta')}</SecondaryButton>}
        >
          <JourneyTracker done={3} />
          <NextCard label={t('nextUp')} title={t('installedNextTitle')}>{t('installedNextBody')}</NextCard>
          <SecondaryButton onClick={() => { setGuideDone(false); setGuideClosed(false); }}>{t('installedNotThere')}</SecondaryButton>
        </JourneyScreen>
      ) : guideV2 ? (
        <JourneyScreen
          hero={<JourneyHero eyebrow={t('approvedEyebrow')} title={t('savedTitle')} subtitle={t('savedSub')} />}
          actions={
            <>
              <PrimaryButton onClick={() => setGuideClosed(false)}>{t('savedInstallCta')}</PrimaryButton>
              <SecondaryButton href={`/welcome?t=${encodeURIComponent(token)}`}>{t('savedBrowserCta')}</SecondaryButton>
            </>
          }
        >
          {tracker}
          <NextCard label={t('nextUp')} title={t('savedNextTitle')}>{t('savedNextBody')}</NextCard>
        </JourneyScreen>
      ) : (
        <JourneyScreen
          hero={
            <JourneyHero
              eyebrow={t('approvedEyebrow')}
              title={skippedGarmin ? to('registrationComplete') : t('youreConnected')}
              subtitle={skippedGarmin ? to('canConnectLater') : t('garminLinkedCoach')}
            />
          }
          actions={<PrimaryButton href="/dashboard/program">{skippedGarmin ? t('goToDashboard') : t('viewProgram')}</PrimaryButton>}
        >
          {tracker}
          {/* What's Next Section */}
          {!skippedGarmin && (
            <>
              <InsetSection header={t('whatsNext')}>
                <InsetRow icon={Calendar} iconBg="bg-brand-600" label={t('receiveWorkouts')} sublabel={t('receiveWorkoutsDesc')} />
                <InsetRow icon={Smartphone} iconBg="bg-brand-600" label={t('syncPhone')} sublabel={t('syncPhoneDesc')} />
                <InsetRow icon={Watch} iconBg="bg-brand-600" label={t('findOnWatch')} sublabel={t('findOnWatchDesc')} />
              </InsetSection>
              <p className="text-center text-[13px]" style={{ color: JOURNEY.soft }}>{t('bluetoothNote')}</p>
            </>
          )}
        </JourneyScreen>
      )}
      </>
    );
  }

  // The groups API answers no athlete for a token it does not know: an old link, a
  // used one, a typo. That used to render an empty join form; it is a dead end, so
  // say so and offer the two ways on. /welcome without a link IS the email-code
  // sign-in (/login only redirects to the marketing page).
  if (linkState === 'invalid') {
    return (
      <JourneyScreen
        testId="join-invalid"
        hero={<JourneyHero title={t('invalidTitle')} subtitle={t('invalidSub')} />}
        actions={
          <>
            <PrimaryButton href="/welcome">{t('invalidCta')}</PrimaryButton>
            <SecondaryButton href="/register?onb=v2">{t('invalidRegister')}</SecondaryButton>
          </>
        }
      >
        <NextCard label={t('invalidNextLabel')} title={t('invalidNextTitle')}>{t('invalidNextBody')}</NextCard>
      </JourneyScreen>
    );
  }

  if (linkState === 'loading' && (step === 'info' || step === 'auth')) {
    return (
      <JourneyScreen hero={<JourneyHero eyebrow={t('approvedEyebrow')} title={t('welcome')} />}>
        <div className="flex flex-1 items-center justify-center py-10" style={{ color: JOURNEY.soft }}>
          <Loader2 className="h-6 w-6 animate-spin" aria-label={tc('loading')} />
        </div>
      </JourneyScreen>
    );
  }

  const busy = step === 'connecting';
  const errorBox = (msg: string | null) => msg && (
    <p role="alert" className="rounded-2xl px-4 py-2.5 text-center text-[14px] font-bold text-white" style={{ background: JOURNEY.red }}>{msg}</p>
  );

  // Onboarding v2, the approval link: the details are on file, so CONFIRM them
  // instead of asking for them a second time. "תיקון" opens the same form.
  if (guideV2 && (step === 'info' || busy) && !editing) {
    return (
      <JourneyScreen
        testId="join-confirm"
        hero={<JourneyHero eyebrow={t('approvedEyebrow')} title={welcomeTitle} subtitle={t('confirmSub')} />}
        actions={
          <>
            <PrimaryButton onClick={() => handleInfoSubmit()} disabled={busy}>{busy ? t('saving') : t('confirmCta')}</PrimaryButton>
            <SecondaryButton onClick={() => { setError(null); setEditing(true); }} disabled={busy}>{t('confirmFix')}</SecondaryButton>
          </>
        }
      >
        {tracker}
        <JourneyCard>
          <JourneyRow icon="👤" title={<bdi>{name}</bdi>} sub={<bdi dir="ltr">{email}</bdi>} />
          {selected && <JourneyRow icon="🏃" title={groupNameHe(selected.name, t)} sub={goalHe(selected.marathonGoal, t)} />}
        </JourneyCard>
        {errorBox(error)}
      </JourneyScreen>
    );
  }

  const fieldCls = 'h-[52px] w-full rounded-2xl border bg-white px-4 text-base focus:outline-none';
  const fieldStyle = { borderColor: JOURNEY.line, color: JOURNEY.ink };

  if (step === 'info' || (guideV2 && busy)) {
    return (
      <form onSubmit={handleInfoSubmit}>
        <JourneyScreen
          hero={
            <JourneyHero
              eyebrow={t('approvedEyebrow')}
              title={welcomeTitle}
              subtitle={guideV2 ? t('fixSub') : garminReady ? t('resumeDesc') : t('joinDesc')}
            />
          }
          actions={<PrimaryButton type="submit" disabled={busy}>{busy ? t('saving') : tc('continue')}</PrimaryButton>}
        >
          {tracker}
          <div>
            <label htmlFor="jt-yourName" className="mb-1 block text-[13px] font-bold" style={{ color: JOURNEY.soft }}>
              {to('yourName')}
            </label>
            <input id="jt-yourName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              autoComplete="name"
              required
              className={fieldCls} style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="jt-emailLabel" className="mb-1 block text-[13px] font-bold" style={{ color: JOURNEY.soft }}>
              {to('emailLabel')}
            </label>
            <input id="jt-emailLabel"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              dir={email ? 'ltr' : 'rtl'}
              autoComplete="email"
              required
              className={cn(fieldCls, email ? 'text-left' : 'text-right')} style={fieldStyle}
            />
          </div>
          {groups.length > 0 && (
            <fieldset>
              <legend className="mb-1 block text-[13px] font-bold" style={{ color: JOURNEY.soft }}>{to('yourPaceGroup')}</legend>
              <div className="flex flex-col gap-2">
                {groups.map(g => {
                  const isSelected = selectedGroup === g.id;
                  const goal = goalHe(g.marathonGoal, t);
                  return (
                    <label
                      key={g.id}
                      className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border-2 bg-white px-4"
                      style={{ borderColor: isSelected ? JOURNEY.dusk : JOURNEY.line }}
                    >
                      <input type="radio" name="join-group" checked={isSelected} onChange={() => setSelectedGroup(g.id)} className="sr-only" />
                      <span className="min-w-0 flex-1 text-[15px]" style={{ color: JOURNEY.ink }}>
                        <b>{groupNameHe(g.name, t)}</b>{goal && <span style={{ color: JOURNEY.soft }}> · {goal}</span>}
                      </span>
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2"
                        style={isSelected ? { background: JOURNEY.dusk, borderColor: JOURNEY.dusk } : { borderColor: JOURNEY.line }}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[13px]" style={{ color: JOURNEY.soft }}>{t('groupPaceNote')}</p>
            </fieldset>
          )}
          {errorBox(error)}
        </JourneyScreen>
      </form>
    );
  }

  // The old (pre-v2) flow's connect steps — Strava, Garmin, Garmin MFA — in the same look.
  return (
    <JourneyScreen
      hero={
        <JourneyHero
          eyebrow={t('approvedEyebrow')}
          title={welcomeTitle}
          subtitle={step === 'mfa' ? to('verificationRequired') : garminReady ? t('resumeDesc') : showGarminForm ? t('connectGarminDesc') : t('connectStravaDesc')}
        />
      }
    >
      {tracker}
      <div className="pb-6">
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
                  <p className="text-13 text-ink-400 mt-1 leading-relaxed">{t('garminAlreadyConnectedDesc')}</p>
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
            <p className="text-13 text-ink-400 leading-relaxed text-center">
              {garminReady ? t('stravaWhyGarmin') : t('stravaWhy')}
            </p>
            {/* Strava's authorize page offers SIGNUP to anyone who isn't already
                signed in on this device, and a member who takes that door gets an
                empty new account the app cannot tell apart from a real one. Warned
                here because this is registration — the one moment when the person is
                most likely not to be signed in to Strava yet. */}
            <p className="text-13 text-ink-400 leading-relaxed text-center">
              {t('stravaUseExistingAccount')}
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
                className="w-full min-h-[44px] text-13 font-medium text-ink-400 hover:text-ink-700 transition-colors disabled:opacity-50"
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
              <p className="text-13 text-ink-400">
                <span className="text-ink-700 font-medium">{to('oneTimeSetup')}</span> {to('garminHelper')}
              </p>
            </div>

            <div>
              <label htmlFor="jt-garminEmail" className="block text-sm font-medium text-ink-500 mb-1">
                {to('garminEmail')}
              </label>
              <Input id="jt-garminEmail"
                type="email"
                value={garminEmail}
                onChange={(e) => setGarminEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                required
              />
            </div>

            <div>
              <label htmlFor="jt-garminPassword" className="block text-sm font-medium text-ink-500 mb-1">
                {to('garminPassword')}
              </label>
              <div className="relative">
                <Input id="jt-garminPassword"
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
              <p className="text-13 text-ink-400 mt-1.5">
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
              <p className="text-13 text-ink-500">
                <span className="text-band-3-ink font-medium">{to('verificationRequired')}</span> {to('mfaHelper')}
              </p>
            </div>

            <div>
              <label htmlFor="jt-verificationCode" className="block text-sm font-medium text-ink-500 mb-1">
                {to('verificationCode')}
              </label>
              <Input id="jt-verificationCode"
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
    </JourneyScreen>
  );
}
