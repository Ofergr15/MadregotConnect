'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { RefreshCw, Activity, ChevronLeft, ChevronRight, Timer, Heart, Flame, Route, Mountain, TrendingUp, Plus } from 'lucide-react';
import { ActivityFeed } from '@/components/ActivityFeed';
// One shared row shape (this page had its own near-identical copy) — the feed
// card and the [activityId] detail page read the same fields off it.
import type { ActivityEntry } from '@/components/activity/types';
import { cn, israelToday, planWeekStartOf, shiftWeekStart } from '@/lib/utils';
import { fetchActivities as fetchActivitiesScoped } from '@/lib/activities-client';
import { Spinner, BigStat } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { ManualActivitySheet } from '@/components/ManualActivitySheet';

// Local-date ISO (YYYY-MM-DD). NOT toISOString(), which converts to UTC and
// shifts the day back in timezones ahead of UTC (Israel is +2/+3), throwing the
// week boundary and per-day bucketing off by one for early/late-hour users.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function getCurrentWeekSunday(offset: number): string {
  return shiftWeekStart(planWeekStartOf(), offset);
}

function getWeekLabel(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const endDate = new Date(date);
  endDate.setDate(date.getDate() + 6);
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const startLabel = date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  const endLabel = endDate.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ActivitiesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('activities');
  const locale = useLocale();
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffsetState] = useState(() => {
    const w = searchParams.get('week');
    return w ? parseInt(w, 10) : 0;
  });
  const [isCoach, setIsCoach] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  // Which day's tooltip is shown by TAP (touch has no :hover) — independent of
  // the CSS-only `group-hover` still driving the desktop/mouse experience.
  const [tappedDay, setTappedDay] = useState<number | null>(null);

  // Pull-to-refresh (swipe down at the top of the page) — mirrors the sync
  // gesture users expect on a native activity feed, alongside the existing
  // manual Sync button. Passive touch tracking only (no preventDefault, which
  // React 17+ makes a no-op on touchmove) — armed only when already scrolled
  // to the top, so the native rubber-band and this indicator move together.
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);
  const PULL_THRESHOLD = 64;
  const PULL_MAX = 96;

  const dayKeys = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'] as const;

  const setWeekOffset = (val: number | ((prev: number) => number)) => {
    setWeekOffsetState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      const params = new URLSearchParams(window.location.search);
      if (next === 0) params.delete('week');
      else params.set('week', String(next));
      const qs = params.toString();
      router.replace(`/dashboard/activities${qs ? `?${qs}` : ''}`, { scroll: false });
      return next;
    });
  };

  // Hoisted above the effects because the fetch is now scoped to this week, so
  // the week is an input to it rather than something only the render needs.
  const weekStartDate = getCurrentWeekSunday(weekOffset);

  useEffect(() => {
    const coachEmail = localStorage.getItem('coach_email');
    const storedAthleteId = localStorage.getItem('athlete_id');
    setIsCoach(!!coachEmail);
    setAthleteId(storedAthleteId);

    // Legacy deep link from every "🏃 X finished a run" push sent before the
    // link was fixed: those rows point here with ?kudos=<activityId>. This page
    // can't show the run — filteredActivities below narrows to the viewer's OWN
    // activities for a non-coach — so hand it to the feed, which can. Thousands
    // of those rows are already in athletes' notification history.
    const legacyKudos = searchParams.get('kudos');
    if (legacyKudos) {
      router.replace(`/feed?activity=${encodeURIComponent(legacyKudos)}`);
      return;
    }

    // Deep link from ConnectDataSourcePopup's "log manually instead" option.
    if (searchParams.get('logManual') === '1') {
      setShowManualEntry(true);
      const params = new URLSearchParams(window.location.search);
      params.delete('logManual');
      const qs = params.toString();
      router.replace(`/dashboard/activities${qs ? `?${qs}` : ''}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when the user pages to another week. Each week is one small request
  // now, so this is cheaper than the single 16 MB response it replaces even after
  // several taps of the arrows.
  useEffect(() => {
    fetchActivities(weekStartDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartDate]);

  // This screen shows exactly ONE week at a time, so it asks for exactly one
  // week. It used to ask for the newest 200 activities with `includeGps: true`
  // and filter down client-side, which was wrong twice over:
  //
  //  - Size. gps_points is a full per-run lat/lng trace. Measured on this page:
  //    16 MB in a single response — 200 rows × ~80 KB — to render the seven days
  //    the user can actually see. On a phone over cellular that is the difference
  //    between a screen and a stall. ActivityFeed does prefer an inlined route
  //    when one is there, but it already has the lazy per-card
  //    /api/activities/details path for rows synced before GPS was persisted, and
  //    a collapsed card doesn't draw a map at all — so the trace is only ever
  //    needed for the ONE card someone expands, which fetches details anyway.
  //  - Correctness. "The newest 200" is not "the week you're looking at". For a
  //    coach those 200 rows are club-wide and cover roughly two weeks at this
  //    club's volume, so paging back a month showed an empty week with no
  //    explanation. A window can't be truncated that way.
  const fetchActivities = async (weekStart: string) => {
    setLoading(true);
    try {
      // `until` is exclusive, so it's the Sunday AFTER the week being shown.
      const end = new Date(weekStart + 'T00:00:00');
      end.setDate(end.getDate() + 7);
      const res = await fetchActivitiesScoped({ since: weekStart, until: iso(end) });
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const syncAndFetch = async () => {
    setSyncing(true);
    try {
      const id = athleteId || localStorage.getItem('athlete_id');
      if (!id) throw new Error('No athlete');
      // Fire both — each route no-ops gracefully ({synced:0}) if this athlete
      // isn't connected to that source, so this works regardless of whether
      // they're on Garmin, Strava, or both.
      const syncHeaders = await bearerHeaders();
      await Promise.allSettled([
        fetch('/api/strava/sync-activities', {
          method: 'POST',
          headers: syncHeaders,
          body: JSON.stringify({ athleteId: id }),
        }),
        fetch('/api/garmin/sync-activities', {
          method: 'POST',
          headers: syncHeaders,
          body: JSON.stringify({ athleteId: id }),
        }),
      ]);
      // Same window as the plain fetch — a sync that pulled in new runs still
      // only needs to refresh the week on screen.
      const end = new Date(weekStartDate + 'T00:00:00');
      end.setDate(end.getDate() + 7);
      const res = await fetchActivitiesScoped({ since: weekStartDate, until: iso(end) });
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
      const timeLocale = locale === 'he' ? 'he-IL' : 'en-US';
      setLastSyncTime(new Date().toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' }));
    } catch { /* silent */ }
    finally { setSyncing(false); }
  };

  const handlePullStart = (e: React.TouchEvent) => {
    if (syncing || window.scrollY > 0) return;
    pullStartYRef.current = e.touches[0].clientY;
  };
  const handlePullMove = (e: React.TouchEvent) => {
    if (pullStartYRef.current == null) return;
    if (window.scrollY > 0) { pullStartYRef.current = null; setPullDistance(0); return; }
    const delta = e.touches[0].clientY - pullStartYRef.current;
    setPullDistance(delta > 0 ? Math.min(delta * 0.5, PULL_MAX) : 0);
  };
  const handlePullEnd = async () => {
    if (pullStartYRef.current == null) return;
    pullStartYRef.current = null;
    if (pullDistance >= PULL_THRESHOLD) {
      setPullDistance(PULL_THRESHOLD);
      await syncAndFetch();
    }
    setPullDistance(0);
  };

  // Filter activities by role
  const filteredActivities = useMemo(() => {
    if (!isCoach && athleteId) return activities.filter(a => a.athlete_id === athleteId);
    return activities;
  }, [activities, isCoach, athleteId]);

  // Compute weekly data based on current weekOffset (weekStartDate is hoisted
  // above the effects, since the fetch is scoped to it now).
  const weekLabel = getWeekLabel(weekStartDate, locale);

  const weekData = useMemo(() => {
    const start = new Date(weekStartDate + 'T00:00:00');
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const weekActivities = filteredActivities.filter(a => {
      const d = new Date(a.start_time);
      return d >= start && d <= end;
    });

    const daily = dayKeys.map((dayKey, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateStr = iso(date);
      const dayActs = weekActivities.filter(a => a.start_time.startsWith(dateStr));
      return {
        dayKey,
        date: dateStr,
        distance: dayActs.reduce((s, a) => s + a.distance / 1000, 0),
        runs: dayActs.length,
        duration: dayActs.reduce((s, a) => s + a.duration, 0),
        perActivity: dayActs.map(a => a.distance / 1000),
      };
    });

    const totalKm = weekActivities.reduce((s, a) => s + a.distance / 1000, 0);
    const totalRuns = weekActivities.length;
    const totalDuration = weekActivities.reduce((s, a) => s + a.duration, 0);
    const avgPace = totalKm > 0 ? Math.round(totalDuration / totalKm) : null;
    const totalCalories = weekActivities.reduce((s, a) => s + (a.calories || 0), 0);
    const avgHR = weekActivities.filter(a => a.average_hr).length > 0
      ? Math.round(weekActivities.reduce((s, a) => s + (a.average_hr || 0), 0) / weekActivities.filter(a => a.average_hr).length)
      : null;
    const totalElevation = weekActivities.reduce((s, a) => s + (a.elevation_gain || 0), 0);

    return { daily, totalKm, totalRuns, totalDuration, avgPace, totalCalories, avgHR, totalElevation, weekActivities };
  }, [filteredActivities, weekStartDate]);

  const maxDist = Math.max(...weekData.daily.map(d => d.distance), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    // dvh and 9.25rem — see the same wrapper on the weekly planner. `100vh` is the
    // URL-bar-hidden height on iOS, and 6rem doesn't cover the 56px header plus
    // the shell's pt-5 plus the 72px tab bar this sits between.
    <div
      className="min-h-[calc(100dvh-9.25rem)] flex flex-col"
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
    >
      {/* Pull-to-refresh affordance — grows with the swipe, spins while the
          pulled-triggered syncAndFetch() runs. */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height,opacity] duration-150"
        style={{ height: pullDistance, opacity: Math.min(pullDistance / PULL_THRESHOLD, 1) }}
      >
        <Spinner size={22} />
      </div>

      {/* HEADER BAR — softened toward an iOS large-title nav bar rather than a
          dense web toolbar (subtle hairline, no hard full-weight border). */}
      <div className="border-b border-page/50 bg-page/50 px-4 sm:px-6 py-4">
        {/* flex-wrap: title + week-nav + Log Activity/Sync don't all fit on
            one row at real phone widths (~390px) — without wrap, the actions
            group renders off-screen entirely, not just visually cramped. */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Activity className="h-5 w-5 text-brand-600" />
            <h1 className="text-lg font-semibold text-ink-700">{t('title')}</h1>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              onClick={() => setWeekOffset(o => o - 1)}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page active:scale-[0.92] transition-all"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="text-center min-w-[140px] sm:min-w-[180px]">
              <p className="text-sm font-medium text-ink-700">{weekLabel}</p>
              <p className="text-xs text-ink-400">
                {weekOffset === 0 ? t('thisWeek') : weekOffset === -1 ? t('lastWeek') : ''}
              </p>
            </div>

            <button
              onClick={() => setWeekOffset(o => Math.min(o + 1, 0))}
              className={cn(
                "flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all",
                weekOffset >= 0 ? "text-ink-900 cursor-not-allowed" : "text-ink-400 hover:text-ink-900 hover:bg-page active:scale-[0.92]"
              )}
              disabled={weekOffset >= 0}
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-brand-600 hover:text-brand-700 active:scale-95 transition-transform ms-1 min-h-[44px] px-1"
              >
                {t('current')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {athleteId && (
              <button
                onClick={() => setShowManualEntry(true)}
                className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-sm font-semibold text-ink-500 border border-page hover:border-ink-300 hover:text-ink-900 active:scale-[0.97] transition-all"
              >
                <Plus className="h-4 w-4" />
                {t('logActivity')}
              </button>
            )}
            <button
              onClick={syncAndFetch}
              disabled={syncing}
              className="flex items-center gap-2 px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? t('syncing') : t('sync')}
            </button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full space-y-5">

        {/* Hero Stats — one shared BigStat for the number+label pattern,
            matching StatisticsScreen instead of four hand-rolled copies. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative overflow-hidden bg-gradient-to-br from-brand-600/15 to-brand-600/5 rounded-2xl p-5 border border-brand-600/20">
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-brand-600/10 rounded-full blur-2xl" />
            <Route className="h-5 w-5 text-brand-600 mb-3" />
            <BigStat
              className="items-start text-start"
              valueClassName="text-2xl sm:text-4xl text-ink-700"
              value={weekData.totalKm > 0 ? weekData.totalKm.toFixed(1) : '—'}
              label={`${t('km')} · ${weekData.totalRuns} ${weekData.totalRuns !== 1 ? t('runs') : t('run')}`}
            />
          </div>
          <div className="relative overflow-hidden bg-card/50 rounded-card p-5 border border-page/30">
            <Timer className="h-5 w-5 text-band-2 mb-3" />
            <BigStat
              className="items-start text-start"
              valueClassName="text-2xl sm:text-4xl text-ink-700"
              value={weekData.totalDuration > 0 ? formatDuration(weekData.totalDuration) : '\u2014'}
              label={t('totalTime')}
            />
          </div>
          <div className="relative overflow-hidden bg-card/50 rounded-card p-5 border border-page/30">
            <TrendingUp className="h-5 w-5 text-accent-600 mb-3" />
            <BigStat
              className="items-start text-start"
              valueClassName="text-2xl sm:text-4xl text-ink-700"
              value={(
                <>
                  {weekData.avgPace ? formatPace(weekData.avgPace) : '\u2014'}
                  <span className="text-lg font-medium text-ink-400 ms-0.5">{t('perKm')}</span>
                </>
              )}
              label={t('avgPace')}
            />
          </div>
          <div className="relative overflow-hidden bg-card/50 rounded-card p-5 border border-page/30">
            <Heart className="h-5 w-5 text-accent-red mb-3" />
            <BigStat
              className="items-start text-start"
              valueClassName="text-2xl sm:text-4xl text-ink-700"
              value={(
                <>
                  {weekData.avgHR || '\u2014'}
                  <span className="text-lg font-medium text-ink-400 ms-0.5">{t('bpm')}</span>
                </>
              )}
              label={t('avgHeartRate')}
            />
          </div>
        </div>

        {/* Daily Volume Chart */}
        <div className="bg-card/30 rounded-card border border-page/20 p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-bold text-ink-700">{t('dailyVolume')}</h3>
            <div className="flex items-center gap-4 text-xs text-ink-400">
              {weekData.totalCalories > 0 && (
                <span className="flex items-center gap-1.5"><Flame className="h-3.5 w-3.5 text-band-3" />{weekData.totalCalories.toLocaleString()} {t('cal')}</span>
              )}
              {weekData.totalElevation > 0 && (
                <span className="flex items-center gap-1.5"><Mountain className="h-3.5 w-3.5 text-accent-600" />{Math.round(weekData.totalElevation)}m</span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-1.5 sm:gap-3 h-36 sm:h-44">
            {weekData.daily.map((d, i) => {
              const isToday = d.date === israelToday();
              const hasMultiple = d.perActivity.length > 1;
              const barH = maxDist > 0 ? (d.distance / maxDist) * 100 : 0;
              const tapped = tappedDay === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => d.distance > 0 && setTappedDay(t => (t === i ? null : i))}
                  className="flex-1 flex flex-col items-center h-full group relative"
                >
                  {/* Tooltip — shown on hover (desktop) OR tap (touch, no :hover) */}
                  {d.distance > 0 && (
                    <div className={cn(
                      'absolute -top-10 left-1/2 -translate-x-1/2 bg-page border border-ink-300 text-ink-700 text-xs font-bold px-3 py-1.5 rounded-xl transition-opacity whitespace-nowrap z-10 shadow-xl',
                      tapped ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}>
                      {d.distance.toFixed(1)} {t('km')}{hasMultiple ? ` · ${d.perActivity.length} ${t('runs')}` : ''}
                    </div>
                  )}
                  {/* Bar */}
                  <div className="flex-1 w-full flex items-end justify-center">
                    {hasMultiple ? (
                      <div className="flex gap-0.5 items-end w-full max-w-[28px] sm:max-w-[40px]" style={{ height: `${Math.max(barH, 8)}%` }}>
                        {d.perActivity.map((km, j) => {
                          const segH = d.distance > 0 ? (km / d.distance) * 100 : 0;
                          return (
                            <div
                              key={j}
                              className={cn(
                                'flex-1 rounded-t-lg transition-all duration-200',
                                // The second segment's hover lightens the orange
                                // (band 3 has no lighter step of its own, so it
                                // lightens against the white card instead).
                                j === 0 ? 'bg-brand-600 group-hover:bg-[#5b54ff] group-hover:shadow-lg group-hover:shadow-brand-600/20' : 'bg-band-3 group-hover:bg-band-3/80',
                              )}
                              style={{ height: `${Math.max(segH, 25)}%` }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          'w-full max-w-[24px] sm:max-w-[36px] rounded-t-xl transition-all duration-200',
                          d.distance > 0 ? 'bg-brand-600/80 group-hover:bg-brand-700 group-hover:shadow-lg group-hover:shadow-brand-600/20' : 'bg-page/30',
                          isToday && d.distance > 0 && 'ring-2 ring-brand-600/50 bg-brand-600'
                        )}
                        style={{ height: `${Math.max(barH, d.distance > 0 ? 10 : 3)}%` }}
                      />
                    )}
                  </div>
                  {/* Label */}
                  <div className="mt-3 text-center">
                    <p className={cn(
                      'text-xs font-bold',
                      isToday ? 'text-brand-600' : d.distance > 0 ? 'text-ink-700' : 'text-ink-400'
                    )}>
                      {t(d.dayKey)}
                    </p>
                    <p className={cn(
                      'text-2xs tabular-nums mt-0.5 font-medium',
                      d.distance > 0 ? 'text-ink-400' : 'text-ink-900'
                    )}>
                      {d.distance > 0 ? d.distance.toFixed(1) : '\u2014'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Activity Feed */}
        <ActivityFeed
          activities={weekData.weekActivities}
          syncing={syncing}
          lastSyncTime={lastSyncTime}
          onSync={syncAndFetch}
          myAthleteId={athleteId}
          isStaff={isCoach}
        />
      </div>

      {athleteId && (
        <ManualActivitySheet
          open={showManualEntry}
          onOpenChange={setShowManualEntry}
          athleteId={athleteId}
          onSaved={() => fetchActivities(weekStartDate)}
        />
      )}
    </div>
  );
}
