'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { israelClock, watchDayState, type WatchDay } from '@/lib/watch/day-status';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Link2, Moon, Sun, Watch, RefreshCw } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, getPlanWeekStart, GROUP_HEX, israelNow, israelToday } from '@/lib/utils';
import { SessionRsvp } from '@/components/feed/SessionRsvp';
import { packPace, paceRangeText, profileSegments, type SegmentKind } from '@/lib/plans/session-profile';
import type { Lineup } from '@/lib/attendance/lineup';
import {
  WORKOUT_TYPE_COLORS, WORKOUT_TYPE_TEXT_COLORS, planDayKey, type WeekSession,
} from '@/lib/plans/workout-parsing';
import { sessionFrame, sessionHeadline, type FrameLabels } from '@/lib/plans/session-summary';
import { nameQualifier, roundKm, sessionTitleParts } from '@/lib/plans/week-summary';
import { numberRuns } from '@/lib/day-session/model';
import type { StepUnits } from '@/lib/plans/step-display';
import { formatDurationClock } from '@/lib/workout-duration';
import { isEstimate } from '@/lib/plans/step-estimate';
import { pickNextSession } from '@/lib/plans/next-session';
import { WorkoutDetailModal, type WorkoutDetailSession } from '@/components/WorkoutDetailModal';
import { DaySessionNotes, SessionLinks } from '@/components/feed/SessionLinks';

// ═════════════════════════════════════════════════════════════════════════════
// THE NEXT SESSION, AS ONE LINE AT THE TOP OF THE FEED
//
// "מחר · אינטרוולים", the distance, and whether it is on the watch. Tapping it
// opens the same WorkoutDetailModal the Program page opens, from the same
// WeekSession — one session, one sheet, no second description of it.
//
// What it is NOT, and each is his instruction:
//
//   · not a send button. The athlete can SEE whether the session reached the
//     watch and cannot ask for it from here ("he can not ask to fetch"), so this
//     reads /api/my-watch and never POSTs to it. A red watch is information; a
//     button here would be a second push path competing with the hero's.
//   · not on all day. It appears at 20:00 the evening before and goes away once
//     the session is run — see lib/plans/next-session.ts, which owns those rules
//     and is shared so this box and the dashboard hero can never name different
//     sessions.
//   · not a summary of the day. A double day is two sessions: run the morning one
//     and the box switches to the evening one rather than vanishing, and the
//     morning/evening banner says which is which.
//
// The pill is icon-only on his call ("בלי שיהיה כתוב בשעון / רק אמוגי") — a
// watch with a green tick, or a red watch when the session has not arrived. The
// label lives in aria-label/title, so a screen reader still gets words.
// ═════════════════════════════════════════════════════════════════════════════

interface WeeklyResponse {
  sessions: WeekSession[];
  currentWeekStart: string;
  hasPlan: boolean;
  /** A weekly plan of its own, not only one-day sessions — the "תוכנית השבוע" link. */
  hasClubPlan?: boolean;
}

interface WatchState {
  garminConnected: boolean;
  hasPlan: boolean;
  onWatch: string[];
  days?: Record<string, WatchDay>;
}

interface FeedActivity {
  id?: string;
  start_time: string;
  distance: number | null;
  duration?: number | null;
  moving_duration?: number | null;
}

/** "56:40" / "1:12:05" for a run's time. */
function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

/** Today's session, done: a green ✓, its name, the distance, time and pace, then "האימון הבא". */
function DoneToday({ done, title, divider = true }: {
  done: { km: number; sec: number; pace: number; runId: string | null }; title: string; divider?: boolean;
}) {
  const body = (
    <>
      <span className="flex items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1FBF66] to-[#0E8A45] text-[19px] font-black text-white shadow-[0_4px_10px_-4px_rgba(18,161,80,0.6)]">✓</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-extrabold text-[#12A150]">היום · בוצע</span>
          <span className="block truncate text-[16px] font-black leading-tight text-ink-900">{title}</span>
        </span>
      </span>
      <span className="mt-2.5 grid grid-cols-3 gap-2 rounded-2xl bg-[#F1FBF5] px-3 py-2 text-center">
        <span><b className="block font-[ui-rounded,system-ui] text-[17px] font-black tabular-nums text-ink-900" dir="ltr">{done.km.toFixed(1)}</b><small className="text-[11px] text-ink-500">ק״מ</small></span>
        <span><b className="block font-[ui-rounded,system-ui] text-[17px] font-black tabular-nums text-ink-900" dir="ltr">{done.sec ? clock(done.sec) : '—'}</b><small className="text-[11px] text-ink-500">זמן</small></span>
        <span><b className="block font-[ui-rounded,system-ui] text-[17px] font-black tabular-nums text-ink-900" dir="ltr">{done.pace ? clock(done.pace) : '—'}</b><small className="text-[11px] text-ink-500">לק״מ</small></span>
      </span>
    </>
  );
  return (
    <>
      {done.runId
        ? <Link href={`/dashboard/activities/${done.runId}`} className="block active:opacity-80">{body}</Link>
        : <div>{body}</div>}
      {divider && (
        <span className="my-3 flex items-center gap-2.5 text-[12px] font-extrabold text-ink-400">
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#D9D9E3]" />האימון הבא<span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#D9D9E3]" />
        </span>
      )}
    </>
  );
}

const SEG_HEIGHT: Record<SegmentKind, string> = { warm: '38%', cool: '38%', rest: '22%', easy: '58%', hard: '100%' };
const SEG_COLOR: Record<SegmentKind, string> = {
  warm: 'linear-gradient(#C9CDD9,#AEB3C2)', cool: 'linear-gradient(#C9CDD9,#AEB3C2)', rest: '#D5D8E1',
  easy: 'linear-gradient(#4ADE7B,#22B45A)', hard: 'linear-gradient(#FFB547,#FF8A00)',
};

export function NextSessionCard() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');
  const tp = useTranslations('planner');
  const tw = useTranslations('watchStatus');

  const { data: weekly } = useApi<WeeklyResponse>('/api/dashboard/weekly');
  const { data: watch } = useApi<WatchState>('/api/my-watch');
  const [detail, setDetail] = useState<WorkoutDetailSession | null>(null);
  // The one-day session the open sheet is about, for its notes and nutrition.
  const [detailMark, setDetailMark] = useState<WeekSession['daySession']>(undefined);
  const [viewGroup, setViewGroup] = useState(0);
  const tn = useTranslations('nextSession');
  const { data: reminderCfg } = useApi<{ config?: { teamDays?: number[]; workoutHour?: number } }>('/api/reminder-config');
  // Open / closed is remembered per session, so an answered card stays one line.
  const [openState, setOpenStateRaw] = useState<'open' | 'closed' | null>(null);

  const todayKey = israelToday();

  useEffect(() => {
    const stored = parseInt(localStorage.getItem('view_group') || '', 10);
    if (stored >= 0 && stored <= 2) setViewGroup(stored);
  }, []);

  // Today's runs only: "is the session done" is a question about today, and
  // `since` is a date-only floor anyway. Through the shared cache (useApi) so a
  // reopen paints this card at once instead of popping it in above the feed a
  // beat later (feed perf trace, 2026-10-12). Same URL fetchActivities builds.
  const myId = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const { data: todayRuns, error: todayRunsError } = useApi<{ activities?: FeedActivity[] }>(
    `/api/activities?${new URLSearchParams({ ...(myId ? { athleteId: myId } : {}), scope: 'self', since: todayKey })}`,
  );
  const runsKmByDate = useMemo(() => {
    if (!todayRuns && !todayRunsError) return null;
    const byDate: Record<string, number[]> = {};
    for (const a of (todayRuns?.activities || []) as FeedActivity[]) {
      // start_time is the athlete's own wall clock, so its date part IS the
      // Israel day — no timezone maths, which would shift a 23:30 run.
      const key = a.start_time.slice(0, 10);
      (byDate[key] ||= []).push((a.distance || 0) / 1000);
    }
    return byDate;
  }, [todayRuns, todayRunsError]);

  const next = useMemo(() => {
    if (!weekly?.hasPlan || !runsKmByDate) return null;
    const byDate = new Map<string, WeekSession[]>();
    for (const s of weekly.sessions) {
      const key = planDayKey(weekly.currentWeekStart, s.dayOfWeek);
      byDate.set(key, [...(byDate.get(key) || []), s]);
    }
    return pickNextSession({
      sessionsFor: (key) => (byDate.get(key) || []).filter((s) => s.kmMax > 0),
      todayKey,
      tomorrowKey: addDaysToDateStr(todayKey, 1),
      hour: israelNow().hour,
      runsKmByDate,
    });
  }, [weekly, runsKmByDate, todayKey]);

  // Today's session is done (the card has moved on to the next one): what was run today,
  // drawn at the top of the card with a ✓ and a divider before the next session
  // (mockup session-done, E + time/distance/pace; Ofer 10-19).
  const doneToday = useMemo(() => {
    if (!weekly?.hasPlan || !runsKmByDate || (next && next.date === todayKey)) return null;
    const key = todayKey;
    const todays = weekly.sessions.filter((x) => planDayKey(weekly.currentWeekStart, x.dayOfWeek) === key && x.kmMax > 0);
    const runs = ((todayRuns?.activities || []) as FeedActivity[]).filter((a) => a.start_time.slice(0, 10) === key && (a.distance || 0) > 0);
    if (!todays.length || !runs.length) return null;
    const meters = runs.reduce((n, a) => n + (a.distance || 0), 0);
    // With no next session the card cannot tell done from skipped-after-22:00, so most of it must be run.
    if (!next && meters / 1000 < (todays[0].kmMin || todays[0].kmMax) * 0.75) return null;
    const sec = runs.reduce((n, a) => n + (a.moving_duration || a.duration || 0), 0);
    return { session: todays[0], km: meters / 1000, sec, pace: sec && meters ? sec / (meters / 1000) : 0, runId: runs[0].id ?? null };
  }, [weekly, next, todayKey, todayRuns, runsKmByDate]);

  const nsKey = next ? `mc:nsc:${next.date}:${next.session.key}` : null;
  useEffect(() => {
    if (!nsKey) return;
    try { const v = localStorage.getItem(nsKey); setOpenStateRaw(v === 'open' || v === 'closed' ? v : null); } catch { /* */ }
  }, [nsKey]);
  const setOpenState = (v: 'open' | 'closed') => {
    setOpenStateRaw(v);
    try { if (nsKey) localStorage.setItem(nsKey, v); } catch { /* private mode */ }
  };
  // Same key SessionRsvp asks for, so it is one request and one cache entry.
  // A one-day session asks who is coming only when the coach marked it a quality session.
  const asksRsvp = (x: WeekSession) => (x.daySession ? x.daySession.quality : !!reminderCfg?.config?.teamDays?.includes(x.dayOfWeek));
  const lineupKey = next && asksRsvp(next.session)
    ? `/api/attendance/lineup?weekStart=${getPlanWeekStart(new Date(`${next.date}T12:00:00`))}&day=${next.session.dayOfWeek}`
    : null;
  const { data: lineup } = useApi<Lineup & { homeIndex: number }>(lineupKey);

  if (!next) {
    // Nothing left this week to point at, but today's session is done: the ✓ alone.
    if (!doneToday) return null;
    return (
      <div className="rounded-[26px] bg-card p-4 shadow-[0_0_0_0.5px_rgba(60,60,67,0.14),0_10px_28px_-14px_rgba(20,24,60,0.22)]">
        <DoneToday done={doneToday} divider={false} title={doneToday.session.name || t('today')} />
      </div>
    );
  }
  // Wait for the club-day settings (cached after the first open): drawing the card
  // without the RSVP and then growing it under the feed was a layout shift.
  if (!reminderCfg) return null;

  const s = next.session;
  const units: StepUnits = {
    km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes'),
  };
  const frameLabels: FrameLabels = {
    ...units, warmup: tp('sectionWarmup'), cooldown: tp('sectionCooldown'),
  };
  const dayNames = tc.raw('dayNames') as string[];
  const rtl = tc('km') !== 'km';

  const kmMin = roundKm(s.kmMin);
  const kmMax = roundKm(s.kmMax);
  const km = kmMin !== kmMax ? `${kmMin}–${kmMax}` : `${kmMax}`;
  const approx = isEstimate(s.kmFrom) ? '~' : '';
  const typeLabel = ta(`runType_${s.type}` as 'runType_easy');
  const fill = WORKOUT_TYPE_COLORS[s.type] || WORKOUT_TYPE_COLORS.easy;
  const ink = WORKOUT_TYPE_TEXT_COLORS[s.type] || WORKOUT_TYPE_TEXT_COLORS.easy;

  // Which half of a two-a-day this is. Only ever drawn for a session the plan
  // actually named morning or evening — inventing "morning" for a single session
  // would tell the club a time the coach never wrote.
  const part = s.kind === 'morning' || s.kind === 'evening' ? s.kind : null;
  const kindLabel = part ? tp(part === 'morning' ? 'sessionMorning' : 'sessionEvening') : '';

  // Only when there IS a watch and a plan on it — same silence as WatchStatus,
  // for the same reason: "not on your watch" to somebody with no Garmin account
  // reads as a fault rather than as a fact.
  const watchKnown = !!watch && watch.garminConnected && watch.hasPlan;
  const onWatch = watchKnown && watch.onWatch.includes(next.date);
  // Same three honest states as WatchStatus (lib/watch/day-status).
  const watchState = !onWatch ? 'none' : watchDayState(watch?.days?.[next.date] ?? { sentAt: '', updatedAt: null, ran: false });
  const watchDay = watch?.days?.[next.date];
  const watchLabel = watchState === 'ran' ? tw('ran')
    : watchState === 'updated' ? `${tw('updated', { time: watchDay?.updatedAt ? israelClock(watchDay.updatedAt) : '' })} · ${tw('updatedHint')}`
      : watchState === 'sent' ? `${tw('sent')} · ${tw('sentHint')}` : tw('notOnWatch');

  // ── The card's new look (feed redesign 2026-10-12) ──
  const whenWord = next.isToday ? t('today') : t('tomorrow');
  const titleText = sessionTitleParts(sessionHeadline(s.steps, units), s.name, dayNames) || s.name || typeLabel;
  const profile = profileSegments(s.steps || []);
  const paces = [0, 1, 2].map((i) => { const p = packPace(s.steps || [], i); return p ? paceRangeText(p) : null; });
  // A club practice day (reminder config) gets the RSVP; any other run doesn't.
  const teamDay = asksRsvp(s);
  const workoutHour = reminderCfg?.config?.workoutHour;
  // A one-day session carries the hour the coach wrote; a club day, the club's practice hour.
  const timeText = s.daySession?.startTime
    || (teamDay && !s.daySession && typeof workoutHour === 'number'
      ? `${String(Math.floor(workoutHour)).padStart(2, '0')}:${String(Math.round((workoutHour % 1) * 60)).padStart(2, '0')}` : '');
  const rsvpWeekStart = getPlanWeekStart(new Date(`${next.date}T12:00:00`));
  const answered = teamDay && !!lineup?.mine;
  const collapsed = answered && openState !== 'open';
  const answeredHex = lineup?.mine?.attending && lineup.mine.index >= 0 ? GROUP_HEX[lineup.mine.index] : '#B4B5BC';

  const Chevron = rtl ? ChevronLeft : ChevronRight;

  /**
   * One session as the detail sheet wants it. Shared by the main card and the
   * tomorrow chip so the two rows cannot describe the same sheet differently —
   * the chip opens the real session, not a summary of it.
   */
  const detailFor = (x: WeekSession): WorkoutDetailSession => {
    setDetailMark(x.daySession);
    const xMin = roundKm(x.kmMin);
    const xMax = roundKm(x.kmMax);
    const xKm = xMin !== xMax ? `${xMin}–${xMax}` : `${xMax}`;
    const xKind = x.kind === 'morning' || x.kind === 'evening'
      ? tp(x.kind === 'morning' ? 'sessionMorning' : 'sessionEvening') : '';
    return {
      name: sessionTitleParts(sessionHeadline(x.steps, units), x.name, dayNames) || x.name,
      day: [dayNames[x.dayOfWeek], xKind].filter(Boolean).join(' · '),
      distance: xKm ? `${isEstimate(x.kmFrom) ? '~' : ''}${xKm} ${units.km}` : '',
      duration: formatDurationClock(x.durationSec),
      steps: x.steps,
      // The story's own copy of the day and the type, unlocalised: the sheet's
      // `day` above is Hebrew and the post is English. `km` is the plain
      // number without a unit, because the story writes its own "(14km)".
      story: { dayOfWeek: x.dayOfWeek, type: x.type, km: xKm, weekStart: weekly?.currentWeekStart, key: x.key },
    };
  };

  // Tomorrow, when today is a double and it is past noon — see next-session.ts.
  const nextDay = next.tomorrow?.session;

  return (
    <>
      {collapsed && doneToday && (
        <div className="mb-2 rounded-[22px] bg-card px-4 pb-3 pt-3 shadow-[0_0_0_0.5px_rgba(60,60,67,0.14)]">
          <DoneToday done={doneToday} divider={false} title={sessionTitleParts(sessionHeadline(doneToday.session.steps, units), doneToday.session.name, dayNames) || doneToday.session.name} />
        </div>
      )}
      {collapsed ? (
        // Answered: one line, so the feed gets its screen back. The chevron opens it.
        <button
          type="button"
          onClick={() => setOpenState('open')}
          className="flex h-16 w-full items-center gap-3 overflow-hidden rounded-[22px] bg-card pe-3 text-start shadow-[0_0_0_0.5px_rgba(60,60,67,0.16),0_8px_20px_-12px_rgba(20,24,60,0.2)]"
        >
          <span className="h-full w-2.5 shrink-0" style={{ background: answeredHex }} />
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${lineup?.mine?.attending ? 'bg-[#34C759]' : 'bg-ink-300'}`}>{lineup?.mine?.attending ? '✓' : '–'}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-ink-900">
              {lineup?.mine?.attending ? tn('comingCollapsed', { when: whenWord, n: (lineup.mine.index ?? 0) + 1 }) : tn('notComingCollapsed', { when: whenWord })}
            </span>
            <span className="block truncate text-xs text-ink-400">{timeText ? `${timeText} · ` : ''}{titleText}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-ink-500" />
        </button>
      ) : (
      <div className="rounded-[26px] bg-card p-4 shadow-[0_0_0_0.5px_rgba(60,60,67,0.14),0_10px_28px_-14px_rgba(20,24,60,0.22)]">
        {doneToday && <DoneToday done={doneToday} title={sessionTitleParts(sessionHeadline(doneToday.session.steps, units), doneToday.session.name, dayNames) || doneToday.session.name} />}
        <button type="button" onClick={() => setDetail(detailFor(s))} className="block w-full text-start active:opacity-80">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-bold text-ink-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: fill }} />
                {whenWord} · {dayNames[s.dayOfWeek]}
              </span>
              <span className="mt-0.5 block font-[ui-rounded,system-ui] text-[28px] font-bold leading-tight tracking-tight text-ink-900">
                {timeText || typeLabel}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {part && (
                // Which half of a two-a-day this is: morning yellow, evening purple.
                <span className={`flex h-7 items-center gap-1 rounded-pill px-2 text-3xs font-bold ${part === 'morning' ? 'bg-[#FFF0C7] text-[#8A5A00]' : 'bg-[#E9E4FF] text-[#4632B5]'}`}>
                  {part === 'morning' ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                  {kindLabel}
                </span>
              )}
              {timeText && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-xs font-bold" style={{ background: `${fill}22`, color: ink }}>
                  <span className="h-2 w-2 rounded-sm" style={{ background: fill }} />{typeLabel}
                </span>
              )}
              {watchKnown && (
                <span title={watchLabel} aria-label={watchLabel} className={`flex h-7 items-center gap-0.5 rounded-pill px-2 ${
                  watchState === 'ran' ? 'bg-accent-600/10 text-accent-900' : watchState === 'updated' ? 'bg-[#FFF3D6] text-[#8A5A00]' : watchState === 'sent' ? 'bg-brand-600/10 text-brand-600' : 'bg-accent-red/10 text-accent-red'}`}>
                  {/* A check only once a run proves the watch had it; until then the app knows the
                      workout is on the Garmin ACCOUNT, and the watch still has to sync (2026-10-19). */}
                  <Watch className="h-3.5 w-3.5" />{watchState === 'ran' ? <Check className="h-3 w-3" /> : onWatch && <RefreshCw className="h-3 w-3" />}
                </span>
              )}
              {answered && (
                <span role="button" tabIndex={0} aria-label={tn('collapse')} onClick={(e) => { e.stopPropagation(); setOpenState('closed'); }} className="flex h-7 w-7 items-center justify-center rounded-full bg-page">
                  <ChevronDown className="h-3.5 w-3.5 rotate-180 text-ink-500" />
                </span>
              )}
            </span>
          </span>
          <span className="mt-2 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-lg font-extrabold text-ink-900">{numberRuns(timeText ? titleText : (nameQualifier(s.name, dayNames) || '')).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>))}</span>
            <span className="shrink-0 text-xs font-semibold text-ink-400"><bdi dir="ltr">{approx}{km}</bdi> {units.km}{s.durationSec ? <> · <bdi dir="ltr">{formatDurationClock(s.durationSec)}</bdi></> : null}</span>
          </span>
          {profile.length > 0 && (
            <span className="mt-3 flex h-6 items-end gap-[2px]" aria-hidden>
              {profile.map((seg, i) => (
                <span key={i} className="block rounded-t-[5px] rounded-b-[2px]" style={{ flexGrow: seg.share, flexBasis: 0, minWidth: 2, height: SEG_HEIGHT[seg.kind], background: SEG_COLOR[seg.kind] }} />
              ))}
            </span>
          )}
        </button>
        {/* The week's plans, and a one-day session's own nutrition — only what exists. */}
        <div className="mt-3 space-y-2 empty:hidden">
          <SessionLinks weekStart={weekly!.currentWeekStart} hasClubPlan={weekly!.hasClubPlan ?? weekly!.hasPlan} daySession={s.daySession} />
        </div>
        {teamDay && (
          <SessionRsvp
            weekStart={rsvpWeekStart}
            day={s.dayOfWeek}
            paces={paces}
            whenLabel={whenWord}
            onAnswered={() => setOpenState('closed')}
          />
        )}
      </div>
      )}

      {nextDay && (
        // Quieter than the card above it on purpose: tonight is the thing to do,
        // tomorrow is the thing to read. Same tap, same sheet, same 🔗 — so the
        // coach can copy tomorrow's story the afternoon before, which is when the
        // club's stories actually get posted.
        <button
          onClick={() => setDetail(detailFor(nextDay))}
          className="mt-2 flex w-full items-center gap-2.5 rounded-card border border-brand-600/10 bg-card/60 px-3 py-2 text-start transition-colors active:bg-page/40"
        >
          <span className="flex-none rounded-pill bg-brand-600/10 px-2 py-0.5 text-4xs font-bold text-brand-600">
            {t('tomorrow')}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-700">
            {ta(`runType_${nextDay.type}` as 'runType_easy')}
            <span className="font-light text-ink-400">
              {' · '}<bdi dir="ltr">{isEstimate(nextDay.kmFrom) ? '~' : ''}{
                roundKm(nextDay.kmMin) !== roundKm(nextDay.kmMax)
                  ? `${roundKm(nextDay.kmMin)}–${roundKm(nextDay.kmMax)}`
                  : `${roundKm(nextDay.kmMax)}`
              }</bdi> {units.km}
            </span>
          </span>
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
            <Link2 className="h-3.5 w-3.5" />
          </span>
          <Chevron className="h-4 w-4 flex-none text-ink-300" />
        </button>
      )}

      {detail && (
        <WorkoutDetailModal
          extra={detailMark !== undefined || weekly ? (
            <>
              <DaySessionNotes daySession={detailMark} />
              {weekly && <SessionLinks weekStart={weekly.currentWeekStart} hasClubPlan={weekly.hasClubPlan ?? weekly.hasPlan} daySession={detailMark} />}
            </>
          ) : undefined}
          session={detail}
          viewGroup={viewGroup}
          onPickGroup={(idx) => {
            setViewGroup(idx);
            try { localStorage.setItem('view_group', String(idx)); } catch { /* ignore */ }
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
