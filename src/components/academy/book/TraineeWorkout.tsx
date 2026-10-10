'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDaysToDateStr, cn } from '@/lib/utils';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import { bookTotals, profileBar } from '@/lib/academy/book-steps';
import type { WeekBoard, WeekBoardWorkout } from '@/lib/academy/week-board';
import { WorkoutPlanSheet } from '../WorkoutPlanSheet';
import { BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, ProfileBar, RICH, kmText } from './ui';
import { StepLines } from './StepLines';
import { WEEKDAY_KEYS, workoutModel } from './WeekBoard';

// ── המתאמן פותח אימון (mockup phone 5) ───────────────────────────────────────────────────
//
// What to run, in sentences and at the trainee's own paces; the bar; what the coach wrote;
// and whether it is already on the watch. After the run, the same screen opens the
// plan-vs-actual sheet that already exists (WorkoutPlanSheet), rather than a second copy of
// it here.
//
// The steps are the ones stored on the trainee's own plan row — the exact paces their
// watch was given — restated through the book model only so they can be drawn as the same
// sentences the coach wrote them in.

export function TraineeWorkout({ workout, board, onClose, onChange }: {
  workout: WeekBoardWorkout;
  board: WeekBoard;
  onClose: () => void;
  /** The coach's "לשנות" — absent for the trainee. */
  onChange?: () => void;
}) {
  const t = useTranslations('workoutBook');
  const [sheet, setSheet] = useState(false);
  const T = board.thresholdSec;
  const model = useMemo(() => workoutModel(workout, T), [workout, T]);
  const totals = model ? bookTotals(model, T) : null;
  const coachFirst = (board.coachName ?? '').split(' ')[0] || null;
  const day = t(`day.${WEEKDAY_KEYS[workout.dayOfWeek]}`);
  const when = workout.date === board.today ? t('today')
    : workout.date === addDaysToDateStr(board.today, 1) ? t('tomorrow') : null;
  const done = workout.compliance.color !== 'grey' && workout.compliance.color !== 'red';
  const isCoach = !!onChange;
  const router = useRouter();
  const openThread = () => router.push(academyThreadUrl({ recipientIsStaff: isCoach, traineeId: board.athlete.id }));

  return (
    <FlowOverlay label={t('workoutLabel')}>
      <FlowScreen
        title={day}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back.week')}</BarButton>}
        trailing={onChange ? <BarButton strong onClick={onChange}>{t('change')}</BarButton> : undefined}
        footer={
          <PrimaryButton secondary onClick={openThread}>
            💬 {isCoach
              ? t('writeTo', { name: board.athlete.name.split(' ')[0] })
              : coachFirst ? t('askCoach', { name: coachFirst }) : t('askCoachGeneric')}
          </PrimaryButton>
        }
      >
        <div>
          <p className="text-13 font-bold text-ink-400">
            {when && <>{when} · </>}{coachFirst ? t('fromCoach', { name: coachFirst }) : t('fromCoachGeneric')}
          </p>
          <h2 className="text-28 font-black leading-tight text-ink-900"><bdi>{workout.name}</bdi></h2>
          {totals && (
            <p className="mt-1 text-[16px] text-ink-500">
              {t.rich('volume', { ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60) })}
            </p>
          )}
        </div>

        {model ? (
          <>
            <div className={cn(CARD, 'p-[18px]')}><ProfileBar segments={profileBar(model, T)} size="lg" /></div>
            <StepLines steps={model} thresholdSec={T} />
          </>
        ) : (
          <p className={cn(CARD, 'px-4 py-3 text-sm text-ink-500')}>{t('stepsUnavailable')}</p>
        )}

        {workout.note && (
          <div className={cn(CARD, 'p-[18px] text-[15px] leading-normal text-ink-500')}>
            {coachFirst && <b className="text-ink-900"><bdi>{coachFirst}</bdi>: </b>}
            <span dir="auto">{workout.note}</span>
          </div>
        )}

        <div className={cn(CARD, 'flex min-h-[64px] items-center gap-3 px-[18px] py-3')}>
          <span className="min-w-0 flex-1">
            <b className="block text-[17px] font-extrabold text-ink-900">⌚ {workout.onWatch ? t('onWatchTitle') : t('notOnWatchTitle')}</b>
            <small className="mt-0.5 block text-[13.5px] text-ink-400">{workout.onWatch ? t('onWatchSub') : t('notOnWatchSub')}</small>
          </span>
          {workout.onWatch && <span className="font-black text-[#0E7A3C]" aria-hidden>✓</span>}
        </div>

        {done && (
          <button type="button" onClick={() => setSheet(true)} className="flex min-h-[44px] items-center justify-center gap-1 text-[16px] font-bold text-brand-600">
            {t('planVsActual')} <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </FlowScreen>
      <WorkoutPlanSheet
        athleteId={board.athlete.id}
        date={sheet ? workout.date : null}
        coachName={board.coachName}
        onOpenChange={o => setSheet(o)}
        onOpenThread={openThread}
      />
    </FlowOverlay>
  );
}
