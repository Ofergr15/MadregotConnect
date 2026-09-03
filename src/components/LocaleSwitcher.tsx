'use client';

import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { apiHeaders } from '@/lib/api';

function getLocaleFromCookie(): string {
  const match = document.cookie.match(/NEXT_LOCALE=([^;]+)/);
  return match?.[1] || 'he';
}

export function LocaleSwitcher() {
  const [locale, setLocaleState] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    setLocaleState(getLocaleFromCookie());
  }, []);

  if (!locale) return null;

  const switchLocale = async () => {
    const newLocale = locale === 'he' ? 'en' : 'he';
    setSwitching(true);
    try {
      // The app's language is this cookie; the NOTIFICATION language is a saved
      // athlete preference, because the crons and sync jobs that send almost
      // every push have no request and therefore no cookie (see
      // src/lib/notifications/locale.ts). Writing only the cookie here is what
      // left an athlete with an English app and Hebrew pushes — the exact split
      // the Settings language row exists to prevent, but reachable in one tap
      // from the header, which bypassed it entirely.
      //
      // Awaited before the reload below, which would otherwise abandon the
      // request mid-flight. Best-effort though: unlike the Settings row this
      // button has nowhere to report an error, it also renders on the public
      // landing page where there is no athlete to save anything for, and the
      // route answers 501 until migration 038 is applied — none of which should
      // block someone from reading the app in their own language.
      const athleteId = localStorage.getItem('athlete_id');
      if (athleteId) {
        await fetch('/api/athletes/notification-prefs', {
          method: 'PUT',
          headers: await apiHeaders(true),
          body: JSON.stringify({ athleteId, language: newLocale }),
        }).catch(() => {});
      }
    } finally {
      document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${60 * 60 * 24 * 365}`;
      window.location.reload();
    }
  };

  return (
    <button
      onClick={switchLocale}
      disabled={switching}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-ink-300 text-ink-500 hover:text-ink-900 hover:border-ink-300 transition-colors disabled:opacity-50"
      title={locale === 'he' ? 'Switch to English' : 'עבור לעברית'}
    >
      <Globe className="h-3.5 w-3.5" />
      {locale === 'he' ? 'EN' : 'עב'}
    </button>
  );
}
