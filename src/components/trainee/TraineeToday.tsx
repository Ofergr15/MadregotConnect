'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn, israelNow, israelToday, planWeekStartOf } from '@/lib/utils';
import { academyTestUrl, academyThreadUrl } from '@/lib/academy/deep-links';
import type { TraineeToday as TodayPayload } from '@/lib/academy/trainee-today';
import type { WeekBoard } from '@/lib/academy/week-board';
import { Bell } from 'lucide-react';
import { SetupPill } from '@/components/onboarding/SetupPill';
import { isViewingPerson } from '@/lib/view-as-person';
import { useHideShellHeader } from '@/lib/shell-chrome';
import { PaceUpdateCard } from '@/components/academy/tools/PaceUpdateCard';
import { TraineeWorkout } from '@/components/academy/book/TraineeWorkout';
import { BodyChips } from './BodyChips';
import { FormCard } from './FormCard';
import { LoadSheet } from './LoadSheet';
import { RaceLine } from './RaceLine';
import { RestCard, TodayWorkoutCard } from './TodayWorkoutCard';
import { CARD, Chevron, RICH, SHADOW, StructureText, Tag, WEEKDAY_KEYS, dm } from './ui';

// ── The academy trainee's home (mockup trainee-experience-v2, phones 1, 1ב, 1ג) ─────────
//
// What to do today, and how I arrive at it: the coach's pace update when there is one,
// the test invitation when it is the next thing that matters, today's session (or the rest
// day with tomorrow under it — never "אין תוכנית"), one number with a word and a sentence,
// last night against my own range, the race, and one button that opens the workout.
// Everything is decided by GET /api/academy/today (lib/academy/trainee-today.ts); this
// only draws it, in the mockup's order.
//
// The mockup's top bar is ONE row: the greeting, 💬 and 🔔. So on the phone this home folds
// the shell's header away while it is mounted (lib/shell-chrome.ts) and carries the bell
// itself (the same /dashboard/notifications door, the same unread count); the account menu
// and search stay one tap away on the tab bar. Under view-as the shell header stays — its
// eye is how the super user switches person. The main button is pinned just above the
// tab bar (the mockup's .foot), so it is on screen at first open.

function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const h = israelNow().hour;
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** An ISO slot as the invitation row says it, on Israel's clock: weekday, "20.10", "6:30". */
function slotParts(iso: string): { day: (typeof WEEKDAY_KEYS)[number]; date: string; time: string } {
  const at = new Date(iso);
  const date = israelToday(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: '2-digit', hour12: false }).format(at);
  return { day: WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()], date: dm(date), time: time.replace(/^0/, '') };
}

export function TraineeToday({ athleteId, firstName }: { athleteId: string; firstName: string }) {
  const t = useTranslations('trainee.home');
  const tb = useTranslations('workoutBook');
  const ts = useTranslations('trainee.loadSheet');
  const { data, error } = useApi<TodayPayload>(`/api/academy/today?athleteId=${encodeURIComponent(athleteId)}`, { keepPreviousData: true });
  // The workout screen (4/5) is the board's own overlay, so it opens on the board's row
  // for that day — the same payload the week screen hands it.
  const [opening, setOpening] = useState<string | null>(null);
  const { data: board } = useApi<WeekBoard>(
    opening ? `/api/academy/week-board?athleteId=${encodeURIComponent(athleteId)}&weekStart=${planWeekStartOf(opening)}` : null,
  );
  const [loadOf, setLoadOf] = useState<string | null>(null);
  const [viewingAs] = useState(isViewingPerson);
  useHideShellHeader(!viewingAs);
  const { data: inbox } = useApi<{ count?: number }>(`/api/notifications/unread?athleteId=${encodeURIComponent(athleteId)}`);
  const bellCount = inbox?.count || 0;
  const [greeting, setGreeting] = useState<'morning' | 'afternoon' | 'evening'>('morning');
  useEffect(() => setGreeting(greetingKey()), []);

  const workout = opening && board ? board.workouts.find(w => w.date === opening) ?? null : null;
  useEffect(() => {
    // The board answered without that day (the plan changed under us): nothing to open.
    if (opening && board && board.weekStart === planWeekStartOf(opening) && !workout) setOpening(null);
  }, [opening, board, workout]);

  const name = (data?.athlete?.name || firstName || '').split(' ')[0];
  const coachFirst = data?.coach?.name.split(' ')[0] ?? null;

  const header = (
    <div className={cn('flex items-center gap-2', !viewingAs && 'safe-top md:pt-0')}>
      <h1 className="min-w-0 flex-1 truncate text-[21px] font-black text-ink-900">{t.rich(`greeting.${greeting}`, { ...RICH, name })}</h1>
      {!viewingAs && <SetupPill className="md:hidden" />}
      <Link
        href={academyThreadUrl({ recipientIsStaff: false, traineeId: athleteId })}
        aria-label={data?.unread ? `${t('threadLabel')} · ${t('unread', { n: data.unread })}` : t('threadLabel')}
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F1F2F7] text-[17px]"
      >
        <span aria-hidden>💬</span>
        {!!data?.unread && (
          <b className="absolute left-0 top-0 h-[17px] min-w-[17px] rounded-[9px] bg-[#E5484D] px-1 text-center text-[10px] leading-[17px] text-white">
            <bdi dir="ltr">{data.unread}</bdi>
          </b>
        )}
      </Link>
      {!viewingAs && (
        <Link
          href="/dashboard/notifications"
          aria-label={bellCount ? `${t('bellLabel')} · ${bellCount}` : t('bellLabel')}
          className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F1F2F7] text-brand-600 md:hidden"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {bellCount > 0 && (
            <b className="absolute left-0 top-0 h-[17px] min-w-[17px] rounded-[9px] bg-[#E5484D] px-1 text-center text-[10px] leading-[17px] text-white">
              <bdi dir="ltr">{bellCount}</bdi>
            </b>
          )}
        </Link>
      )}
    </div>
  );

  if (!data || !data.isMember) {
    return (
      <div className="space-y-2.5" dir="rtl">
        {header}
        <p className={cn(CARD, 'px-4 py-6 text-center text-sm text-ink-400')}>{error ? t('error') : t('loading')}</p>
      </div>
    );
  }

  const when = data.focus;
  const today = israelToday();
  const invite = data.invitation ? slotParts(data.invitation.slot) : null;
  const openDate = data.dayState === 'workout' ? data.card?.date : data.dayState === 'rest' ? data.next?.date : null;

  return (
    <div className="space-y-2.5" dir="rtl">
      {header}

      {data.paceUpdate && <PaceUpdateCard card={data.paceUpdate} />}

      {invite && (
        <Link href={academyTestUrl({ recipientIsStaff: false })} className={cn(CARD, 'flex min-h-[56px] items-center gap-[11px] px-3.5')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🎯</span>
          <span className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">{t.rich('invite.title', { ...RICH, day: tb(`day.${invite.day}`), date: invite.date })}</b>
            <small className="mt-px block text-[12.5px] text-ink-400">{t.rich('invite.sub', { ...RICH, time: invite.time })}</small>
          </span>
          <span aria-hidden className="grid h-11 w-6 shrink-0 place-items-center text-ink-300"><Chevron className="h-[14px] w-[9px]" /></span>
        </Link>
      )}

      {data.dayState === 'workout' && data.card ? (
        <TodayWorkoutCard card={data.card} when={when} coachName={coachFirst} />
      ) : data.dayState === 'rest' ? (
        <RestCard date={data.date} when={when} next={data.next} prevKind={data.prevKind} />
      ) : (
        <section className={cn('rounded-[22px] bg-white px-4 py-[15px]', SHADOW)}>
          <h2 className="text-[20px] font-black text-ink-900">{t('noPlan')}</h2>
          <p className="mt-1 text-[14px] text-ink-500">{t('noPlanSay')}</p>
        </section>
      )}

      <FormCard form={data.form} when={data.dayState === 'rest' ? 'tomorrow' : when} gender={data.athlete.gender} showBands={data.dayState === 'workout'} />

      <BodyChips sleep={data.body.sleep} rhr={data.body.rhr} today={today} />

      {data.race && <RaceLine race={data.race} showBuild={data.dayState === 'workout'} />}

      {data.yesterday && (
        <button type="button" onClick={() => setLoadOf(data.yesterday!.activityId)} className={cn(CARD, 'flex min-h-[56px] w-full items-center gap-[11px] px-3.5 text-start')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🏃</span>
          <span className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">
              {data.yesterday.title
                ? t.rich('yesterday.title', { ...RICH, name: data.yesterday.title, bdi: () => <StructureText text={data.yesterday!.title!} /> })
                : t.rich('yesterday.titleKm', { ...RICH, km: data.yesterday.km })}
              {' · ⚡ '}<bdi dir="ltr">{data.yesterday.load}</bdi>
            </b>
            <small className="mt-px block text-[12.5px] text-ink-400">{ts(`source.${data.yesterday.source}` as never)}</small>
          </span>
          {(data.yesterday.source === 'hr' || data.yesterday.source === 'pace_avg') && <Tag tone="n">{t('yesterday.estimate')}</Tag>}
        </button>
      )}

      {openDate && (
        // Pinned to the bottom of the scroll box, which ends at the tab bar: the mockup's
        // .foot, on screen at first open however long the cards above it run.
        <div className="pointer-events-none sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-page from-70% to-transparent px-4 pb-1 pt-3">
          <button
            type="button"
            onClick={() => setOpening(openDate)}
            disabled={!!opening && !workout}
            className={cn(
              'pointer-events-auto flex h-[52px] w-full items-center justify-center gap-1.5 rounded-[15px] text-[16px] font-extrabold disabled:opacity-60',
              data.dayState === 'rest' ? cn('bg-white text-brand-600', SHADOW) : 'bg-brand-600 text-white',
            )}
          >
            {opening && !workout
              ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : data.dayState === 'rest' ? t('openTomorrow') : data.card?.done ? t('openDone') : t('open')}
          </button>
        </div>
      )}

      {workout && board && <TraineeWorkout workout={workout} board={board} onClose={() => setOpening(null)} />}
      <LoadSheet open={!!loadOf} onOpenChange={o => { if (!o) setLoadOf(null); }} athleteId={athleteId} activityId={loadOf} />
    </div>
  );
}
