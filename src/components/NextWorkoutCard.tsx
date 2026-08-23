'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarPlus, CheckCircle2, ArrowRight } from 'lucide-react';
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
  typeColor: string;
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
  /** The embedded <AttendanceRSVP /> for this workout, or null when there's no team day to RSVP for. */
  children?: React.ReactNode;
}

// Consolidated "what's next for me" hero card — replaces a separate RSVP
// section + a separate today/tomorrow-workout tile with ONE card: the next
// relevant workout, inline actions (RSVP + add-to-calendar), and a
// context-aware primary CTA directly below it. (Dashboard IA cleanup, per
// Talos Barbershop / My Disney Experience research on consolidating
// "what's next" into a single hero card with inline actions.)
export function NextWorkoutCard({
  isToday, workout, typeLabel, typeColor, done, doneKm, date, workoutHour,
  hasRsvpTarget, rsvpAnswered, isNewPlan, children,
}: NextWorkoutCardProps) {
  const t = useTranslations('nextWorkout');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  const rsvpRef = useRef<HTMLDivElement>(null);

  const sessionName = workout.sessions?.[0]?.name || '';
  const distanceLabel = workout.min === workout.max ? `${workout.max}` : `${workout.min}–${workout.max}`;

  const calendarHref = googleCalendarUrl({
    title: `${t('eventTitle')} · ${sessionName || typeLabel}`,
    description: `${distanceLabel} ${tc('km')} · ${typeLabel}`,
    date,
    hour: workoutHour,
  });

  const scrollToRsvp = () => rsvpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <>
      <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30 space-y-4">
        {/* Next relevant workout — today's if not done yet, else tomorrow's */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {isToday ? td('today') : td('tomorrow')}
            </p>
            <div className="flex items-center gap-1.5">
              {done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
              <span
                className="text-3xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${typeColor}20`, color: typeColor }}
              >
                {typeLabel}
              </span>
            </div>
          </div>
          <p className="text-2xl font-black text-white mt-1 tabular-nums">
            {distanceLabel}
            <span className="text-sm font-medium text-slate-500 ms-1">{tc('km')}</span>
            {!!doneKm && doneKm > 0 && (
              <span className="text-xs font-semibold text-emerald-400 ms-2">
                {Math.round(doneKm * 10) / 10} {t('doneSuffix')}
              </span>
            )}
          </p>
          {sessionName && <p className="text-2xs text-slate-500 mt-0.5">{sessionName}</p>}
        </div>

        {/* Inline action: add to calendar */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={calendarHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-700/50 hover:bg-slate-700 transition-colors"
          >
            <CalendarPlus className="h-3.5 w-3.5" /> {t('addToCalendar')}
          </a>
        </div>

        {/* Inline action: RSVP (embedded, existing component — untouched internals) */}
        {children && <div ref={rsvpRef}>{children}</div>}
      </div>

      {/* Primary CTA bar, directly below the card — context-aware */}
      {hasRsvpTarget && !rsvpAnswered ? (
        <button
          onClick={scrollToRsvp}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors"
        >
          {t('ctaConfirm')} <ArrowRight className="h-4 w-4" />
        </button>
      ) : (
        <Link
          href="/dashboard/program"
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors"
        >
          {t('ctaViewPlan')}
          {isNewPlan && (
            <span className="bg-white/20 text-white text-3xs font-bold px-2 py-0.5 rounded-full">
              {t('newPlanBadge')}
            </span>
          )}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </>
  );
}
