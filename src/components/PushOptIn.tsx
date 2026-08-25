'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, X } from 'lucide-react';
import { isStandalone, isIosDevice, subscribeToPush } from '@/lib/pwa';

const DISMISS_KEY = 'push_optin_dismissed';
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
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

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

  if (!show) return null;

  return (
    // z-50 so it sits ABOVE the bottom tab bar (which is fixed bottom-0 z-40),
    // and lifted clear of the ~72px tab bar on mobile so the Enable button is
    // never hidden behind it. On desktop (no tab bar) it sits at the normal edge.
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 pb-[calc(72px+env(safe-area-inset-bottom)+8px)] md:pb-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-4 flex items-start gap-3">
        <div className="bg-primary-500/20 w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
          <Bell className="h-5 w-5 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white">{title || t('title')}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{description || t('description')}</p>
          <button
            onClick={enable}
            disabled={busy}
            className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {busy ? t('enabling') : t('enable')}
          </button>
        </div>
        <button onClick={dismiss} aria-label={t('dismiss')} className="text-slate-400 hover:text-white shrink-0">
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
