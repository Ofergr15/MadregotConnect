'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { academyThreadUrl } from '@/lib/academy/deep-links';

/**
 * A trainee with no workouts yet: the plan comes from the coach, and the one thing to do
 * meanwhile is talk to them. `onOpen` where the screen owns the conversation sheet;
 * otherwise the `?thread=mine` link, which the academy page opens over the home/board.
 */
export function EmptyPlanCoach({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const t = useTranslations('emptyPlan');
  const cls = 'mx-auto mt-2 flex min-h-[44px] w-fit items-center gap-0.5 rounded-full bg-brand-600 px-4 text-[14px] font-extrabold text-white active:scale-95';
  return (
    <div className={className} data-testid="empty-plan-coach">
      <p className="text-center text-[13.5px] text-ink-500">{t('line')}</p>
      {onOpen
        ? <button type="button" onClick={onOpen} className={cls}>{t('button')}<ChevronLeft className="h-4 w-4" aria-hidden /></button>
        : <Link href={academyThreadUrl({ recipientIsStaff: false, traineeId: null })} className={cls}>{t('button')}<ChevronLeft className="h-4 w-4" aria-hidden /></Link>}
    </div>
  );
}
