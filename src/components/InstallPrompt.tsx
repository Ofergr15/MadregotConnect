'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Share, Plus, X } from 'lucide-react';

// The `beforeinstallprompt` event isn't in the DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa_install_dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

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
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    // Android / Chromium: capture the install event and show our own button.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Once installed, hide the banner and remember it.
    const onInstalled = () => {
      setDeferredPrompt(null);
      setShowIosHint(false);
      localStorage.setItem(DISMISS_KEY, '1');
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari has no beforeinstallprompt — show a manual hint instead.
    if (isIosSafari()) setShowIosHint(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferredPrompt(null);
    setShowIosHint(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Whatever the choice, don't keep nagging on this device.
    setDeferredPrompt(null);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  if (!deferredPrompt && !showIosHint) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 safe-bottom pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl p-4 flex items-start gap-3">
        <div className="bg-primary-500/20 w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
          <Download className="h-5 w-5 text-primary-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white">{t('title')}</h2>

          {deferredPrompt ? (
            <>
              <p className="text-xs text-slate-400 mt-0.5">{t('description')}</p>
              <button
                onClick={handleInstall}
                className="mt-3 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('installButton')}
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-1">
              {t('iosHintPrefix')}
              <Share className="inline h-3.5 w-3.5 text-slate-300" />
              {t('iosHintMiddle')}
              <Plus className="inline h-3.5 w-3.5 text-slate-300" />
              {t('iosHintSuffix')}
            </p>
          )}
        </div>

        <button
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="text-slate-400 hover:text-white shrink-0"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
