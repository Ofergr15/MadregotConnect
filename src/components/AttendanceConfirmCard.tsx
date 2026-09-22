'use client';

import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { getPlanWeekStart, israelDateAnchor, toISODate } from '@/lib/utils';
import { planDayKey } from '@/lib/plans/workout-parsing';
import { useWorkoutTypeLabel } from '@/lib/plans/use-workout-type-label';
import { AttendanceRSVP } from './AttendanceRSVP';

// The athlete's "confirm attendance" surface, now that the tab bar has no
// separate אישור slot and the action belongs to the Program tab instead.
//
// Self-contained on purpose: it picks its own target workout and fetches the two
// things that decide it, so a host screen only has to mount it. Both keys are
// already read by the dashboard through the same useApi/SWR cache, so this adds
// no request on a session that has been there.
//
// Renders nothing when there's no team workout today or tomorrow, and nothing at
// all for a viewer who isn't an athlete (AttendanceRSVP bails on a missing
// athlete_id) — so a coach on the program page sees no change.

interface WeeklyPlan {
  dailyDistances?: Array<{ day: string; dayOfWeek: number; type: string; max: number }>;
  currentWeekStart?: string;
  /** False when the returned week has no plan — `dailyDistances` is then all rest. */
  hasPlan?: boolean;
}

export function AttendanceConfirmCard() {
  const tc = useTranslations('common');
  const workoutTypeLabel = useWorkoutTypeLabel();
  const { data: reminderConfig } = useApi<{ config?: { teamDays?: number[]; workoutHour?: number } }>('/api/reminder-config');
  const { data: weekly } = useApi<WeeklyPlan>('/api/dashboard/weekly');
  // Same fallback as the dashboard: Tuesday + Friday are the club's team days
  // until the coach configures otherwise.
  const teamDays = reminderConfig?.config?.teamDays ?? [2, 5];

  // A DAY-BEFORE flow, matching the Mon 08:00 / Mon 18:00 pushes for a Tuesday
  // workout: the evening before a team day it asks "coming tomorrow?", and on the
  // day itself it only nudges whoever never answered (hideIfAnswered below).
  // Unlike the dashboard this has no ?rsvp= deep-link override — the pushes link
  // to /dashboard, which keeps owning the "answer a days-old notification" case.
  //
  // Anchored on ISRAEL's day, not the device's: a phone left on a US timezone is
  // hours behind, and "today" here decides which day's attendance gets recorded.
  const target = (() => {
    const anchor = israelDateAnchor();
    const todayDow = anchor.getDay();
    if (teamDays.includes(todayDow)) return { date: anchor, dow: todayDow, dayBefore: false };
    const tomorrow = israelDateAnchor();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDow = tomorrow.getDay();
    if (teamDays.includes(tomorrowDow)) return { date: tomorrow, dow: tomorrowDow, dayBefore: true };
    return null;
  })();
  if (!target) return null;

  // Matched on the target DATE against the week the endpoint actually returned,
  // and only a day that HAS a workout. Matching on `dayOfWeek` alone labelled the
  // card off next week's plan after the Saturday-20:00 rollover, and with no
  // `max > 0` guard a team day the coach left empty read "Tue · rest".
  const planWeek = weekly?.hasPlan ? weekly.currentWeekStart : undefined;
  const targetKey = toISODate(target.date);
  const workout = planWeek
    ? weekly?.dailyDistances?.find((d) => d.max > 0 && planDayKey(planWeek, d.dayOfWeek) === targetKey)
    : undefined;
  // The title itself says today/tomorrow (AttendanceRSVP's dayBefore prop); this
  // label only names the workout.
  //
  // Both halves are raw DATA and neither is copy. `d.day` comes off the English
  // `DAY_NAMES` array in workout-parsing.ts and `d.type` is the stored slug, so
  // this line printed "Fri · long_run" on an RTL Hebrew card — measured on the
  // program tab. The dashboard had exactly this bug on exactly this card and fixed
  // it (see `rsvpDayLabel` in dashboard/page.tsx); this is the second mount of the
  // same component, reached from the Program tab, and it never got the fix. Same
  // two sources as there: `common.dayNames` for the day, and the
  // `activities.runType_*` keys everything else in the app uses for the type.
  const dayLabel = workout ? (tc.raw('dayNames') as string[])[workout.dayOfWeek] : undefined;
  const label = workout?.type ? `${dayLabel} · ${workoutTypeLabel(workout.type)}` : dayLabel;

  return (
    <AttendanceRSVP
      workoutLabel={label || undefined}
      // Derived from the TARGET date, not from today — otherwise a Saturday
      // asking about Sunday's workout would file the answer under the week that
      // just ended.
      weekStart={getPlanWeekStart(target.date)}
      day={target.dow}
      dayBefore={target.dayBefore}
      workoutHour={reminderConfig?.config?.workoutHour}
      hideIfAnswered={!target.dayBefore}
    />
  );
}
