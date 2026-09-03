'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useOnboarding, markOnboarding } from '@/lib/onboarding/use-onboarding';
import { ProgressRing } from './ProgressRing';
import { TASK_LABEL_KEY } from './task-meta';

// ═════════════════════════════════════════════════════════════════════════════
// The setup-progress card — top of /dashboard/profile, between the greeting and
// ק״מ שבועי. Renders only while the athlete is still "new"
// (onboarding_completed_at IS NULL), celebrates once when the last task lands,
// and then removes itself for good rather than sitting at 100% on the best
// real estate on the screen.
//
// A ring rather than a bar on purpose: the weekly-km track sits two blocks below
// and a second horizontal fill would read as another training metric.
// ═════════════════════════════════════════════════════════════════════════════

export function SetupProgressCard({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('setup');
  const { data, mutate } = useOnboarding();
  const [acknowledging, setAcknowledging] = useState(false);

  // Nothing to show for staff without an athlete row, for anyone who has already
  // finished, or before the first read resolves (no skeleton: a placeholder that
  // then vanishes for the ~26 members who are done would be worse than nothing).
  if (!data || !data.applicable || data.completed) return null;

  if (data.allDone) {
    const acknowledge = async () => {
      setAcknowledging(true);
      // Optimistic: the card's whole job is to disappear here. If the POST fails
      // (e.g. 078 not applied yet) it comes back on the next revalidate, which is
      // the honest outcome — better than a spinner over a celebration.
      await markOnboarding({ markCompleted: true });
      await mutate();
    };
    return (
      <div data-tour="setupCard" className="rounded-card bg-card px-4 py-6 text-center">
        <p className="text-[40px] leading-none">🎉</p>
        <h2 className="mt-2 text-xl font-bold text-ink-700">{t('celebrateTitle')}</h2>
        <p className="mx-auto mt-1.5 max-w-[260px] text-13 font-light text-ink-400">{t('celebrateBody')}</p>
        <button
          type="button"
          onClick={acknowledge}
          disabled={acknowledging}
          className="mx-auto mt-4 flex min-h-[44px] w-full max-w-[200px] items-center justify-center rounded-pill bg-brand-600 text-[15px] font-bold text-white active:bg-brand-700 disabled:opacity-60"
        >
          {t('celebrateCta')}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-tour="setupCard"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 rounded-card bg-card p-4 text-start active:bg-page/60"
    >
      <ProgressRing pct={data.pct} />

      <span className="min-w-0 flex-1">
        <span className="block text-xl font-bold text-ink-700">{t('title')}</span>
        <span className="mt-0.5 block truncate text-sm font-light text-ink-400">
          {t('progressCount', { done: data.doneCount, total: data.totalCount })}
          {data.nextKey && (
            <>
              {' · '}
              {t('nextUp')} <span className="font-bold text-ink-700">{t(TASK_LABEL_KEY[data.nextKey])}</span>
            </>
          )}
        </span>
      </span>

      <ChevronLeft className="h-[18px] w-[18px] shrink-0 text-ink-300" />
    </button>
  );
}
