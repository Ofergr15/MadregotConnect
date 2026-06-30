'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { RefreshCw, Activity, TrendingUp, ChevronLeft, ChevronRight, Timer, Heart, Flame, Route, Mountain } from 'lucide-react';
import { ActivityFeed } from '@/components/ActivityFeed';
import { cn } from '@/lib/utils';

interface ActivityEntry {
  id: string;
  athlete_id: string;
  garmin_activity_id: number;
  activity_name: string;
  activity_type: string;
  start_time: string;
  distance: number;
  duration: number;
  moving_duration?: number;
  average_pace: number | null;
  average_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  elevation_gain: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  avg_cadence?: number | null;
  avg_stride_length?: number | null;
  vo2max?: number | null;
  lap_count?: number | null;
  location_name?: string | null;
  has_polyline?: boolean;
  splits?: any[] | null;
  athlete_name?: string;
}

function getCurrentWeekSunday(offset: number): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek + offset * 7);
  return sunday.toISOString().split('T')[0];
}

function getWeekLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const endDate = new Date(date);
  endDate.setDate(date.getDate() + 6);
  const startLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffsetState] = useState(() => {
    const w = searchParams.get('week');
    return w ? parseInt(w, 10) : 0;
  });
  const [isCoach, setIsCoach] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);

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

  useEffect(() => {
    const coachEmail = localStorage.getItem('coach_email');
    const storedAthleteId = localStorage.getItem('athlete_id');
    setIsCoach(!!coachEmail);
    setAthleteId(storedAthleteId);
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/garmin/sync-activities');
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
      await fetch('/api/garmin/sync-activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await fetch('/api/garmin/sync-activities');
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
      setLastSyncTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    } catch { /* silent */ }
    finally { setSyncing(false); }
  };

  const enrichActivities = async () => {
    setEnriching(true);
    try {
      await fetch('/api/garmin/sync-activities', { method: 'PATCH' });
      await fetchActivities();
    } catch { /* silent */ }
    finally { setEnriching(false); }
  };

  // Filter activities by role
  const filteredActivities = useMemo(() => {
    if (!isCoach && athleteId) return activities.filter(a => a.athlete_id === athleteId);
    return activities;
  }, [activities, isCoach, athleteId]);

  // Compute weekly data based on current weekOffset
  const weekStartDate = getCurrentWeekSunday(weekOffset);
  const weekLabel = getWeekLabel(weekStartDate);

  const weekData = useMemo(() => {
    const start = new Date(weekStartDate + 'T00:00:00');
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekActivities = filteredActivities.filter(a => {
      const d = new Date(a.start_time);
      return d >= start && d <= end;
    });

    const daily = days.map((day, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const dayActs = weekActivities.filter(a => a.start_time.startsWith(dateStr));
      return {
        day,
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
        <div className="animate-spin h-10 w-10 border-[3px] border-[#4338ff]/20 border-t-[#4338ff] rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      {/* ═══ HEADER BAR - same pattern as Weekly Planner ═══ */}
      <div className="border-b border-slate-700 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Activity className="h-5 w-5 text-primary-400" />
            <h1 className="text-lg font-semibold text-white">Activities</h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setWeekOffset(o => o - 1)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="text-center min-w-[180px]">
              <p className="text-sm font-medium text-white">{weekLabel}</p>
              <p className="text-xs text-slate-500">
                {weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : ''}
              </p>
            </div>

            <button
              onClick={() => setWeekOffset(o => Math.min(o + 1, 0))}
              className={cn(
                "p-2 rounded-lg transition-colors",
                weekOffset >= 0 ? "text-slate-700 cursor-not-allowed" : "text-slate-400 hover:text-white hover:bg-slate-700"
              )}
              disabled={weekOffset >= 0}
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-primary-400 hover:text-primary-300 ml-2"
              >
                Current
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isCoach && activities.some(a => !a.avg_cadence && !a.vo2max) && (
              <button
                onClick={enrichActivities}
                disabled={enriching}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50"
              >
                <TrendingUp className={cn("h-3.5 w-3.5", enriching && "animate-pulse")} />
                {enriching ? 'Enriching...' : 'Enrich'}
              </button>
            )}
            <button
              onClick={syncAndFetch}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#4338ff] hover:bg-[#3730d4] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Weekly Summary Stats */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          {/* Summary Row */}
          <div className="grid grid-cols-3 sm:grid-cols-7 divide-x divide-slate-700/40">
            {[
              { label: 'Distance', value: weekData.totalKm > 0 ? `${weekData.totalKm.toFixed(1)}` : '—', unit: 'km', icon: Route, color: 'text-[#4338ff]' },
              { label: 'Runs', value: `${weekData.totalRuns}`, unit: '', icon: Activity, color: 'text-[#4338ff]' },
              { label: 'Time', value: weekData.totalDuration > 0 ? formatDuration(weekData.totalDuration) : '—', unit: '', icon: Timer, color: 'text-slate-300' },
              { label: 'Avg Pace', value: weekData.avgPace ? formatPace(weekData.avgPace) : '—', unit: '/km', icon: TrendingUp, color: 'text-emerald-400' },
              { label: 'Avg HR', value: weekData.avgHR ? `${weekData.avgHR}` : '—', unit: 'bpm', icon: Heart, color: 'text-red-400' },
              { label: 'Calories', value: weekData.totalCalories > 0 ? weekData.totalCalories.toLocaleString() : '—', unit: '', icon: Flame, color: 'text-orange-400' },
              { label: 'Elevation', value: weekData.totalElevation > 0 ? `${Math.round(weekData.totalElevation)}` : '—', unit: 'm', icon: Mountain, color: 'text-green-400' },
            ].map((stat, i) => (
              <div key={i} className={cn("px-4 py-4 text-center", i > 2 && "hidden sm:block")}>
                <stat.icon className={cn("h-4 w-4 mx-auto mb-1.5", stat.color)} />
                <p className="text-lg font-black text-white tabular-nums leading-tight">
                  {stat.value}
                  {stat.unit && <span className="text-[10px] text-slate-500 ml-0.5 font-medium">{stat.unit}</span>}
                </p>
                <p className="text-[10px] text-slate-500 font-medium uppercase mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Daily Bar Chart */}
          <div className="border-t border-slate-700/40 px-6 py-5">
            <div className="flex items-end justify-between gap-3 h-20">
              {weekData.daily.map((d, i) => {
                const isToday = d.date === new Date().toISOString().split('T')[0];
                const hasMultiple = d.perActivity.length > 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative h-full">
                    {d.distance > 0 && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-[10px] font-bold px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                        {d.distance.toFixed(1)}km{hasMultiple && ` (${d.perActivity.length})`}
                      </div>
                    )}
                    <div className="flex-1 w-full flex items-end justify-center gap-0.5">
                      {d.perActivity.length > 0 ? (
                        d.perActivity.map((km, j) => {
                          const barH = maxDist > 0 ? (km / maxDist) * 100 : 0;
                          return (
                            <div
                              key={j}
                              className={cn(
                                'rounded-md transition-all duration-200',
                                j === 0 ? 'bg-[#4338ff]/60 group-hover:bg-[#4338ff]' : 'bg-amber-400/60 group-hover:bg-amber-400',
                                isToday && 'ring-2 ring-[#4338ff]/30',
                                hasMultiple ? 'flex-1 max-w-[11px]' : 'w-full max-w-[24px]'
                              )}
                              style={{ height: `${Math.max(barH, 12)}%` }}
                            />
                          );
                        })
                      ) : (
                        <div
                          className="w-full max-w-[24px] rounded-md bg-slate-700/20"
                          style={{ height: '3%' }}
                        />
                      )}
                    </div>
                    <span className={cn(
                      'text-[10px] font-semibold',
                      isToday ? 'text-[#4338ff]' : d.distance > 0 ? 'text-slate-300' : 'text-slate-600'
                    )}>
                      {d.day}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <ActivityFeed
          activities={weekData.weekActivities}
          syncing={syncing}
          lastSyncTime={lastSyncTime}
          onSync={syncAndFetch}
        />
      </div>
    </div>
  );
}
