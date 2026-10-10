'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Watch, X } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { connectPromptVariant, type ConnectPromptVariant } from '@/lib/connect-prompt';
import { useOnboarding } from '@/lib/onboarding/use-onboarding';
import { useOnboardingV2 } from '@/lib/install/v2';
import { nudgeAllowed, nudgeAllowedV2, nudgeDayKey, nudgeLedgerKey, readNudgeLedger, type NudgeLedger } from '@/lib/onboarding/nudge-ledger';
import { JOURNEY, PrimaryButton, SecondaryButton } from '@/components/onboarding/journey-ui';

/** "אחר כך" this many times and it stops asking (the old "אל תציגו שוב", by count). */
const LATER_KEY = 'connect_data_source_later_count';
const MAX_LATERS = 3;

/**
 * First-run "connect your training data" nudge (roadmap flow #22, step 2).
 *
 * Google Sign-In only creates the account — it carries no Strava/Garmin
 * token, so a brand-new (or Google-only) athlete lands on the dashboard with
 * neither data source connected. This is a soft, dismissible prompt (not a
 * hard redirect/gate) pointing at the existing profile "Activity Data
 * Source" section (Strava + Garmin connect, built in
 * dashboard/profile/page.tsx — not duplicated here), with a "log it by hand"
 * fallback for athletes who have neither device/app.
 *
 * Was `GarminReminderPopup` (Garmin-only, unused/never mounted anywhere).
 * Renamed + extended to also clear when Strava is connected, and to surface
 * the manual-entry fallback, then mounted in the dashboard layout.
 *
 * It asks one of two different questions — see connectPromptVariant(). "Connect
 * Strava or Garmin" is the right ask of an account with neither, and the wrong one
 * of a Strava-only member: their runs already arrive, and what they are actually
 * missing is the only channel a coach's workout can take to a watch. Since a Strava
 * sign-in no longer walks /join (where the Garmin step lives), that member is now
 * the common case rather than an edge one, so the Garmin ask has its own copy and
 * drops the manual-logging fallback, which would make no sense to somebody whose
 * runs are already flowing in.
 *
 * ONE PROMPT AT A TIME (journey audit, 2026-10-10). Right after the first run the
 * feed stacked three asks: the install strip, the setup checklist ("5 things
 * left", which leads with the watch) and this modal on top. So it now waits while
 * the feed's setup checklist (SetupNudgeCard) may be showing — same conditions,
 * same ledger — and when it does show it has one quiet way out, "אחר כך"; the
 * manual-logging link and "don't show again" are gone. "Don't show again" is
 * kept by count: the third "later" retires it, like the install offer's three.
 */
export function ConnectDataSourcePopup() {
  const router = useRouter();
  const t = useTranslations('connectPrompt');
  const [variant, setVariant] = useState<ConnectPromptVariant>('none');
  const { data: onboarding } = useOnboarding();
  const v2 = useOnboardingV2();
  // The feed's setup-checklist ledger (SetupNudgeCard), read once. null = not yet.
  const [ledger, setLedger] = useState<NudgeLedger | null>(null);

  useEffect(() => {
    if (window.location.pathname.includes('/profile')) return;
    if (window.location.pathname.includes('/activities')) return;

    // Staff don't get nagged to connect a watch. This read `localStorage.role`,
    // a key nothing in the app has ever written — so the bypass never fired and
    // coaches got the popup on every dashboard page. These are the keys that
    // actually exist (same test as dashboard/program's isAdmin).
    const isStaff =
      localStorage.getItem('admin_session') === 'true' || !!localStorage.getItem('coach_email');
    if (isStaff) return;

    const athleteId = localStorage.getItem('athlete_id');
    if (!athleteId) return;

    const dismissed = localStorage.getItem('connect_data_source_dismissed');
    if (dismissed === 'forever') return;

    const sessionDismissed = sessionStorage.getItem('connect_data_source_dismissed_session');
    if (sessionDismissed) return;

    try {
      setLedger(readNudgeLedger(localStorage.getItem(nudgeLedgerKey(athleteId))));
    } catch {
      setLedger({ days: [], skipped: true }); // private mode: the card can't show either
    }

    let mounted = true;
    apiHeaders()
      .then(headers => fetch(`/api/athletes/me?id=${athleteId}`, { headers }))
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (mounted && data?.athlete) setVariant(connectPromptVariant(data.athlete));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (variant === 'none') return null;
  // Wait for the setup state, then stay out of the way while the checklist on the
  // feed (SetupNudgeCard: same conditions) carries the ask. Hiding, not
  // dismissing: the next visit decides again.
  if (!onboarding || !ledger) return null;
  const today = nudgeDayKey(new Date());
  const nudgeMayShow = v2 ? nudgeAllowedV2(ledger, today) : nudgeAllowed(ledger, today);
  const checklistUp =
    onboarding.applicable &&
    !onboarding.completed &&
    !onboarding.allDone &&
    onboarding.tourSeen &&
    onboarding.tasks.some((task) => !task.done) &&
    nudgeMayShow;
  if (checklistUp) return null;
  // The first run is still ahead, or just ending (the "seen" stamp is on its way):
  // the tour hands over to the checklist, not to this.
  if (onboarding.applicable && onboarding.migrated && !onboarding.tourSeen) return null;

  // Both asks share one "stop asking me" switch. Someone who said never when they
  // had nothing connected is not asked again for having connected only half of it.
  const garminOnly = variant === 'garmin';

  const handleRemindLater = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    try {
      const n = (Number(localStorage.getItem(LATER_KEY)) || 0) + 1;
      localStorage.setItem(LATER_KEY, String(n));
      if (n >= MAX_LATERS) localStorage.setItem('connect_data_source_dismissed', 'forever');
    } catch { /* private mode */ }
    setVariant('none');
  };

  const handleConnect = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setVariant('none');
    router.push('/dashboard/profile?connectGarmin=1');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" dir="rtl">
      <div className="relative w-full max-w-sm rounded-[28px] bg-white p-6">
        <button
          onClick={handleRemindLater}
          className="absolute top-2 end-2 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ color: JOURNEY.soft }}
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: JOURNEY.tagBg, color: JOURNEY.tag }}>
            {garminOnly
              ? <Watch className="h-7 w-7" />
              : <Activity className="h-7 w-7" />}
          </div>

          <h2 className="text-[20px] font-black" style={{ color: JOURNEY.ink }}>{t(garminOnly ? 'garminTitle' : 'title')}</h2>
          <p className="mt-2 text-[15px] leading-relaxed" style={{ color: JOURNEY.soft }}>
            {t(garminOnly ? 'garminDescription' : 'description')}
          </p>

          <div className="mt-5 flex w-full flex-col gap-1">
            <PrimaryButton onClick={handleConnect}>{t(garminOnly ? 'garminConnectNow' : 'connectNow')}</PrimaryButton>
            <SecondaryButton onClick={handleRemindLater}>{t('later')}</SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
