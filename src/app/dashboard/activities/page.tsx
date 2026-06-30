'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Activity, TrendingUp, Route, Flame, ChevronLeft, ChevronRight } from 'lucide-react';
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

interface DailyDistance {
  day: string;
  date: string;
  distance: number;
  runs: number;
  duration: number;
}

function getWeekDates(offset: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const day = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day + offset * 7);
  sunday.setHours(0, 0, 0, 0);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    start: sunday,
    end: saturday,
    label: `${fmt(sunday)} – ${fmt(saturday)}`,
  };
}

function computeWeeklyData(activities: ActivityEntry[], offset: number): {
  daily: DailyDistance[];
  totalKm: number;
  totalRuns: number;
  totalHours: number;
  avgPace: number | null;
  totalCalories: number;
} {
  const { start, end } = getWeekDates(offset);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daily: DailyDistance[] = days.map((day, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return { day, date: date.toISOString().split('T')[0], distance: 0, runs: 0, duration: 0 };
  });

  const weekActivities = activities.filter(a => {
    const d = new Date(a.start_time);
    return d >= start && d <= end;
  });

  for (const act of weekActivities) {
    const d = new Date(act.start_time);
    const dayIdx = d.getDay();
    daily[dayIdx].distance += act.distance / 1000;
    daily[dayIdx].runs += 1;
    daily[dayIdx].duration += act.duration;
  }

  const totalKm = weekActivities.reduce((s, a) => s + a.distance / 1000, 0);
  const totalRuns = weekActivities.length;
  const totalDuration = weekActivities.reduce((s, a) => s + a.duration, 0);
  const totalCalories = weekActivities.reduce((s, a) => s + (a.calories || 0), 0);
  const avgPace = totalKm > 0 ? Math.round(totalDuration / totalKm) : null;

  return { daily, totalKm, totalRuns, totalHours: totalDuration / 3600, avgPace, totalCalories };
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function WeeklyBarChart({ daily, totalKm, totalRuns, totalHours, avgPace, totalCalories, weekLabel, onPrev, onNext }: {
  daily: DailyDistance[];
  totalKm: number;
  totalRuns: number;
  totalHours: number;
  avgPace: number | null;
  totalCalories: number;
  weekLabel: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const maxDist = Math.max(...daily.map(d => d.distance), 1);

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 p-5">
      {/* Header with navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onPrev} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-white">{weekLabel}</span>
        <button onClick={onNext} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Bar chart */}
      <div className="flex items-end justify-between gap-2 h-32 mb-3 px-1">
        {daily.map((d, i) => {
          const barHeight = maxDist > 0 ? (d.distance / maxDist) * 100 : 0;
          const isToday = d.date === new Date().toISOString().split('T')[0];
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative h-full">
              {d.distance > 0 && (
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-[10px] font-bold px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  {d.distance.toFixed(1)}km · {d.runs} run{d.runs > 1 ? 's' : ''}
                </div>
              )}
              <div className="flex-1 w-full flex items-end justify-center">
                <div
                  className={cn(
                    'w-full max-w-[32px] rounded-t-md transition-all group-hover:opacity-100',
                    d.distance > 0 ? 'bg-[#4338ff]/75 group-hover:bg-[#4338ff]' : 'bg-slate-700/30',
                    isToday && d.distance > 0 && 'ring-1 ring-[#4338ff]/50'
                  )}
                  style={{ height: `${Math.max(barHeight, d.distance > 0 ? 8 : 2)}%` }}
                />
              </div>
              <span className={cn('text-[10px] font-medium', isToday ? 'text-white' : 'text-slate-500')}>{d.day}</span>
            </div>
          );
        })}
      </div>

      {/* Weekly totals */}
      <div className="grid grid-cols-5 gap-2 pt-3 border-t border-slate-700/40">
        <div className="text-center">
          <p className="text-lg font-black text-white tabular-nums">{totalKm.toFixed(1)}</p>
          <p className="text-[10px] text-slate-500 font-medium">KM</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-black text-white tabular-nums">{totalRuns}</p>
          <p className="text-[10px] text-slate-500 font-medium">RUNS</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-black text-white tabular-nums">{totalHours.toFixed(1)}</p>
          <p className="text-[10px] text-slate-500 font-medium">HOURS</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-black text-white tabular-nums">{avgPace ? formatPace(avgPace) : '—'}</p>
          <p className="text-[10px] text-slate-500 font-medium">AVG PACE</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-black text-white tabular-nums">{totalCalories.toLocaleString()}</p>
          <p className="text-[10px] text-slate-500 font-medium">KCAL</p>
        </div>
      </div>
    </div>
  );
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
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

  const weekData = computeWeeklyData(activities, weekOffset);
  const { label: weekLabel } = getWeekDates(weekOffset);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin h-10 w-10 border-[3px] border-[#4338ff]/20 border-t-[#4338ff] rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="h-6 w-6 text-[#4338ff]" />
            Activities
          </h1>
          <p className="text-sm text-slate-400 mt-1">Training data synced from Garmin</p>
        </div>
        <div className="flex items-center gap-2">
          {activities.some(a => !a.avg_cadence && !a.vo2max) && (
            <button
              onClick={enrichActivities}
              disabled={enriching}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-slate-700 hover:bg-slate-600 transition-colors disabled:opacity-50"
            >
              <TrendingUp className={cn("h-3.5 w-3.5", enriching && "animate-pulse")} />
              {enriching ? 'Enriching...' : 'Enrich'}
            </button>
          )}
          <button
            onClick={syncAndFetch}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#4338ff] hover:bg-[#3730d4] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Weekly Bar Chart */}
      <WeeklyBarChart
        daily={weekData.daily}
        totalKm={weekData.totalKm}
        totalRuns={weekData.totalRuns}
        totalHours={weekData.totalHours}
        avgPace={weekData.avgPace}
        totalCalories={weekData.totalCalories}
        weekLabel={weekLabel}
        onPrev={() => setWeekOffset(o => o - 1)}
        onNext={() => setWeekOffset(o => Math.min(o + 1, 0))}
      />

      {/* Activity Feed */}
      <ActivityFeed
        activities={activities}
        syncing={syncing}
        lastSyncTime={lastSyncTime}
        onSync={syncAndFetch}
      />
    </div>
  );
}
