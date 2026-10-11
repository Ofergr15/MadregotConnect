'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { LoadStatus } from '@/lib/academy/pmc';
import { LEARNING_DAYS } from '@/lib/academy/pmc';
import { RICH } from './ui';

// ── Why there is no number (the missing-data rule) ───────────────────────────────────────
//
// The one sentence every load screen shows in place of a number — the home's form card
// (1), progress (7) and the coach's C2 — so the three say the same thing: the watch
// stopped sending (and how to reconnect), the runs are still being priced, too many runs
// had neither pace nor heart rate (a test or HR fixes it), or the engine is still
// learning, and why ("new here" or "the older runs could not be priced").

export type NoNumberStatus = Exclude<LoadStatus, { kind: 'ok' }>;

/** The icon, the title and the sentence for a status that is not ok. */
export function useNoNumberText() {
  const t = useTranslations('trainee.home.form');
  return (status: NoNumberStatus, audience: 'trainee' | 'coach' = 'trainee') => {
    switch (status.kind) {
      case 'noFeed': {
        const p = status.provider;
        return {
          icon: '⌚',
          title: status.feed === 'failed'
            ? t('noFeed.failed', { provider: p })
            : t.rich('noFeed.stale', { ...RICH, provider: p, n: status.days ?? 0 }),
          say: t(`noFeed.${audience}Say`, { feed: status.feed, provider: p }),
          action: audience === 'trainee' && status.feed === 'failed',
        };
      }
      case 'computing':
        return { icon: '⏳', title: t('computing'), say: t.rich('computingSay', { ...RICH, n: status.pending }), action: false };
      case 'learning':
        return {
          icon: '⏳',
          title: t.rich('learning', { ...RICH, n: status.daysLeft }),
          say: status.cause === 'unpriced' ? t('learningUnpricedSay') : t.rich('learningSay', { ...RICH, total: LEARNING_DAYS }),
          action: false,
        };
      default:
        return { icon: '⌚', title: t('insufficient'), say: t('insufficientSay'), action: false };
    }
  };
}

/** The reconnect link under a refused credential. */
export function ReconnectLink() {
  const t = useTranslations('trainee.home.form');
  return (
    <Link href="/dashboard/profile" className="mt-1 inline-flex min-h-[44px] items-center text-[13.5px] font-extrabold text-brand-600">
      {t('noFeed.reconnect')}
    </Link>
  );
}
