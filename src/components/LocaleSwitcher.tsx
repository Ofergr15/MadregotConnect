'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/i18n/locale';

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('locale');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const switchLocale = () => {
    const newLocale = locale === 'he' ? 'en' : 'he';
    startTransition(async () => {
      await setLocale(newLocale);
      router.refresh();
    });
  };

  return (
    <button
      onClick={switchLocale}
      disabled={isPending}
      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 transition-colors disabled:opacity-50"
    >
      {t('switchTo')}
    </button>
  );
}
