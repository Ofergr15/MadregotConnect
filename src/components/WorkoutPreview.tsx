'use client';

import { useTranslations } from 'next-intl';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { Timer, Route, Sunrise, Moon } from 'lucide-react';
import { workoutDistanceMeters } from '@/lib/workout-distance';
import { workoutDurationSec, stepDurationSec, formatDurationShort } from '@/lib/workout-duration';
import { sessionKind } from '@/lib/plans/session-label';
import { splitRepeatSteps } from '@/lib/plans/repeat-block';
import {
  isRestStep,
  repeatHasMultiplePaces,
  stepMetric,
  stepQualifier,
  type StepUnits,
} from '@/lib/plans/step-display';
import {
  countSets,
  groupLadders,
  isPaceLadder,
  ladderPaces,
  paceCarrier,
  profileSegments,
  workoutSections,
  type SectionKind,
} from '@/lib/plans/workout-shape';
import { StepPace } from './PaceTokens';

const stepColors: Record<string, { dot: string; bg: string }> = {
  warmup: { dot: 'bg-band-3', bg: 'bg-band-3/10' },
  cooldown: { dot: 'bg-band-2', bg: 'bg-band-2/10' },
  interval: { dot: 'bg-accent-red', bg: 'bg-accent-red/10' },
  active: { dot: 'bg-purple-400', bg: 'bg-purple-400/10' },
  rest: { dot: 'bg-accent-600', bg: 'bg-accent-600/10' },
  recovery: { dot: 'bg-accent-600/10', bg: 'bg-accent-600/10' },
};

const workoutTypeStyles: Record<string, { border: string; color: string }> = {
  intervals: { border: 'border-s-red-400', color: 'text-accent-red' },
  long_run: { border: 'border-s-purple-400', color: 'text-purple-600' },
  tempo: { border: 'border-s-orange-400', color: 'text-band-3' },
  fartlek: { border: 'border-s-pink-400', color: 'text-pink-600' },
  progressive: { border: 'border-s-teal-400', color: 'text-teal-600' },
  easy: { border: 'border-s-blue-400', color: 'text-band-2' },
  recovery: { border: 'border-s-green-400', color: 'text-accent-600' },
};

/** A zone name ("Z3") for the rare step that targets a zone instead of a pace. */
function fmtZone(step: WorkoutStep): string {
  if (step.targetType === 'no_target' || step.targetPaceMinPerKm) return '';
  return step.targetZone || '';
}

export function inferWorkoutType(workout: ParsedWorkout): string {
  const name = workout.name.toLowerCase();
  const desc = (workout.description || '').toLowerCase();
  const text = `${name} ${desc}`;

  if (/interval|אינטרוול|pyramid|פירמידה/.test(text)) return 'intervals';
  if (/long|ארוכה|ארוך/.test(text)) return 'long_run';
  if (/tempo|טמפו/.test(text)) return 'tempo';
  if (/fartlek|פרטלק/.test(text)) return 'fartlek';
  if (/progressive|מתגברת/.test(text)) return 'progressive';
  if (/recovery|שחרור|easy|קל/.test(text)) return 'recovery';

  const hasRepeats = workout.steps.some(s => s.repeatCount && s.repeatCount > 2);
  if (hasRepeats) return 'intervals';

  if (workoutDistanceMeters(workout) > 15000) return 'long_run';

  return 'easy';
}

/** The legs of a set on one wrapped line: `15 שנ׳ מתגברת / 45 שנ׳ הליכה`. */
function LegList({ legs, units, showPaces }: { legs: WorkoutStep[]; units: StepUnits; showPaces: boolean }) {
  return (
    <>
      {legs.map((leg, j) => {
        const qualifier = stepQualifier(leg);
        return (
          <span key={j} className="flex items-center gap-x-1.5 min-w-0">
            {j > 0 && <span className="text-[10px] text-ink-300">/</span>}
            <span className={cn('text-[11px]', isRestStep(leg) ? 'text-ink-400' : 'text-ink-700 font-medium')}>
              {stepMetric(leg, units)}
            </span>
            {qualifier && <span className="text-[10px] text-ink-400 truncate">{qualifier}</span>}
            {showPaces && <StepPace step={leg} />}
          </span>
        );
      })}
    </>
  );
}

/**
 * Consecutive sets of the same shape at climbing paces, as one row:
 * `4 × 45 שנ׳ · סולם קצב · 3:50 3:40 3:30 3:20`.
 *
 * Tuesday writes that as four separate steps, and four near-identical rows is
 * four times the reading for one instruction. The rungs are the whole point, so
 * they are the emphasis; nothing is dropped, because the only thing that differs
 * between the steps IS the pace (see `ladderKey`).
 */
function LadderLine({ steps, units }: { steps: WorkoutStep[]; units: StepUnits }) {
  const tp = useTranslations('planner');
  const first = steps[0];
  const carrier = paceCarrier(first);
  const climbs = isPaceLadder(steps);
  const paces = ladderPaces(steps);
  const total = formatDurationShort(steps.reduce((sum, s) => sum + stepDurationSec(s), 0));

  return (
    <div className="rounded border border-accent-red/20 bg-accent-red/5 px-2 py-1 min-w-0">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepColors['interval'].dot)} />
        <span dir="ltr" className="text-[11px] text-accent-red font-bold shrink-0">{steps.length} ×</span>
        {first.repeatCount && first.repeatSteps ? (
          // A ladder of SETS — "3 × [2 × 2 ק״מ / 3 דק׳ ג׳וג]". The inner count
          // stays visible: three sets of two reps is not the same as six reps.
          <span className="flex flex-wrap items-center gap-x-1.5 min-w-0 rounded border border-ink-300/40 px-1.5">
            <span dir="ltr" className="text-[10px] text-ink-500 font-bold">{first.repeatCount} ×</span>
            <LegList legs={first.repeatSteps} units={units} showPaces={false} />
          </span>
        ) : (
          <>
            <span className="text-[11px] text-ink-700 font-medium">{stepMetric(first, units)}</span>
            {stepQualifier(first) && (
              <span className="text-[10px] text-ink-400 truncate">{stepQualifier(first)}</span>
            )}
          </>
        )}
        {climbs && <span className="text-[10px] text-ink-400 shrink-0">{tp('paceLadder')}</span>}
        <span className="ms-auto flex items-center gap-1 shrink-0" dir="ltr">
          {climbs ? (
            paces.map((pace, i) => (
              <span
                key={i}
                className="rounded bg-accent-red/12 px-1 text-[10px] font-bold text-accent-red tabular-nums"
              >
                {pace}
              </span>
            ))
          ) : carrier ? (
            <StepPace step={carrier} />
          ) : null}
          {total && <span className="text-[10px] text-ink-400 tabular-nums">{total}</span>}
        </span>
      </div>
    </div>
  );
}

function StepLine({ step, units }: { step: WorkoutStep; units: StepUnits }) {
  const colors = stepColors[step.type] || { dot: 'bg-ink-300', bg: 'bg-ink-300/10' };

  // A repeat block used to render as the bare word "6x" — no repeat distance, no
  // pace, no recovery. On an intervals workout, which is most of what the club
  // runs, that meant the card showed everything EXCEPT the numbers the session
  // is built on.
  //
  // It then rendered the recovery as `notes || duration`, which is how Sunday's
  // "8 × 15 שנ׳ / 45 שנ׳ הליכה" came out as "8x 15s" + "הליכה": the note REPLACED
  // the 45 seconds. Now the whole block is one line in the notation the coach
  // writes it in — every leg, its duration, its qualifier and its pace.
  if (step.repeatCount && step.repeatSteps) {
    const legs = step.repeatSteps;
    const { lead } = splitRepeatSteps(legs);
    // With two working legs there are two paces, and one right-aligned chip can
    // only show the first: Thursday is 6 × (9 דק׳ @4:25 + 1 דק׳ @3:40) and the
    // 3:40 surge is the session. Those blocks put each pace beside its own leg.
    const inlinePaces = repeatHasMultiplePaces(step);
    const total = formatDurationShort(stepDurationSec(step));
    return (
      <div className="rounded border border-brand-600/20 bg-brand-600/5 px-2 py-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepColors['interval'].dot)} />
          <span dir="ltr" className="text-[11px] text-brand-600 font-bold shrink-0">{step.repeatCount} ×</span>
          <LegList legs={legs} units={units} showPaces={inlinePaces} />
          {/* How long the set takes, which is what decides whether it fits in the
              morning — no screen showed it before. */}
          <span className="ms-auto flex items-center gap-1.5 shrink-0">
            {!inlinePaces && lead && <StepPace step={lead} />}
            {total && <span className="text-[10px] text-ink-400 tabular-nums">{total}</span>}
          </span>
        </div>
      </div>
    );
  }

  const zone = fmtZone(step);
  const metric = stepMetric(step, units);
  const qualifier = stepQualifier(step);

  // Distance first, pace at the end of the SAME row (`ms-auto`), so the pace
  // lines up in a column down the card. `flex-wrap` is what lets the pace drop
  // to its own line — whole, never mid-token — in the narrow 7-column desktop
  // week; on a phone, where the day cards are full width, it stays inline.
  return (
    <div className={cn('flex flex-wrap items-center gap-x-1.5 py-1 px-2 rounded min-w-0', colors.bg)}>
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', colors.dot)} />
      {metric && (
        <span className="text-[11px] text-ink-700 truncate min-w-0 font-medium">{metric}</span>
      )}
      {zone && <span className="text-[10px] text-ink-400 shrink-0">{zone}</span>}
      {/* An open step has no metric to lead with, so its note IS the workout and
          gets the metric's own weight — Wednesday ("70-80 דק׳ ריצת שחרור קלה")
          and Monday evening used to render as the single word "סבב". */}
      {qualifier && (
        <span className={cn(
          'min-w-0',
          metric ? 'text-[10px] text-ink-400 truncate' : 'text-[11px] text-ink-700 font-medium flex-1',
        )}>
          {qualifier}
        </span>
      )}
      <StepPace step={step} className="ms-auto" />
    </div>
  );
}

/**
 * The session's shape as one row of proportional blocks — warm-up, work,
 * recovery, jog home. It says "eight hard reps" or "long and steady" before a
 * single number is read, which is what you actually want from a week at a glance.
 *
 * Decorative on purpose (`aria-hidden`): every value in it is already written out
 * in the rows below, so a screen reader gains nothing from 16 unlabelled bars.
 */
function ProfileBar({ steps }: { steps: WorkoutStep[] }) {
  const segments = profileSegments(steps);
  // One block has no shape — a bar the full width of the card would just be a
  // coloured line pretending to be information.
  if (segments.length < 2) return null;
  const total = segments.reduce((sum, seg) => sum + seg.sec, 0) || 1;

  return (
    <div className="mx-2.5 mb-1.5 flex h-2.5 gap-px overflow-hidden rounded bg-ink-300/15" aria-hidden="true">
      {segments.map((seg, i) => {
        const rest = seg.type === 'rest' || seg.type === 'recovery';
        return (
          <div
            key={i}
            className={cn(stepColors[seg.type]?.dot || 'bg-ink-300', rest && 'opacity-40')}
            style={{ flex: `${Math.max(seg.sec / total, 0.004)} 0 auto`, minWidth: 2 }}
          />
        );
      })}
    </div>
  );
}

interface WorkoutPreviewProps {
  workout: ParsedWorkout;
  compact?: boolean;
  /** Merged onto the card's own classes — e.g. to strip top rounding/border when a day-header sits directly above it. */
  className?: string;
}

/**
 * "בוקר" / "ערב" / "חלק 1/2", plus an optional-session pill.
 *
 * Only rendered when the day actually holds more than one session — which is
 * exactly when a bare workout name ("ריצה קלה") stops being enough to tell you
 * which of the day's two runs you are looking at.
 */
function SessionBadge({ workout, compact }: { workout: ParsedWorkout; compact?: boolean }) {
  const tp = useTranslations('planner');
  const kind = sessionKind(workout);
  if (!kind) return null;

  const label =
    kind === 'morning' ? tp('sessionMorning')
    : kind === 'evening' ? tp('sessionEvening')
    : tp('partLabel', { index: workout.partIndex ?? 1, count: workout.partCount ?? 1 });

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', compact ? 'mb-1' : 'mb-1')}>
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/12 px-2 py-0.5 text-[10px] font-bold text-brand-600">
        {kind === 'morning' ? <Sunrise className="h-2.5 w-2.5" /> : kind === 'evening' ? <Moon className="h-2.5 w-2.5" /> : null}
        {label}
      </span>
      {workout.optional && (
        <span className="inline-flex items-center rounded-full bg-ink-300/15 px-2 py-0.5 text-[10px] font-bold text-ink-400">
          {tp('sessionOptional')}
        </span>
      )}
    </div>
  );
}

export function WorkoutPreview({ workout, compact = false, className }: WorkoutPreviewProps) {
  const tc = useTranslations('common');
  const tp = useTranslations('planner');
  const steps = workout.steps;
  const units: StepUnits = {
    km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes'),
  };

  // Coach-aware distance (prefers the day's km range) so per-day cards sum to
  // the same weekly total shown on the athlete dashboard.
  const totalDist = workoutDistanceMeters(workout);
  // Pace-aware duration. The local `estimateTime` this replaces counted `time`
  // steps only, so Sunday's 23.5 km showed as "8m" — its strides block.
  const totalTime = workoutDurationSec(workout);
  const type = inferWorkoutType(workout);
  const style = workoutTypeStyles[type] || workoutTypeStyles['easy'];

  // Compact: minimal card
  if (compact) {
    return (
      <div className={cn(
        'bg-card/80 border border-page/40 rounded-lg overflow-hidden border-s-[3px] h-full',
        style.border,
        className
      )}>
        <div className="px-3 py-2.5">
          <SessionBadge workout={workout} compact />
          <p className="text-[11px] font-semibold text-ink-700 truncate">{workout.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {totalDist > 0 && (
              <span className="text-[10px] text-ink-400">
                {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
              </span>
            )}
            {totalTime > 0 && (
              <span className="text-[10px] text-ink-400">{formatDurationShort(totalTime)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Full card. Every step is on it — there is no "+12 more".
  //
  // The old card showed three steps and hid the rest behind a button, so Tuesday
  // (fifteen steps) displayed the least of any day in the week while being the
  // day with the most in it. Flattening all fifteen into a list isn't the answer
  // either; the card is built the way the program is written instead: warm-up /
  // main / cool-down, with same-shape sets merged into one pace-ladder line.
  const sections = workoutSections(steps);
  const showSectionLabels = sections.length > 1;
  const sets = countSets(steps);
  const sectionLabels: Record<SectionKind, string> = {
    warmup: tp('sectionWarmup'),
    main: tp('sectionMain'),
    cooldown: tp('sectionCooldown'),
  };

  return (
    <div className={cn(
      'bg-card/80 border border-page/40 rounded-lg overflow-hidden border-s-[3px] transition-all hover:bg-page h-full flex flex-col',
      style.border,
      className
    )}>
      {/* Header */}
      <div className="px-3 pt-3 pb-1.5">
        <SessionBadge workout={workout} />
        <h3 className="font-semibold text-[12px] text-ink-700 leading-snug truncate">{workout.name}</h3>
        {workout.description && (
          <p className="text-[10px] text-ink-400 mt-0.5 truncate">{workout.description}</p>
        )}
      </div>

      <ProfileBar steps={steps} />

      {/* Steps, by section */}
      <div className="px-2.5 pb-2 flex-1">
        {sections.map((section) => (
          <div key={section.kind} className="space-y-0.5 [&:not(:first-child)]:mt-1.5">
            {showSectionLabels && (
              <p className="px-1 text-[9px] font-black uppercase tracking-[0.08em] text-ink-400">
                {sectionLabels[section.kind]}
              </p>
            )}
            {groupLadders(section.steps).map((item, i) => (
              item.kind === 'ladder'
                ? <LadderLine key={i} steps={item.steps} units={units} />
                : <StepLine key={i} step={item.step} units={units} />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      {(totalDist > 0 || totalTime > 0) && (
        <div className="border-t border-page/30 px-3 py-1.5 flex items-center gap-3 bg-page/30">
          {totalDist > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-ink-400">
              <Route className="h-2.5 w-2.5" />
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
            </span>
          )}
          {totalTime > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-ink-400">
              <Timer className="h-2.5 w-2.5" />
              {formatDurationShort(totalTime)}
            </span>
          )}
          {sets > 0 && (
            <span className="text-[10px] text-ink-400">
              {sets === 1 ? tp('setsOne') : tp('setsCount', { count: sets })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
