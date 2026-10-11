'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { TodayCard } from '@/lib/academy/trainee-today';
import type { TestState } from '@/lib/academy/test-state';
import { ProfileBar } from '@/components/academy/book/ui';
import { RICH, SHADOW, StructureText, Tag, clock, km, weekdayOf } from './ui';

// ── The day's session, or the rest day (mockup 1 / 1ב / 1ג) ──────────────────────────────
//
// "היום · שלישי", whether it is already on the watch, the session's name, its size and its
// work pace, the profile bar, and what the coach wrote. A rest day is not "no plan": it
// says "מנוחה", why it is good, and tomorrow's session under it.

/** "10.3 ק״מ · כ־51 דק׳ · החזרות ב־4:05"; `compact` (tomorrow's mini card) "10.5 ק״מ · ב־4:30". */
function Sub({ card, compact }: { card: TodayCard; compact?: boolean }) {
  const t = useTranslations('trainee.home');
  const parts: React.ReactNode[] = [];
  // An easy run is named by its kilometres ("קל 6 ק״מ"), so the line does not repeat them.
  if (card.distanceM && (card.kind === 'quality' || compact)) parts.push(t.rich('km', { ...RICH, km: km(card.distanceM) }));
  if (card.durationSec && !compact) parts.push(t.rich('min', { ...RICH, min: Math.round(card.durationSec / 60) }));
  if (card.paceSec) parts.push(t.rich(card.paceOf === 'reps' && !compact ? 'repsAt' : 'runAt', { ...RICH, pace: clock(card.paceSec) }));
  if (card.kind === 'easy' && card.paceSec && !compact) parts.push(t('easyTalk'));
  return (
    <>
      {parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
    </>
  );
}

/** The line in place of the pace and the minutes while there is no usable test. */
export function NeedsTest({ test, className }: { test?: TestState | null; className?: string }) {
  const t = useTranslations('trainee.home');
  const state = test?.kind === 'pending' || test?.kind === 'otherProtocol' ? test.kind : 'none';
  return <p className={cn('text-[13px] font-bold leading-snug text-[#A8510A]', className)}>🎯 {t('needsTest', { state })}</p>;
}

export function TodayWorkoutCard({ card, when, coachName, test }: {
  card: TodayCard;
  when: 'today' | 'tomorrow';
  coachName: string | null;
  test?: TestState | null;
}) {
  const t = useTranslations('trainee.home');
  const tb = useTranslations('workoutBook');
  const day = tb(`day.${weekdayOf(card.date)}`);
  return (
    <section className={cn('rounded-[22px] border-2 border-brand-600 bg-white px-4 py-[15px]', SHADOW)}>
      <div className="flex items-baseline justify-between gap-2">
        <Tag tone="b">{t('dayTag', { when, day })}</Tag>
        {card.done ? <Tag tone="g">{t('doneTag')}</Tag> : card.onWatch ? <Tag tone="g">{t('onWatch')}</Tag> : null}
      </div>
      <h2 className="mt-1.5 text-[28px] font-black leading-[1.15] text-ink-900"><StructureText text={card.title} /></h2>
      <p className="mt-[3px] text-[14.5px] text-ink-500"><Sub card={card} /></p>
      {card.paceBasis === 'none' && <NeedsTest test={test} className="mt-1.5" />}
      {card.bar.length > 0 && card.kind === 'quality' && <ProfileBar segments={card.bar} height={30} className="mt-[11px]" palette="trainee" />}
      {card.note && (
        <p className="mt-[11px] rounded-xl bg-[#F7F7FA] px-[11px] py-2 text-[13.5px] leading-[1.45] text-ink-500">
          {coachName && <b className="text-ink-900"><bdi>{coachName}</bdi>: </b>}
          <span dir="auto">{card.note}</span>
        </p>
      )}
    </section>
  );
}

export function RestCard({ date, when, next, prevKind, test }: {
  date: string;
  when: 'today' | 'tomorrow';
  next: TodayCard | null;
  prevKind: TodayCard['kind'] | null;
  test?: TestState | null;
}) {
  const t = useTranslations('trainee.home');
  const tb = useTranslations('workoutBook');
  return (
    <section className={cn('rounded-[22px] border-2 border-[#D5D6DE] bg-white px-4 py-[15px]', SHADOW)}>
      <div className="flex items-baseline justify-between gap-2">
        <Tag tone="n">{t('dayTag', { when, day: tb(`day.${weekdayOf(date)}`) })}</Tag>
        <Tag tone="g">{t('onPlanTag')}</Tag>
      </div>
      <h2 className="mt-1.5 text-[28px] font-black leading-[1.15] text-ink-900">{t('rest')}</h2>
      <p className="mt-[3px] text-[14.5px] text-ink-500">
        {prevKind === 'quality' ? t('restAfterQuality') : prevKind === 'easy' ? t('restAfterEasy') : t('restPlain')}
      </p>
      {next && (
        <div className="mt-3 border-t border-[#EFEFF4] pt-2.5">
          <p className="text-[12.5px] font-bold text-ink-400">{t('nextDay', { when: when === 'today' ? 'tomorrow' : 'other', day: tb(`day.${weekdayOf(next.date)}`) })}</p>
          <p className="mt-0.5 text-[17px] font-black text-ink-900"><StructureText text={next.title} /></p>
          <p className="text-[13px] leading-normal text-ink-500">
            <Sub card={next} compact />
            {next.onWatch && <> · {t('onWatch')}</>}
          </p>
          {next.paceBasis === 'none' && <NeedsTest test={test} className="mt-1" />}
          {next.bar.length > 0 && <ProfileBar segments={next.bar} height={16} className="mt-[7px]" palette="trainee" />}
        </div>
      )}
    </section>
  );
}
