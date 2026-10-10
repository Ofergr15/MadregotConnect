'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, cn } from '@/lib/utils';
import { COMPLIANCE_HEX, meterFraction } from '@/lib/academy/compliance';
import { absoluteToLibrary, fromLibrarySteps, mainStepIndex, profileBar, type BookStep } from '@/lib/academy/book-steps';
import type { WeekBoard as WeekBoardData, WeekBoardWorkout } from '@/lib/academy/week-board';
import { N, ProfileBar, RICH, clockText, hoursText, kmText } from './ui';
import { DayPlanner } from './DayPlanner';
import { TraineeWorkout } from './TraineeWorkout';

// ── השבוע (mockup phone 4) — the same screen for the trainee and the coach ───────────────
//
// TrainingPeaks' two good ideas, in the club's week (Sunday first): a colour strip down the
// side of every session that says how it went before a number is read (lib/academy/
// compliance.ts — green within ±20%, yellow ▲▼ a bit off, orange far off, red missed, grey
// not yet), and the week summed at the top, planned against done.
//
// One line per session says what happened (`▼ 8.4 מ־10 ק״מ`), and the next session draws
// its profile, because "what am I running next" is the question this screen is opened to
// answer. Tapping any session opens it (phone 5); the coach gets the same screen with the
// planner one tap further, and the days with nothing on them as `+` chips.

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** `2026-10-11` → `11.10` */
function dm(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/** A planned workout's own steps, as the book model, drawn at the trainee's threshold. */
export function workoutModel(w: Pick<WeekBoardWorkout, 'steps'>, thresholdSec: number | null): BookStep[] | null {
  if (!w.steps?.length) return null;
  return fromLibrarySteps(absoluteToLibrary(w.steps, thresholdSec ?? 300).steps);
}

export function WeekBoard({ athleteId, initialWeek }: { athleteId: string; initialWeek?: string | null }) {
  const t = useTranslations('workoutBook');
  const [week, setWeek] = useState<string | null>(initialWeek ?? null);
  const { data, error, mutate } = useApi<WeekBoardData>(
    `/api/academy/week-board?athleteId=${encodeURIComponent(athleteId)}${week ? `&weekStart=${week}` : ''}`,
    { keepPreviousData: true },
  );
  const [open, setOpen] = useState<WeekBoardWorkout | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);

  const next = useMemo(() => data?.workouts.find(w => w.date >= data.today && w.compliance.color === 'grey') ?? null, [data]);

  if (!data) {
    return <p className="py-10 text-center text-sm text-ink-400">{error ? t('error.load') : t('loading')}</p>;
  }

  const weekStart = data.weekStart;
  const T = data.thresholdSec;
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i));
  const emptyDays = days.filter(d => !data.workouts.some(w => w.date === d) && d >= data.today);
  const { totals } = data;

  return (
    <div className="space-y-2.5" dir="rtl">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setWeek(addDaysToDateStr(weekStart, -7))} aria-label={t('prevWeek')}
          className="grid h-11 w-11 place-items-center rounded-full text-brand-600">
          <ChevronRight className="h-6 w-6" />
        </button>
        <h2 className="text-[17px] font-extrabold text-ink-900">
          {t('weekTitle')} · <N>{dm(weekStart).split('.')[0]}–{dm(data.weekEnd)}</N>
        </h2>
        <button type="button" onClick={() => setWeek(addDaysToDateStr(weekStart, 7))} aria-label={t('nextWeek')}
          className="grid h-11 w-11 place-items-center rounded-full text-brand-600">
          <ChevronLeft className="h-6 w-6" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Total label={t('total.km')} done={kmText(totals.doneKm * 1000)} planned={kmText(totals.plannedKm * 1000)} fraction={meterFraction(totals.doneKm, totals.plannedKm)} />
        <Total label={t('total.workouts')} done={String(totals.doneCount)} planned={String(totals.plannedCount)} fraction={meterFraction(totals.doneCount, totals.plannedCount)} />
        <Total label={t('total.time')} done={hoursText(totals.doneSec)} planned={hoursText(totals.plannedSec)} fraction={meterFraction(totals.doneSec, totals.plannedSec)} />
      </div>

      {data.workouts.length === 0 && (
        <p className="rounded-[18px] bg-white px-4 py-5 text-center text-sm text-ink-400">{t('weekEmpty')}</p>
      )}

      {data.workouts.map(w => (
        <WeekCard
          key={`${w.date}-${w.name}`}
          w={w}
          today={data.today}
          thresholdSec={T}
          isNext={next?.date === w.date}
          onOpen={() => setOpen(w)}
        />
      ))}

      {data.canPlan && emptyDays.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-13 font-bold text-ink-400">{t('addOn')}</span>
          {emptyDays.map(d => (
            <button key={d} type="button" onClick={() => setPlanning(d)}
              className="h-11 rounded-full bg-white px-4 text-[15px] font-bold text-brand-600 shadow-sm">
              + {t(`dayShort.${WEEKDAY_KEYS[new Date(`${d}T12:00:00Z`).getUTCDay()]}`)}
            </button>
          ))}
        </div>
      )}

      {open && (
        <TraineeWorkout
          workout={open}
          board={data}
          onClose={() => setOpen(null)}
          onChange={data.canPlan ? () => { setPlanning(open.date); setOpen(null); } : undefined}
        />
      )}
      {planning && (
        <DayPlanner
          athleteId={athleteId}
          date={planning}
          onClose={() => setPlanning(null)}
          onDone={() => void mutate()}
        />
      )}
    </div>
  );
}

function Total({ label, done, planned, fraction }: { label: string; done: string; planned: string; fraction: number }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]">
      <small className="block text-xs font-bold text-ink-400">{label}</small>
      <p className="mt-0.5 whitespace-nowrap">
        <N className="text-[19px] font-black text-ink-900">{done}</N>{' '}
        <N className="text-13 text-ink-400">/ {planned}</N>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F4F4F8]">
        <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}

function WeekCard({ w, today, thresholdSec, isNext, onOpen }: {
  w: WeekBoardWorkout;
  today: string;
  thresholdSec: number | null;
  isNext: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('workoutBook');
  const c = w.compliance;
  const dayShort = t(`dayShort.${WEEKDAY_KEYS[w.dayOfWeek]}`);
  const caret = c.caret === 'up' ? '▲' : c.caret === 'down' ? '▼' : '';
  const tomorrow = addDaysToDateStr(today, 1);
  const model = useMemo(() => workoutModel(w, thresholdSec), [w, thresholdSec]);
  const reps = !!model && model[mainStepIndex(model)]?.kind === 'reps';

  let status: React.ReactNode;
  if (c.color === 'green') status = <span className="text-[#0E7A3C]">✓ {t('onPlan')}</span>;
  else if (c.color === 'red') status = <span className="font-extrabold text-accent-red-ink">{t('missed')}</span>;
  else if (c.color === 'grey') {
    const when = w.date === today ? t('today') : w.date === tomorrow ? t('tomorrow') : null;
    status = <>{when && <>{when} · </>}{w.onWatch ? t('onWatchShort') : t('notOnWatch')}</>;
  } else {
    const planned = c.measure === 'time' ? Math.round((w.plannedSec ?? 0) / 60) : kmText(w.plannedM ?? 0);
    const actual = c.measure === 'time' ? Math.round((w.actualSec ?? 0) / 60) : kmText(w.actualM ?? 0);
    status = (
      <span className={cn('font-extrabold', c.color === 'orange' ? 'text-[#9A4A0E]' : 'text-[#7A5A08]')}>
        {caret} {t.rich(c.measure === 'time' ? 'ofPlannedMin' : 'ofPlannedKm', { ...RICH, actual, planned })}
      </span>
    );
  }

  const done = c.color !== 'grey' && c.color !== 'red';
  const km = done ? w.actualM : w.plannedM;
  const pace = done ? w.actualPace : w.plannedPace;
  const off = done && w.actualPace && w.plannedPace ? w.actualPace - w.plannedPace : 0;
  const paceColor = !done ? 'text-ink-900' : Math.abs(off) <= 5 ? 'text-[#0E7A3C]' : 'text-[#8A4308]';

  return (
    <button type="button" onClick={onOpen} className="flex w-full overflow-hidden rounded-[18px] bg-white text-start shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]">
      <span aria-hidden className="w-[7px] shrink-0" style={{ background: COMPLIANCE_HEX[c.color] }} />
      <span className="min-w-0 flex-1 px-3.5 py-3">
        <span className="flex items-baseline justify-between gap-2">
          <b className="truncate text-[16.5px] font-extrabold text-ink-900">{dayShort} · <bdi>{w.name}</bdi></b>
          <small className="shrink-0 text-13 text-ink-400">{status}</small>
        </span>
        <small className="mt-0.5 block text-13 text-ink-400">
          {km ? <>{t.rich('kmOnly', { ...RICH, km: kmText(km) })}</> : null}
          {pace ? (
            <> · {t.rich(reps ? 'repsAtPace' : 'atPace', {
              ...RICH,
              pace: `${done && Math.abs(off) > 5 ? (off > 0 ? '▼ ' : '▲ ') : ''}${clockText(pace)}`,
              p: (chunks) => <bdi dir="ltr" className={cn('font-black', paceColor)}>{chunks}</bdi>,
            })}</>
          ) : null}
        </small>
        {isNext && model && <ProfileBar segments={profileBar(model, thresholdSec)} height={20} className="mt-2" />}
      </span>
    </button>
  );
}
