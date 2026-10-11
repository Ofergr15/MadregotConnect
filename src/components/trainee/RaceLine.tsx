'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TodayRace } from '@/lib/academy/trainee-today';
import { traineeProgressUrl } from '@/lib/academy/deep-links';
import { CARD, Chevron, RICH, dm } from './ui';

// ── 🏁 the race, counted down (mockup 1) ─────────────────────────────────────────────────
//
// "מרתון ולנסיה · עוד 54 ימים" and, under it, the date, the goal, and how many weeks of
// build are left — when that still fits the one line. Opens the progress tab, whose race
// range draws the build.

export function RaceLine({ race, showBuild = true }: { race: TodayRace; showBuild?: boolean }) {
  const t = useTranslations('trainee.home.race');
  const parts: React.ReactNode[] = [<bdi key="d" dir="ltr">{dm(race.date)}</bdi>];
  if (race.goal) parts.push(<span key="g">{t.rich('goal', { ...RICH, goal: race.goal })}</span>);
  if (showBuild && race.weeksOfBuild > 0) parts.push(<span key="w">{t.rich('build', { ...RICH, n: race.weeksOfBuild })}</span>);
  return (
    <Link href={traineeProgressUrl()} className={cn(CARD, 'flex min-h-[56px] items-center gap-[11px] px-3.5')}>
      <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🏁</span>
      <span className="min-w-0 flex-1 py-[9px]">
        <b className="block text-[14.5px] font-extrabold text-ink-900">{t.rich('title', { ...RICH, name: race.name, n: race.daysLeft })}</b>
        {/* One line, always (mockup 1): each part is unbreakable and the row is one line
            tall, so a part that would wrap — the build weeks on a narrow phone, usually —
            drops out instead of leaving 'בנייה' alone on a second line. */}
        <small className="mt-px flex max-h-[1.375em] flex-wrap overflow-hidden text-[12.5px] leading-snug text-ink-400">
          {parts.map((p, i) => <span key={i} className="whitespace-nowrap">{i > 0 && '\u00A0·\u00A0'}{p}</span>)}
        </small>
      </span>
      <span aria-hidden className="grid h-11 w-6 shrink-0 place-items-center text-ink-300"><Chevron className="h-[14px] w-[9px]" /></span>
    </Link>
  );
}
