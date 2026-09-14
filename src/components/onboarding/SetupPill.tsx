'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useOnboarding } from '@/lib/onboarding/use-onboarding';
import { SETUP_CHECKLIST_HREF } from './task-meta';

// ═════════════════════════════════════════════════════════════════════════════
// THE SCORE, IN THE HEADER, NEXT TO THE BELL
//
// The ring and the checklist have existed for a while, and they live on
// /dashboard/profile — the one screen a member who hasn't finished setting up
// never opens. That is the whole gap: the app knew exactly what was missing and
// only said so where nobody was looking.
//
// So the score moves to where the eye already goes for an unread dot, and it is
// deliberately loud: red, white text, a slow breathing halo. It is a nag, and it
// is meant to read as one.
//
// **It is not dismissible, and that is what makes דלג on the nudge card safe to
// offer.** The card can be sent away for good; the score cannot leave until it
// reads 5/5, at which point it removes itself. One of the two has to be
// permanent or "finish your profile" becomes a thing you can simply decline, and
// a member with no watch connected has no runs — which is the club's problem,
// not just theirs.
//
// Hidden for staff with no athlete row, for anybody already finished, before the
// first read resolves, and during the first run (the tour is explaining this very
// thing; two voices saying it at once is one too many).
// ═════════════════════════════════════════════════════════════════════════════

export function SetupPill({ className }: { className?: string }) {
  const t = useTranslations('setup');
  const { data } = useOnboarding();

  if (!data || !data.applicable || data.completed || data.allDone) return null;
  if (!data.tourSeen) return null;

  return (
    <Link
      href={SETUP_CHECKLIST_HREF}
      aria-label={t('pillAria', { done: data.doneCount, total: data.totalCount })}
      className={cn(
        'animate-setup-pulse flex h-8 items-center gap-1.5 rounded-pill bg-accent-red ps-2 pe-2.5',
        'text-white active:scale-95 transition-transform',
        className,
      )}
    >
      {/* Its own element with dir="ltr" — a fraction dropped inline into an RTL
          line is reordered, and "2/5" came out as "5/2". */}
      <span dir="ltr" className="text-13 font-bold leading-none tabular-nums">
        {data.doneCount}/{data.totalCount}
      </span>
      <span className="text-3xs font-bold leading-none">{t('pillLabel')}</span>
    </Link>
  );
}
