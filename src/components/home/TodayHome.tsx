'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, ChevronLeft, Clock, Share2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, cn, getPlanWeekStart, israelNow, israelToday } from '@/lib/utils';
import { roundKm, sessionTitleParts } from '@/lib/plans/week-summary';
import { planDayKey, type DailyDistance, type WeekSession } from '@/lib/plans/workout-parsing';
import { pickNextSession } from '@/lib/plans/next-session';
import { sessionHeadline } from '@/lib/plans/session-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { clockPace, paceRangeText } from '@/lib/plans/session-profile';
import { formatDurationClock } from '@/lib/workout-duration';
import { feelPrefillOf } from '@/lib/academy/workout-extras';
import { fetchFeedItemByActivity } from '@/lib/feed-client';
import { packPaces, rangeBar, runClock, runVerdict, steadyTarget, type SteadyTarget } from '@/lib/home/today';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';
import type { ShareSubject } from '@/lib/share/sheet-model';
import { WatchStatus } from '@/components/WatchStatus';
import { WorkoutDetailModal, type WorkoutDetailSession } from '@/components/WorkoutDetailModal';
import { ShareSheet } from '@/components/ShareSheet';
import { TomorrowCard } from './TomorrowCard';

/**
 * "היום" — the runner's home (mockup ~/.cache/madregot/today-mockup.html, approved by Ofer
 * 2026-10-19). One screen for "what do I do today, how did it go, how is my week":
 *
 *   before the run   today's session in the runner's lane — its headline, the pack's pace,
 *                    the watch, the coach's note, the RSVP when the day asks for one;
 *   after the run    the run against that target (two bars on a steady run), how it felt
 *                    (the watch's answer, one tap opens the feedback form), share;
 *   the day before   tomorrow's team session with the vote (TomorrowCard).
 *
 * These are the cards of the home's middle; the rest of the morning briefing (the race,
 * my week, the club, the coach's word, last night) is components/home/HomeToday.tsx, and
 * last week is LastWeekCard — the two sessions' designs merged (Ofer 2026-10-19).
 *
 * The session comes from /api/plans/week in the runner's own lane, which already merges
 * the coach's one-day sessions; which session is "next" is lib/plans/next-session.ts, the
 * rule the feed's card uses, so the two never name different sessions. The week and its
 * kilometres are the profile's (stats.planWeek), so the screens can't disagree either.
 */

interface LaneWeek {
  hasPlan?: boolean;
  hasClubPlan?: boolean;
  lane?: number | null;
  sessions?: WeekSession[];
  dailyDistances?: DailyDistance[];
}

interface TodayActivity {
  id: string;
  garmin_activity_id: number | null;
  start_time: string;
  distance: number | null;
  duration: number | null;
  average_hr: number | null;
  perceived_feel: number | null;
  perceived_rpe: number | null;
}

const FACES = ['😣', '😕', '😐', '🙂', '😄'];
const CARD = 'rounded-[22px] bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';

export function TodayCards({ athleteId, rsvp, rsvpForToday }: {
  athleteId: string;
  /** The attendance question, when the club asks one (dashboard page owns its state). */
  rsvp?: ReactNode;
  /** It asks about TODAY's session; the day-before question ("מגיעים מחר?") stands on its own. */
  rsvpForToday?: boolean;
}) {
  const t = useTranslations('todayHome');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');
  const tp = useTranslations('planner');
  const td = useTranslations('dashboard');
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };
  const dayNames = tc.raw('dayNames') as string[];

  const today = israelToday();
  const { data: stats } = useApi<{ planWeek?: PlanWeekStats }>(`/api/athletes/${athleteId}/stats`);
  const pw = stats?.planWeek;
  const { data: week } = useApi<LaneWeek>(pw ? `/api/plans/week?weekStart=${pw.weekStart}&lane=mine` : null);
  const { data: lastWeek } = useApi<LaneWeek>(pw ? `/api/plans/week?weekStart=${addDaysToDateStr(pw.weekStart, -7)}&lane=mine` : null);
  const { data: acts } = useApi<{ activities?: TodayActivity[] }>(
    `/api/activities?${new URLSearchParams({ athleteId, scope: 'self', since: today })}`,
  );
  const tomorrow = addDaysToDateStr(today, 1);
  const tomorrowWeek = getPlanWeekStart(new Date(`${tomorrow}T12:00:00`));
  const { data: nextWeek } = useApi<LaneWeek>(pw && tomorrowWeek !== pw.weekStart ? `/api/plans/week?weekStart=${tomorrowWeek}&lane=mine` : null);
  const { data: reminder } = useApi<{ config?: { teamDays?: number[]; workoutHour?: number } }>('/api/reminder-config');
  const [detail, setDetail] = useState<WorkoutDetailSession | null>(null);
  const [share, setShare] = useState<ShareSubject | null>(null);
  const [viewGroup, setViewGroup] = useState<number | null>(null);

  // The pack's pace lane, 1–3; the club's default lane when the plan didn't say.
  const packIndex = Math.min(2, Math.max(0, (week?.lane ?? 2) - 1));
  const todayRuns = (acts?.activities ?? []).filter((a) => a.start_time.slice(0, 10) === today && (a.distance ?? 0) > 0)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const sessionsFor = (() => {
    const byDate = new Map<string, WeekSession[]>();
    if (week?.hasPlan && pw) {
      for (const s of week.sessions ?? []) {
        const key = planDayKey(pw.weekStart, s.dayOfWeek);
        byDate.set(key, [...(byDate.get(key) || []), s]);
      }
    }
    for (const w of pw && nextWeek?.hasPlan ? [nextWeek] : []) {
      for (const s of w.sessions ?? []) {
        const key = planDayKey(tomorrowWeek, s.dayOfWeek);
        byDate.set(key, [...(byDate.get(key) || []), s]);
      }
    }
    return (key: string) => (byDate.get(key) || []).filter((s) => s.kmMax > 0);
  })();

  if (!pw || !week) return <div className={cn(CARD, 'h-[260px] animate-pulse')} />;

  const next = pickNextSession({
    sessionsFor, todayKey: today, tomorrowKey: tomorrow, hour: israelNow().hour,
    runsKmByDate: { [today]: todayRuns.map((a) => (a.distance ?? 0) / 1000) },
  });
  const todaySessions = sessionsFor(today);
  const lastRun = todayRuns[todayRuns.length - 1];
  // The session the latest run was: the n-th run of a double is its n-th session.
  const ranSession = lastRun ? todaySessions[Math.min(todayRuns.length, todaySessions.length) - 1] ?? null : null;
  const notes = (next?.session ?? ranSession)?.daySession?.notes?.trim();

  const detailFor = (x: WeekSession): WorkoutDetailSession => {
    const lo = roundKm(x.kmMin); const hi = roundKm(x.kmMax);
    const km = lo !== hi ? `${lo}–${hi}` : `${hi}`;
    return {
      name: sessionTitleParts(sessionHeadline(x.steps, units), x.name, dayNames) || x.name,
      day: dayNames[x.dayOfWeek],
      distance: km ? `${km} ${units.km}` : '',
      duration: formatDurationClock(x.durationSec),
      steps: x.steps,
      story: { dayOfWeek: x.dayOfWeek, type: x.type, km },
    };
  };
  const openShare = async (id: string) => {
    const { item } = await fetchFeedItemByActivity(id);
    if (item?.activity) setShare({ kind: 'workout', item });
  };

  // The day before a team day: tomorrow's session and the vote, in one card.
  const tomorrowSessions = sessionsFor(tomorrow);
  const tomorrowDow = new Date(`${tomorrow}T12:00:00Z`).getUTCDay();
  const teamTomorrow = tomorrowSessions[0]?.daySession
    ? tomorrowSessions[0].daySession.quality
    : !!reminder?.config?.teamDays?.includes(tomorrowDow);
  const hour = reminder?.config?.workoutHour;
  const tomorrowTime = tomorrowSessions[0]?.daySession?.startTime
    ?? (typeof hour === 'number' ? `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}` : null);

  return (
    <div className="space-y-3">
      {lastRun && (
        <RunResult run={lastRun} session={ranSession} lane={week.lane ?? null} packIndex={packIndex} onShare={() => openShare(lastRun.id)} />
      )}

      {next && (!lastRun || next.date !== today || (next.index > 1 && !next.session.optional)) && !(teamTomorrow && next.date === tomorrow) && (
        <SessionCard
          session={next.session}
          when={next.isToday ? td('today') : td('tomorrow')}
          time={next.session.daySession?.startTime ?? null}
          typeLabel={ta(`runType_${next.session.type}` as 'runType_easy')}
          headline={sessionHeadline(next.session.steps, units) || next.session.name}
          lane={week.lane ?? null}
          packIndex={packIndex}
          kindLabel={next.session.kind === 'morning' ? tp('sessionMorning') : next.session.kind === 'evening' ? tp('sessionEvening') : ''}
          watch={<WatchStatus date={next.date} />}
          onDetail={() => setDetail(detailFor(next.session))}
        >
          {next.isToday && rsvpForToday && rsvp}
        </SessionCard>
      )}

      {rsvp && !(next?.isToday && rsvpForToday) && rsvp}

      {!lastRun && !next && !teamTomorrow && (
        <div className={cn(CARD, 'py-5 text-center')}>
          <b className="text-[15.5px] text-ink-900">{week.hasPlan ? t('restTitle') : t('noPlanTitle')}</b>
          <p className="mt-1 text-13 text-ink-500">{week.hasPlan ? t('restBody') : t('noPlanBody')}</p>
        </div>
      )}

      {notes && (
        <div className={CARD}>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-[13px] font-black text-white">M</span>
            <b className="text-[15.5px] font-extrabold text-ink-900">{t('fromCoach')}</b>
          </div>
          <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700" dir="auto">{notes}</p>
        </div>
      )}

      {teamTomorrow && (
        <TomorrowCard date={tomorrow} weekStart={tomorrowWeek} dayOfWeek={tomorrowDow} sessions={tomorrowSessions} lane={(tomorrowWeek !== pw.weekStart ? nextWeek?.lane : week.lane) ?? null} packIndex={packIndex} time={tomorrowTime} />
      )}

      {detail && <WorkoutDetailModal session={detail} viewGroup={viewGroup ?? packIndex} onPickGroup={setViewGroup} onClose={() => setDetail(null)} />}
      {share && <ShareSheet subject={share} onClose={() => setShare(null)} />}
    </div>
  );
}

function SessionCard({ session, when, time, typeLabel, headline, lane, packIndex, kindLabel, watch, onDetail, children }: {
  session: WeekSession;
  lane: number | null;
  when: string;
  time: string | null;
  typeLabel: string;
  headline: string;
  packIndex: number;
  kindLabel: string;
  watch: ReactNode;
  onDetail: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations('todayHome');
  const tc = useTranslations('common');
  const pace = packPaces(session.steps, lane)[packIndex];
  const lo = roundKm(session.kmMin); const hi = roundKm(session.kmMax);
  // "50–70 דק׳": the number big, its unit small, as the run's kilometres are after it.
  const m = /^([\d.:–-]+)\s*(.*)$/.exec(headline);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 py-0.5 pe-3 ps-2 text-[12.5px] font-extrabold text-white">
          <Clock className="h-3.5 w-3.5" strokeWidth={2.5} />{when}{time && <> · <bdi dir="ltr">{time}</bdi></>}
        </span>
        <span className="text-[12.5px] text-ink-400">{[kindLabel, typeLabel].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="mt-1.5 text-[40px] font-black leading-tight tracking-tight text-ink-900">
        {m ? <><bdi dir="ltr">{m[1]}</bdi><small className="ms-1.5 text-[17px] font-bold text-ink-500">{m[2]}</small></> : <span dir="auto">{headline}</span>}
      </div>
      <div className="mt-2.5 flex gap-2">
        {pace && <Tile value={paceRangeText(pace)} label={t('packPace')} />}
        {hi > 0 && <Tile value={lo !== hi ? `${lo}–${hi}` : `${hi}`} label={tc('km')} />}
      </div>
      <div className="mt-3">{watch}</div>
      {children}
      <button type="button" onClick={onDetail} className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl bg-page text-sm font-extrabold text-ink-900">
        {t('details')}<ChevronLeft className="h-4 w-4 ltr:rotate-180" />
      </button>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col rounded-xl bg-page/70 px-2.5 py-1.5">
      <b className="whitespace-nowrap text-[17px] font-extrabold text-ink-900"><bdi dir="ltr">{value}</bdi></b>
      <span className="truncate text-[11.5px] text-ink-400">{label}</span>
    </span>
  );
}

function RunResult({ run, session, lane, packIndex, onShare }: {
  run: TodayActivity;
  session: WeekSession | null;
  lane: number | null;
  packIndex: number;
  onShare: () => void;
}) {
  const t = useTranslations('todayHome');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');
  const meters = run.distance ?? 0;
  const seconds = run.duration ?? 0;
  const km = meters / 1000;
  const target: SteadyTarget | null = session ? steadyTarget(session.steps, lane, packIndex) : null;
  const verdict = target ? runVerdict(target, { seconds, meters }) : null;
  const paceSec = km > 0 ? seconds / km : 0;
  const prefill = feelPrefillOf(run);
  return (
    <>
      <div className={CARD}>
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-600 py-0.5 pe-3 ps-2 text-[12.5px] font-extrabold text-white">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />{t('done')} · <bdi dir="ltr">{run.start_time.slice(11, 16)}</bdi>
          </span>
          {session && <span className="text-[12.5px] text-ink-400">{ta(`runType_${session.type}` as 'runType_easy')}</span>}
        </div>
        <div className="mt-1.5 text-[46px] font-black leading-none tracking-tight text-ink-900">
          <bdi dir="ltr">{roundKm(km)}</bdi><small className="ms-1.5 text-[17px] font-bold text-ink-500">{tc('km')}</small>
        </div>
        <div className="mt-2.5 flex gap-2">
          <Tile value={runClock(seconds)} label={t('time')} />
          {paceSec > 0 && <Tile value={clockPace(paceSec)} label={t('pace')} />}
          {run.average_hr ? <Tile value={String(Math.round(run.average_hr))} label={t('hr')} /> : null}
        </div>
        {target && (
          <>
            <Bar label={t('time')} hint={target.kind === 'time' ? t('targetMin', { lo: Math.round(target.min / 60), hi: Math.round(target.max / 60) }) : t('targetKm', { lo: roundKm(target.min / 1000), hi: roundKm(target.max / 1000) })}
              value={target.kind === 'time' ? runClock(seconds) : String(roundKm(km))}
              lo={target.kind === 'time' ? `${Math.round(target.min / 60)}′` : String(roundKm(target.min / 1000))}
              hi={target.kind === 'time' ? `${Math.round(target.max / 60)}′` : String(roundKm(target.max / 1000))}
              bar={rangeBar(target.min, target.max, target.kind === 'time' ? seconds : meters)} />
            {target.pace && paceSec > 0 && (
              <Bar label={t('pace')} hint={t('targetPack')} value={clockPace(paceSec)}
                lo={clockPace(target.pace.min)} hi={clockPace(target.pace.max)}
                bar={rangeBar(target.pace.min, target.pace.max, paceSec)} />
            )}
          </>
        )}
        {verdict && (
          <p className={cn('mt-3 flex items-center gap-1.5 text-sm font-extrabold', verdict === 'onPlan' ? 'text-accent-900' : 'text-band-3-ink')}>
            {verdict === 'onPlan' && <Check className="h-4 w-4" strokeWidth={3} />}{t(`verdict_${verdict}`)}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onShare} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-brand-600 text-sm font-extrabold text-white">
            <Share2 className="h-4 w-4" />{t('share')}
          </button>
          <Link href={`/dashboard/activities/${run.id}`} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-page text-sm font-extrabold text-ink-900">
            {t('toRun')}<ChevronLeft className="h-4 w-4 ltr:rotate-180" />
          </Link>
        </div>
      </div>

      {run.garmin_activity_id != null && (
        <div className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <b className="text-[15.5px] font-extrabold text-ink-900">{t('howFelt')}</b>
            {prefill?.feel != null && <span className="text-[12.5px] text-ink-400">{t('fromWatch')}</span>}
          </div>
          <div className="mt-2.5 flex gap-1">
            {FACES.map((f, i) => (
              <Link key={i} href={`/dashboard/feedback?activity=${run.garmin_activity_id}&feel=${i}`}
                className={cn('flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-bold', prefill?.feel === i ? 'bg-brand-600/[0.08] text-brand-600' : 'text-ink-400')}>
                <span className={cn('text-[22px]', prefill?.feel === i ? '' : 'opacity-55 grayscale')}>{f}</span>
                {t(`feel${i}` as 'feel0')}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Bar({ label, hint, value, lo, hi, bar }: { label: string; hint: string; value: string; lo: string; hi: string; bar: ReturnType<typeof rangeBar> }) {
  // RTL: the track's start is the right edge, so the lower number (the faster pace, the
  // shorter time) sits on the right. Positions are logical (inset-inline-start).
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[12.5px] font-semibold text-ink-500">
        <span>{label} <span className="font-medium text-ink-400">{hint}</span></span>
        <b className="text-ink-900"><bdi dir="ltr">{value}</bdi></b>
      </div>
      <div className="relative mt-1.5 h-2.5 rounded-full bg-page">
        <div className="absolute inset-y-0 rounded-full bg-accent-600/25" style={{ insetInlineStart: `${bar.from}%`, width: `${bar.to - bar.from}%` }} />
        <div className={cn('absolute -top-1 h-[18px] w-[18px] rounded-full border-[3px] border-card shadow', bar.inside ? 'bg-accent-600' : 'bg-band-3')}
          style={{ insetInlineStart: `${bar.at}%`, transform: 'translateX(50%)' }} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-ink-400">
        <span className="absolute translate-x-1/2" style={{ insetInlineStart: `${bar.from}%` }}><bdi dir="ltr">{lo}</bdi></span>
        <span className="absolute translate-x-1/2" style={{ insetInlineStart: `${bar.to}%` }}><bdi dir="ltr">{hi}</bdi></span>
      </div>
    </div>
  );
}
