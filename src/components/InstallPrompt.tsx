'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Share, Plus, PartyPopper, X } from 'lucide-react';
import { isStandalone } from '@/lib/pwa';

// The `beforeinstallprompt` event isn't in the DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Permanent opt-out (explicit "don't ask again"). Separate from SESSION_SKIP_KEY
// below, which is a soft "not now" that should still resurface on a later visit.
const DISMISS_KEY = 'pwa_install_dismissed';
const SESSION_SKIP_KEY = 'pwa_install_skipped_session';

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; disambiguate via touch.
    (/macintosh/i.test(ua) && 'ontouchend' in document);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return isIos && isSafari;
}

export function InstallPrompt() {
  const t = useTranslations('install');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    if (sessionStorage.getItem(SESSION_SKIP_KEY) === '1') return;

    // Android / Chromium: capture the install event and show our own button.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Once installed, hide the modal and remember it.
    const onInstalled = () => {
      setDeferredPrompt(null);
      setShowIosSteps(false);
      localStorage.setItem(DISMISS_KEY, '1');
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari has no beforeinstallprompt — walk through the manual steps instead.
    if (isIosSafari()) setShowIosSteps(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Soft dismiss — closes for this visit, resurfaces next session.
  const notNow = () => {
    sessionStorage.setItem(SESSION_SKIP_KEY, '1');
    setDeferredPrompt(null);
    setShowIosSteps(false);
  };

  // Hard opt-out — only reachable via an explicit "don't ask again" action.
  const dontAskAgain = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferredPrompt(null);
    setShowIosSteps(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Whatever the choice, don't keep nagging on this device.
    setDeferredPrompt(null);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  if (!deferredPrompt && !showIosSteps) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={notNow}
    >
      <div
        className="w-full max-w-md bg-card rounded-t-3xl sm:rounded-3xl border border-page shadow-2xl overflow-hidden safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-base font-bold text-ink-700">
            {showIosSteps ? t('iosStepsTitle') : t('title')}
          </h2>
          <button onClick={notNow} aria-label={t('dismiss')} className="-m-2 p-2 text-ink-400 hover:text-ink-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {showIosSteps ? (
          <div className="px-5 pb-5 pt-4">
            <ol className="space-y-3">
              {[
                { icon: Share, text: t('iosStep1') },
                { icon: Plus, text: t('iosStep2') },
                { icon: PartyPopper, text: t('iosStep3') },
              ].map((step, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-sm font-bold text-brand-600">
                    {i + 1}
                  </span>
                  <step.icon className="h-4 w-4 shrink-0 text-ink-500" />
                  <span className="text-sm text-ink-700">{step.text}</span>
                </li>
              ))}
            </ol>
            <button
              onClick={dontAskAgain}
              className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              {t('gotIt')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 pb-5 pt-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-brand-600/20">
              <Image src="/images/icon-192.png" alt="" width={40} height={40} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-400">{t('description')}</p>
            <div className="mt-4 flex w-full flex-col gap-2">
              <button
                onClick={handleInstall}
                className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {t('installButton')}
              </button>
              <button
                onClick={notNow}
                className="w-full rounded-xl border border-ink-300 py-3 text-sm font-medium text-ink-700 transition-colors hover:bg-page"
              >
                {t('skip')}
              </button>
            </div>
            <button onClick={dontAskAgain} className="mt-3 text-xs text-ink-400 underline hover:text-ink-500">
              {t('dontAskAgain')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
