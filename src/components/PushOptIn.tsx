'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, X } from 'lucide-react';
import { isStandalone, isIosDevice, subscribeToPush, ensurePushSubscription } from '@/lib/pwa';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { logClient } from '@/lib/client-log';

const DISMISS_KEY = 'push_optin_dismissed';
// Last day (YYYY-MM-DD) the subscription self-heal ran successfully on this
// device — see ensurePushSubscription. Once a day is plenty: the thing it
// repairs only changes when iOS drops the subscription.
const HEAL_KEY = 'push_sub_healed_on';
// Belt to the localStorage braces: never run the heal twice in one page life,
// even if the effect re-runs or the recheck event fires.
let healAttempted = false;
// Set once a concrete push benefit is imminent for this athlete (see
// requestPushOptInPrompt below). We gate on this instead of showing the ask on
// every dashboard load, so it only surfaces right when the value is obvious —
// e.g. right after submitting workout feedback ("we'll notify you when your
// coach replies").
const TRIGGER_KEY = 'push_optin_trigger';
const RECHECK_EVENT = 'push-optin-recheck';

// Call this at the moment push notifications become concretely useful — e.g.
// immediately after an athlete submits workout feedback, so the next thing
// that could happen (a coach reply) is exactly what the prompt promises.
// Flips a persisted flag and asks any mounted PushOptIn to re-evaluate; it
// still won't show if the athlete already granted/denied/dismissed.
export function requestPushOptInPrompt() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TRIGGER_KEY, '1');
  window.dispatchEvent(new Event(RECHECK_EVENT));
}

export function PushOptIn({ title, description }: { title?: string; description?: string } = {}) {
  const t = useTranslations('push');
  const { answered: installAnswered } = useInstallStep();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    // Repair a subscription iOS dropped behind our back. This runs for athletes
    // who ALREADY granted permission — precisely the case every other path here
    // returns early on, which is why a dead subscription used to stay dead.
    const heal = () => {
      if (healAttempted) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const athleteId = localStorage.getItem('athlete_id');
      if (!athleteId) return;
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(HEAL_KEY) === today) return;
      healAttempted = true;
      ensurePushSubscription(athleteId)
        .then((result) => {
          // Stamp only on success, so a failing device retries next open
          // instead of going quiet until tomorrow.
          if (result.ok) localStorage.setItem(HEAL_KEY, today);
          // A resubscribe means we just found (and fixed) a dropped
          // subscription — worth a server-side record, since the whole point is
          // that this failure is otherwise invisible. Failures too.
          if (result.action === 'resubscribed' || !result.ok) logClient('push-heal', { ...result });
        })
        .catch(() => {});
    };
    heal();

    const check = () => {
      if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
      // See isIosDevice's own comment — subscribing from a regular Safari tab
      // permanently taints how iOS presents this subscription's notifications.
      // Don't offer the prompt at all until launched from the home screen icon.
      if (isIosDevice() && !isStandalone()) return;
      if (!localStorage.getItem('athlete_id')) return; // only athletes have a subscription target
      // Only ask once a concrete benefit is imminent (see requestPushOptInPrompt)
      // — not as a blanket ask on every dashboard visit.
      if (localStorage.getItem(TRIGGER_KEY) !== '1') return;

      // Don't nag if this device is already subscribed.
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => { if (!sub) setShow(true); })
        .catch(() => {});
    };

    check(); // covers the trigger having already fired earlier this session
    window.addEventListener(RECHECK_EVENT, check);
    return () => window.removeEventListener(RECHECK_EVENT, check);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const athleteId = localStorage.getItem('athlete_id') || '';
      const result = await subscribeToPush(athleteId);
      if (result.ok) setShow(false);
      else if (result.error === 'permission_denied') dismiss();
      // any other error: leave the banner so the user can retry
    } finally {
      setBusy(false);
    }
  };

  // Never ask for push before the install step has been answered. On iOS a
  // subscription created from a Safari tab is tagged as page-origin push
  // permanently — so asking first would quietly cost this device native-looking
  // notifications for good, which is the whole reason install comes first.
  if (!show || !installAnswered) return null;

  return (
    // z-50 so it sits ABOVE the bottom tab bar (which is fixed bottom-0 z-40),
    // and lifted clear of the ~72px tab bar on mobile so the Enable button is
    // never hidden behind it. On desktop (no tab bar) it sits at the normal edge.
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 pb-[calc(72px+env(safe-area-inset-bottom)+8px)] md:pb-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md bg-card rounded-card border border-page shadow-2xl p-4 flex items-start gap-3">
        <div className="bg-brand-600/20 w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
          <Bell className="h-5 w-5 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-ink-700">{title || t('title')}</h2>
          <p className="text-xs text-ink-400 mt-0.5">{description || t('description')}</p>
          <button
            onClick={enable}
            disabled={busy}
            className="mt-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {busy ? t('enabling') : t('enable')}
          </button>
        </div>
        <button onClick={dismiss} aria-label={t('dismiss')} className="text-ink-400 hover:text-ink-900 shrink-0">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/**
 * PushOptIn pre-filled for the "waiting on coach approval" moment — used on
 * both pending-approval screens (the standalone route and join/onboard's
 * inline done state). Triggers on its own mount, so each screen just renders
 * this instead of wiring up requestPushOptInPrompt() + the copy itself.
 */
export function ApprovalPushOptIn() {
  const t = useTranslations('push');
  useEffect(() => { requestPushOptInPrompt(); }, []);
  return <PushOptIn title={t('approvalTitle')} description={t('approvalDescription')} />;
}
