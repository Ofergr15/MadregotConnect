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
// So the score moves to where the eye already goes for an unread dot. It used
// to be a red pill with a breathing halo, and a brand-new member read red "0/5"
// as an error (journey audit, 2026-10-10). Now it is a progress ring in the brand
// colour: still the one permanent reminder, no longer an alarm.
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

  const R = 15;
  const C = 2 * Math.PI * R;
  const pct = data.totalCount > 0 ? Math.max(0, Math.min(1, data.doneCount / data.totalCount)) : 0;

  return (
    <Link
      href={SETUP_CHECKLIST_HREF}
      aria-label={t('pillAria', { done: data.doneCount, total: data.totalCount })}
      className={cn(
        // A 44px round button like the bell beside it, the ring drawn inside.
        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-brand-600',
        'active:scale-95 transition-transform',
        className,
      )}
    >
      {/* -rotate-90 starts the arc at 12 o'clock; a circle has no reading direction,
          so it is not mirrored in RTL (same as ProgressRing). */}
      <svg viewBox="0 0 36 36" className="absolute inset-[4px] h-9 w-9 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth="3" className="stroke-page" />
        <circle
          cx="18" cy="18" r={R} fill="none" strokeWidth="3" strokeLinecap="round"
          className="stroke-brand-600 transition-[stroke-dashoffset] duration-500"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      {/* Its own element with dir="ltr" — a fraction dropped inline into an RTL
          line is reordered, and "2/5" came out as "5/2". */}
      <span dir="ltr" className="relative text-13 font-bold leading-none tabular-nums">
        {data.doneCount}/{data.totalCount}
      </span>
    </Link>
  );
}
