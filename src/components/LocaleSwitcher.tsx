'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Globe } from 'lucide-react';

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const switchLocale = () => {
    const newLocale = locale === 'he' ? 'en' : 'he';
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${60 * 60 * 24 * 365}`;
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <button
      onClick={switchLocale}
      disabled={isPending}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 transition-colors disabled:opacity-50"
      title={locale === 'he' ? 'Switch to English' : 'עבור לעברית'}
    >
      <Globe className="h-3.5 w-3.5" />
      {locale === 'he' ? 'EN' : 'עב'}
    </button>
  );
}
