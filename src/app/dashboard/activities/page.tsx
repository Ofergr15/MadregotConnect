'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Activity, TrendingUp, Route, Flame, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
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

interface WeeklyTrend {
  week: string;
  distance: number;
  runs: number;
  duration: number;
  avgPace: number | null;
}

function getWeekStart(offset: number = 0): string {
  const now = new Date();
  const day = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day + offset * 7);
  return sunday.toISOString().split('T')[0];
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Compute weekly summary stats
  const thisWeekStart = getWeekStart(0);
  const lastWeekStart = getWeekStart(-1);

  const thisWeekActivities = activities.filter(a => a.start_time >= thisWeekStart);
  const lastWeekActivities = activities.filter(a => a.start_time >= lastWeekStart && a.start_time < thisWeekStart);

  const thisWeekDist = thisWeekActivities.reduce((sum, a) => sum + a.distance, 0) / 1000;
  const lastWeekDist = lastWeekActivities.reduce((sum, a) => sum + a.distance, 0) / 1000;
  const thisWeekTime = thisWeekActivities.reduce((sum, a) => sum + a.duration, 0);
  const thisWeekRuns = thisWeekActivities.length;
  const thisWeekCalories = thisWeekActivities.reduce((sum, a) => sum + (a.calories || 0), 0);

  const distDelta = lastWeekDist > 0 ? Math.round(((thisWeekDist - lastWeekDist) / lastWeekDist) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin h-10 w-10 border-[3px] border-[#4338ff]/20 border-t-[#4338ff] rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="h-6 w-6 text-[#4338ff]" />
            Activities
          </h1>
          <p className="text-sm text-slate-400 mt-1">Training data synced from Garmin</p>
        </div>
        <button
          onClick={syncAndFetch}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#4338ff] hover:bg-[#3730d4] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Weekly Summary Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">This Week</p>
          <p className="text-2xl font-black text-white mt-2 tabular-nums">
            {thisWeekDist.toFixed(1)}<span className="text-sm font-medium text-slate-500 ml-1">km</span>
          </p>
          {distDelta !== 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              {distDelta > 0 ? <TrendingUp className="h-3 w-3 text-green-400" /> : <TrendingUp className="h-3 w-3 text-amber-400 rotate-180" />}
              <span className={cn('text-xs font-bold', distDelta > 0 ? 'text-green-400' : 'text-amber-400')}>
                {distDelta > 0 ? '+' : ''}{distDelta}%
              </span>
              <span className="text-xs text-slate-500">vs last week</span>
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Runs</p>
          <p className="text-2xl font-black text-white mt-2 tabular-nums flex items-center gap-2">
            <Route className="h-5 w-5 text-[#4338ff]" />{thisWeekRuns}
          </p>
          <p className="text-xs text-slate-500 mt-1.5">this week</p>
        </div>

        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Duration</p>
          <p className="text-2xl font-black text-white mt-2 tabular-nums">
            {Math.round(thisWeekTime / 60)}<span className="text-sm font-medium text-slate-500 ml-1">min</span>
          </p>
          <p className="text-xs text-slate-500 mt-1.5">{(thisWeekTime / 3600).toFixed(1)} hours</p>
        </div>

        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/30">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Calories</p>
          <p className="text-2xl font-black text-white mt-2 tabular-nums flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-400" />{thisWeekCalories.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1.5">burned this week</p>
        </div>
      </section>

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
