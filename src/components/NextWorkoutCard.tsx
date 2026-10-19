'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Check, ChevronLeft } from 'lucide-react';
import { numberRuns } from '@/lib/day-session/model';
import { googleCalendarUrl } from '@/lib/calendar-link';

interface WorkoutTile {
  day: string;
  dayOfWeek: number;
  min: number;
  max: number;
  type: string;
  sessions?: Array<{ min: number; max: number; type: string; name: string }>;
}

interface NextWorkoutCardProps {
  /** true when `workout` is today's session (whether done or still pending); false = tomorrow's. */
  isToday: boolean;
  workout: WorkoutTile;
  typeLabel: string;
  /** The workout type's FILL hue — this card uses it as a 20% chip wash. */
  typeColor: string;
  /** The readable twin of `typeColor`, for the label sitting ON that wash.
   *  The fill palette is far too light to read against 20% of itself: the
   *  `easy` blue measured 2.28:1 here. See WORKOUT_TYPE_TEXT_COLORS. */
  typeTextColor: string;
  /** Only meaningful when isToday — has today's distance target already been met. */
  done?: boolean;
  doneKm?: number;
  /** Calendar date the workout falls on (today or tomorrow), for the "add to calendar" link. */
  date: Date;
  /** Team workout start hour (Israel local, admin-configured), used as the calendar event time. */
  workoutHour: number;
  hasRsvpTarget: boolean;
  rsvpAnswered: boolean;
  /** This week's plan was pushed recently — shows a badge on the "view plan" CTA. */
  isNewPlan?: boolean;
  /** The <WatchStatus /> row for this workout's date, or nothing when there's no watch to ask about. */
  watch?: React.ReactNode;
  /** The embedded <AttendanceRSVP /> for this workout, or null when there's no team day to RSVP for. */
  children?: React.ReactNode;
  /** Today's run against the plan, once it is judged (execution.dir_*). The page asks; the card shows. */
  verdict?: { onPlan: boolean; label: string } | null;
  /** Tomorrow's session, on one line under a done today. */
  tomorrow?: string | null;
}

// "What's next for me" in ONE compact card (Ofer, 2026-10-19, mockups/morning-1019/home-v4):
// it used to take half the screen — a date line, a huge km range, an "add to calendar"
// button, the RSVP as its own block and a full-width CTA under it. Now: what the session
// is, whether it's on the Garmin account (the watch row), and, once it's run, done and
// whether it kept to the plan. Calendar becomes an icon, the plan a small link.
export function NextWorkoutCard({
  isToday, workout, typeLabel, typeColor, typeTextColor, done, doneKm, date, workoutHour,
  isNewPlan, watch, children, verdict, tomorrow,
}: NextWorkoutCardProps) {
  const t = useTranslations('nextWorkout');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');

  const sessionName = workout.sessions?.[0]?.name || '';
  const distanceLabel = workout.min === workout.max ? `${workout.max}` : `${workout.min}–${workout.max}`;
  const runs = (text: string) => numberRuns(text).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>));

  const calendarHref = googleCalendarUrl({
    title: `${t('eventTitle')} · ${sessionName || typeLabel}`,
    description: `${distanceLabel} ${tc('km')} · ${typeLabel}`,
    date,
    hour: workoutHour,
  });

  return (
    <div className={`rounded-card p-4 shadow-sm ${done ? 'bg-gradient-to-b from-accent-600/10 to-card' : 'bg-card'}`}>
      <div className="flex items-center gap-2">
        {done
          ? <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-600"><Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /></span>
          : <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: `${typeColor}20`, color: typeTextColor }}>{typeLabel}</span>}
        <p className="text-13 font-extrabold text-ink-500">
          {isToday ? td('today') : td('tomorrow')}{done && <> · {t('done')}</>}
        </p>
        {done && verdict && (
          <span className={`ms-auto rounded-full px-2.5 py-0.5 text-xs font-black ${verdict.onPlan ? 'bg-accent-600/15 text-accent-900' : 'bg-band-3/15 text-band-3-ink'}`}>{verdict.label}</span>
        )}
        {!done && (
          <a href={calendarHref} target="_blank" rel="noopener noreferrer" aria-label={t('addToCalendar')}
            className="ms-auto -my-2 -me-2 grid h-11 w-11 place-items-center rounded-xl text-ink-400 hover:text-ink-900">
            <CalendarPlus className="h-4 w-4" />
          </a>
        )}
      </div>

      <p className="mt-1.5 text-[28px] font-black leading-tight text-ink-900 tabular-nums">
        {done && doneKm
          ? <><bdi dir="ltr">{Math.round(doneKm * 10) / 10}</bdi> <small className="text-sm font-bold text-ink-500">{tc('km')}</small></>
          : sessionName ? runs(sessionName) : <><bdi dir="ltr">{distanceLabel}</bdi> <small className="text-sm font-bold text-ink-500">{tc('km')}</small></>}
      </p>
      <p className="text-xs text-ink-500">
        {done
          ? <>{t('plannedWas')} {sessionName ? runs(sessionName) : <bdi dir="ltr">{distanceLabel}</bdi>}</>
          : sessionName && <><bdi dir="ltr">{distanceLabel}</bdi> {tc('km')}</>}
      </p>

      {tomorrow && (
        <p className="mt-2.5 border-t border-page pt-2.5 text-13 text-ink-700">{td('tomorrow')} · {runs(tomorrow)}</p>
      )}
      {/* Is it on the Garmin account, and one tap if it isn't (WatchStatus). */}
      {watch && <div className="mt-2.5">{watch}</div>}
      {children && <div className="mt-3">{children}</div>}

      <Link href="/dashboard/program" className="mt-2 -mb-2 inline-flex min-h-[44px] items-center gap-1 text-sm font-bold text-brand-600">
        {t('ctaViewPlan')}
        {isNewPlan && <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-3xs font-bold">{t('newPlanBadge')}</span>}
        <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
      </Link>
    </div>
  );
}
