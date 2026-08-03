'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, X } from 'lucide-react';

const DISMISS_KEY = 'push_optin_dismissed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushOptIn() {
  const t = useTranslations('push');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    if (!localStorage.getItem('athlete_id')) return; // only athletes have a subscription target

    // Don't nag if this device is already subscribed.
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (!sub) setShow(true); })
      .catch(() => {});
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapid) throw new Error('missing VAPID key');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { dismiss(); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteId: localStorage.getItem('athlete_id'),
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });
      setShow(false);
    } catch {
      // leave the banner so the user can retry
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-4 safe-bottom pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-4 flex items-start gap-3">
        <div className="bg-primary-500/20 w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
          <Bell className="h-5 w-5 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white">{t('title')}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{t('description')}</p>
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
