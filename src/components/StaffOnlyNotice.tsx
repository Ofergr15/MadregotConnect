'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The screen a plain member sees on a staff-only page (lib/auth/staff-pages.ts). */
export function StaffOnlyNotice() {
  const t = useTranslations('staffOnly');
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="mb-1 grid h-14 w-14 place-items-center rounded-full bg-card shadow-sm">
        <Lock className="h-6 w-6 text-ink-500" />
      </span>
      <b className="text-lg font-extrabold text-ink-900">{t('title')}</b>
      <p className="max-w-[280px] text-sm text-ink-500">{t('body')}</p>
      <Link href="/feed" className="mt-3 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-extrabold text-white">{t('back')}</Link>
    </div>
  );
}
