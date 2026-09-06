'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Camera, ChevronLeft, Loader2, Trophy } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, getPlanWeekStart, israelDateAnchor, israelNow, israelToday } from '@/lib/utils';
import { GOAL_RACE, goalRaceProgress } from '@/lib/goal-race';
import { WORKOUT_TYPE_TEXT_COLORS, WORKOUT_TYPE_LABELS, planDayKey } from '@/lib/plans/workout-parsing';
import { AttendanceRSVP } from '@/components/AttendanceRSVP';
import { SetupProgressCard } from '@/components/onboarding/SetupProgressCard';
import type { FeedItem } from '@/lib/feed/project';

// ═════════════════════════════════════════════════════════════════════════════
// The Profile screen exactly as the designer drew it (Figma frame "Home",
// 402×874) — greeting, weekly-km progress, updates deck, race countdown, the
// upcoming team workout with its RSVP, this week's completion, and the week
// strip. Every value here comes from an endpoint the app already serves; see
// the DESIGN SYSTEM block in tailwind.config.ts for the tokens.
//
// It lives in its own component rather than inside profile/page.tsx because
// that page is already 1100 lines of drill-down screens, and because these
// blocks need four reads of their own that the drill-downs don't want.
//
// Two deliberate departures from the frame, both because the frame shows a
// single captured moment and the screen has to handle every other one:
//   • The frame's numbers are stale-but-real (106 days / week 2 of 17 compute
//     to 95 and 4 today) — everything is computed, never transcribed.
//   • The frame shows only the pre-tap RSVP state, so the answered state and
//     the דבוקה picker come from AttendanceRSVP's own logic (variant="inline").
// ═════════════════════════════════════════════════════════════════════════════

interface DailyDistance {
  day: string;
  dayOfWeek: number;
  min: number;
  max: number;
  type: string;
  sessions?: Array<{ min: number; max: number; type: string; name: string }>;
}

interface WeeklyData {
  dailyDistances: DailyDistance[];
  weekTotalMax: number;
  currentWeekStart: string;
  /** False when no plan exists for `currentWeekStart` — the rest is then empty. */
  hasPlan?: boolean;
  trainingDays: number;
}

interface ReminderCfg {
  teamDays?: number[];
  workoutHour?: number;
  /** Where the team meets. Admin-editable in Settings → workout reminders; the
   *  frame's מיקום column is the only slot with no data behind it, so the
   *  column is dropped rather than filled with a plausible-looking default. */
  location?: string;
}

export function ProfileOverview({
  athleteId,
  athleteName,
  avatarUrl,
  initials,
  uploadingPhoto,
  onPhotoClick,
  onOpenSetup,
}: {
  athleteId: string;
  athleteName: string;
  avatarUrl: string | null;
  initials: string;
  uploadingPhoto: boolean;
  onPhotoClick: () => void;
  /** Opens the setup checklist. The card above it renders itself away for good
   *  once setup is done, so this is dead weight for most of the club's life. */
  onOpenSetup: () => void;
}) {
  const t = useTranslations('profile');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  const locale = useLocale();

  const { data: weekly } = useApi<WeeklyData>('/api/dashboard/weekly');
  const { data: reminder } = useApi<{ config?: ReminderCfg }>('/api/reminder-config');
  const { data: summary } = useApi<{ thisWeek?: { km: number; runs: number } }>(
    athleteId ? `/api/athletes/summary?athleteId=${athleteId}` : null,
  );
  // Two, not one: the deck shows the newest announcement and peeks a second
  // card behind it only when there IS a second one.
  const { data: updates } = useApi<{ items: FeedItem[] }>('/api/feed?types=announcement&limit=2');

  const greetHour = israelNow().hour;
  const greeting = greetHour < 12 ? td('goodMorning') : greetHour < 18 ? td('goodAfternoon') : td('goodEvening');

  const teamDays = reminder?.config?.teamDays ?? [2, 5];
  const workoutHour = reminder?.config?.workoutHour ?? 18;
  const location = reminder?.config?.location?.trim() || '';

  const days = weekly?.dailyDistances || [];
  const weekKmDone = summary?.thisWeek?.km ?? 0;

  // The goal comes from the plan for the week the athlete is STANDING IN, which
  // is not always the week `/api/dashboard/weekly` returns: that one rolls to the
  // next week after Saturday 20:00 so the card above can preview it. Taking the
  // goal from there divided this week's kilometres by next week's target every
  // Saturday evening. `/api/plans/week` answers for one explicit week and reports
  // `hasPlan: false` rather than substituting another, so the bar hides instead of
  // measuring against a week that was never planned.
  const { data: thisWeekPlan } = useApi<{ hasPlan?: boolean; weekTotalMin?: number; weekTotalMax?: number }>(
    `/api/plans/week?weekStart=${getPlanWeekStart(israelDateAnchor())}`,
  );
  // The MIDPOINT of the plan's range, not its top. `weekTotalMax` made the bar
  // permanently unfinishable — run every session at the middle of its range and it
  // sat near 85% — and the midpoint is already what this codebase means by a
  // week's planned volume (`weekDelta` and the volume-trend chart both average
  // min and max).
  const weekKmGoal = thisWeekPlan?.hasPlan
    ? round1(((thisWeekPlan.weekTotalMin || 0) + (thisWeekPlan.weekTotalMax || 0)) / 2)
    : 0;

  // Which workout does the card show? Simply the SOONEST planned day — today
  // first, then tomorrow, and so on.
  //
  // It used to prefer the next TEAM day (teamDays, by default Tue + Fri) and
  // only fall back to the nearest planned day if no team day had a plan at all.
  // That is not what "the upcoming workout" means: on a Saturday it skipped
  // Sunday's session and showed Tuesday's, four days out, while Sunday sat
  // right there in the same week's plan. The heading promises the next one.
  //
  // The card's RSVP is unaffected — that still only appears on a team day, and
  // only for today or tomorrow (see showRsvp below). It just no longer decides
  // which workout the whole card is about.
  //
  // Walks the plan week's own DATES rather than counting weekdays forward from
  // today. `dayOfWeek` means nothing without the week it belongs to, and the week
  // this endpoint returns is not always the week the browser is in — it rolls to
  // the next one after Saturday 20:00 Israel so athletes can preview. Stepping
  // `offset` days from today onto that data mislabelled a session up to seven days
  // out as tomorrow's, and handed `getPlanWeekStart` a date from the wrong week,
  // which filed the RSVP under a week the workout isn't in.
  const upcoming = (() => {
    if (!weekly?.hasPlan || !weekly.currentWeekStart) return null;
    const todayKey = israelToday();
    return days
      .filter((d) => d.max > 0)
      .map((d) => {
        const key = planDayKey(weekly.currentWeekStart, d.dayOfWeek);
        return {
          workout: d,
          date: new Date(`${key}T12:00:00`),
          isTeamDay: teamDays.includes(d.dayOfWeek),
          // Whole days from today to that date, so 0 = today and 1 = tomorrow.
          offset: Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${todayKey}T12:00:00Z`)) / 86_400_000),
        };
      })
      .filter((c) => c.offset >= 0)
      .sort((a, b) => a.offset - b.offset)[0] ?? null;
  })();

  // RSVP only for today's or tomorrow's TEAM workout. Answering for a session
  // five days out would be a new flow — the reminders, the coach roster and
  // AttendanceRSVP's own hideIfAnswered rule are all built around the
  // day-before ask — so the card renders without pills until then rather than
  // quietly widening attendance semantics.
  const rsvpOffset = upcoming?.offset ?? -1;
  const showRsvp = !!upcoming?.isTeamDay && (rsvpOffset === 0 || rsvpOffset === 1);

  const race = goalRaceProgress();
  const raceDate = GOAL_RACE.date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-5">
      {/* ═══ GREETING + AVATAR ═══ */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPhotoClick}
          className="relative h-[55px] w-[55px] shrink-0 rounded-full"
          aria-label={t('changePhoto')}
        >
          <span className="block h-full w-full overflow-hidden rounded-full">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={athleteName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-brand-600 text-lg font-bold text-white">{initials}</span>
            )}
          </span>
          {/* The frame draws a bare avatar, but tapping it is the only way to
              change a photo anywhere in the app — so the badge stays, smaller. */}
          <span className="absolute bottom-0 end-0 flex h-5 w-5 items-center justify-center rounded-full bg-card shadow-sm">
            {uploadingPhoto ? <Loader2 className="h-3 w-3 animate-spin text-brand-600" /> : <Camera className="h-3 w-3 text-ink-500" />}
          </span>
        </button>
        <div className="min-w-0 flex-1 text-start">
          <p className="text-sm font-bold text-ink-700">{greeting},</p>
          <h1 className="truncate text-28 font-bold text-brand-600">{athleteName}</h1>
        </div>
      </div>

      {/* ═══ SETUP PROGRESS — new members only, then gone for good ═══ */}
      <SetupProgressCard onOpen={onOpenSetup} />

      {/* ═══ WEEKLY KM — actual against the plan's own weekly total ═══ */}
      {weekKmGoal > 0 && (
        <div>
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-xl font-bold text-ink-700">{t('weeklyKm')}</h2>
            <p className="text-2xl font-bold text-brand-600 tabular-nums">
              {round1(weekKmDone)}<span className="text-ink-400">/</span>{round1(weekKmGoal)}
            </p>
          </div>
          {/* Fill is a plain block inside an RTL track, so it grows from the
              right in Hebrew and from the left in English without two rules. */}
          <div className="h-3 w-full overflow-hidden rounded-pill bg-card">
            <div
              className="h-full rounded-pill bg-brand-600 transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.round((weekKmDone / weekKmGoal) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* ═══ UPDATES — the club's announcements, newest first ═══ */}
      {updates?.items && updates.items.length > 0 && (
        <div className="relative">
          {updates.items.length > 1 && (
            <div aria-hidden="true" className="absolute inset-x-2 top-1.5 h-full rounded-card bg-brand-600/40" />
          )}
          <Link
            href={`/feed?item=${updates.items[0].id}`}
            className="relative block rounded-card bg-brand-600 p-4 text-white active:opacity-90"
          >
            <p className="text-xl font-bold">{t('updates')}</p>
            <p className="mt-1 line-clamp-2 text-sm font-light" dir="auto">{updates.items[0].body}</p>
          </Link>
        </div>
      )}

      {/* ═══ GOAL RACE ═══ */}
      <div className="flex items-center gap-3 rounded-card bg-card p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/10">
          <Trophy className="h-4 w-4 text-brand-600" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-bold text-ink-700">{td(GOAL_RACE.nameKey)}</p>
          <p className="text-xs font-light text-ink-400">
            {/* week 0 = the block hasn't started; "week 0 of 17" would be a lie,
                so the date stands alone until it has. */}
            {race.week > 0 ? `${raceDate} · ${t('blockWeek', { week: race.week, total: race.totalWeeks })}` : raceDate}
          </p>
        </div>
        <div className="shrink-0 text-center">
          <p className="text-2xl font-extrabold leading-none text-brand-600 tabular-nums">{race.days}</p>
          <p className="text-xs font-light text-ink-400">{tc('days')}</p>
        </div>
      </div>

      {/* ═══ UPCOMING WORKOUT + RSVP ═══ */}
      {upcoming && (
        <div data-tour="upcomingWorkout" className="space-y-4 rounded-card bg-card p-4">
          <div className="flex items-start justify-between">
            <h2 className="text-xl font-bold text-ink-700">{t('upcomingWorkout')}</h2>
            <p className="shrink-0">
              <span className="text-2xl font-bold text-brand-600 tabular-nums">
                {upcoming.workout.min === upcoming.workout.max
                  ? upcoming.workout.max
                  : `${upcoming.workout.min}–${upcoming.workout.max}`}
              </span>{' '}
              <span className="text-xs font-light text-ink-400">{tc('km')}</span>
            </p>
          </div>

          {/* The frame rules a hairline between each pair of columns (three 39px
              lines for four columns). `border-s` on every cell but the first is
              the RTL-safe way to draw them: one line per gap, on the inline
              start edge, mirroring itself in English. */}
          <div
            className={cn(
              'grid gap-2 [&>*+*]:border-s [&>*+*]:border-ink-300 [&>*+*]:ps-2',
              location ? 'grid-cols-4' : 'grid-cols-3',
            )}
          >
            <Field label={t('colDay')} value={(tc.raw('dayNames') as string[])[upcoming.workout.dayOfWeek]} />
            <Field label={t('colTime')} value={`${String(workoutHour).padStart(2, '0')}:00`} />
            {location && <Field label={t('colLocation')} value={location} />}
            <Field
              label={t('colType')}
              value={WORKOUT_TYPE_LABELS[upcoming.workout.type] || upcoming.workout.type}
              color={WORKOUT_TYPE_TEXT_COLORS[upcoming.workout.type]}
            />
          </div>

          {showRsvp && (
            <AttendanceRSVP
              variant="inline"
              weekStart={getPlanWeekStart(upcoming.date)}
              day={upcoming.workout.dayOfWeek}
              dayBefore={rsvpOffset === 1}
              workoutHour={workoutHour}
            />
          )}
        </div>
      )}

      {/* ═══ COMPLETED THIS WEEK ═══ */}
      {weekly && weekly.trainingDays > 0 && (
        <div className="flex items-center justify-between rounded-card bg-card px-4 py-3">
          <p className="text-sm font-light text-ink-700">{t('completedThisWeek')}</p>
          <p className="text-2xl font-bold text-brand-600 tabular-nums">
            {summary?.thisWeek?.runs ?? 0}<span className="text-ink-400">/</span>{weekly.trainingDays}
          </p>
        </div>
      )}

      {/* ═══ WEEK STRIP ═══ */}
      {days.length > 0 && (
        // The tour anchors the whole block, heading and link included, so the
        // spotlight stays inside the page gutters — the tile row itself bleeds
        // past both screen edges (-mx-4) and would look like a cut-off hole.
        <div data-tour="weekStrip">
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-xl font-bold text-ink-700">{t('weeklyProgram')}</h2>
            <p className="text-sm font-light text-ink-500">
              {weekly?.currentWeekStart
                ? new Date(weekly.currentWeekStart + 'T00:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })
                : ''}
            </p>
          </div>
          {/* Says why the tiles are empty. `/api/dashboard/weekly` deliberately
              stopped falling back to the newest plan, so a week with nothing
              published renders seven "—" tiles — correct, and unreadable: it
              looks identical to the app having lost the plan. Only on an
              explicit `false`; while the request is in flight `hasPlan` is
              undefined and there is nothing to claim yet. */}
          {weekly?.hasPlan === false && (
            <p className="mb-2 text-sm font-light text-ink-400">{t('noPlanThisWeekYet')}</p>
          )}
          {/* Seven 74px tiles don't fit 402px, so the strip scrolls — the frame
              shows five and clips the rest. `-mx-4 px-4` lets it bleed to the
              screen edge inside the page's padded main. */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {days.map((d) => (
              <DayTile
                key={d.dayOfWeek}
                letter={(tc.raw('dayNamesShort') as string[])[d.dayOfWeek]}
                date={weekly?.currentWeekStart ? dayOfWeekDate(weekly.currentWeekStart, d.dayOfWeek) : null}
                km={d.min === d.max ? `${d.max}` : `${d.min}–${d.max}`}
                hasKm={d.max > 0}
                locale={locale}
                // By date, not by weekday: on Saturday evening the strip shows the
                // NEXT week, where matching on weekday ringed next Saturday as today.
                isToday={!!weekly?.currentWeekStart && planDayKey(weekly.currentWeekStart, d.dayOfWeek) === israelToday()}
                isTeamDay={teamDays.includes(d.dayOfWeek)}
                kmUnit={tc('km')}
              />
            ))}
          </div>
          <Link href="/dashboard/program" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand-600">
            {t('fullProgram')}
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

// One labelled cell in the upcoming-workout row. Both lines are 14px/300 in the
// frame — the workout type is the single cell it colours, and the only one it
// sets in bold, so `color` drives both.
function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-light text-ink-400">{label}</p>
      <p
        className={cn('truncate text-sm', color ? 'font-bold' : 'font-light text-ink-700')}
        style={color ? { color } : undefined}
        dir="auto"
      >
        {value}
      </p>
    </div>
  );
}

function DayTile({
  letter, date, km, hasKm, locale, isToday, isTeamDay, kmUnit,
}: {
  letter: string;
  date: Date | null;
  /** Pre-formatted, so a day whose plan is a RANGE reads the same here as on the
   *  card above it — the strip used to print only the top of it. */
  km: string;
  hasKm: boolean;
  locale: string;
  isToday: boolean;
  isTeamDay: boolean;
  kmUnit: string;
}) {
  return (
    <div
      className={cn(
        'relative flex h-[88px] w-[74px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-card bg-card',
        isToday && 'border border-brand-600',
      )}
    >
      <span className="text-sm font-light text-ink-500">{letter}</span>
      {date && (
        // Day number + short month assembled separately rather than via one
        // toLocaleDateString: he-IL renders {day,month:'short'} as "9 באוג׳",
        // and the frame has no preposition.
        <span className="text-sm font-bold text-ink-700">
          {date.getDate()} {date.toLocaleDateString(locale, { month: 'short' })}
        </span>
      )}
      <span className="text-sm font-light text-ink-500">{hasKm ? `${km} ${kmUnit}` : '—'}</span>
      {/* The frame's blue dots mark the club's team-workout days. */}
      {isTeamDay && <span className="absolute bottom-2 h-1.5 w-1.5 rounded-full bg-brand-600" />}
    </div>
  );
}

function dayOfWeekDate(weekStart: string, dayOfWeek: number) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + dayOfWeek);
  return d;
}

/** Trims the float dust off an activity-summed distance (95.30000000000001). */
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
