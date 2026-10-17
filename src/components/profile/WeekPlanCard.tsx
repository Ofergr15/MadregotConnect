'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, Check, ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, getPlanWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { WeekTargetBar } from '@/components/profile/WeekTargetBar';
import { AttendanceRSVP } from '@/components/AttendanceRSVP';
import { WORKOUT_TYPE_COLORS, WORKOUT_TYPE_TEXT_COLORS, getDisplayWeekStart, planDayKey, type WeekSession } from '@/lib/plans/workout-parsing';
import { sessionHeadline } from '@/lib/plans/session-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { roundKm } from '@/lib/plans/week-summary';
import { weekTargetRange, type WeekPlanTotals } from '@/lib/plans/week-target';
import { useWorkoutTypeLabel } from '@/lib/plans/use-workout-type-label';
import { dayStatus, weekRangeParts, type DayStatus } from '@/lib/plans/week-status';
import type { Last7Report, ReportDay } from '@/lib/reports/last-7-days';

/**
 * THE WEEK, DAY BY DAY (Ofer, 2026-10-17, mockups/weekly-plan) — seven rows, all
 * on screen: what the plan asks for that day in the athlete's own lane, what was
 * run, and whether that is done, partial or missed.
 *
 * It is always the week the athlete is standing in. The plan's Saturday-20:00
 * rollover is for previewing, so after it next week appears as a second tab once
 * the coach has published it, and as one line saying it isn't out yet until then.
 * The strip this replaced rolled over itself and showed seven dashes of an
 * unpublished week beside a bar still counting this one.
 *
 * Kilometres done come from the plan week's own dates in the stats `last7` window
 * (the same request the profile body makes): on any day of a Sunday–Saturday week
 * the days already gone are inside the last seven.
 */

interface PlanWeek extends WeekPlanTotals {
  weekStart: string;
  sessions: WeekSession[];
  dailyDistances: Array<{ dayOfWeek: number; requiredMin?: number; requiredMax?: number; min: number; max: number; type: string }>;
  trainingDays: number;
  lane?: number | null;
  ownPlan?: boolean;
}

/** Past this length a headline is the coach's prose, not a set — the type says more. */
const HEADLINE_MAX = 24;

const kmText = (min: number, max: number) => {
  const a = roundKm(min);
  const b = roundKm(max);
  return a === b ? `${b}` : `${a}–${b}`;
};

export function WeekPlanCard({ athleteId, teamDays, workoutHour }: { athleteId: string; teamDays: number[]; workoutHour: number }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const locale = useLocale();
  const typeLabel = useWorkoutTypeLabel();
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };

  const today = israelToday();
  const thisWeek = getPlanWeekStart(israelDateAnchor());
  // After Saturday 20:00 the app previews next week; this card keeps this one.
  const previewWeek = getDisplayWeekStart(new Date());
  const hasPreview = previewWeek !== thisWeek;

  const { data: cur } = useApi<PlanWeek>(`/api/plans/week?weekStart=${thisWeek}&lane=mine`);
  const { data: next } = useApi<PlanWeek>(hasPreview ? `/api/plans/week?weekStart=${previewWeek}&lane=mine` : null);
  const { data: stats } = useApi<{ last7?: Last7Report }>(athleteId ? `/api/athletes/${athleteId}/stats` : null);
  const runsByDate = new Map((stats?.last7?.days ?? []).map((d) => [d.date, d] as const));

  const [showNext, setShowNext] = useState(false);
  const [openDay, setOpenDay] = useState<number | null>(null);

  const week = showNext && next?.hasPlan ? next : cur;
  if (!week) return null;
  const isThisWeek = week.weekStart === thisWeek;

  const dayNames = tc.raw('dayNames') as string[];
  const dayShort = tc.raw('dayNamesShort') as string[];

  const days = Array.from({ length: 7 }, (_, dow) => {
    const date = planDayKey(week.weekStart, dow);
    const all = (week.sessions ?? []).filter((s) => s.dayOfWeek === dow);
    const required = all.filter((s) => !s.optional);
    const dd = week.dailyDistances?.find((d) => d.dayOfWeek === dow);
    const requiredMin = dd?.requiredMin ?? dd?.min ?? 0;
    const requiredMax = dd?.requiredMax ?? dd?.max ?? 0;
    const run: ReportDay | undefined = isThisWeek ? runsByDate.get(date) : undefined;
    const km = run?.km ?? 0;
    const headlines = required.map((s) => sessionHeadline(s.steps ?? [], units)).filter(Boolean);
    const joined = headlines.join(' + ');
    const type = dd?.type ?? 'rest';
    const minutes = Math.round(required.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60);
    return {
      dow, date, all, required, requiredMin, requiredMax, run, km, type,
      // A coach's sentence for a headline ("40 דקות 4:50-5:30 או מנוחה…") gives way
      // to the session's length, and a day with neither to its type.
      title: joined && joined.length <= HEADLINE_MAX ? joined
        : minutes > 0 ? `${minutes} ${units.min}` : typeLabel(type),
      joinedTitle: headlines.length > 1 && joined.length <= HEADLINE_MAX,
      status: (isThisWeek ? dayStatus({ date, today, requiredMin, km }) : 'future') as DayStatus,
    };
  });

  const doneKm = days.reduce((sum, d) => sum + (d.date <= today ? d.km : 0), 0);
  const target = weekTargetRange(week);
  const planned = days.filter((d) => d.requiredMin > 0).length;
  const onPlan = days.filter((d) => d.status === 'done').length;
  const range = weekRangeParts(week.weekStart, locale);
  const rangeText = 'days' in range
    ? <><bdi dir="ltr">{range.days}</bdi> {range.month}</>
    : <><bdi>{range.from}</bdi> – <bdi>{range.to}</bdi></>;

  // RSVP for today's or tomorrow's team session — the ask the reminders make.
  const rsvp = isThisWeek || week.weekStart === previewWeek
    ? days.find((d) => {
        if (!teamDays.includes(d.dow) || d.requiredMin <= 0) return false;
        const off = Math.round((Date.parse(`${d.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
        return off === 0 || off === 1;
      })
    : undefined;

  const open = openDay != null ? days[openDay] : null;

  return (
    <div data-tour="weekStrip" className="rounded-card bg-card p-4">
      {hasPreview && next?.hasPlan && (
        <div role="tablist" className="mb-3 grid grid-cols-2 rounded-xl bg-page/70 p-1 text-sm font-bold">
          {[false, true].map((n) => (
            <button
              key={String(n)}
              role="tab"
              aria-selected={showNext === n}
              onClick={() => setShowNext(n)}
              className={cn('min-h-[36px] rounded-lg', showNext === n ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-400')}
            >
              {n ? t('weekTabNext') : t('weekTabThis')}
            </button>
          ))}
        </div>
      )}

      {/* Next week has nothing run yet: a bar at 0 says nothing, so just the target. */}
      {week.hasPlan && target && isThisWeek ? (
        <WeekTargetBar title={t('weeklyProgram')} doneKm={doneKm} target={target} />
      ) : (
        <div className="flex items-end justify-between gap-2">
          <h2 className="text-xl font-bold text-ink-700">{t('weeklyProgram')}</h2>
          {target && (
            <p className="text-sm text-ink-500">
              <bdi dir="ltr" className="text-lg font-bold text-ink-700">{Math.round(target.min)}–{Math.round(target.max)}</bdi> {tc('km')}
            </p>
          )}
        </div>
      )}
      <p className="mt-1.5 flex flex-wrap gap-x-1 text-xs text-ink-400">
        <span>{isThisWeek ? t('weekThis') : t('weekTabNext')} · {rangeText}</span>
        {week.hasPlan && isThisWeek && planned > 0 && <span>· {t('weekDaysOnPlan', { done: onPlan, planned })}</span>}
        {week.hasPlan && (week.ownPlan ? <span>· {t('weekOwnPlan')}</span> : week.lane ? <span>· {t('weekLane', { n: week.lane })}</span> : null)}
      </p>

      {!week.hasPlan ? (
        <p className="mt-3 text-sm font-light text-ink-400">{t('noPlanThisWeekYet')}</p>
      ) : (
        <ul className="mt-2">
          {days.map((d) => (
            <li key={d.dow}>
              <button
                type="button"
                onClick={() => setOpenDay(d.dow)}
                aria-label={t('weekDayOpen', { day: dayNames[d.dow] })}
                className={cn(
                  'flex min-h-[56px] w-full items-center gap-2.5 border-t border-page py-1.5 text-start',
                  d.date === today && '-mx-2 w-[calc(100%+1rem)] rounded-xl border-transparent bg-brand-600/[0.07] px-2',
                )}
              >
                <span className="flex w-8 flex-none flex-col items-center leading-tight">
                  <span className="text-base font-extrabold text-ink-900">{dayShort[d.dow]}</span>
                  <bdi dir="ltr" className="text-3xs text-ink-400">{d.date.slice(8, 10)}.{d.date.slice(5, 7)}</bdi>
                </span>
                <span aria-hidden className="w-1 self-stretch rounded-full my-1" style={{ background: WORKOUT_TYPE_COLORS[d.type] ?? WORKOUT_TYPE_COLORS.rest }} />
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-sm font-bold text-ink-900">{d.title}</bdi>
                  {/* The team badge rides the second line: beside a two-session title it
                      cut the evening's set off. */}
                  <span className="flex items-center gap-1.5 truncate text-xs font-semibold" style={{ color: WORKOUT_TYPE_TEXT_COLORS[d.type] ?? WORKOUT_TYPE_TEXT_COLORS.rest }}>
                    {teamDays.includes(d.dow) && d.requiredMin > 0 && (
                      <span className="flex-none rounded-full bg-brand-600/10 px-1.5 py-px text-3xs font-bold text-brand-600">{t('weekTeamDay')}</span>
                    )}
                    <span className="truncate">
                      {typeLabel(d.type)}
                      {d.required.length > 1 && !d.joinedTitle && <> · {t('weekSessions', { n: d.required.length })}</>}
                      {d.all.length > d.required.length && <> · {t('weekOptional')}</>}
                    </span>
                  </span>
                </span>
                <span className="min-w-[68px] flex-none text-end leading-tight">
                  {d.km > 0 ? (
                    <>
                      <span className="block text-xs text-ink-700"><bdi dir="ltr" className="text-base font-extrabold">{roundKm(d.km)}</bdi> {tc('km')}</span>
                      {d.requiredMax > 0 && <span className="block text-3xs text-ink-400">{t('weekPlannedOf')} <bdi dir="ltr">{kmText(d.requiredMin, d.requiredMax)}</bdi></span>}
                    </>
                  ) : d.requiredMax > 0 ? (
                    <>
                      <span className="block text-xs text-ink-400"><bdi dir="ltr">{kmText(d.requiredMin, d.requiredMax)}</bdi> {tc('km')}</span>
                      {d.status === 'missed' && <span className="block text-3xs font-bold text-accent-red">{t('weekMissed')}</span>}
                    </>
                  ) : null}
                </span>
                <StatusMark status={d.status} label={d.status === 'future' || d.status === 'rest' ? '' : t(`weekStatus_${d.status}`)} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasPreview && !next?.hasPlan && next && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-page/70 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
          <Bell className="mt-0.5 h-4 w-4 flex-none text-ink-400" aria-hidden />
          <p>
            <span className="block font-bold text-ink-700">{t('weekTabNext')} · <NextRange weekStart={previewWeek} locale={locale} /></span>
            {t('weekNextPending')}
          </p>
        </div>
      )}

      {rsvp && (
        <div className="mt-3">
          <AttendanceRSVP
            variant="inline"
            weekStart={week.weekStart}
            day={rsvp.dow}
            dayBefore={rsvp.date !== today}
            workoutHour={workoutHour}
          />
        </div>
      )}

      <Link href="/dashboard/program" className="inline-flex items-center gap-1 py-3.5 -mb-3.5 text-sm font-bold text-brand-600">
        {t('fullProgram')}
        <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
      </Link>

      <Sheet
        open={open != null}
        onOpenChange={(o) => { if (!o) setOpenDay(null); }}
        title={open ? `${dayNames[open.dow]} · ${open.date.slice(8, 10)}.${open.date.slice(5, 7)}` : ''}
      >
        {open && (
          <div className="px-1 pb-2">
            {open.all.length === 0 ? (
              <p className="py-2 text-sm text-ink-500">{typeLabel('rest')}</p>
            ) : open.all.map((s) => {
              const hl = sessionHeadline(s.steps ?? [], units);
              const kind = s.kind === 'morning' ? t('weekMorning') : s.kind === 'evening' ? t('weekEvening') : '';
              return (
                <div key={s.key} className="flex gap-2.5 border-b border-page py-2.5">
                  <span aria-hidden className="w-1 rounded-full" style={{ background: WORKOUT_TYPE_COLORS[s.type] ?? WORKOUT_TYPE_COLORS.rest }} />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink-900" dir="auto">{hl || s.name}</p>
                    <p className="text-xs text-ink-500">
                      {[kind, s.optional ? t('weekOptionalSession') : '', typeLabel(s.type)].filter(Boolean).join(' · ')}
                      {s.kmMax > 0 && <> · <bdi dir="ltr">{kmText(s.kmMin, s.kmMax)}</bdi> {tc('km')}</>}
                      {s.durationSec > 0 && <> · <bdi dir="ltr">{Math.round(s.durationSec / 60)}</bdi> {tc('minutes')}</>}
                    </p>
                  </div>
                </div>
              );
            })}
            {open.run?.activities?.length ? (
              <>
                <p className="mb-1 mt-3 text-xs font-bold text-ink-400">{t('weekWhatYouDid')}</p>
                {open.run.activities.map((a) => (
                  <Link
                    key={a.id}
                    href={`/dashboard/activities/${a.id}`}
                    className="flex min-h-[48px] items-center gap-2 border-b border-page text-sm"
                  >
                    <bdi dir="ltr" className="font-bold text-ink-900">{roundKm(a.km)}</bdi> {tc('km')}
                    <span className="ms-auto flex items-center text-xs font-bold text-brand-600">{t('weekToRun')}<ChevronLeft className="h-4 w-4 ltr:rotate-180" /></span>
                  </Link>
                ))}
              </>
            ) : null}
            <Link
              href="/dashboard/program"
              className="mt-4 flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-brand-600 text-base font-extrabold text-white"
            >
              {t('weekFullWorkout')}
            </Link>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function NextRange({ weekStart, locale }: { weekStart: string; locale: string }) {
  const r = weekRangeParts(weekStart, locale);
  return 'days' in r ? <><bdi dir="ltr">{r.days}</bdi> {r.month}</> : <><bdi>{r.from}</bdi> – <bdi>{r.to}</bdi></>;
}

function StatusMark({ status, label }: { status: DayStatus; label: string }) {
  if (status === 'future' || status === 'rest') return <span className="w-[22px] flex-none" aria-hidden />;
  if (status === 'today') {
    return <span className="flex-none rounded-full bg-brand-600 px-1.5 py-0.5 text-3xs font-bold text-white">{label}</span>;
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-xs font-extrabold',
        status === 'done' && 'bg-accent-600 text-white',
        status === 'partial' && 'bg-band-3/15 text-band-3-ink',
        status === 'missed' && 'bg-accent-red/10 text-accent-red',
      )}
    >
      {status === 'done' ? <Check className="h-3 w-3" strokeWidth={3.5} /> : status === 'partial' ? '◐' : '✕'}
    </span>
  );
}
