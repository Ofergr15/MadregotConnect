'use client';

import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';

function getLocaleFromCookie(): string {
  const match = document.cookie.match(/NEXT_LOCALE=([^;]+)/);
  return match?.[1] || 'he';
}

export function LocaleSwitcher() {
  const [locale, setLocaleState] = useState<string | null>(null);

  useEffect(() => {
    setLocaleState(getLocaleFromCookie());
  }, []);

  if (!locale) return null;

  const switchLocale = () => {
    const newLocale = locale === 'he' ? 'en' : 'he';
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${60 * 60 * 24 * 365}`;
    window.location.reload();
  };

  return (
    <button
      onClick={switchLocale}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 transition-colors"
      title={locale === 'he' ? 'Switch to English' : 'עבור לעברית'}
    >
      <Globe className="h-3.5 w-3.5" />
      {locale === 'he' ? 'EN' : 'עב'}
    </button>
  );
}
