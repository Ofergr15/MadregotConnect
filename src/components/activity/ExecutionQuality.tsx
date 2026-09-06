'use client';

/**
 * "Plan vs. execution" — the section at the top of a run.
 *
 * Reads in one order, deliberately: WHICH WAY you missed, then by how much, then
 * rep by rep, then what could and could not be measured at all. The percentage is
 * a ring beside the headline rather than the headline itself, because the same
 * 62% is earned by running everything too fast and by running everything too
 * slow, and those need opposite advice.
 *
 * The grey "not measured" rows are a feature, not a gap. `adherence.ts`
 * deliberately refuses to grade a planned duration it had to invent, or a
 * whole-run average pace on a structured session — so this says which, and why,
 * instead of showing a confident number nobody should trust.
 *
 * RTL notes, both of which have bitten this app before: every <svg> carries
 * `direction="ltr"` (an inherited rtl flips `text-anchor` and silently moves
 * labels), and numeric ranges like "3:20–3:30" are wrapped in <bdi dir="ltr">
 * (bare digit pairs reorder inside Hebrew text).
 */

import { useTranslations } from 'next-intl';
import { AlertCircle, Info, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DIRECTION_COLOR,
  PACE_STATUS_COLOR,
  ZERO_AT_TOLERANCE_MULTIPLE,
  type ExecutionDirection,
  type ExecutionMetric,
  type ExecutionRep,
  type ExecutionVerdict,
} from '@/lib/plan-execution/verdict';
import type { PlannedKmPoint } from '@/lib/academy/segments';
import { ExecutionRing } from './ExecutionRing';
import { PaceChart } from './charts';
import { formatDuration, formatPace } from './format';
import type { Split } from './types';

// ── Small formatters ────────────────────────────────────────────────────────

function paceRange(min: number | null, max: number | null): string | null {
  if (min == null) return null;
  if (max == null || max === min) return formatPace(min);
  return `${formatPace(min)}–${formatPace(max)}`;
}

function kmRange(min: number | null, max: number | null): string | null {
  if (!min) return null;
  const lo = (min / 1000).toFixed(1);
  if (!max || max === min) return lo;
  const hi = (max / 1000).toFixed(1);
  return lo === hi ? lo : `${lo}–${hi}`;
}

/** Numbers inside Hebrew text need explicit LTR isolation — see the header note. */
function Num({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr" className="tabular-nums">{children}</bdi>;
}

// ── Headline ────────────────────────────────────────────────────────────────

/**
 * The one sentence that says how far off, in the unit the athlete thinks in.
 * Built from whichever signal the verdict was actually graded on, so it never
 * quotes a pace deviation for a run that was graded on distance alone.
 */
function verdictDetail(
  verdict: ExecutionVerdict,
  t: ReturnType<typeof useTranslations<'execution'>>,
): string {
  const { direction, paceDeviationSec, repCounts } = verdict;
  const seconds = paceDeviationSec == null ? null : Math.abs(paceDeviationSec);

  if (direction === 'mixed') {
    return t('detail_mixed', { faster: repCounts.faster, slower: repCounts.slower });
  }
  if ((direction === 'too_fast' || direction === 'too_slow') && seconds != null) {
    return t(direction === 'too_fast' ? 'detail_too_fast' : 'detail_too_slow', { sec: seconds });
  }
  if (direction === 'too_long' || direction === 'too_short') {
    const distance = verdict.metrics.find((metric) => metric.key === 'distance');
    // No number to quote means no sentence to build — never "longer by  km".
    if (distance?.deviation != null) {
      const km = (Math.abs(distance.deviation) / 1000).toFixed(1);
      return t(direction === 'too_long' ? 'detail_too_long' : 'detail_too_short', { km });
    }
  }
  if (direction === 'on_target') return t('detail_on_target');
  return t('detail_unknown');
}

// ── The deviation axis ──────────────────────────────────────────────────────

/**
 * Where the run's average pace fell relative to the band the coach wrote.
 *
 * Scale runs from "3 tolerances faster than the band" to "3 tolerances slower" —
 * the same span over which `closeness` decays to zero, so the marker's position on
 * this axis and the number in the ring are the same measurement.
 *
 * The note at the bottom is the reason this feature exists. On a structured
 * session the AVERAGE of four reps can land inside the tolerance halo while not
 * one of the four reps was in band. Without saying so, this axis would quietly
 * contradict the four coloured dots directly below it.
 */
function DeviationAxis({
  actual,
  bandMin,
  bandMax,
  toleranceSec,
  direction,
  noRepOnTarget,
}: {
  actual: number;
  bandMin: number;
  bandMax: number;
  toleranceSec: number;
  direction: ExecutionDirection;
  noRepOnTarget: boolean;
}) {
  const t = useTranslations('execution');
  const span = toleranceSec * ZERO_AT_TOLERANCE_MULTIPLE;
  const lo = bandMin - span;
  const hi = bandMax + span;
  const pos = (pace: number) => ((pace - lo) / (hi - lo)) * 100;
  const clamp = (value: number) => Math.max(1.5, Math.min(98.5, value));

  const markerPct = clamp(pos(actual));
  const insideTolerance = actual >= bandMin - toleranceSec && actual <= bandMax + toleranceSec;
  const color = DIRECTION_COLOR[direction];

  return (
    <div>
      {/* dir="ltr" here too, NOT just on the bar below. Without it an RTL page
          reverses this row and "faster" ends up over the slow end of a bar that
          never reversed — the labels then contradict the marker they explain. */}
      <div dir="ltr" className="mb-2 flex items-center justify-between text-3xs font-bold uppercase tracking-wide text-ink-400">
        <span>{t('axisFaster')}</span>
        <span>{t('axisTarget')}</span>
        <span>{t('axisSlower')}</span>
      </div>

      {/* dir="ltr" so faster is always on the left, whatever the page direction. */}
      <div dir="ltr" className="relative h-9">
        <div className="absolute inset-x-0 top-3 h-3 rounded-full bg-page" />
        {/* The tolerated stretch, then the band itself on top of it. */}
        <div
          className="absolute top-3 h-3 rounded-full"
          style={{
            left: `${pos(bandMin - toleranceSec)}%`,
            width: `${pos(bandMax + toleranceSec) - pos(bandMin - toleranceSec)}%`,
            background: `${DIRECTION_COLOR.on_target}26`,
          }}
        />
        <div
          className="absolute top-3 h-3 rounded-full"
          style={{
            left: `${pos(bandMin)}%`,
            width: `${Math.max(pos(bandMax) - pos(bandMin), 1.5)}%`,
            background: `${DIRECTION_COLOR.on_target}80`,
          }}
        />
        <div
          className="absolute top-0.5 flex flex-col items-center"
          style={{ left: `${markerPct}%`, transform: 'translateX(-50%)' }}
        >
          <span className="text-3xs font-bold tabular-nums" style={{ color }}>{formatPace(actual)}</span>
          <span className="mt-0.5 h-4 w-1.5 rounded-full" style={{ background: color }} />
        </div>
      </div>

      {insideTolerance && noRepOnTarget && (
        <p className="mt-1.5 flex items-start gap-1.5 text-3xs leading-snug text-ink-500">
          <Info className="mt-px h-3 w-3 shrink-0 text-ink-400" />
          {t('axisAverageTrap')}
        </p>
      )}
    </div>
  );
}

// ── Rep-by-rep ──────────────────────────────────────────────────────────────

const CHART_W = 320;
const CHART_H = 120;
const PAD_L = 40;
const PAD_R = 10;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 100;

/**
 * Every graded rep against the band. Faster is UP — the intuition every runner
 * already has — so the y axis is inverted relative to the pace numbers on it.
 */
function RepsChart({
  reps,
  bandMin,
  bandMax,
  toleranceSec,
}: {
  reps: ExecutionRep[];
  bandMin: number;
  bandMax: number;
  toleranceSec: number;
}) {
  const t = useTranslations('execution');
  const paces = reps.map((rep) => rep.actualPace as number);
  const lowest = Math.min(...paces, bandMin - toleranceSec);
  const highest = Math.max(...paces, bandMax + toleranceSec);
  const padding = Math.max((highest - lowest) * 0.15, 4);
  const top = lowest - padding;
  const bottom = highest + padding;

  const y = (pace: number) => PLOT_TOP + ((pace - top) / (bottom - top)) * (PLOT_BOTTOM - PLOT_TOP);
  const step = (CHART_W - PAD_L - PAD_R) / reps.length;
  const x = (index: number) => PAD_L + step * (index + 0.5);

  // The only two paces worth labelling are the band's own edges. Evenly spaced
  // ticks put 3:04 and 3:37 on the axis — paces nobody prescribed — and a dot
  // read against those instead of against the target it was graded on.
  const ticks = bandMin === bandMax ? [bandMin] : [bandMin, bandMax];

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      direction="ltr"
      className="w-full"
      role="img"
      aria-label={t('repsTitle')}
    >
      {/* Label only — the band rect below already draws the line these mark. */}
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD_L - 3} x2={PAD_L} y1={y(tick)} y2={y(tick)} stroke="#C9C9C9" strokeWidth="1" />
          <text x={PAD_L - 6} y={y(tick) + 3} textAnchor="end" fontSize="8" fill={DIRECTION_COLOR.on_target} className="tabular-nums">
            {formatPace(tick)}
          </text>
        </g>
      ))}

      {/* The tolerated stretch, then the coach's band inside it. */}
      <rect
        x={PAD_L}
        y={y(bandMin - toleranceSec)}
        width={CHART_W - PAD_L - PAD_R}
        height={Math.max(y(bandMax + toleranceSec) - y(bandMin - toleranceSec), 1)}
        fill={`${DIRECTION_COLOR.on_target}14`}
      />
      <rect
        x={PAD_L}
        y={y(bandMin)}
        width={CHART_W - PAD_L - PAD_R}
        height={Math.max(y(bandMax) - y(bandMin), 1.5)}
        fill={`${DIRECTION_COLOR.on_target}3D`}
      />
      <text x={CHART_W - PAD_R} y={y(bandMin) - 3} textAnchor="end" fontSize="8" fill={DIRECTION_COLOR.on_target}>
        {t('targetBand')}
      </text>

      {reps.map((rep, index) => {
        const color = PACE_STATUS_COLOR[rep.status];
        const edge = rep.status === 'faster' ? bandMin : rep.status === 'slower' ? bandMax : null;
        return (
          <g key={rep.index}>
            {/* The gap to the nearest band edge, drawn as the distance it is. */}
            {edge != null && (
              <line x1={x(index)} x2={x(index)} y1={y(edge)} y2={y(rep.actualPace as number)} stroke={color} strokeWidth="1.5" strokeOpacity="0.45" />
            )}
            {/* White ring: an on-target dot is green ON the green band, and
                without it the reps that went right were the hardest to see. */}
            <circle cx={x(index)} cy={y(rep.actualPace as number)} r="4.5" fill={color} stroke="#FFFFFF" strokeWidth="1.5" />
            {/* Rep number only. The pace of each dot is on its own row directly
                below the chart; printing it twice, 20px apart, read as noise. */}
            <text x={x(index)} y={CHART_H - 4} textAnchor="middle" fontSize="9" fill="#8A8A8A" className="tabular-nums">
              {index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RepRows({ reps }: { reps: ExecutionRep[] }) {
  const t = useTranslations('execution');
  return (
    <div className="divide-y divide-page">
      {reps.map((rep, index) => {
        const color = PACE_STATUS_COLOR[rep.status];
        const delta = rep.deviation ?? 0;
        return (
          <div key={rep.index} className="flex items-center gap-3 py-2">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-3xs font-bold tabular-nums"
              style={{ background: `${color}1F`, color }}
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-500">
              {/* Localised units, not the literals "km" and "s" these two cells
                  used to hardcode — an English abbreviation next to a table that
                  says ק״מ two rows down reads as an unfinished screen. */}
              {rep.actualDistanceM
                ? <><Num>{(rep.actualDistanceM / 1000).toFixed(2)}</Num> {t('unitKm')}</>
                : rep.label}
            </span>
            <span className="text-sm font-bold tabular-nums" style={{ color }}>
              <Num>{formatPace(rep.actualPace as number)}</Num>
            </span>
            <span className="w-16 shrink-0 text-end text-3xs font-semibold" style={{ color }}>
              {delta === 0
                ? t('repInBand')
                : <><Num>{delta > 0 ? '+' : '−'}{Math.abs(delta)}</Num>{t('unitSec')}</>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── What was measured, and what wasn't ──────────────────────────────────────

function MetricRow({ metric }: { metric: ExecutionMetric }) {
  const t = useTranslations('execution');
  const graded = metric.status !== 'unknown';
  const color = graded
    ? metric.status === 'on_target'
      ? DIRECTION_COLOR.on_target
      : metric.status === 'faster' || metric.status === 'under'
        ? DIRECTION_COLOR.too_fast
        : DIRECTION_COLOR.too_slow
    : '#8A8A8A';

  // `estimated_plan` means adherence.ts INVENTED this target (a duration derived
  // from a distance the coach wrote, say). Printing it in the "planned" column
  // next to a "not measured" chip claimed the plan asked for a number it never
  // did. A pace band flagged `structured_session` is the real thing the coach
  // wrote, though — that one still shows.
  const plannedIsOurs = metric.reason === 'estimated_plan';
  const planned = plannedIsOurs
    ? null
    : metric.key === 'pace'
      ? paceRange(metric.plannedMin, metric.plannedMax)
      : metric.key === 'distance'
        ? kmRange(metric.plannedMin, metric.plannedMax)
        : metric.plannedMin ? formatDuration(metric.plannedMin) : null;
  const actual = metric.actual == null
    ? null
    : metric.key === 'pace'
      ? formatPace(metric.actual)
      : metric.key === 'distance'
        ? (metric.actual / 1000).toFixed(1)
        : formatDuration(metric.actual);
  const unit = metric.key === 'distance' ? t('unitKm') : metric.key === 'pace' ? t('unitPerKm') : null;

  return (
    <div className="flex items-baseline gap-2 py-2">
      <span className="w-16 shrink-0 text-xs font-semibold text-ink-700">
        {t(`metric_${metric.key}` as 'metric_distance')}
      </span>
      <span className="w-24 shrink-0 text-xs text-ink-400">
        {planned ? <><Num>{planned}</Num>{unit && <span className="ms-0.5">{unit}</span>}</> : '—'}
      </span>
      <span className="flex-1 text-sm font-bold" style={{ color }}>
        {/* The unit goes on the actual too, for distance only: "8.0" beside a
            planned "13.6 km" is the one cell in this table that can't be read on
            its own, and it's the cell that carries the whole verdict. A pace and
            a duration announce their own format. */}
        {actual ? (
          <>
            <Num>{actual}</Num>
            {metric.key === 'distance' && unit && <span className="ms-0.5 text-xs font-semibold">{unit}</span>}
          </>
        ) : '—'}
      </span>
      {graded ? (
        <span className="shrink-0 text-3xs font-bold" style={{ color }}>
          {t(`status_${metric.status}` as 'status_on_target')}
        </span>
      ) : (
        // "no comparison", not "not measured": the actual on this row usually WAS
        // measured — 56:40 is a real time — it's the plan side that's missing.
        <span className="shrink-0 rounded-full bg-page px-2 py-0.5 text-3xs font-semibold text-ink-400">
          {t('noComparison')}
        </span>
      )}
    </div>
  );
}

// ── Which evidence this card can show ───────────────────────────────────────

/** The reps the engine was willing to grade — the rest have no pace to plot. */
function gradedRepsOf(verdict: ExecutionVerdict): ExecutionRep[] {
  return verdict.reps.filter((rep) => rep.graded && rep.actualPace != null && rep.status !== 'unknown');
}

/**
 * Whether this card draws the per-km pace chart as its evidence.
 *
 * Only for a continuous run, and only when there is nothing better. A structured
 * session gets `RepsChart`, which answers the same question far more sharply; and
 * a structured session whose reps could NOT be read gets no chart at all, because
 * a kilometre grid laid over reps and recovery jogs is actively misleading — see
 * `isContinuousPlan`, which is where that call is made and explained.
 *
 * A continuous run has no reps to draw. Until now its whole evidence was one
 * average on the deviation axis, so 10 km held steady on target and 10 km that
 * drifted 20 s/km over the last three looked identical on this card.
 *
 * Exported so `ActivityDetailBody` can drop its own copy of the chart instead of
 * showing the same graphic twice on one page: one predicate, both call sites.
 */
export function executionTakesPaceChart(
  verdict: ExecutionVerdict | null,
  splits: Split[] | undefined,
  planned: (PlannedKmPoint | null)[] | null | undefined,
  plannedContinuous: boolean | undefined,
): boolean {
  if (!verdict) return false;
  // An unplanned run has no plan to draw behind the line.
  if (verdict.status === 'unplanned') return false;
  if (!plannedContinuous) return false;
  if (!splits || splits.length < 2) return false;
  // Every bin unmatched means the plan put no pace target on this run's distance;
  // an all-null overlay draws a chart with nothing to compare against.
  if (!planned?.some((point) => point != null)) return false;
  return gradedRepsOf(verdict).length === 0;
}

/**
 * How many kilometres actually sat in the band drawn behind them.
 *
 * The chart is not self-explanatory at a glance: a line that hugs a 10 s/km band
 * over an 85 s/km axis looks like it is "roughly there" whether it was in or out.
 * Counting says which — and it is what makes the chart evidence rather than
 * decoration. Judged against the same ±tolerance the rest of the card uses, so a
 * kilometre one second outside the band is not called a miss.
 */
function tallyKmInBand(
  splits: Split[],
  planned: (PlannedKmPoint | null)[],
  toleranceSec: number,
): { inBand: number; graded: number } {
  let inBand = 0;
  let graded = 0;
  planned.forEach((point, index) => {
    const pace = splits[index]?.averagePace;
    if (point == null || pace == null) return;
    graded += 1;
    if (pace >= point.min - toleranceSec && pace <= point.max + toleranceSec) inBand += 1;
  });
  return { inBand, graded };
}

// ── The section ─────────────────────────────────────────────────────────────

export function ExecutionQuality({
  verdict,
  splits,
  planned,
  plannedContinuous,
  loading = false,
  className,
}: {
  verdict: ExecutionVerdict | null;
  /** Per-km splits, for the pace chart. Absent on the feed, present on a run. */
  splits?: Split[];
  /** The plan projected onto those same bins by `projectBandsToBins`. */
  planned?: (PlannedKmPoint | null)[] | null;
  /** Whether that plan is one unbroken stretch — see `executionTakesPaceChart`. */
  plannedContinuous?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const t = useTranslations('execution');

  // Nothing to say and nothing to apologise for: the run simply isn't graded
  // yet. Renders no empty frame at all rather than a card that says "loading".
  if (!verdict && !loading) return null;

  if (!verdict) {
    return (
      <div className={cn('rounded-card border border-page bg-card p-4', className)}>
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-page" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-page" />
            <div className="h-3 w-40 animate-pulse rounded bg-page" />
          </div>
        </div>
      </div>
    );
  }

  const showKmChart = executionTakesPaceChart(verdict, splits, planned, plannedContinuous);
  const kmTally = showKmChart && splits && planned
    ? tallyKmInBand(splits, planned, verdict.toleranceSec)
    : null;
  const kmChart = showKmChart && splits ? (
    <>
      <PaceChart splits={splits} planned={planned ?? undefined} />
      <p className="mt-1 text-3xs leading-snug text-ink-400">
        {kmTally && kmTally.graded > 0
          ? t('kmSummary', { inBand: kmTally.inBand, graded: kmTally.graded })
          : t('kmChartNote')}
      </p>
      {/* The reason this chart is worth the space. A whole-run average of 5:02
          lands inside a 4:50–5:00 band's tolerance, so the ring reads 100% for a
          run whose last four kilometres were 6–16 s/km slow. Same trap the axis
          note warns about on a structured session, on a run with no reps to
          count — and without saying it, the ring and the chart directly
          contradict each other with nothing to say which to believe. */}
      {verdict.direction === 'on_target' && kmTally != null && kmTally.inBand < kmTally.graded && (
        <p className="mt-1.5 flex items-start gap-1.5 text-3xs leading-snug text-ink-500">
          <Info className="mt-px h-3 w-3 shrink-0 text-ink-400" />
          {t('kmAverageTrap')}
        </p>
      )}
    </>
  ) : null;

  // A session the engine won't score, with nothing else worth reporting. Says so
  // plainly instead of showing an empty ring and three grey rows — a percentage
  // withheld without a reason reads as a broken feature.
  // (A run that also went long or short keeps the full section below: the ring
  // dashes out, but "you ran 8 of 13.6 km" is still true and worth saying.)
  if (verdict.status === 'ungraded' && verdict.direction === 'unknown') {
    return (
      <div className={cn('rounded-card border border-page bg-card p-4', className)}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page">
            <AlertCircle className="h-4 w-4 text-ink-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-700">{t('ungradedTitle')}</p>
            {/* Two different reasons wear the same "no score" hat, and blaming the
                watch for the wrong one is a lie the athlete can check: a plan that
                asked for three different paces has no single average to grade, and
                its laps were never the problem. */}
            <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
              {t(kmChart ? 'ungradedVariableBody' : 'ungradedBody')}
            </p>
          </div>
        </div>
        {/* No number, but not nothing: the kilometres are still evidence, and this
            state used to end the page with an apology and a blank. */}
        {kmChart && <div className="mt-4 border-t border-page pt-4">{kmChart}</div>}
      </div>
    );
  }

  // A run with no planned workout behind it. Its own answer, not a 0% — the
  // academy screens used to drop these, which made an athlete's extra easy run
  // read as a missed session.
  if (verdict.status === 'unplanned') {
    return (
      <div className={cn('rounded-card border border-page bg-card p-4', className)}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page">
            <Target className="h-4 w-4 text-ink-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-700">{t('unplannedTitle')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{t('unplannedBody')}</p>
          </div>
        </div>
      </div>
    );
  }

  const gradedReps = gradedRepsOf(verdict);
  const hasBand = verdict.paceBandMin != null && verdict.paceBandMax != null;
  const paceMetric = verdict.metrics.find((metric) => metric.key === 'pace');
  const averagePace = gradedReps.length
    ? Math.round(gradedReps.reduce((sum, rep) => sum + (rep.actualPace as number), 0) / gradedReps.length)
    : paceMetric?.actual ?? null;
  const color = DIRECTION_COLOR[verdict.direction];

  /**
   * Whether plotting that pace against the coach's band is a fair comparison.
   *
   * It is for the mean of the graded reps, and for a continuous run whose
   * whole-run average `adherence.ts` was willing to grade. It is NOT for a
   * structured session's whole-run average, which includes the warmup, the
   * recoveries and the cooldown: on a 4x2000 that average is minutes per km
   * slower than the work band, so the axis pinned the marker at the far slow end
   * of a run whose reps may have been perfect — the exact comparison the engine
   * declines to make (`reason: 'structured_session'`), drawn as the biggest
   * graphic on the card, and coloured by a direction that came from elsewhere.
   */
  const paceComparable = gradedReps.length > 0
    || (paceMetric != null && paceMetric.status !== 'unknown');

  return (
    <div className={cn('overflow-hidden rounded-card border border-page bg-card', className)}>
      {/* A hairline in the verdict's colour, so the answer is legible before a
          single word is read — including from a card peeking above the fold. */}
      <div className="h-1" style={{ background: color }} />

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-3xs font-bold uppercase tracking-wide text-ink-400">{t('title')}</p>
            {/* One statement of the verdict, not two: the coloured hairline above,
                this coloured headline and the ring already say it three ways. A
                chip repeating these exact words sat directly under them. */}
            <h3 className="mt-1.5 text-xl font-black leading-tight" style={{ color }}>
              {t(`dir_${verdict.direction}` as 'dir_on_target')}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">{verdictDetail(verdict, t)}</p>
            {verdict.workoutName && (
              <p className="mt-1.5 truncate text-xs text-ink-400">{verdict.workoutName}</p>
            )}
          </div>
          <ExecutionRing
            score={verdict.score}
            direction={verdict.direction}
            size={104}
            caption={t('accuracyShort')}
            // Not `score ?? 0`: a withheld score is not a zero, and announcing
            // "accuracy 0 percent" is the same false number the ring is dashed
            // out precisely to avoid.
            ariaLabel={verdict.score == null
              ? t('ringLabelUngraded')
              : t('ringLabel', { score: verdict.score })}
          />
        </div>

        {averagePace != null && hasBand && paceComparable && (
          <div className="mt-5 border-t border-page pt-4">
            <DeviationAxis
              actual={averagePace}
              bandMin={verdict.paceBandMin as number}
              bandMax={verdict.paceBandMax as number}
              toleranceSec={verdict.toleranceSec}
              direction={verdict.direction}
              noRepOnTarget={gradedReps.length > 0 && verdict.repCounts.onTarget === 0}
            />
          </div>
        )}

        {gradedReps.length > 0 && hasBand ? (
          <div className="mt-5 border-t border-page pt-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="text-xs font-bold text-ink-700">{t('repsTitle')}</p>
              <p className="text-3xs text-ink-400">
                {t('repSummary', { onTarget: verdict.repCounts.onTarget, graded: gradedReps.length })}
              </p>
            </div>
            <p className="mb-2 text-3xs text-ink-400">
              {t('repsTargetLabel')} <Num>{paceRange(verdict.paceBandMin, verdict.paceBandMax)}</Num> {t('unitPerKm')}
            </p>
            <RepsChart
              reps={gradedReps}
              bandMin={verdict.paceBandMin as number}
              bandMax={verdict.paceBandMax as number}
              toleranceSec={verdict.toleranceSec}
            />
            <div className="mt-2">
              <RepRows reps={gradedReps} />
            </div>
          </div>
        ) : kmChart ? (
          // No heading above it: the chart draws its own, and a second one saying
          // the same words would be the third label on one graphic.
          <div className="mt-5 border-t border-page pt-4">{kmChart}</div>
        ) : verdict.repsReason ? (
          <p className="mt-4 flex items-start gap-1.5 border-t border-page pt-4 text-3xs leading-snug text-ink-400">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            {t('repsUnavailable')}
          </p>
        ) : null}

        <div className="mt-5 border-t border-page pt-4">
          <p className="mb-1 text-xs font-bold text-ink-700">{t('measuredTitle')}</p>
          <div className="mb-1 flex items-baseline gap-2 text-3xs font-bold uppercase tracking-wide text-ink-400">
            <span className="w-16 shrink-0" />
            <span className="w-24 shrink-0">{t('colPlanned')}</span>
            <span className="flex-1">{t('colActual')}</span>
          </div>
          <div className="divide-y divide-page">
            {verdict.metrics.map((metric) => (
              <MetricRow key={metric.key} metric={metric} />
            ))}
          </div>
          {/* The reasons, once, under the rows they belong to — a grey cell with
              no explanation is the thing that reads as a broken feature. */}
          {verdict.metrics.some((metric) => metric.reason) && (
            <ul className="mt-2 space-y-1">
              {verdict.metrics
                .filter((metric) => metric.reason)
                .map((metric) => (
                  <li key={metric.key} className="flex items-start gap-1.5 text-3xs leading-snug text-ink-400">
                    <Info className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      <span className="font-semibold">{t(`metric_${metric.key}` as 'metric_distance')}</span>
                      {' — '}
                      {t(`reason_${metric.reason}` as 'reason_no_data')}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {verdict.basis && (
            <p className="mt-3 rounded-xl bg-page/70 px-3 py-2 text-3xs leading-snug text-ink-500">
              {t(`basis_${verdict.basis}` as 'basis_metrics')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
