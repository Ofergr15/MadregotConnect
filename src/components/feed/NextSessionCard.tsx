'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronLeft, ChevronRight, Link2, Moon, Sun, Watch } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, israelNow, israelToday } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import {
  WORKOUT_TYPE_COLORS, WORKOUT_TYPE_TEXT_COLORS, planDayKey, type WeekSession,
} from '@/lib/plans/workout-parsing';
import { sessionFrame, sessionHeadline, type FrameLabels } from '@/lib/plans/session-summary';
import { nameQualifier, roundKm } from '@/lib/plans/week-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { formatDurationClock } from '@/lib/workout-duration';
import { isEstimate } from '@/lib/plans/step-estimate';
import { pickNextSession } from '@/lib/plans/next-session';
import { WorkoutDetailModal, type WorkoutDetailSession } from '@/components/WorkoutDetailModal';

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
}

interface WatchState {
  garminConnected: boolean;
  hasPlan: boolean;
  onWatch: string[];
}

interface FeedActivity {
  start_time: string;
  distance: number | null;
}

export function NextSessionCard() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');
  const tp = useTranslations('planner');
  const tw = useTranslations('watchStatus');

  const { data: weekly } = useApi<WeeklyResponse>('/api/dashboard/weekly');
  const { data: watch } = useApi<WatchState>('/api/my-watch');
  const [runsKmByDate, setRunsKmByDate] = useState<Record<string, number[]> | null>(null);
  const [detail, setDetail] = useState<WorkoutDetailSession | null>(null);
  const [viewGroup, setViewGroup] = useState(0);

  const todayKey = israelToday();

  useEffect(() => {
    const stored = parseInt(localStorage.getItem('view_group') || '', 10);
    if (stored >= 0 && stored <= 2) setViewGroup(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Today's runs only: "is the session done" is a question about today, and
        // `since` is a date-only floor anyway.
        const res = await fetchActivities({ selfOnly: true, since: todayKey });
        const data = res.ok ? await res.json() : { activities: [] };
        const byDate: Record<string, number[]> = {};
        for (const a of (data.activities || []) as FeedActivity[]) {
          // start_time is the athlete's own wall clock, so its date part IS the
          // Israel day — no timezone maths, which would shift a 23:30 run.
          const key = a.start_time.slice(0, 10);
          (byDate[key] ||= []).push((a.distance || 0) / 1000);
        }
        if (!cancelled) setRunsKmByDate(byDate);
      } catch {
        if (!cancelled) setRunsKmByDate({});
      }
    })();
    return () => { cancelled = true; };
  }, [todayKey]);

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

  if (!next) return null;

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

  const Chevron = rtl ? ChevronLeft : ChevronRight;

  /**
   * One session as the detail sheet wants it. Shared by the main card and the
   * tomorrow chip so the two rows cannot describe the same sheet differently —
   * the chip opens the real session, not a summary of it.
   */
  const detailFor = (x: WeekSession): WorkoutDetailSession => {
    const xMin = roundKm(x.kmMin);
    const xMax = roundKm(x.kmMax);
    const xKm = xMin !== xMax ? `${xMin}–${xMax}` : `${xMax}`;
    const xKind = x.kind === 'morning' || x.kind === 'evening'
      ? tp(x.kind === 'morning' ? 'sessionMorning' : 'sessionEvening') : '';
    return {
      name: [sessionHeadline(x.steps, units), nameQualifier(x.name, dayNames)]
        .filter(Boolean).join(' · ') || x.name,
      day: [dayNames[x.dayOfWeek], xKind].filter(Boolean).join(' · '),
      distance: xKm ? `${isEstimate(x.kmFrom) ? '~' : ''}${xKm} ${units.km}` : '',
      duration: formatDurationClock(x.durationSec),
      steps: x.steps,
      // The story's own copy of the day and the type, unlocalised: the sheet's
      // `day` above is Hebrew and the post is English. `km` is the plain
      // number without a unit, because the story writes its own "(14km)".
      story: { dayOfWeek: x.dayOfWeek, type: x.type, km: xKm },
    };
  };

  // Tomorrow, when today is a double and it is past noon — see next-session.ts.
  const nextDay = next.tomorrow?.session;

  return (
    <>
      <button
        onClick={() => setDetail(detailFor(s))}
        className="flex w-full items-center gap-3 rounded-card bg-card p-3 text-start transition-colors active:bg-page/40"
      >
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-2xs font-bold"
          style={{ background: `${fill}22`, color: ink }}
        >
          {/* The type's own colour, as a block — the card carries no other colour,
              so this is what makes intervals and an easy run tell apart at a glance. */}
          <span className="h-3 w-3 rounded-full" style={{ background: fill }} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink-700">
            {next.isToday ? t('today') : t('tomorrow')} · {typeLabel}
          </span>
          <span className="block text-xs font-light text-ink-400">
            <bdi dir="ltr">{approx}{km}</bdi> {units.km}
            {next.total > 1 && ` · ${next.index}/${next.total}`}
          </span>
        </span>

        {part && (
          <span
            className={`flex flex-none items-center gap-1 rounded-pill px-2 py-0.5 text-3xs font-bold ${
              part === 'morning' ? 'bg-[#FFF0C7] text-[#8A5A00]' : 'bg-[#E9E4FF] text-[#4632B5]'
            }`}
          >
            {part === 'morning' ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
            {kindLabel}
          </span>
        )}

        {watchKnown && (
          <span
            title={onWatch ? tw('onWatch') : tw('notOnWatch')}
            aria-label={onWatch ? tw('onWatch') : tw('notOnWatch')}
            className={`flex flex-none items-center gap-0.5 rounded-lg px-1.5 py-1 ${
              onWatch ? 'bg-accent-600/10 text-accent-600' : 'bg-accent-red/10 text-accent-red'
            }`}
          >
            <Watch className="h-3.5 w-3.5" />
            {onWatch && <Check className="h-3 w-3" />}
          </span>
        )}

        {/* The card's only advertisement of the copy. Nobody taps a row to find out
            what it does, so the affordance has to be ON the row — this is the same
            icon the sheet's copy button carries, which is what makes the tap and
            what it opens read as one thing. */}
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
          <Link2 className="h-3.5 w-3.5" />
        </span>

        <Chevron className="h-4 w-4 flex-none text-ink-300" />
      </button>

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
