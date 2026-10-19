'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HomeToday } from '@/components/home/HomeToday';
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
import { MAX_HR_MIN_RUNS } from '@/lib/academy/load';
import { hrEstimateKey } from '@/lib/academy/test-state';
import { LoadSheet } from './LoadSheet';
import { RaceLine } from './RaceLine';
import { RestCard, TodayWorkoutCard } from './TodayWorkoutCard';
import { TestEntryCard } from '@/components/academy/completion/TestEntryCard';
import { CARD, Chevron, RICH, SHADOW, StructureText, TOP_BAR, Tag, WEEKDAY_KEYS, dm } from './ui';

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

export function TraineeToday({ athleteId, firstName, academyOnly = false }: {
  athleteId: string;
  firstName: string;
  /** In the academy and no club group: no club week to wait for — the coach writes theirs. */
  academyOnly?: boolean;
}) {
  const t = useTranslations('trainee.home');
  const tb = useTranslations('workoutBook');
  const ts = useTranslations('trainee.loadSheet');
  const td = useTranslations('trainee.done');
  const tf = useTranslations('trainee.home.form');
  const { data, error, mutate } = useApi<TodayPayload>(`/api/academy/today?athleteId=${encodeURIComponent(athleteId)}`, { keepPreviousData: true });
  // The workout screen (4/5) is the board's own overlay, so it opens on the board's row
  // for that day — the same payload the week screen hands it.
  const [opening, setOpening] = useState<string | null>(null);
  const [entryTyping, setEntryTyping] = useState(false);
  // `?test=entry` (the "לבקש מכולם" push, deep-links.ts): raise the entry card. Read once on
  // mount from window.location — the dashboard page has no Suspense boundary.
  const [raiseEntry, setRaiseEntry] = useState(false);
  useEffect(() => { setRaiseEntry(new URLSearchParams(window.location.search).get('test') === 'entry'); }, []);
  const { data: board } = useApi<WeekBoard>(
    opening ? `/api/academy/week-board?athleteId=${encodeURIComponent(athleteId)}&weekStart=${planWeekStartOf(opening)}` : null,
  );
  // The rest of this week, under today's card (academy-dash.html): the board the week screen reads.
  const { data: week } = useApi<WeekBoard>(`/api/academy/week-board?athleteId=${encodeURIComponent(athleteId)}&weekStart=${planWeekStartOf(israelToday())}`);
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
    <div className={cn('flex items-center gap-2', !viewingAs && TOP_BAR)}>
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
  const entryCard = !!data.test && (data.test.kind !== 'ok' || data.test.old);
  const openDate = data.dayState === 'workout' ? data.card?.date : data.dayState === 'rest' ? data.next?.date : null;

  return (
    <div className="space-y-2.5" dir="rtl">
      {header}

      {data.paceUpdate && <PaceUpdateCard card={data.paceUpdate} />}

      {/* "חסר לנו הטסט האחרון שלך" (academy-existing-trainees, phone 4), in place of the card's
          "🎯 צריך טסט" line that left nothing to do: find it in the watch or type it, sent to the
          coach for approval; "ממתין לאישור" until then. */}
      {entryCard && !academyOnly && <TestEntryCard athleteId={athleteId} onSent={() => void mutate()} onTyping={setEntryTyping} raise={raiseEntry} />}

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
        <TodayWorkoutCard card={data.card} when={when} coachName={coachFirst} test={data.test} needsTestLine={!entryCard} />
      ) : data.dayState === 'rest' ? (
        <RestCard date={data.date} when={when} next={data.next} prevKind={data.prevKind} test={data.test} needsTestLine={!entryCard} />
      ) : (
        <section className={cn('rounded-[22px] bg-white px-4 py-[15px]', SHADOW)}>
          {academyOnly ? (
            <>
              <h2 className="text-[20px] font-black text-ink-900">{t('coachWrites')}</h2>
              <p className="mt-1 text-[14px] text-ink-500">{t('coachWritesSay')}</p>
            </>
          ) : (
            <>
              <h2 className="text-[20px] font-black text-ink-900">{t('noPlan', { week: data.weekStart !== planWeekStartOf(today) ? 'next' : 'this' })}</h2>
              <p className="mt-1 text-[14px] text-ink-500">{t('noPlanSay', { when })}</p>
            </>
          )}
        </section>
      )}

      {/* No Garmin yet: the coach's workouts cannot reach the watch — say so, with the one fix. */}
      {!data.canWatch && (
        <Link href="/dashboard/profile?connectGarmin=1" className={cn(CARD, 'flex min-h-[56px] items-center gap-[11px] border-[1.5px] border-[#0B6BCB]/25 px-3.5')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">⌚</span>
          <span className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">{t('connectGarmin')}</b>
            <small className="mt-px block text-[12.5px] text-ink-400">{t('connectGarminSub')}</small>
          </span>
          <span className="shrink-0 rounded-xl bg-[#0B6BCB] px-3 py-2 text-[12.5px] font-extrabold text-white">{t('connectGarminAction')}</span>
        </Link>
      )}

      {/* A new academy-only trainee: what the coach will do and the watch come first, the test after. */}
      {entryCard && academyOnly && <TestEntryCard athleteId={athleteId} onSent={() => void mutate()} onTyping={setEntryTyping} raise={raiseEntry} />}

      {/* The coach's conversation, on the home itself: questions, feelings, pain. */}
      <Link href={academyThreadUrl({ recipientIsStaff: false, traineeId: athleteId })} className={cn(CARD, 'flex min-h-[56px] items-center gap-[11px] px-3.5')}>
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[17px] shadow-[0_0_0_2.5px_#16A34A]">💬</span>
        <span className="min-w-0 flex-1 py-[9px]">
          <b className="block text-[14.5px] font-extrabold text-ink-900">{coachFirst ? t('chatWith', { name: coachFirst }) : t('threadLabel')}</b>
          <small className="mt-px block text-[12.5px] text-ink-400">{t('chatSub')}</small>
        </span>
        {!!data.unread && <b className="rounded-[9px] bg-[#E5484D] px-1.5 text-[11px] leading-[18px] text-white"><bdi dir="ltr">{data.unread}</bdi></b>}
        <span aria-hidden className="grid h-11 w-6 shrink-0 place-items-center text-ink-300"><Chevron className="h-[14px] w-[9px]" /></span>
      </Link>

      {/* What else this week: the days after today, and whether each is on the watch. */}
      {(() => {
        const ahead = (week?.workouts ?? []).filter((w) => w.date > today && !w.optional);
        if (!ahead.length) return null;
        return (
          <section className={cn(CARD, 'px-3.5 py-2.5')} aria-label={t('restOfWeek')}>
            <b className="block text-[13px] font-extrabold text-ink-500">{t('restOfWeek')}</b>
            {ahead.slice(0, 4).map((w) => (
              <div key={`${w.date}-${w.name}`} className="flex min-h-[40px] items-center gap-2.5 border-b border-page last:border-b-0">
                <span className="w-9 shrink-0 text-[13px] font-extrabold text-[#7C3AED]">{tb(`day.${WEEKDAY_KEYS[w.dayOfWeek]}`)}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink-900"><StructureText text={w.name} /></span>
                <span className="shrink-0 text-[12px] text-ink-400">{w.onWatch ? t('onWatch') : t('notOnWatchYet')}</span>
              </div>
            ))}
          </section>
        );
      })()}

      {/* "השבוע שלי" — the club runner's own card (home/HomeToday), opening the progress tab
          with the records and the improvement (AthleteProgress). */}
      <HomeToday athleteId={athleteId} href="/dashboard/academy/progress" />

      <FormCard form={data.form} when={data.dayState === 'rest' ? 'tomorrow' : when} gender={data.athlete.gender} showBands={data.dayState === 'workout'} testKind={data.test?.kind ?? null} />

      <BodyChips sleep={data.body.sleep} rhr={data.body.rhr} missing={data.body.missing} today={today} />

      {data.race && <RaceLine race={data.race} showBuild={data.dayState === 'workout'} />}

      {data.yesterday && data.yesterday.load == null ? (
        // Yesterday's run could not be priced: still shown, with its km and why (missing-data rule).
        <div className={cn(CARD, 'flex min-h-[56px] w-full items-center gap-[11px] px-3.5')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🏃</span>
          <span className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">
              {data.yesterday.title
                ? t.rich('yesterday.title', { ...RICH, name: data.yesterday.title, bdi: () => <StructureText text={data.yesterday!.title!} /> })
                : t.rich('yesterday.titleKm', { ...RICH, km: data.yesterday.km })}
            </b>
            <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
              ⚡ {data.yesterday.noLoad === 'hrLearning' ? td.rich('noLoadHrLearning', { ...RICH, n: MAX_HR_MIN_RUNS }) : td('noLoad')}
            </small>
          </span>
        </div>
      ) : data.yesterday && (
        <button type="button" onClick={() => setLoadOf(data.yesterday!.activityId)} className={cn(CARD, 'flex min-h-[56px] w-full items-center gap-[11px] px-3.5 text-start')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🏃</span>
          <span className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">
              {data.yesterday.title
                ? t.rich('yesterday.title', { ...RICH, name: data.yesterday.title, bdi: () => <StructureText text={data.yesterday!.title!} /> })
                : t.rich('yesterday.titleKm', { ...RICH, km: data.yesterday.km })}
              {' · ⚡ '}<bdi dir="ltr">{data.yesterday.load}</bdi>
            </b>
            <small className="mt-px block text-[12.5px] text-ink-400">
              {/* An HR estimate while a test waits (or is 2000 m) does not say "עוד אין טסט". */}
              {data.yesterday.source === 'hr' && data.test && (data.test.kind === 'pending' || data.test.kind === 'otherProtocol')
                ? tf(hrEstimateKey(data.test.kind))
                : ts(`source.${data.yesterday.source}` as never)}
            </small>
          </span>
          {(data.yesterday.source === 'hr' || data.yesterday.source === 'pace_avg') && <Tag tone="n">{t('yesterday.estimate')}</Tag>}
        </button>
      )}

      {/* Hidden while the test card's fields are open: its "לשלוח" is then the one primary on screen. */}
      {openDate && !entryTyping && (
        // Pinned to the bottom of the scroll box, which ends at the tab bar: the mockup's
        // .foot, on screen at first open however long the cards above it run.
        // !-mb-4 (over the parent's space-y): the scroll box's own bottom padding taken back,
        // so a home that fits ends at the button instead of scrolling 16px of nothing.
        <div className="pointer-events-none sticky bottom-0 z-10 -mx-4 !-mb-4 bg-gradient-to-t from-page from-70% to-transparent px-4 pb-1 pt-3 md:!mb-0">
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
