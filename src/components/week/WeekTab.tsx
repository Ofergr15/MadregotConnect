'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronLeft, Share2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { useStoryAccess } from '@/lib/stories/client';
import { ShareSheet } from '@/components/ShareSheet';
import { AttendanceRSVP } from '@/components/AttendanceRSVP';
import { Ring, Where, WEEK_ACCENT } from '@/components/profile/MyWeekCard';
import { WORKOUT_TYPE_COLORS } from '@/lib/plans/workout-parsing';
import { sessionHeadline } from '@/lib/plans/session-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { roundKm } from '@/lib/plans/week-summary';
import { dayStatus } from '@/lib/plans/week-status';
import { lastWeekKm, plannedMin, ringNumbers, weekDayRows, weekLeft, type WeekPlan } from '@/lib/plans/week-tab';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';
import type { Last7Report } from '@/lib/reports/last-7-days';

// ═════════════════════════════════════════════════════════════════════════════
// "השבוע" — the plan tab's first view (my-week-proposal.html, Ofer 10-20): the
// ring from "השבוע שלי", then the seven days with the plan in a line and the run
// under it, what is left, ten weeks, and sharing the week. Nothing here is computed
// anew: the ring and "what's left" read lib/plans/week-tab (the profile card reads
// the same), the runs are stats.planWeek's, the plan is the member's own lane.
// A past day with no run gets no colour at all — no failure red, no grey "missed".
// ═════════════════════════════════════════════════════════════════════════════

interface Stats { planWeek?: PlanWeekStats; last7?: Last7Report }

const kmText = (min: number, max: number) => {
  const a = roundKm(min); const b = roundKm(max);
  return a === b ? `${b}` : `${a}–${b}`;
};
const pace = (seconds: number, km: number) => {
  if (km <= 0) return '';
  const s = Math.round(seconds / km);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const clock = (sec: number) => {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export function WeekTab({ athleteId, teamDays = [2, 5], workoutHour = 18, onOpenPlan }: {
  athleteId: string;
  teamDays?: number[];
  workoutHour?: number;
  /** The plan line: the training view's full workout, as the tab always showed it. */
  onOpenPlan?: () => void;
}) {
  const t = useTranslations('weekTab');
  const tp = useTranslations('profile');
  const tc = useTranslations('common');
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };
  const dayNames = tc.raw('dayNames') as string[];
  const col = WEEK_ACCENT.club;

  // The same two reads as the profile's "השבוע שלי" card (SWR shares them).
  const { data: stats } = useApi<Stats>(athleteId ? `/api/athletes/${athleteId}/stats` : null);
  const pw = stats?.planWeek;
  const { data: plan } = useApi<WeekPlan & { hasPlan?: boolean }>(pw ? `/api/plans/week?weekStart=${pw.weekStart}&lane=mine` : null);
  const [sharing, setSharing] = useState(false);
  const weekStory = useStoryAccess('weekly');

  if (!pw) return <div className="h-[420px] animate-pulse rounded-card bg-card" />;

  const today = israelToday();
  const { target, shouldBy, scale } = ringNumbers(pw, plan);
  const rows = weekDayRows(pw, plan);
  const left = weekLeft(pw, plan);
  const lastWeek = lastWeekKm(pw);
  const planned = rows.filter((r) => r.d <= pw.today && plannedMin(plan, r.d) > 0);
  const done = planned.filter((r) => dayStatus({ date: r.date, today, requiredMin: plannedMin(plan, r.d), km: r.km }) === 'done').length;
  const diff = (a: number, b: number) => `${a - b >= 0 ? '+' : '−'}${roundKm(Math.abs(a - b))}`;
  const lastWhen = `${dayNames[pw.today]} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}`;
  const range = (() => {
    const a = new Date(`${pw.weekStart}T12:00:00Z`); const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6);
    return `${a.getUTCDate()}.${a.getUTCMonth() + 1}–${b.getUTCDate()}.${b.getUTCMonth() + 1}`;
  })();
  const canShare = !!stats?.last7 && stats.last7.runs > 0 && !!weekStory?.allowed;

  return (
    <div className="space-y-3" dir="rtl">
      {/* The ring — "השבוע שלי"'s own, with its two "where" lines. */}
      <section className="rounded-card bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-ink-900">{t('title')}</h2>
          <span className="text-xs font-semibold text-ink-400"><bdi dir="ltr">{range}</bdi> · {tp('myWeekDay', { n: pw.today + 1 })}</span>
        </div>
        <div className="relative mx-auto mt-1 h-[200px] w-[200px]">
          <Ring km={pw.km} scale={scale} target={target} should={shouldBy} col={col} id="week-tab" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <bdi dir="ltr" className="text-[40px] font-black leading-none tracking-tight text-ink-900 tabular-nums">{roundKm(pw.km)}</bdi>
            <span className="text-sm font-bold text-ink-500">{tc('km')}</span>
            {target ? (
              <span className="mt-1 text-xs font-bold text-accent-900">{t('outOf', { km: Math.round(target.min) })}</span>
            ) : (
              <span className="mt-1 text-xs font-semibold text-ink-400">{tp('myWeekNoPlan')}</span>
            )}
          </div>
        </div>
        {/* Only once something is done: "0 of 3" on an empty week reads as a failure. */}
        {planned.length > 0 && done > 0 && (
          <p className={cn('mt-1 text-center text-sm font-extrabold', done === planned.length ? 'text-accent-900' : 'text-ink-700')}>
            {t('daysDone', { done, planned: planned.length })}
          </p>
        )}
        <div className="mt-2 space-y-1.5">
          {shouldBy > 0 && <Where dashed label={tp('myWeekShouldBy')} value={roundKm(shouldBy)} delta={diff(pw.km, shouldBy)} good={pw.km >= shouldBy} unit={tc('km')} />}
          {(pw.lastWeekSoFar > 0 || pw.km > 0) && (
            <Where label={tp('myWeekSameLastWeek', { when: lastWhen })} value={roundKm(pw.lastWeekSoFar)} delta={diff(pw.km, pw.lastWeekSoFar)} good={pw.km >= pw.lastWeekSoFar} unit={tc('km')} />
          )}
        </div>
      </section>

      {!plan?.hasPlan && <p className="px-2 text-center text-sm text-ink-400">{t('noPlan')}</p>}

      {/* The seven days: the plan in a line, the run under it. */}
      <section className="overflow-hidden rounded-card bg-card">
        {rows.map((r) => {
          const ran = r.km > 0;
          const isToday = r.when === 'today';
          const rsvp = (r.when === 'today' || r.when === 'tomorrow') && teamDays.includes(r.d) && r.prescribed;
          return (
            <div key={r.d} className={cn('border-b border-page px-4 py-3 last:border-0', isToday && 'bg-brand-600/[0.04]')}>
              <div className="flex items-center gap-2">
                <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', ran ? 'bg-accent-600' : 'bg-transparent')}>
                  {ran && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </span>
                <span className="text-sm font-extrabold text-ink-900">
                  {dayNames[r.d]} <bdi dir="ltr" className="font-semibold text-ink-400">{Number(r.date.slice(8, 10))}.{Number(r.date.slice(5, 7))}</bdi>
                </span>
                {isToday && <span className="rounded-full bg-brand-600 px-2 py-px text-2xs font-extrabold text-white">{t('today')}</span>}
                {r.when === 'tomorrow' && <span className="rounded-full bg-page px-2 py-px text-2xs font-bold text-ink-500">{t('tomorrow')}</span>}
              </div>

              <div className="mt-1.5 space-y-1 ps-8">
                {r.sessions.length === 0 && <p className="text-xs text-ink-400">{t('rest')}</p>}
                {r.sessions.map((s) => {
                  const hl = sessionHeadline(s.steps ?? [], units) || s.name;
                  const part = s.kind === 'evening' ? t('evening') : s.kind === 'morning' && r.sessions.length > 1 ? t('morning') : '';
                  return (
                    <button key={s.key} type="button" onClick={onOpenPlan}
                      className={cn('flex w-full items-center gap-2 text-start', s.optional && 'opacity-90')}>
                      <span aria-hidden className="h-4 w-1 shrink-0 rounded-full" style={{ background: s.optional ? '#A78BFA' : WORKOUT_TYPE_COLORS[s.type] ?? WORKOUT_TYPE_COLORS.rest }} />
                      <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', s.optional ? 'text-ink-500' : 'font-semibold text-ink-900')}>
                        {part && <span className="text-ink-400">{part} · </span>}
                        <bdi dir="ltr">{hl}</bdi>
                      </span>
                      {s.optional && <span className="shrink-0 rounded-full bg-[#EDE9FE] px-2 py-px text-2xs font-extrabold text-[#6D28D9]">{t('optional')}</span>}
                      {s.kmMax > 0 && <span className="shrink-0 text-xs font-bold text-ink-400"><bdi dir="ltr">{kmText(s.kmMin, s.kmMax)}</bdi></span>}
                    </button>
                  );
                })}

                {r.runs.map((run, i) => {
                  const body = (
                    <>
                      <span className="text-sm font-extrabold text-ink-900"><bdi dir="ltr">{roundKm(run.km)}</bdi> {tc('km')}</span>
                      <span className="text-xs text-ink-500"><bdi dir="ltr">{clock(run.seconds)}</bdi> · <bdi dir="ltr">{pace(run.seconds, run.km)}</bdi>/{tc('km')}</span>
                      {run.id && (
                        <span className="ms-auto flex items-center text-xs font-bold text-brand-600">
                          {r.prescribed ? t('planVsRun') : tp('weekToRun')}<ChevronLeft className="h-4 w-4 ltr:rotate-180" />
                        </span>
                      )}
                    </>
                  );
                  return run.id ? (
                    <Link key={run.id} href={`/dashboard/activities/${run.id}`} className="mt-1 flex min-h-[44px] items-center gap-2 rounded-xl bg-page/70 px-3">{body}</Link>
                  ) : (
                    <div key={i} className="mt-1 flex min-h-[44px] items-center gap-2 rounded-xl bg-page/70 px-3">{body}</div>
                  );
                })}

                {isToday && !ran && r.prescribed && <p className="pt-0.5 text-xs text-ink-400">{t('openToday')}</p>}
                {rsvp && (
                  <div className="pt-1.5">
                    <AttendanceRSVP variant="inline" weekStart={pw.weekStart} day={r.d} dayBefore={r.when === 'tomorrow'} workoutHour={workoutHour} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* What is left — the ring's own floor less what is run, so it matches the ring. */}
      {left && (
        <section className="rounded-card bg-card p-4">
          <h3 className="text-sm font-extrabold text-ink-900">{t('leftTitle')}</h3>
          {left.requiredKm > 0 ? (
            <p className="mt-1 text-[15px] font-bold text-ink-900">{t('leftRequired', { km: roundKm(left.requiredKm), days: left.days })}</p>
          ) : (
            <p className="mt-1 text-[15px] font-bold text-accent-900">{t('leftReached')}</p>
          )}
          {left.next && (
            <p className="mt-1 text-sm text-ink-600">
              {t('leftNext')} {dayNames[left.next.d]} · <bdi dir="ltr">{sessionHeadline(left.next.session.steps ?? [], units) || left.next.session.name}</bdi>
              {left.next.session.kmMax > 0 && <> · <bdi dir="ltr">{kmText(left.next.session.kmMin, left.next.session.kmMax)}</bdi> {tc('km')}</>}
            </p>
          )}
          {left.optionalKm > 0 && <p className="mt-1 text-xs font-bold text-[#6D28D9]">{t('leftOptional', { km: roundKm(left.optionalKm) })}</p>}
        </section>
      )}

      {/* Ten weeks in one line; the whole history stays on the profile. */}
      <Link href="/dashboard/profile?tab=stats" className="flex items-center gap-3 rounded-card bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-ink-900">{t('tenWeeks')}</p>
          <p className="mt-0.5 text-xs text-ink-400">
            {pw.avgKm > 0 && t('tenWeeksAvg', { km: roundKm(pw.avgKm) })}
            {lastWeek != null && lastWeek > 0 && <> · {t('lastWeek')} <bdi dir="ltr" className="font-bold text-ink-700">{roundKm(lastWeek)}</bdi></>}
          </p>
        </div>
        <span className="flex shrink-0 items-center text-xs font-bold text-brand-600">{t('allInProfile')}<ChevronLeft className="h-4 w-4 ltr:rotate-180" /></span>
      </Link>

      {canShare && (
        <button type="button" onClick={() => setSharing(true)}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-pill bg-ink-900 text-[15px] font-extrabold text-white">
          <Share2 className="h-4 w-4" /> {t('share')}
        </button>
      )}
      {sharing && stats?.last7 && weekStory?.allowed && <ShareSheet subject={{ kind: 'week', report: stats.last7 }} onClose={() => setSharing(false)} />}
    </div>
  );
}
