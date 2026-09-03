'use client';

import { useApi } from '@/lib/api';
import { getPlanWeekStart } from '@/lib/utils';
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
  dailyDistances?: Array<{ day: string; dayOfWeek: number; type: string }>;
}

export function AttendanceConfirmCard() {
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
  const target = (() => {
    const todayDow = new Date().getDay();
    if (teamDays.includes(todayDow)) return { date: new Date(), dow: todayDow, dayBefore: false };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDow = tomorrow.getDay();
    if (teamDays.includes(tomorrowDow)) return { date: tomorrow, dow: tomorrowDow, dayBefore: true };
    return null;
  })();
  if (!target) return null;

  const workout = weekly?.dailyDistances?.find((d) => d.dayOfWeek === target.dow);
  // The title itself says today/tomorrow (AttendanceRSVP's dayBefore prop); this
  // label only names the workout.
  const label = workout?.type ? `${workout.day} · ${workout.type}` : workout?.day;

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
