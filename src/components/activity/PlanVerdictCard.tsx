'use client';

import { useTranslations } from 'next-intl';
import { Target } from 'lucide-react';
import type { MetricStatus, PaceStatus } from '@/lib/academy/adherence';
import type { EffortReport } from '@/lib/academy/segments';
import { exceededPlan, verdictLevel, type PlanVerdict, type PlanVerdictLevel } from '@/lib/academy/verdict';
import { cn } from '@/lib/utils';
import { formatDuration, formatPace } from './format';

/**
 * "Did this run match the day's plan?" on one run.
 *
 * The academy compliance table has answered this for a year — for the single
 * athlete flagged `is_academy`. Everyone else got a plan pushed to their watch
 * and no feedback at all. This is the same verdict, from the same engine (see
 * `lib/academy/verdict`), on the surface every athlete already opens.
 *
 * Renders nothing when there's no plan for the day, or nothing gradeable in it —
 * an absent verdict must not turn into an empty box on a run that was fine.
 */

/**
 * `above` isn't a `PlanVerdictLevel` — it's the off-plan levels when the run only
 * missed by doing more (see `exceededPlan`). It gets its own tone because red for
 * "further and faster than asked" reads as an accusation, not information.
 */
type Headline = PlanVerdictLevel | 'above';

const LEVEL_STYLE: Record<Headline, { dot: string; text: string; border: string }> = {
  on_plan: { dot: 'bg-accent-600', text: 'text-accent-900', border: 'border-accent-600/30' },
  above: { dot: 'bg-band-2', text: 'text-band-2-ink', border: 'border-band-2/30' },
  partly: { dot: 'bg-band-3', text: 'text-band-3-ink', border: 'border-band-3/30' },
  off_plan: { dot: 'bg-accent-red', text: 'text-accent-red-ink', border: 'border-accent-red/30' },
  unknown: { dot: 'bg-ink-300', text: 'text-ink-400', border: 'border-page/30' },
};

const LEVEL_KEY: Record<Headline, string> = {
  on_plan: 'planLevelOnPlan',
  above: 'planLevelAbove',
  partly: 'planLevelPartly',
  off_plan: 'planLevelOffPlan',
  unknown: 'planLevelUnknown',
};

const STATUS_KEY: Record<Exclude<MetricStatus | PaceStatus, 'unknown'>, string> = {
  on_target: 'planStatusOnTarget',
  under: 'planStatusUnder',
  over: 'planStatusOver',
  faster: 'planStatusFaster',
  slower: 'planStatusSlower',
};

/**
 * On target is green, ungraded is grey, and the two ways of missing get different
 * colours: doing more than asked is blue (worth knowing, not a failure), doing
 * less is amber. Same split as the headline's `above`, so the chip at the top and
 * the rows under it can't tell different stories.
 */
function statusStyle(status: MetricStatus | PaceStatus): string {
  if (status === 'on_target') return 'text-accent-900';
  if (status === 'unknown') return 'text-ink-400';
  if (status === 'over' || status === 'faster') return 'text-band-2-ink';
  return 'text-band-3-ink';
}

function kmRange(minM: number, maxM: number): string {
  const lo = (minM / 1000).toFixed(1);
  const hi = (maxM / 1000).toFixed(1);
  return lo === hi ? lo : `${lo}–${hi}`;
}

function paceRange(min: number, max: number): string {
  return min === max ? formatPace(min) : `${formatPace(min)}–${formatPace(max)}`;
}

/** One metric: what was planned, what was run, and whether that counts. */
function MetricRow({
  label,
  planned,
  actual,
  unit,
  status,
  statusLabel,
  note,
}: {
  label: string;
  planned: string;
  actual: string;
  unit?: string;
  status: MetricStatus | PaceStatus;
  statusLabel: string | null;
  note?: string | null;
}) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-ink-400 w-14 shrink-0">{label}</span>
      <span className="font-bold text-ink-700 tabular-nums">{actual}</span>
      <span className="text-ink-400 tabular-nums">
        / {planned}{unit ? ` ${unit}` : ''}
      </span>
      {statusLabel && (
        <span className={cn('text-xs font-semibold ms-auto', statusStyle(status))}>{statusLabel}</span>
      )}
      {note && <span className="text-3xs text-ink-400">({note})</span>}
    </div>
  );
}

export function PlanVerdictCard({
  verdict,
  className,
}: {
  verdict: PlanVerdict | null;
  className?: string;
}) {
  const t = useTranslations('activities');
  if (!verdict) return null;

  const level = verdictLevel(verdict);
  const { distance, duration, pace, efforts } = verdict;
  // The reps are the stronger evidence when they answered, so a session with reps
  // missing stays off-plan even if the totals only went over.
  const headline: Headline =
    level !== 'on_plan' && level !== 'unknown'
      && !efforts?.neededTotal
      && exceededPlan(distance.status, pace.status)
      ? 'above'
      : level;
  const style = LEVEL_STYLE[headline];

  // Nothing gradeable at all and no rep check to show: the plan exists but this
  // card would be a header over three dashes. Say nothing instead.
  const hasEfforts = !!efforts && (efforts.verdict !== 'unverifiable' || !!efforts.reason);
  if (level === 'unknown' && !hasEfforts) return null;

  const statusLabel = (status: MetricStatus | PaceStatus) =>
    status === 'unknown' ? null : t(STATUS_KEY[status] as 'planStatusOnTarget');

  // The pace band the verdict was actually judged against, when it was judged.
  // `plannedMin/Max` is the WORK band — for a structured session that's a set of
  // rep paces, and the whole-run average was never compared to it (see
  // computeGradedPaceBand), so showing it beside a status would be a lie.
  const paceBandMin = pace.status === 'unknown' ? pace.plannedMin : pace.comparedMin;
  const paceBandMax = pace.status === 'unknown' ? pace.plannedMax : pace.comparedMax;

  return (
    <div className={cn('rounded-xl border bg-card/40 p-4', style.border, className)}>
      <div className="flex items-center gap-2 mb-3">
        <Target className="h-4 w-4 text-ink-400 shrink-0" />
        <p className="text-3xs font-bold uppercase text-ink-400">{t('planTitle')}</p>
        {verdict.workoutName && (
          <p className="text-xs text-ink-500 truncate">{verdict.workoutName}</p>
        )}
        <span className={cn('flex items-center gap-1.5 text-xs font-bold ms-auto shrink-0', style.text)}>
          <span className={cn('h-2 w-2 rounded-full', style.dot)} />
          {t(LEVEL_KEY[headline] as 'planLevelOnPlan')}
        </span>
      </div>

      <div className="space-y-1.5">
        {distance.actual != null && (
          <MetricRow
            label={t('distance')}
            actual={(distance.actual / 1000).toFixed(1)}
            planned={kmRange(distance.plannedMin, distance.plannedMax)}
            unit="km"
            status={distance.status}
            statusLabel={statusLabel(distance.status)}
          />
        )}
        {pace.actual != null && paceBandMin != null && paceBandMax != null && (
          <MetricRow
            label={t('pace')}
            actual={formatPace(pace.actual)}
            planned={paceRange(paceBandMin, paceBandMax)}
            unit="/km"
            status={pace.status}
            statusLabel={statusLabel(pace.status)}
          />
        )}
        {duration.actual != null && duration.planned > 0 && (
          <MetricRow
            label={t('duration')}
            actual={formatDuration(duration.actual)}
            planned={formatDuration(duration.planned)}
            status={duration.status}
            statusLabel={statusLabel(duration.status)}
            note={duration.estimated ? t('planEstimated') : null}
          />
        )}
      </div>

      {hasEfforts && <EffortsSection efforts={efforts!} />}
    </div>
  );
}

/**
 * The per-rep check: the only answer available to an athlete who read the plan and
 * pressed start rather than running the pushed structured workout.
 *
 * It reports reps RUN separately from reps run AT PACE, because those are two
 * different conversations, and it reports "the laps can't show this" separately
 * from "the reps weren't there" — an athlete on automatic 1 km laps must never be
 * told they skipped a 400.
 */
function EffortsSection({ efforts }: { efforts: EffortReport }) {
  const t = useTranslations('activities');
  const rows = efforts.requirements.filter(r => r.verifiable);

  let headline: string | null = null;
  let headlineStyle = 'text-ink-400';
  if (efforts.verdict === 'confirmed') {
    headline = t('planRepsConfirmed');
    headlineStyle = 'text-accent-900';
  } else if (efforts.verdict === 'partial') {
    headline = t('planRepsPartial', { found: efforts.foundTotal, needed: efforts.neededTotal });
    headlineStyle = 'text-band-3-ink';
  } else if (efforts.verdict === 'missed') {
    headline = t('planRepsMissed');
    headlineStyle = 'text-accent-red-ink';
  } else if (efforts.reason === 'no_laps') {
    headline = t('planRepsNoLaps');
  } else if (efforts.reason === 'laps_too_coarse') {
    headline = t('planRepsCoarse', { meters: Math.round(efforts.medianLapM ?? 0) });
  } else {
    // 'no_paced_plan' — the day asks for no reps, so there are none to report.
    return null;
  }

  return (
    <div className="mt-3 pt-3 border-t border-page/30 space-y-1.5">
      <p className="text-3xs font-bold uppercase text-ink-400">{t('planReps')}</p>
      <p className={cn('text-sm font-semibold', headlineStyle)}>{headline}</p>
      {efforts.attemptedTotal > efforts.foundTotal && (
        <p className="text-xs text-ink-400">
          {t('planRepsRun', {
            attempted: efforts.attemptedTotal,
            needed: efforts.neededTotal,
            found: efforts.foundTotal,
          })}
        </p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-2 text-xs">
          <span className="text-ink-500 shrink-0">{r.needed}×{r.label}</span>
          <span className="text-ink-400 tabular-nums shrink-0">{paceRange(r.paceMin, r.paceMax)}</span>
          {/* Trimmed to [] for anyone but the athlete and staff (see the route). */}
          {r.paces.length > 0 && (
            <span className="text-ink-500 tabular-nums truncate">
              {r.paces.map(formatPace).join(' · ')}
            </span>
          )}
          <span
            className={cn(
              'font-bold tabular-nums ms-auto shrink-0',
              r.found >= r.needed ? 'text-accent-900' : r.attempted > 0 ? 'text-band-3-ink' : 'text-accent-red-ink',
            )}
          >
            {r.found}/{r.needed}
          </span>
        </div>
      ))}
    </div>
  );
}
