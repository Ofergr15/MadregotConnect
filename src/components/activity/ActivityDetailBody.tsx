'use client';

import { useTranslations } from 'next-intl';
import {
  Activity, Flame, Footprints, Gauge, Heart, MapPin, Mountain,
  RefreshCw, Sparkles, TrendingUp, Zap,
} from 'lucide-react';
import { PlannedKmPoint } from '@/lib/academy/segments';
import { cn } from '@/lib/utils';
import { ElevationChart, HRChart, PaceChart } from './charts';
import { useExecutionVerdict } from './execution-context';
import { ExecutionQuality } from './ExecutionQuality';
import { DEFAULT_MAX_HR, formatDuration, formatPace, getHRZone } from './format';
import { RouteMap } from './RouteMap';
import { SplitsTable } from './SplitsTable';
import type { ActivityDetailsData, ActivityEntry } from './types';

/** One tile in the performance grid — same box six different stats sat in. */
function StatTile({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-page/50 rounded-xl p-4 border border-page/20">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <p className="text-3xs font-bold uppercase text-ink-400">{label}</p>
      </div>
      {children}
    </div>
  );
}

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
  canSeeExecution = false,
  className,
}: {
  activity: ActivityEntry;
  details: ActivityDetailsData | null;
  loading?: boolean;
  planned?: (PlannedKmPoint | null)[] | null;
  /**
   * Whether to show the plan-vs-execution grade: the athlete themselves, or
   * staff. The caller decides because only the caller knows who's looking; the
   * API enforces the same rule, so a false here costs a fetch, not a leak.
   */
  canSeeExecution?: boolean;
  className?: string;
}) {
  const t = useTranslations('activities');

  const { verdict, loading: loadingVerdict } = useExecutionVerdict(activity.id, {
    enabled: canSeeExecution,
    // Per-rep verdicts need the watch's laps, which THIS screen's details fetch
    // is what caches. So ask again once it lands and the rep-by-rep breakdown
    // fills in on this visit instead of the next one.
    revision: details ? 1 : 0,
  });

  // The row the fetch returned is the same row, only wider (perceived effort,
  // shoe, cadence) — let it fill in whatever the caller's copy lacks.
  const act: ActivityEntry = details?.activity ? { ...activity, ...details.activity } : activity;

  const distKm = (act.distance / 1000).toFixed(1);
  const paceStr = act.average_pace ? formatPace(act.average_pace) : null;
  const durationStr = formatDuration(act.duration);
  const movingStr = act.moving_duration ? formatDuration(act.moving_duration) : null;

  // Zones against the club-wide 190, but never below what the run itself
  // recorded: a max of 196 is proof the ceiling is low for this athlete, so it
  // lifts the top of the scale instead of pinning the whole run into zone 5.
  const maxHR = Math.max(DEFAULT_MAX_HR, act.max_hr ?? 0);
  const hrZone = act.average_hr ? getHRZone(act.average_hr, maxHR) : null;

  const splits = details?.splits || act.splits || [];
  // Prefer the route stored at sync time (instant, reliable); fall back to the
  // live-fetched points for activities synced before GPS was persisted.
  const routePoints = (act.gps_points && act.gps_points.length > 0)
    ? act.gps_points
    : (details?.gpsPoints || []);
  // A stored empty array means we confirmed there's no GPS (indoor/treadmill).
  const knownNoRoute = Array.isArray(act.gps_points) && act.gps_points.length === 0;

  const cadence = act.avg_cadence || details?.summary?.averageRunCadence;
  const strideRaw = act.avg_stride_length;
  const strideStr = strideRaw
    // Garmin reports stride in cm on some rows, meters on others.
    ? (strideRaw > 10 ? (strideRaw / 100).toFixed(2) : strideRaw.toFixed(2))
    : details?.summary?.strideLength?.toFixed(2);
  const vo2 = act.vo2max || details?.summary?.vO2MaxValue;
  const calories = act.calories || details?.summary?.calories;
  // Perceived effort lives on the activity row (migration 026) — the Garmin-era
  // `summary` is only a fallback for rows synced before that.
  const rpe = act.perceived_rpe ?? details?.summary?.perceivedRpe ?? null;
  const feel = act.perceived_feel ?? details?.summary?.perceivedFeel ?? null;

  return (
    <div className={cn('space-y-5', className)}>
      {/* First, before the map and the numbers: was this the workout that was
          asked for? Everything below is the evidence for that answer. */}
      <ExecutionQuality verdict={verdict} loading={loadingVerdict} />

      {loading && !details && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 text-ink-400 animate-spin" />
          <span className="text-sm text-ink-400 ms-2">{t('detailLoading')}</span>
        </div>
      )}

      {/* Map — stored route if available, else live-fetched */}
      {routePoints.length > 2 ? (
        <div className="rounded-xl overflow-hidden border border-page/30">
          <RouteMap points={routePoints} height={300} splits={splits} />
        </div>
      ) : (!loading && (knownNoRoute || details)) ? (
        <div className="rounded-card border border-page/30 bg-card/40 py-6 text-center">
          <MapPin className="h-5 w-5 text-ink-400 mx-auto mb-1" />
          <p className="text-xs text-ink-400">{t('noRoute')}</p>
        </div>
      ) : null}

      {/* Key Stats Banner */}
      <div className="bg-gradient-to-br from-card/60 to-page/60 rounded-xl p-5 border border-page/30">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-ink-400 mb-1">{t('distance')}</p>
            <p className="text-3xl font-black text-ink-700 tabular-nums">{distKm}<span className="text-sm text-ink-400 ms-1">km</span></p>
          </div>
          <div>
            <p className="text-xs text-ink-400 mb-1">{t('pace')}</p>
            <p className="text-3xl font-black text-ink-700 tabular-nums">{paceStr || '—'}<span className="text-sm text-ink-400 ms-1">/km</span></p>
          </div>
          <div>
            <p className="text-xs text-ink-400 mb-1">{t('duration')}</p>
            <p className="text-3xl font-black text-ink-700 tabular-nums">{durationStr}</p>
            {movingStr && movingStr !== durationStr && (
              <p className="text-3xs text-ink-400 mt-0.5">{movingStr} {t('movingSuffix')}</p>
            )}
          </div>
          {/* Avg HR and elevation used to be desktop-only here. On a phone — where
              the feed is actually read — that dropped two of the five headline
              numbers, so they wrap into the grid instead of disappearing. */}
          {act.average_hr && (
            <div>
              <p className="text-xs text-ink-400 mb-1">{t('avgHrShort')}</p>
              <p className={cn('text-3xl font-black tabular-nums', hrZone?.color)}>{act.average_hr}</p>
              {hrZone && <p className="text-3xs text-ink-400 mt-0.5">{t('zone')} {hrZone.zone} · {t(`hrZone${hrZone.zone}` as 'hrZone1')}</p>}
            </div>
          )}
          {act.elevation_gain ? (
            <div>
              <p className="text-xs text-ink-400 mb-1">{t('elevation')}</p>
              <p className="text-3xl font-black text-ink-700 tabular-nums">{Math.round(act.elevation_gain)}<span className="text-sm text-ink-400 ms-1">m</span></p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Performance Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {calories ? (
          <StatTile icon={<Flame className="h-3.5 w-3.5 text-band-3" />} label={t('caloriesLabel')}>
            <p className="text-2xl font-black text-ink-700 tabular-nums">{calories}</p>
            <p className="text-3xs text-ink-400 mt-0.5">{t('unitKcal')}</p>
          </StatTile>
        ) : null}
        {cadence ? (
          <StatTile icon={<Footprints className="h-3.5 w-3.5 text-band-2" />} label={t('cadence')}>
            <p className="text-2xl font-black text-ink-700 tabular-nums">{Math.round(cadence)}</p>
            <p className="text-3xs text-ink-400 mt-0.5">{t('unitStepsPerMin')}</p>
          </StatTile>
        ) : null}
        {strideStr ? (
          <StatTile icon={<TrendingUp className="h-3.5 w-3.5 text-purple-600" />} label={t('stride')}>
            <p className="text-2xl font-black text-ink-700 tabular-nums">{strideStr}</p>
            <p className="text-3xs text-ink-400 mt-0.5">{t('unitMeters')}</p>
          </StatTile>
        ) : null}
        {vo2 ? (
          <StatTile icon={<Zap className="h-3.5 w-3.5 text-band-3" />} label={t('vo2max')}>
            <p className="text-2xl font-black text-ink-700 tabular-nums">{vo2}</p>
            <p className="text-3xs text-ink-400 mt-0.5">{t('unitVo2')}</p>
          </StatTile>
        ) : null}
        {act.max_hr ? (
          <StatTile icon={<Heart className="h-3.5 w-3.5 text-accent-red" />} label={t('maxHr')}>
            <p className="text-2xl font-black text-ink-700 tabular-nums">{act.max_hr}</p>
            <p className="text-3xs text-ink-400 mt-0.5">{t('bpm')}</p>
          </StatTile>
        ) : null}
        {act.lap_count ? (
          <StatTile icon={<Activity className="h-3.5 w-3.5 text-band-2" />} label={t('laps')}>
            <p className="text-2xl font-black text-ink-700 tabular-nums">{act.lap_count}</p>
            <p className="text-3xs text-ink-400 mt-0.5">{t('lapsRecorded')}</p>
          </StatTile>
        ) : null}
        {details?.summary?.trainingEffect ? (
          <StatTile icon={<Activity className="h-3.5 w-3.5 text-band-2" />} label={t('trainingEffect')}>
            <div className="flex items-baseline gap-3">
              <div>
                <p className="text-xl font-black text-band-2 tabular-nums">{details.summary.trainingEffect.toFixed(1)}</p>
                <p className="text-3xs text-ink-400">{t('aerobic')}</p>
              </div>
              {details.summary.anaerobicTrainingEffect && (
                <div>
                  <p className="text-xl font-black text-band-3 tabular-nums">{details.summary.anaerobicTrainingEffect.toFixed(1)}</p>
                  <p className="text-3xs text-ink-400">{t('anaerobic')}</p>
                </div>
              )}
            </div>
          </StatTile>
        ) : null}
        {act.shoe_name ? (
          <StatTile icon={<Footprints className="h-3.5 w-3.5 text-ink-500" />} label={t('shoe')}>
            <p className="text-base font-bold text-ink-700 leading-tight">{act.shoe_name}</p>
          </StatTile>
        ) : null}
        {(rpe != null || feel != null) && (
          <StatTile icon={<Gauge className="h-3.5 w-3.5 text-brand-600" />} label={t('selfEval')}>
            <div className="flex items-baseline gap-3">
              {rpe != null && (
                <div>
                  <p className="text-xl font-black text-brand-600 tabular-nums">{rpe.toFixed(0)}<span className="text-xs text-ink-400">/10</span></p>
                  <p className="text-3xs text-ink-400">{t('effort')}</p>
                </div>
              )}
              {feel != null && (
                <div>
                  <p className="text-xl leading-none">{['😣', '😕', '😐', '🙂', '😄'][Math.round(feel)] ?? '—'}</p>
                  <p className="text-3xs text-ink-400 mt-1">{t('feel')}</p>
                </div>
              )}
            </div>
          </StatTile>
        )}
      </div>

      {/* Charts - Full Width Stacked */}
      {splits.length >= 2 && (
        <div className="space-y-4">
          <div className="bg-page/40 rounded-xl p-4 border border-page/20">
            <PaceChart splits={splits} planned={planned || undefined} />
          </div>
          {splits.some(s => s.averageHR) && (
            <div className="bg-page/40 rounded-xl p-4 border border-page/20">
              <HRChart splits={splits} maxHR={maxHR} />
            </div>
          )}
          <div className="bg-page/40 rounded-xl p-4 border border-page/20">
            <ElevationChart splits={splits} />
          </div>
        </div>
      )}

      {/* Splits Table */}
      {splits.length > 0 && <SplitsTable splits={splits} />}

      {/* Nothing but the headline numbers exist for this run. Say so, rather than
          ending on an empty stretch of page that reads as a loading failure. */}
      {!loading && details && splits.length === 0 && routePoints.length <= 2 && (
        <div className="rounded-card border border-page/30 bg-card/40 py-6 text-center">
          <Sparkles className="h-5 w-5 text-ink-400 mx-auto mb-1" />
          <p className="text-xs text-ink-400">
            {t('noSplits')}
          </p>
        </div>
      )}
    </div>
  );
}
