'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { mutate } from 'swr';
import { BellRing, HeartHandshake, MessageCircle, CalendarCheck } from 'lucide-react';
import { subscribeToPush } from '@/lib/pwa';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { ONBOARDING_KEY, useOnboarding } from '@/lib/onboarding/use-onboarding';
import {
  PUSH_STEP_DISMISS_KEY,
  PUSH_STEP_SESSION_SKIP_KEY,
  canShowNotificationsStep,
  recordPushStepSkipped,
  type PushPermissionState,
} from '@/lib/onboarding/first-run-order';
import { logClient } from '@/lib/client-log';

// ═════════════════════════════════════════════════════════════════════════════
// Step 3 of the first run: turn notifications on — after the icon is on the home
// screen and after the tour, before the setup checklist.
//
// This is the only screen in the app that ASKS a new athlete for push
// permission. PushOptIn's banner needs a `push_optin_trigger` flag that exactly
// one page sets (workout feedback), so anybody who hadn't submitted feedback was
// simply never asked — see first-run-order.ts for the numbers that came out of.
//
// The OS prompt is reached ONLY from the primary button here. That's the whole
// design: `Notification.requestPermission()` fires once per origin for all time
// and a denial can't be undone from inside the page, so every way out of this
// sheet that isn't a deliberate "yes" has to leave the prompt unspent.
// ═════════════════════════════════════════════════════════════════════════════

/** What the browser reports, normalised so an absent `Notification` is a value. */
function readPermission(): PushPermissionState {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  return Notification.permission as PushPermissionState;
}

export function NotificationsStep() {
  const t = useTranslations('pushStep');
  const { data } = useOnboarding();
  const { answered: installAnswered } = useInstallStep();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set only for failures that are worth another tap. A denial is NOT one of
  // them: it's terminal for this origin, so it closes the step instead.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShow(canShowNotificationsStep(data, installAnswered, readPermission()));
  }, [data, installAnswered]);

  /** Gone for good: they enabled it, or asked not to be offered again. */
  const closeForever = useCallback(() => {
    localStorage.setItem(PUSH_STEP_DISMISS_KEY, '1');
    setShow(false);
  }, []);

  /** "Not now" — back on the next visit, up to PUSH_STEP_MAX_OFFERS times. */
  const skipForNow = useCallback(() => {
    sessionStorage.setItem(PUSH_STEP_SESSION_SKIP_KEY, '1');
    recordPushStepSkipped();
    setShow(false);
  }, []);

  // Escape is "not now", matching a backdrop tap and the install step. Above the
  // early return so the hook count can't change between renders.
  useEffect(() => {
    if (!show) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skipForNow();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [show, skipForNow]);

  if (!show) return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const athleteId = localStorage.getItem('athlete_id') || '';
      const result = await subscribeToPush(athleteId);
      // This is the one moment we learn whether a brand-new athlete ends up
      // reachable at all, and it happens on a real device we can't debug — so
      // record the outcome either way. `push-heal` covers the repair path; this
      // covers first acquisition.
      logClient('push-onboarding-step', { ok: result.ok, error: result.error });
      if (result.ok) {
        // The checklist scores this task off a live `push_subscriptions` row, so
        // revalidate: the athlete should see it tick without a reload.
        mutate(ONBOARDING_KEY);
        closeForever();
        return;
      }
      // Terminal — the prompt is spent and no button here can bring it back.
      // Closing for good is the honest response; the settings screen keeps the
      // recovery instructions for someone who changes their mind in iOS Settings.
      if (result.error === 'permission_denied') {
        closeForever();
        return;
      }
      setError(result.error ?? 'unknown');
    } finally {
      setBusy(false);
    }
  };

  const benefits = [
    { icon: HeartHandshake, text: t('benefitKudos') },
    { icon: MessageCircle, text: t('benefitCoach') },
    { icon: CalendarCheck, text: t('benefitPlan') },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-step-title"
      onClick={skipForNow}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-card px-5 pb-7 pt-6 shadow-2xl safe-bottom sm:rounded-3xl"
        data-testid="notifications-step"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600/15">
          <BellRing className="h-8 w-8 text-brand-600" />
        </div>

        <h2 id="push-step-title" className="mt-3.5 text-center text-lg font-bold leading-snug text-ink-700">
          {t('title')}
        </h2>
        <p className="mx-auto mt-2 max-w-[300px] text-center text-13 font-light leading-relaxed text-ink-400">
          {t('description')}
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          {benefits.map((benefit, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-600/15">
                <benefit.icon className="h-3.5 w-3.5 text-brand-600" />
              </span>
              <span className="text-13 text-ink-700">{benefit.text}</span>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mt-4 text-center text-2xs font-light leading-relaxed text-red-400">
            {t('failed')}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="flex min-h-[48px] w-full items-center justify-center rounded-pill bg-brand-600 text-[15px] font-bold text-white active:bg-brand-700 disabled:opacity-60"
          >
            {busy ? t('enabling') : error ? t('retry') : t('enable')}
          </button>
          <button
            type="button"
            onClick={skipForNow}
            disabled={busy}
            className="flex min-h-[48px] w-full items-center justify-center rounded-pill border border-page text-[15px] font-bold text-ink-700 active:bg-page disabled:opacity-60"
          >
            {t('skip')}
          </button>
        </div>

        <button
          type="button"
          onClick={closeForever}
          disabled={busy}
          className="mx-auto mt-3.5 block text-2xs font-light text-ink-400 underline disabled:opacity-60"
        >
          {t('dontAskAgain')}
        </button>
      </div>
    </div>
  );
}
