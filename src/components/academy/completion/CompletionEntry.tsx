'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';

/**
 * The door into "השלמת פרטים" from People → trainees: how many are ready, how many are missing
 * something. Drawn only while somebody is missing something, or as a quiet "all ready" row.
 */
export function CompletionEntry({ ready, total, missing, onOpen }: { ready: number; total: number; missing: number; onOpen: () => void }) {
  const t = useTranslations('completion.entry');
  const m = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;
  return (
    <button type="button" onClick={onOpen}
      className="mb-2.5 flex min-h-[56px] w-full items-center gap-3 rounded-card bg-card px-3.5 py-2 text-start active:bg-page/40">
      <span aria-hidden className={missing ? 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FDF0E2] text-[18px]' : 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E5F6EC] text-[18px]'}>
        {missing ? '📝' : '✓'}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14.5px] font-extrabold text-ink-700">{t('title')}</b>
        <small className="block text-2xs text-ink-400">
          {missing ? t.rich('missing', { ready, total, missing, m }) : t.rich('allReady', { total, m })}
        </small>
      </span>
      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
    </button>
  );
}
