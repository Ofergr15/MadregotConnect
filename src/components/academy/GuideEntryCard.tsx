'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GraduationCap } from 'lucide-react';
import { ACADEMY_GUIDE_PATH } from '@/lib/academy/guide';
import { CARD, Chevron } from '@/components/trainee/ui';

/** The trainee's door to "מדריך לאקדמיה", on the academy home (both trainee experiences). */
export function GuideEntryCard() {
  const t = useTranslations('academyGuide');
  return (
    <Link href={ACADEMY_GUIDE_PATH} className={`${CARD} flex min-h-[56px] items-center gap-[11px] px-3.5`} data-testid="academy-guide-entry">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-brand-600 text-white">
        <GraduationCap className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 py-[9px]">
        <b className="block text-[14.5px] font-extrabold text-ink-900">{t('entryCard')}</b>
        <small className="mt-px block text-[12.5px] text-ink-400">{t('entryRowSub')}</small>
      </span>
      <span aria-hidden className="grid h-11 w-6 shrink-0 place-items-center text-ink-300"><Chevron className="h-[14px] w-[9px]" /></span>
    </Link>
  );
}
