'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export default function GarminCallbackPage() {
  const t = useTranslations('onboarding');
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticket = params.get('ticket');

    if (!ticket) {
      setStatus('error');
      return;
    }

    if (window.opener) {
      window.opener.postMessage({ type: 'garmin-ticket', ticket }, '*');
      setStatus('done');
      setTimeout(() => window.close(), 1000);
    } else {
      // Mobile or popup blocked — store ticket and redirect to join page
      localStorage.setItem('garmin_ticket', ticket);
      setStatus('done');
      window.location.href = '/';
    }
  }, []);

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="text-center">
        {/* The page's only heading, and hidden because there is nothing to show:
            this is a popup that posts a ticket back and closes itself inside a
            second. Visually it is a spinner — but a screen reader landed here
            with no heading at all and no way to tell the Garmin handoff from a
            blank page. `role="status"` on the live region below is what actually
            announces the outcome. */}
        <h1 className="sr-only">{t('garminCallbackTitle')}</h1>
        <div role="status">
          {status === 'error' ? (
            <>
              <p className="text-accent-red font-medium">{t('garminNoTicket')}</p>
              <p className="text-ink-400 text-sm mt-2">{t('garminTryAgain')}</p>
            </>
          ) : (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-4"></div>
              <p className="text-ink-700 font-medium">{t('garminConnecting')}</p>
              <p className="text-ink-400 text-sm mt-2">{t('garminWindowCloses')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
