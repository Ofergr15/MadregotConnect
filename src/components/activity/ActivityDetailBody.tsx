'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, RefreshCw, Sparkles } from 'lucide-react';
import { PlannedKmPoint } from '@/lib/academy/segments';
import { displaySplits } from '@/lib/activities/km-splits';
import type { ExecutionVerdict } from '@/lib/plan-execution/verdict';
import { cn } from '@/lib/utils';
import { RunFeedback } from '@/components/academy/RunFeedback';
import { ExecutionQuality } from './ExecutionQuality';
import { DEFAULT_MAX_HR, formatDuration, formatPace, getHRZone, strideMeters } from './format';
import { RouteMap } from './RouteMap';
import { BestEfforts, Conditions, Times, KmSplitsList, PaceHrScatter, RecoveryChart, RepsDetail, TechniqueChart, WorkoutCard, ZoneBars, useRunAnalysis } from './RunAnalysis';
import { RunCharts, type RunPhase } from './RunCharts';
import { HrZones, KmSplits, Laps, Section, StatGrid, lapsAreKm, type StatCell } from './RunSections';
import { minutesSinceEnd, STREAM_WAIT_MIN, useActivityStream } from './useActivityStream';
import { MetricCards, RepsVsTarget } from './MetricCards';
import type { ActivityDetailsData, ActivityEntry } from './types';

/**
 * Everything below the headline for a single run: route map, key stats, the
 * performance grid, the three charts, the splits table.
 *
 * Shared by the feed card's expanded state and the standalone activity page, so
 * "open a workout" shows the same thing wherever it's opened from. The caller
 * owns the fetch (see `useActivityDetails`) and passes the result in.
 */
export function ActivityDetailBody({
  activity,
  details,
  loading = false,
  planned,
  plannedContinuous = false,
  verdict = null,
  loadingVerdict = false,
  mapOnly = false,
  renderMap,
  className,
}: {
  activity: ActivityEntry;
  details: ActivityDetailsData | null;
  loading?: boolean;
  planned?: (PlannedKmPoint | null)[] | null;
  /** Whether that plan is one unbroken stretch — see `executionTakesPaceChart`. */
  plannedContinuous?: boolean;
  /**
   * The day's plan graded against this run. Passed in rather than fetched here:
   * it arrives on the same request as `planned` (`?bands=1&verdict=1`), because
   * the bands and the score are two readings of one plan lookup and asking twice
   * was two round trips to render one card. Null → the card renders nothing,
   * which is also what a viewer who may not read this person's score gets.
   */
  verdict?: ExecutionVerdict | null;
  /** That request still in flight — the card holds its height instead of popping in. */
  loadingVerdict?: boolean;
  /**
   * The trainee screen 5's "מפה וגרף": the map, the headline numbers and the pace and HR
   * graphs, nothing that grades the run (screen 5 already did, in its own terms).
   */
  mapOnly?: boolean;
  /**
   * The run page draws the map itself, edge-to-edge above the title — it hands
   * this a slot and gets the map (with the chart cursor wired in) back.
   */
  renderMap?: (map: React.ReactNode) => React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('activities');
  const tr = useTranslations('runPage');
  const hero = !!renderMap;

  // The row the fetch returned is the same row, only wider (perceived effort,
  // shoe, cadence) — let it fill in whatever the caller's copy lacks.
  const act: ActivityEntry = details?.activity ? { ...activity, ...details.activity } : activity;

  const distKm = (act.distance / 1000).toFixed(2);
  const paceStr = act.average_pace ? formatPace(act.average_pace) : null;
  const durationStr = formatDuration(act.duration);
  const movingStr = act.moving_duration ? formatDuration(act.moving_duration) : null;

  // Zones against the club-wide 190, but never below what the run itself
  // recorded: a max of 196 is proof the ceiling is low for this athlete, so it
  // lifts the top of the scale instead of pinning the whole run into zone 5.
  const maxHR = Math.max(DEFAULT_MAX_HR, act.max_hr ?? 0);
  const hrZone = act.average_hr ? getHRZone(act.average_hr, maxHR) : null;

  // The row already holds the laps, so the kilometres are drawable before the
  // details request lands — and still drawable if it fails. Through the same
  // binning the server does, or the two paints disagree: the row's raw `laps` are
  // per workout STEP, and rendering them as splits is the 31-kilometre 15 km run.
  const splits = details?.splits || displaySplits(act.splits, act.laps);
  // Prefer the route stored at sync time (instant, reliable); fall back to the
  // live-fetched points for activities synced before GPS was persisted.
  const routePoints = (act.gps_points && act.gps_points.length > 0)
    ? act.gps_points
    : (details?.gpsPoints || []);
  // A stored empty array means we confirmed there's no GPS (indoor/treadmill).
  const knownNoRoute = Array.isArray(act.gps_points) && act.gps_points.length === 0;

  const cadence = act.avg_cadence || details?.summary?.averageRunCadence;
  // One reader for every scale the column has been written in — see `strideMeters`.
  const stride = strideMeters(act.avg_stride_length) ?? strideMeters(details?.summary?.strideLength);
  const vo2 = act.vo2max || details?.summary?.vO2MaxValue;
  const calories = act.calories || details?.summary?.calories;
  // Perceived effort lives on the activity row (migration 026) — the Garmin-era
  // `summary` is only a fallback for rows synced before that.
  const rpe = act.perceived_rpe ?? details?.summary?.perceivedRpe ?? null;
  const feel = act.perceived_feel ?? details?.summary?.perceivedFeel ?? null;

  // The 1 Hz trace, when the run has one. Everything below draws from it first and
  // from the splits otherwise.
  const ago = minutesSinceEnd(act.start_time, act.duration);
  const { data: trace } = useActivityStream(act.id, ago != null && ago >= -5 && ago < STREAM_WAIT_MIN);
  // The workout the watch ran, the efforts, the weather — /api/activities/analysis (RunAnalysis.tsx).
  const { data: an, mutate: reAnalyse } = useRunAnalysis(mapOnly ? null : act.id);
  // Read again once a late trace lands: the efforts, recoveries and cadence come from it.
  const traced = !!trace?.stream;
  useEffect(() => { if (traced && an && !an.recovery?.length && !an.efforts?.length) void reAnalyse(); }, [traced]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the trace lands
  const repBands = useMemo(() => {
    const v = trace?.stream; const w = an?.workout;
    if (!v || !w) return null;
    const kmAt = (sec: number) => { const i = v.t.findIndex((x) => x >= sec); return i < 0 ? v.d[v.d.length - 1] : v.d[i]; };
    return w.reps.map((r) => ({ fromKm: kmAt(r.start), toKm: kmAt(r.start + r.seconds), fromSec: r.start, toSec: r.start + r.seconds }));
  }, [trace?.stream, an?.workout]);
  const watchLaps = trace?.laps && trace.laps.length > 1 && !lapsAreKm(trace.laps) ? trace.laps : null;
  const [cursor, setCursor] = useState<number | null>(null);

  // The workout's parts along the run, for the strip above the charts: what came before the
  // reps, the reps, what came after (only when the watch ran a workout with reps).
  const phases = useMemo<RunPhase[] | null>(() => {
    const target = details?.repTarget;
    const lapsAll = (trace?.laps ?? (act.laps as Array<{ distance: number; duration: number }> | null)) || [];
    if (!target || lapsAll.length < 4) return null;
    const isRep = (l: { distance: number }) => Math.abs(l.distance - target.meters) <= Math.max(15, target.meters * 0.08);
    const first = lapsAll.findIndex(isRep);
    let last = -1;
    lapsAll.forEach((l, i) => { if (isRep(l)) last = i; });
    if (first < 0 || last <= first) return null;
    // A recovery after the last rep belongs to the reps.
    if (last + 1 < lapsAll.length && lapsAll[last + 1].distance < target.meters) last += 1;
    const km = (n: number) => lapsAll.slice(0, n).reduce((a, l) => a + l.distance, 0) / 1000;
    const out: RunPhase[] = [];
    if (first > 0) out.push({ from: 0, to: km(first), label: tr('phaseSteady'), kind: 'steady' });
    out.push({ from: km(first), to: km(last + 1), label: `${target.reps}×${target.meters}`, kind: 'reps' });
    if (last + 1 < lapsAll.length) out.push({ from: km(last + 1), to: km(lapsAll.length), label: tr('phaseCool'), kind: 'easy' });
    return out;
  }, [details?.repTarget, trace?.laps, act.laps, tr]);

  const cells: StatCell[] = [
    { label: t('distance'), value: distKm, unit: tr('unitKm') },
    { label: tr('avgPaceLabel'), value: paceStr, unit: tr('unitPerKm') },
    { label: tr('movingTime'), value: movingStr || durationStr },
    { label: t('elevation'), value: act.elevation_gain ? String(Math.round(act.elevation_gain)) : null, unit: tr('m') },
    { label: t('avgHrShort'), value: act.average_hr ? String(Math.round(act.average_hr)) : null, unit: hrZone ? `Z${hrZone.zone}` : undefined },
    { label: t('caloriesLabel'), value: calories ? Number(calories).toLocaleString('en') : null },
  ];
  const more: StatCell[] = [
    { label: t('cadence'), value: cadence ? String(Math.round(cadence)) : null, unit: t('unitStepsPerMin') },
    { label: t('stride'), value: stride ? stride.toFixed(2) : null, unit: tr('m') },
    { label: t('maxHr'), value: act.max_hr ? String(Math.round(act.max_hr)) : null },
    { label: t('vo2max'), value: vo2 ? String(vo2) : null },
    { label: tr('totalTime'), value: movingStr && movingStr !== durationStr ? durationStr : null },
    { label: t('laps'), value: act.lap_count ? String(act.lap_count) : null },
    {
      label: t('trainingEffect'),
      value: details?.summary?.trainingEffect
        ? `${details.summary.trainingEffect.toFixed(1)}${details.summary.anaerobicTrainingEffect ? ` / ${details.summary.anaerobicTrainingEffect.toFixed(1)}` : ''}`
        : null,
    },
    { label: t('shoe'), value: act.shoe_name || null },
    {
      label: t('selfEval'),
      value: rpe != null || feel != null
        ? `${rpe != null ? `${rpe.toFixed(0)}/10` : ''}${feel != null ? ` ${['😣', '😕', '😐', '🙂', '😄'][Math.round(feel)] ?? ''}` : ''}`.trim()
        : null,
    },
  ];

  const map = routePoints.length > 2 ? (
    <RouteMap points={routePoints} height={hero ? 420 : 280} splits={splits} variant={hero ? 'hero' : 'card'} cursor={cursor} />
  ) : null;

  return (
    <div className={cn('space-y-3', className)}>
      {/* The page puts the map edge-to-edge above everything (`renderMap`); the
          activities list, which expands this inline, gets it here. */}
      {renderMap ? renderMap(map) : map ? (
        <div className="overflow-hidden rounded-card border border-page">{map}</div>
      ) : (!loading && (knownNoRoute || details)) ? (
        <div className="rounded-card border border-page bg-card py-5 text-center">
          <MapPin className="mx-auto mb-1 h-5 w-5 text-ink-400" />
          <p className="text-xs text-ink-400">{t('noRoute')}</p>
        </div>
      ) : null}

      {/* Elsewhere the grid of numbers; on the run page those are over the map and the
          rest are cards at the end of the page (mockup run-page-b). */}
      {!(hero && !mapOnly) && (
        <Section>
          <StatGrid cells={cells} more={mapOnly ? undefined : more} />
        </Section>
      )}

      {/* Was this the workout that was asked for — as ONE row. The full breakdown
          (axis, reps, measured table) is a tap away instead of ~900px above the
          charts. Renders nothing for a viewer who may not read this score. */}
      {/* #136, the same three for every source (2026-10-21): total = start to finish
          (Garmin elapsedDuration / Strava elapsed_time; the trace's last second for a row
          synced before 166), moving = Garmin's movingDuration / Strava's moving_time — the
          "Moving Time" both apps show — and stopped is the gap. The net used to be the
          watch's TIMER on a Garmin run (1:50:52 on the 10 × 1600 of 10-20, where Garmin
          and Strava say 1:49) and the moving time on a Strava one. The timer is Garmin's
          headline "Time", so it stays, as a line under them. */}
      {!mapOnly && <Times
        total={act.elapsed_duration ?? Math.max(act.duration || 0, trace?.stream?.t.at(-1) ?? 0)}
        moving={act.moving_duration ?? act.duration ?? null}
        timer={act.duration ?? null} />}
      {!mapOnly && an?.conditions && <Conditions c={an.conditions} />}

      {/* The watch ran a workout with reps: that IS the plan against execution (RunAnalysis). */}
      {!mapOnly && an?.workout ? <WorkoutCard a={an} /> : !mapOnly && (
        <ExecutionQuality
          verdict={verdict}
          splits={splits}
          planned={planned}
          plannedContinuous={plannedContinuous}
          loading={loadingVerdict}
          collapsible
        />
      )}

      {/* What a person said about it, directly under the machine's reading. */}
      {!mapOnly && <RunFeedback athleteId={act.athlete_id} startTime={act.start_time} />}

      {loading && !details && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-ink-400" />
          <span className="ms-2 text-sm text-ink-400">{t('detailLoading')}</span>
        </div>
      )}

      {(trace?.stream || splits.length >= 2) && (
        <Section title={tr('analysisTitle')}>
          <RunCharts
            view={trace?.stream ?? null}
            splits={splits}
            avgPace={act.average_pace}
            avgHr={act.average_hr}
            elevationGain={act.elevation_gain}
            maxHr={trace?.maxHr ?? maxHR}
            onCursor={setCursor}
            planned={planned ?? null}
            phases={phases}
            bands={repBands}
          />
          {trace && !trace.hrVisible && <p className="mt-2 text-2xs text-ink-400">{tr('hrHidden')}</p>}
        </Section>
      )}

      {/* The reps against this runner's target pace, when the watch ran a workout with reps. */}
      {!mapOnly && trace?.kmSplits && trace.kmSplits.length > 1 && <KmSplitsList splits={trace.kmSplits} maxHr={trace.maxHr ?? maxHR} />}
      {!mapOnly && an && <BestEfforts a={an} />}
      {!mapOnly && trace?.zones && <ZoneBars seconds={trace.zones} maxHr={trace.maxHr ?? maxHR} />}
      {!mapOnly && an?.workout && <RepsDetail w={an.workout} maxHr={trace?.maxHr ?? maxHR} />}
      {!mapOnly && an && <RecoveryChart items={an.recovery} />}
      {!mapOnly && an && <TechniqueChart items={an.technique} />}
      {!mapOnly && trace?.stream && an?.workout && <PaceHrScatter view={trace.stream} bands={an.workout.reps.map((r) => [r.start, r.start + r.seconds] as [number, number])} />}
      {!mapOnly && !an?.workout && details?.repTarget && !!(trace?.laps || act.laps) && (
        <Section title={tr('repsVsTarget', { n: details.repTarget.reps })}>
          <RepsVsTarget laps={(trace?.laps ?? (act.laps as Array<{ distance: number; duration: number }>)) || []} target={details.repTarget} />
        </Section>
      )}
      {!mapOnly && !an?.workout && watchLaps && <Laps laps={watchLaps} />}
      {!mapOnly && !(trace?.kmSplits && trace.kmSplits.length > 1) && <KmSplits streamKm={trace?.kmSplits ?? null} splits={splits} maxHr={trace?.maxHr ?? maxHR} />}
      {hero && !mapOnly && (
        <Section title={tr('moreMetrics')}>
          <MetricCards m={{
            vo2: vo2 ? Number(vo2) : null, rpe, avgHr: act.average_hr ?? null, maxHr: act.max_hr ?? null, hrCeiling: maxHR,
            cadence: cadence ? Number(cadence) : null, stride: stride ?? null,
            moving: act.elapsed_duration ? act.duration : act.moving_duration ?? null, total: act.elapsed_duration ?? act.duration, elevation: act.elevation_gain ?? null,
            calories: calories ? Number(calories) : null, distanceKm: act.distance / 1000,
          }} />
        </Section>
      )}

      {/* Nothing but the headline numbers exist for this run. Say so, rather than
          ending on an empty stretch of page that reads as a loading failure. */}
      {!mapOnly && !loading && details && splits.length === 0 && !trace?.stream && routePoints.length <= 2 && (
        <div className="rounded-card border border-page bg-card py-6 text-center">
          <Sparkles className="mx-auto mb-1 h-5 w-5 text-ink-400" />
          <p className="text-xs text-ink-400">{t('noSplits')}</p>
        </div>
      )}
    </div>
  );
}
