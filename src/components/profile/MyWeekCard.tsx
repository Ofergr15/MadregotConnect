'use client';

import { showTesterBar, useStoryAccess } from '@/lib/stories/client';
import { StoryTesterBar } from '@/components/stories/StoryTesterBar';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronLeft, Share2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { AttendanceRSVP } from '@/components/AttendanceRSVP';
import { ShareSheet } from '@/components/ShareSheet';
import type { Last7Report } from '@/lib/reports/last-7-days';
import { WORKOUT_TYPE_COLORS, planDayKey, type WeekSession } from '@/lib/plans/workout-parsing';
import { sessionHeadline } from '@/lib/plans/session-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { roundKm } from '@/lib/plans/week-summary';
import { weekTargetRange, type WeekPlanTotals } from '@/lib/plans/week-target';
import { useWorkoutTypeLabel } from '@/lib/plans/use-workout-type-label';
import { dayStatus, type DayStatus } from '@/lib/plans/week-status';
import { formatDurationClock } from '@/lib/workout-duration';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';

/**
 * "השבוע שלי" (Ofer, 2026-10-18, mockups/my-week/full.html) — the top of the stats tab.
 *
 *  · A RING: this plan week's kilometres against the group's target range (the green arc
 *    outside it). Until the coach publishes the week it measures against the athlete's
 *    own ten-week average instead of a target nobody set.
 *  · A DASHED ARC inside it: where the plan says to be by the END OF TODAY — and no
 *    further. Never the week ahead: Wednesday's number is Wednesday's business.
 *  · The same moment LAST WEEK: same weekday, same minute — not last week's total, which
 *    reads as a collapse every Sunday.
 *  · Seven day circles (done / partial / missed / today / not yet); a day that has come
 *    opens what was planned and what was run.
 *  · Ten plan weeks as a line, like Strava, and this month and this year.
 *
 * One window for all of it, the plan's Sunday week (lib/athletes/plan-week.ts). The
 * screen it replaces measured the watch's Monday week against the plan's Sunday target.
 */

interface PlanWeek extends WeekPlanTotals {
  weekStart: string;
  hasClubPlan?: boolean;
  sessions: WeekSession[];
  dailyDistances: Array<{ dayOfWeek: number; requiredMin?: number; min: number; type: string }>;
}
interface Stats {
  planWeek?: PlanWeekStats;
  last7?: Last7Report;
  monthKm?: number;
  monthRuns?: number;
  yearKm?: number;
  yearRuns?: number;
}

const R = 78;

/**
 * The card's accent: the club's blue, or the academy's purple when a coach or the academy
 * manager opens a trainee (academy-dash.html). One table, so every blue mark follows it.
 */
export type WeekAccent = 'club' | 'academy';
export const WEEK_ACCENT: Record<WeekAccent, { main: string; soft: string }> = {
  club: { main: '#1525FF', soft: '#5B6BFF' },
  academy: { main: '#7C3AED', soft: '#A78BFA' },
};
const kmText = (min: number, max: number) => {
  const a = roundKm(min); const b = roundKm(max);
  return a === b ? `${b}` : `${a}–${b}`;
};
const clock = (start: string) => start.slice(11, 16);
const pace = (seconds: number, km: number) => {
  if (km <= 0) return '';
  const s = Math.round(seconds / km);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const hours = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;

export function MyWeekCard({ athleteId, owner, athleteName, teamDays = [], workoutHour = 18, accent = 'club', academyLane = false, compact = false }: {
  athleteId: string;
  /** On the shared week card (it moved here with the seven-day card it used to sit on). */
  athleteName?: string;
  /** The athlete's own profile: their lane, their RSVP. A teammate's reads that athlete's lane. */
  owner: boolean;
  teamDays?: number[];
  workoutHour?: number;
  /** 'academy' on a trainee's full picture: purple instead of the club's blue. */
  accent?: WeekAccent;
  /** Staff reading an academy trainee: that trainee's OWN week (their coach's plan). */
  academyLane?: boolean;
  /** Inside a sheet: no month/year tiles, no link to the program. */
  compact?: boolean;
}) {
  const col = WEEK_ACCENT[accent];
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const locale = useLocale();
  const typeLabel = useWorkoutTypeLabel();
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };
  const dayNames = tc.raw('dayNames') as string[];
  const dayShort = tc.raw('dayNamesShort') as string[];

  // The profile body asks for the same key, so this costs no request.
  const { data: stats } = useApi<Stats>(athleteId ? `/api/athletes/${athleteId}/stats` : null);
  const pw = stats?.planWeek;
  const { data: plan } = useApi<PlanWeek>(pw ? `/api/plans/week?weekStart=${pw.weekStart}&lane=${owner ? 'mine' : athleteId}${academyLane && !owner ? '&academy=1' : ''}` : null);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const weekStory = useStoryAccess('weekly');

  if (!pw) return null;

  const today = israelToday();
  const clubPlan = plan?.hasPlan && plan.hasClubPlan !== false;
  const target = clubPlan ? weekTargetRange(plan) : null;
  const plannedMin = (d: number) => {
    const dd = plan?.dailyDistances?.find((x) => x.dayOfWeek === d);
    return dd ? dd.requiredMin ?? dd.min : 0;
  };
  const shouldBy = Array.from({ length: pw.today + 1 }, (_, d) => plannedMin(d)).reduce((s, x) => s + x, 0);
  // Without a published week the ring is against the athlete's own average.
  const scale = target?.max || Math.max(pw.avgKm, pw.km * 1.25, shouldBy * 1.25, 10);

  const days = Array.from({ length: 7 }, (_, d) => {
    const date = planDayKey(pw.weekStart, d);
    const required = (plan?.sessions ?? []).filter((s) => s.dayOfWeek === d && !s.optional);
    return {
      d, date, km: pw.days[d], runs: pw.dayRuns[d],
      sessions: (plan?.sessions ?? []).filter((s) => s.dayOfWeek === d),
      required,
      status: dayStatus({ date, today, requiredMin: plannedMin(d), km: pw.days[d] }) as DayStatus,
    };
  });
  const planned = days.filter((x) => x.d <= pw.today && plannedMin(x.d) > 0);
  const onPlan = planned.filter((x) => x.status === 'done').length;
  const tomorrow = pw.today < 6 ? days[pw.today + 1].required[0] : undefined;

  const range = (() => {
    const a = new Date(`${pw.weekStart}T12:00:00Z`); const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6);
    const m = (x: Date) => x.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
    return a.getUTCMonth() === b.getUTCMonth()
      ? <><bdi dir="ltr">{a.getUTCDate()}–{b.getUTCDate()}</bdi> {m(a)}</>
      : <><bdi>{a.getUTCDate()} {m(a)}</bdi> – <bdi>{b.getUTCDate()} {m(b)}</bdi></>;
  })();

  // RSVP for today's or tomorrow's team session — the ask the reminders make.
  const rsvpDay = owner
    ? days.find((x) => teamDays.includes(x.d) && x.required.length > 0 && (x.d === pw.today || x.d === pw.today + 1))
    : undefined;

  const open = openDay != null ? days[openDay] : null;
  const diff = (a: number, b: number) => `${a - b >= 0 ? '+' : '−'}${roundKm(Math.abs(a - b))}`;
  const lastWhen = `${dayNames[pw.today]} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}`;

  return (
    <div className="space-y-3">
      <div data-tour="weekStrip" className="rounded-card bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-ink-900">{!owner && athleteName ? t.rich('theirWeek', { name: athleteName.split(' ')[0] || athleteName, b: (c) => <bdi>{c}</bdi> }) : t('myWeek')}</h2>
            {showTesterBar(weekStory) && <StoryTesterBar feature="weekly" tone="light" className="mt-1" />}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-ink-400">{range} · {t('myWeekDay', { n: pw.today + 1 })}</span>
            {/* The week's share card — nothing to share in a week with no runs. */}
            {/* Behind the stories gate (lib/stories/gate.ts). */}
            {stats?.last7 && stats.last7.runs > 0 && weekStory?.allowed && (
              <button
                type="button"
                onClick={() => setSharing(true)}
                aria-label={t('weekShareAction')}
                className="-my-2 -me-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-400 hover:text-brand-600"
              >
                <Share2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {sharing && stats?.last7 && weekStory?.allowed && (
          <ShareSheet
            subject={{ kind: 'week', report: stats.last7, athleteName }}
            onClose={() => setSharing(false)}
          />
        )}

        <div className="relative mx-auto mt-1 h-[200px] w-[200px]">
          <Ring km={pw.km} scale={scale} target={target} should={shouldBy} col={col} id={accent} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <bdi dir="ltr" className="text-[40px] font-black leading-none tracking-tight text-ink-900 tabular-nums">{roundKm(pw.km)}</bdi>
            <span className="text-sm font-bold text-ink-500">{tc('km')}</span>
            {target ? (
              <span className="mt-1 text-xs font-bold text-accent-900">{t('myWeekTarget')} <bdi dir="ltr">{Math.round(target.min)}–{Math.round(target.max)}</bdi></span>
            ) : (
              <span className="mt-1 text-xs font-semibold text-ink-400">{t('myWeekNoPlan')}</span>
            )}
          </div>
        </div>

        <div className="mt-2 space-y-1.5">
          {shouldBy > 0 && (
            <Where
              dashed
              label={t('myWeekShouldBy')}
              value={roundKm(shouldBy)}
              delta={diff(pw.km, shouldBy)}
              good={pw.km >= shouldBy}
              unit={tc('km')}
            />
          )}
          {(pw.lastWeekSoFar > 0 || pw.km > 0) && (
            <Where
              label={t('myWeekSameLastWeek', { when: lastWhen })}
              value={roundKm(pw.lastWeekSoFar)}
              delta={diff(pw.km, pw.lastWeekSoFar)}
              good={pw.km >= pw.lastWeekSoFar}
              unit={tc('km')}
            />
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 text-center">
          <Stat value={String(pw.runs)} label={t('myWeekRuns')} />
          <Stat value={hours(pw.seconds)} label={t('myWeekHours')} />
          <Stat value={pace(pw.seconds, pw.km) || '—'} label={t('myWeekPace')} />
        </div>

        <div className="my-3 h-px bg-page" />
        <div className="flex items-center justify-between text-sm font-extrabold">
          {target || planned.length ? (
            <>
              <span>{t('myWeekByPlan')}</span>
              {planned.length > 0 && (
                <span className={cn('text-xs', onPlan === planned.length ? 'text-accent-900' : 'text-band-3-ink')}>{t('weekDaysOnPlan', { done: onPlan, planned: planned.length })}</span>
              )}
            </>
          ) : tomorrow ? (
            <>
              <span>{t('myWeekTomorrow')}</span>
              <span className="text-xs font-semibold text-ink-400"><bdi dir="ltr">{sessionHeadline(tomorrow.steps ?? [], units) || tomorrow.name}</bdi></span>
            </>
          ) : <span>{t('myWeekDays')}</span>}
        </div>
        <div className="mt-2.5 flex justify-between">
          {days.map((x) => {
            const future = x.d > pw.today;
            return (
              <button
                key={x.d}
                type="button"
                disabled={future}
                onClick={() => setOpenDay(x.d)}
                aria-label={t('weekDayOpen', { day: dayNames[x.d] })}
                className="flex w-[42px] flex-col items-center gap-1 disabled:cursor-default"
              >
                <DayDot col={col.main} status={future ? 'future' : x.status} ran={x.km > 0} today={x.d === pw.today} label={future ? '' : x.status === 'future' || x.status === 'rest' ? '' : t(`weekStatus_${x.status}`)} />
                <bdi dir="ltr" className={cn('text-[13px] font-extrabold tabular-nums', future || !x.km ? 'text-ink-300' : 'text-ink-900')}>
                  {future ? '·' : x.km ? roundKm(x.km) : x.status === 'missed' ? '0' : '—'}
                </bdi>
                <span className={cn('text-xs font-bold', x.d === pw.today ? 'rounded-full px-1.5 text-white' : 'text-ink-400')} style={x.d === pw.today ? { background: col.main } : undefined}>{dayShort[x.d]}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-center text-2xs text-ink-300">{t('myWeekTapHint')}</p>
        {!target && pw.avgKm > 0 && <p className="mt-1 text-center text-2xs text-ink-300">{t('myWeekVsAverage', { km: pw.avgKm })}</p>}

        {rsvpDay && (
          <div className="mt-3">
            <AttendanceRSVP variant="inline" weekStart={pw.weekStart} day={rsvpDay.d} dayBefore={rsvpDay.d !== pw.today} workoutHour={workoutHour} />
          </div>
        )}
      </div>

      <div className="rounded-card bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-ink-900">{t('myWeekTenWeeks')}</h2>
          {pw.avgKm > 0 && <span className="text-xs font-semibold text-ink-400">{t('myWeekAvg', { km: pw.avgKm })}</span>}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink-500">{range}</span>
          <bdi dir="ltr" className="text-[22px] font-black text-ink-900 tabular-nums">{roundKm(pw.km)}</bdi>
          <span className="text-xs text-ink-400">{tc('km')}</span>
        </div>
        {pw.weeks.some((x) => x.km > 0)
          ? <WeeksLine weeks={pw.weeks} locale={locale} col={col.main} id={accent} />
          : <p className="mt-3 text-sm font-light text-ink-400">{t('noKmHistory')}</p>}
      </div>

      {stats && !compact && (
        <div className="grid grid-cols-2 gap-2.5">
          <Tile km={stats.monthKm ?? 0} label={t('myWeekMonth', { month: new Date().toLocaleDateString(locale, { month: 'long', timeZone: 'Asia/Jerusalem' }), runs: stats.monthRuns ?? 0 })} />
          <Tile km={stats.yearKm ?? 0} label={t('myWeekYear', { runs: stats.yearRuns ?? 0 })} />
        </div>
      )}

      {!compact && (
        <Link href="/dashboard/program" className="inline-flex items-center gap-1 px-1 py-2 text-sm font-bold text-brand-600">
          {t('fullProgram')}
          <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
        </Link>
      )}

      <Sheet
        open={open != null}
        onOpenChange={(o) => { if (!o) setOpenDay(null); }}
        title={open ? `${dayNames[open.d]} · ${open.date.slice(8, 10)}.${open.date.slice(5, 7)}` : ''}
      >
        {open && (
          <div className="px-1 pb-2">
            {open.sessions.length === 0 ? (
              <p className="py-2 text-sm text-ink-500">{typeLabel('rest')}</p>
            ) : open.sessions.map((s) => {
              const hl = sessionHeadline(s.steps ?? [], units);
              const kind = s.kind === 'morning' ? t('weekMorning') : s.kind === 'evening' ? t('weekEvening') : '';
              return (
                <div key={s.key} className="flex gap-2.5 border-b border-page py-2.5">
                  <span aria-hidden className="w-1 rounded-full" style={{ background: WORKOUT_TYPE_COLORS[s.type] ?? WORKOUT_TYPE_COLORS.rest }} />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink-900"><bdi dir="ltr">{hl || s.name}</bdi></p>
                    <p className="text-xs text-ink-500">
                      {[kind, s.optional ? t('weekOptionalSession') : '', typeLabel(s.type)].filter(Boolean).join(' · ')}
                      {s.kmMax > 0 && <> · <bdi dir="ltr">{kmText(s.kmMin, s.kmMax)}</bdi> {tc('km')}</>}
                      {s.durationSec > 0 && <> · <bdi dir="ltr">{formatDurationClock(s.durationSec)}</bdi></>}
                    </p>
                  </div>
                </div>
              );
            })}
            {open.runs.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-xs font-bold text-ink-400">
                  {t('weekWhatYouDid')}
                  {open.status !== 'rest' && open.status !== 'future' && open.status !== 'today' && <> · <span className={open.status === 'done' ? 'text-accent-900' : 'text-band-3-ink'}>{t(`weekStatus_${open.status}`)}</span></>}
                </p>
                {open.runs.map((r, i) => {
                  const body = (
                    <>
                      <bdi dir="ltr" className="font-bold text-ink-900">{roundKm(r.km)}</bdi> {tc('km')}
                      <span className="text-xs text-ink-400"><bdi dir="ltr">{clock(r.start)}</bdi> · <bdi dir="ltr">{pace(r.seconds, r.km)}</bdi></span>
                      {r.id && <span className="ms-auto flex items-center text-xs font-bold text-brand-600">{t('weekToRun')}<ChevronLeft className="h-4 w-4 ltr:rotate-180" /></span>}
                    </>
                  );
                  return r.id ? (
                    <Link key={r.id} href={`/dashboard/activities/${r.id}`} className="flex min-h-[48px] items-center gap-2 border-b border-page text-sm">{body}</Link>
                  ) : (
                    <div key={i} className="flex min-h-[48px] items-center gap-2 border-b border-page text-sm">{body}</div>
                  );
                })}
              </>
            )}
            {!compact && (
              <Link href="/dashboard/program" className="mt-4 flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-brand-600 text-base font-extrabold text-white">
                {t('weekFullWorkout')}
              </Link>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Ring({ km, scale, target, should, col, id }: { km: number; scale: number; target: { min: number; max: number } | null; should: number; col: { main: string; soft: string }; id: string }) {
  const C = 2 * Math.PI * R;
  const R2 = R + 14; const C2 = 2 * Math.PI * R2;
  // On the grey track itself, under the fill: inside the ring, clear of the number.
  const R3 = R;
  const frac = Math.min(km / scale, 1);
  const lo = target ? target.min / scale : 0;
  const f3 = Math.min(should / scale, 1);
  const ang = f3 * 2 * Math.PI - Math.PI / 2;
  const x1 = 100 + R3 * Math.cos(ang); const y1 = 100 + R3 * Math.sin(ang);
  return (
    <svg viewBox="0 0 200 200" width="200" height="200" aria-hidden>
      <defs>
        <linearGradient id={`myweek-ring-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={col.soft} />
          <stop offset="1" stopColor={col.main} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r={R} fill="none" stroke="#EEF0F6" strokeWidth="16" />
      {/* The target range, outside the ring. */}
      {target && (
        <circle cx="100" cy="100" r={R2} fill="none" stroke="#22C55E" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${(1 - lo) * C2} 9999`} strokeDashoffset={-lo * C2} transform="rotate(-90 100 100)" />
      )}
      {/* Where the plan says to be by the end of today — and not a day further. Dashed
          along the track, so the run covers it as it gets there; the dot stays on top. */}
      {should > 0 && (
        <path d={`M100,${100 - R3} A${R3},${R3} 0 ${f3 > 0.5 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`}
          fill="none" stroke="#111827" strokeWidth="2.5" strokeDasharray="3 4" strokeLinecap="round" opacity=".55" />
      )}
      {km > 0 && (
        <circle cx="100" cy="100" r={R} fill="none" stroke={`url(#myweek-ring-${id})`} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${frac * C} 9999`} transform="rotate(-90 100 100)" />
      )}
      {should > 0 && <circle cx={x1} cy={y1} r="5" fill="#111827" stroke="#fff" strokeWidth="2" />}
    </svg>
  );
}

function Where({ label, value, delta, good, unit, dashed = false }: { label: string; value: number; delta: string; good: boolean; unit: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-page/60 px-3 py-2 text-xs text-ink-500">
      {dashed && <span aria-hidden className="w-4 flex-none border-t-[2.2px] border-dashed border-ink-500" />}
      <span className="min-w-0 flex-1">{label}</span>
      <span className="flex-none text-sm font-bold text-ink-900"><bdi dir="ltr">{value}</bdi> {unit}</span>
      <bdi dir="ltr" className={cn('flex-none rounded-full px-2 py-px text-[13px] font-black', good ? 'bg-accent-600/10 text-accent-900' : 'bg-band-3/10 text-band-3-ink')}>{delta}</bdi>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <bdi dir="ltr" className="block text-[19px] font-black text-ink-900 tabular-nums">{value}</bdi>
      <span className="text-xs font-semibold text-ink-400">{label}</span>
    </div>
  );
}

function DayDot({ status, ran, today, label, col }: { status: DayStatus; ran: boolean; today: boolean; label: string; col: string }) {
  const tick = <Check className="h-[18px] w-[18px] text-white" strokeWidth={3} />;
  if (status === 'done') return <span role="img" aria-label={label} className="grid h-8 w-8 place-items-center rounded-full bg-accent-600">{tick}</span>;
  if (status === 'partial') return <span role="img" aria-label={label} className="h-8 w-8 rounded-full" style={{ background: 'conic-gradient(#F59E0B 0 50%, #FDE7C2 50% 100%)' }} />;
  if (status === 'missed') return <span role="img" aria-label={label} className="grid h-8 w-8 place-items-center rounded-full bg-accent-red/10 text-[13px] font-black text-accent-red">✕</span>;
  if (status === 'rest' && ran) return <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: col }}>{tick}</span>;
  if (status === 'rest') return <span className="h-8 w-8 rounded-full bg-page" />;
  return <span role={label ? 'img' : undefined} aria-label={label || undefined} className={cn('h-8 w-8 rounded-full border-2 border-dashed', today ? 'border-solid' : 'border-ink-300/70')} style={today ? { borderColor: col } : undefined} />;
}

function Tile({ km, label }: { km: number; label: string }) {
  return (
    <div className="rounded-card bg-card px-3.5 py-3">
      <bdi dir="ltr" className="block text-[22px] font-black text-ink-900 tabular-nums">{Math.round(km).toLocaleString('en-US')}</bdi>
      <span className="text-xs font-semibold text-ink-400">{label}</span>
    </div>
  );
}

/** Ten plan weeks as one line, like Strava: grid with km on the side, months under it, this week marked. */
function WeeksLine({ weeks, locale, col, id }: { weeks: Array<{ weekStart: string; km: number }>; locale: string; col: string; id: string }) {
  const w = 300; const h = 130; const padL = 34;
  const max = Math.max(...weeks.map((x) => x.km), 10);
  const step = max > 120 ? 50 : max > 60 ? 25 : 10;
  const top = Math.ceil(max / step) * step;
  const n = weeks.length;
  // RTL reading order: the oldest week on the right, this one on the left.
  const xs = weeks.map((_, i) => w - 6 - (i * (w - padL - 12)) / Math.max(n - 1, 1));
  const ys = weeks.map((x) => h - (x.km / top) * h);
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const grid = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const seen = new Set<number>();
  const months = weeks.map((x, i) => {
    const m = Number(x.weekStart.slice(5, 7));
    if (seen.has(m)) return null;
    seen.add(m);
    return { x: xs[i], label: new Date(`${x.weekStart}T12:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }) };
  }).filter(Boolean) as Array<{ x: number; label: string }>;
  const cx = xs[n - 1]; const cy = ys[n - 1];
  return (
    <svg viewBox={`0 -10 ${w} ${h + 28}`} className="mt-2 block h-auto w-full" role="img" aria-label="10 weeks">
      <defs>
        <linearGradient id={`myweek-area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity=".14" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g) => {
        const y = h - (g / top) * h;
        return (
          <g key={g}>
            <line x1={padL} x2={w} y1={y} y2={y} stroke="#EEF0F4" />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10.5" fill="#A1A6B0" direction="ltr">{g}</text>
          </g>
        );
      })}
      <polygon points={`${xs[0].toFixed(1)},${h} ${pts} ${xs[n - 1].toFixed(1)},${h}`} fill={`url(#myweek-area-${id})`} />
      <line x1={cx} x2={cx} y1={-6} y2={h} stroke={col} strokeWidth="1.2" strokeDasharray="2 3" opacity=".6" />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={i === n - 1 ? 5.5 : 3.5} fill={i === n - 1 ? col : '#fff'} stroke={col} strokeWidth="2" />
      ))}
      {months.map((m) => <text key={m.label} x={m.x} y={h + 16} textAnchor="middle" fontSize="11" fill="#8B909A">{m.label}</text>)}
    </svg>
  );
}
