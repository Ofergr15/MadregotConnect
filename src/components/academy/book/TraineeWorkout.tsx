'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, cn } from '@/lib/utils';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import { bookTotals, profileBar } from '@/lib/academy/book-steps';
import { watchRange } from '@/lib/academy/watch-range';
import type { WeekBoard, WeekBoardWorkout } from '@/lib/academy/week-board';
import type { WorkoutResponse } from '@/lib/academy/workout-extras';
import { WorkoutPlanSheet } from '../WorkoutPlanSheet';
import { LoadSheet } from '@/components/trainee/LoadSheet';
import { DoneTabs, WorkoutDone } from '@/components/trainee/WorkoutDone';
import { FeelAndTalk } from '@/components/trainee/FeelAndTalk';
import { StructureText, dm as dmOf, monthName } from '@/components/trainee/ui';
import { useTraineeV2 } from '@/lib/trainee/v2';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, ProfileBar, RICH, clockText, kmText } from './ui';
import { StepLines } from './StepLines';
import { WEEKDAY_KEYS, workoutModel } from './WeekBoard';

// ── המתאמן פותח אימון (book mockup phone 5; trainee-experience-v2 phones 4 and 5) ──────────
//
// Before the run (4): what to run, in sentences and at the trainee's own paces; the bar;
// the ⚡ it will cost (tap → 5ב); the range each work step carries on the watch; why the
// pace is what it is; what the coach wrote; and where it waits on the watch.
//
// After it (5): the same overlay becomes the summary — one verdict line, the plan against
// what was done, every rep against its range, a real PR — with the map and the laps one
// tab away and "איך הרגשת?" (6) as the one action. The coach opening a done workout sees
// the same summary, with "write to" as the action.
//
// The steps are the ones stored on the trainee's own plan row — the exact paces their
// watch was given — restated through the book model only so they can be drawn as the same
// sentences the coach wrote them in. The additions come from GET /api/academy/workout,
// and are drawn only under the trainee-experience v2 switch (lib/trainee/v2.ts); without
// it this is the book v3 screen as it shipped.

export function TraineeWorkout({ workout, board, onClose, onChange }: {
  workout: WeekBoardWorkout;
  board: WeekBoard;
  onClose: () => void;
  /** The coach's "לשנות" — absent for the trainee. */
  onChange?: () => void;
}) {
  const t = useTranslations('workoutBook');
  const tw = useTranslations('trainee.workout');
  const locale = useLocale();
  const [sheet, setSheet] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [feeling, setFeeling] = useState(false);
  const T = board.thresholdSec;
  const model = useMemo(() => workoutModel(workout, board.referenceSec), [workout, board.referenceSec]);
  const totals = model ? bookTotals(model, T) : null;
  const coachFirst = (board.coachName ?? '').split(' ')[0] || null;
  const day = t(`day.${WEEKDAY_KEYS[workout.dayOfWeek]}`);
  const when = workout.date === board.today ? t('today')
    : workout.date === addDaysToDateStr(board.today, 1) ? t('tomorrow') : null;
  const done = workout.compliance.color !== 'grey' && workout.compliance.color !== 'red';
  const isCoach = !!onChange;
  const router = useRouter();
  const openThread = () => router.push(academyThreadUrl({ recipientIsStaff: isCoach, traineeId: board.athlete.id }));
  const v2 = useTraineeV2();
  const { data: fetched, mutate } = useApi<WorkoutResponse>(
    v2 ? `/api/academy/workout?athleteId=${encodeURIComponent(board.athlete.id)}&date=${workout.date}` : null,
  );
  const data = v2 ? fetched : undefined;

  // The watch range of a work step: the plan step's own (what Garmin got) when the plan's
  // steps line up with the book's, else the step's pace ±1.5% — the same rule.
  const rangeFor = (step: number, paceSec: number) => {
    const fromPlan = data?.steps && model && data.steps.length === model.length ? data.steps[step] : null;
    if (fromPlan) return fromPlan.work ? fromPlan.watchRange : null;
    return watchRange({ targetPaceMinPerKm: paceSec }, 'work');
  };

  const why = data?.why ?? null;
  const askCoach = (
    <PrimaryButton secondary={!v2} onClick={openThread}>
      💬 {isCoach
        ? t('writeTo', { name: board.athlete.name.split(' ')[0] })
        : coachFirst ? t('askCoach', { name: coachFirst }) : t('askCoachGeneric')}
    </PrimaryButton>
  );

  const loadSheet = (
    <LoadSheet
      open={loadOpen}
      onOpenChange={setLoadOpen}
      athleteId={board.athlete.id}
      activityId={done ? data?.activity?.id ?? workout.activityId : null}
      planned={!done && data?.expectedLoad
        ? { load: data.expectedLoad, parts: data.expectedParts ?? [], thresholdSec: why?.thresholdSec ?? T, basisTestDate: why?.basisTestDate ?? null }
        : null}
    />
  );
  const plan = (
    <WorkoutPlanSheet
      athleteId={board.athlete.id}
      date={sheet ? workout.date : null}
      coachName={board.coachName}
      onOpenChange={o => setSheet(o)}
      onOpenThread={openThread}
    />
  );

  // ── 5: after the run ──
  if (v2 && done && (data?.done || !data)) {
    return (
      <FlowOverlay label={t('workoutLabel')}>
        <FlowScreen
          title={tw('doneTitle', { day })}
          leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back.week')}</BarButton>}
          trailing={onChange ? <BarButton strong onClick={onChange}>{t('change')}</BarButton> : undefined}
          className="gap-2.5"
          footer={isCoach || !data ? askCoach : <PrimaryButton onClick={() => setFeeling(true)}>{tw('feelButton')}</PrimaryButton>}
        >
          <DoneTabs activityId={data?.activity?.id ?? workout.activityId} onLaps={() => setSheet(true)} />
          {data ? <WorkoutDone data={data} onLoad={() => setLoadOpen(true)} /> : (
            <p className={cn(CARD, 'px-4 py-6 text-center text-sm text-ink-400')}>{t('loading')}</p>
          )}
        </FlowScreen>
        {plan}
        {loadSheet}
        {feeling && data && (
          <FeelAndTalk
            athleteId={board.athlete.id}
            date={workout.date}
            dayLabel={day}
            workoutName={workout.name}
            coachName={board.coachName}
            coachGender={board.coachGender ?? null}
            data={data}
            onClose={() => setFeeling(false)}
            onSaved={() => void mutate()}
          />
        )}
      </FlowOverlay>
    );
  }

  // ── 4: before the run ──
  const delta = why ? why.thresholdSec - why.targetSec : 0;
  // The card's own estimate (the ⚡'s legs) once the extras are in, so screen 4 says the
  // "כ־51 דק׳" the home did; the book's totals until then and without v2.
  const size = v2 && data?.planTotals ? data.planTotals : totals;
  return (
    <FlowOverlay label={t('workoutLabel')}>
      <FlowScreen
        title={v2 ? <>{day} <bdi dir="ltr">{dmOf(workout.date)}</bdi></> : day}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back.week')}</BarButton>}
        trailing={onChange ? <BarButton strong onClick={onChange}>{t('change')}</BarButton> : undefined}
        footer={askCoach}
        className={v2 ? 'gap-2' : undefined}
      >
        <div>
          <p className="text-13 font-bold text-ink-400">
            {when && <>{when} · </>}{coachFirst ? t('fromCoach', { name: coachFirst }) : t('fromCoachGeneric')}
          </p>
          <h2 className="text-28 font-black leading-tight text-ink-900">{v2 ? <StructureText text={workout.name} /> : <bdi>{workout.name}</bdi>}</h2>
          {(size || data?.expectedLoad) && (
            <p className="mt-1 text-[16px] text-ink-500">
              {size && t.rich('volume', { ...RICH, km: kmText(size.distanceM), min: Math.round(size.durationSec / 60) })}
              {data?.expectedLoad && (
                <>
                  {size && ' · '}
                  <button type="button" onClick={() => setLoadOpen(true)} className="relative text-ink-500 underline decoration-dotted underline-offset-[3px] after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">
                    {tw.rich('expectedLoad', { ...RICH, load: data.expectedLoad, m: (c) => <bdi dir="ltr">{c}</bdi> })}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        {model ? (
          <>
            <div className={cn(CARD, v2 ? 'px-[14px] py-3' : 'p-[18px]')}>
              <ProfileBar segments={profileBar(model, T)} size="lg" palette={v2 ? 'trainee' : undefined} height={v2 ? 40 : undefined} />
            </div>
            <StepLines steps={model} thresholdSec={T} rangeFor={v2 ? rangeFor : undefined} trainee={v2} />
          </>
        ) : (
          <p className={cn(CARD, 'px-4 py-3 text-sm text-ink-500')}>{t('stepsUnavailable')}</p>
        )}

        {workout.note && (
          <div className={cn(CARD, v2 ? 'px-4 py-3 text-[14.5px] leading-snug' : 'p-[18px] text-[15px] leading-normal', 'text-ink-500')}>
            {coachFirst && <b className="text-ink-900"><bdi>{coachFirst}</bdi>: </b>}
            <span dir="auto">{workout.note}</span>
          </div>
        )}

        <div className={cn(CARD, 'overflow-hidden')}>
          {why && (
            <div className={cn('flex min-h-[56px] items-center gap-3 border-b border-[#EFEFF4] px-[18px]', v2 ? 'py-2' : 'py-2.5')}>
              <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🎯</span>
              <span className="min-w-0 flex-1">
                <b className="block text-[16px] font-extrabold text-ink-900">{tw.rich('whyTitle', { ...RICH, pace: clockText(why.targetSec), m: (c) => <bdi dir="ltr">{c}</bdi> })}</b>
                <small className="mt-0.5 block text-[13.5px] leading-snug text-ink-400">
                  {tw.rich(delta > 0 ? 'whyFaster' : delta < 0 ? 'whySlower' : 'whySame', {
                    ...RICH,
                    m: (c) => <bdi dir="ltr">{c}</bdi>,
                    n: Math.abs(delta),
                    threshold: clockText(why.thresholdSec),
                    month: monthName(why.basisTestDate, locale),
                  })}
                </small>
              </span>
            </div>
          )}
          {v2 ? (
            <div className="flex min-h-[56px] items-center gap-3 px-[18px] py-2">
              <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">⌚</span>
              <span className="min-w-0 flex-1">
                <b className="block text-[16px] font-extrabold text-ink-900">{workout.onWatch ? tw('sentTitle') : tw('notSentTitle')}</b>
                <small className="mt-0.5 block text-[13.5px] text-ink-400">
                  {workout.onWatch
                    ? tw.rich('sentSub', { ...RICH, m: (c) => <bdi dir="ltr">{c}</bdi>, name: workout.name, bdi: () => <StructureText text={workout.name} /> })
                    : tw('notSentSub')}
                </small>
              </span>
              {workout.onWatch && <span className="whitespace-nowrap rounded-lg bg-[#E5F6EC] px-2 py-[3px] text-[11.5px] font-extrabold text-[#0E7A3C]">{tw('onWatchTag')}</span>}
            </div>
          ) : (
            <div className="flex min-h-[64px] items-center gap-3 px-[18px] py-3">
              <span className="min-w-0 flex-1">
                <b className="block text-[17px] font-extrabold text-ink-900">⌚ {workout.onWatch ? t('onWatchTitle') : t('notOnWatchTitle')}</b>
                <small className="mt-0.5 block text-[13.5px] text-ink-400">{workout.onWatch ? t('onWatchSub') : t('notOnWatchSub')}</small>
              </span>
              {workout.onWatch && <span className="font-black text-[#0E7A3C]" aria-hidden>✓</span>}
            </div>
          )}
        </div>

        {done && (
          <button type="button" onClick={() => setSheet(true)} className="flex min-h-[44px] items-center justify-center gap-1 text-[16px] font-bold text-brand-600">
            {t('planVsActual')} <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </FlowScreen>
      {plan}
      {loadSheet}
    </FlowOverlay>
  );
}
