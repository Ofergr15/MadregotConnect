'use client';

import { useEffect, useState } from 'react';
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

function getWeekDates(offset: number): { start: Date; end: Date; label: string; isThisWeek: boolean } {
  const now = new Date();
  const day = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day + offset * 7);
  sunday.setHours(0, 0, 0, 0);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  saturday.setHours(23, 59, 59, 999);

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    start: sunday,
    end: saturday,
    label: `${fmt(sunday)} – ${fmt(saturday)}`,
    isThisWeek: offset === 0,
  };
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

function WeeklyOverview({ activities, weekOffset, onChangeWeek }: {
  activities: ActivityEntry[];
  weekOffset: number;
  onChangeWeek: (offset: number) => void;
}) {
  const { start, end, label, isThisWeek } = getWeekDates(weekOffset);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const weekActivities = activities.filter(a => {
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
  const maxDist = Math.max(...daily.map(d => d.distance), 1);

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden">
      {/* Week Navigation Header - matching Weekly Planner style */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/30">
        <button
          onClick={() => onChangeWeek(weekOffset - 1)}
          className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">{label}</h2>
          {isThisWeek && <p className="text-xs text-slate-400">This week</p>}
        </div>
        <button
          onClick={() => onChangeWeek(Math.min(weekOffset + 1, 0))}
          className={cn(
            "p-2 rounded-lg transition-colors",
            weekOffset >= 0 ? "text-slate-600 cursor-not-allowed" : "text-slate-400 hover:text-white hover:bg-slate-700"
          )}
          disabled={weekOffset >= 0}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Stats Summary Row */}
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-px bg-slate-700/20">
        {[
          { label: 'Distance', value: `${totalKm.toFixed(1)}`, unit: 'km', icon: Route, color: 'text-[#4338ff]' },
          { label: 'Runs', value: `${totalRuns}`, unit: '', icon: Activity, color: 'text-[#4338ff]' },
          { label: 'Time', value: formatDuration(totalDuration), unit: '', icon: Timer, color: 'text-slate-300' },
          { label: 'Avg Pace', value: avgPace ? formatPace(avgPace) : '—', unit: '/km', icon: TrendingUp, color: 'text-emerald-400' },
          { label: 'Avg HR', value: avgHR ? `${avgHR}` : '—', unit: 'bpm', icon: Heart, color: 'text-red-400' },
          { label: 'Calories', value: totalCalories > 0 ? totalCalories.toLocaleString() : '—', unit: 'kcal', icon: Flame, color: 'text-orange-400' },
          { label: 'Elevation', value: totalElevation > 0 ? `${Math.round(totalElevation)}` : '—', unit: 'm', icon: Mountain, color: 'text-green-400' },
        ].map((stat, i) => (
          <div key={i} className="bg-slate-800/50 px-3 py-3 text-center hidden sm:block first:block [&:nth-child(2)]:block [&:nth-child(3)]:block">
            <stat.icon className={cn("h-3.5 w-3.5 mx-auto mb-1", stat.color)} />
            <p className="text-base font-black text-white tabular-nums leading-tight">
              {stat.value}<span className="text-[10px] text-slate-500 ml-0.5">{stat.unit}</span>
            </p>
            <p className="text-[9px] text-slate-500 font-medium uppercase mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Daily Bar Chart */}
      <div className="px-6 py-5">
        <div className="flex items-end justify-between gap-2 h-24">
          {daily.map((d, i) => {
            const barHeight = maxDist > 0 ? (d.distance / maxDist) * 100 : 0;
            const isToday = d.date === new Date().toISOString().split('T')[0];
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative h-full">
                {d.distance > 0 && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-[10px] font-bold px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                    {d.distance.toFixed(1)}km · {d.runs} run{d.runs > 1 ? 's' : ''}
                  </div>
                )}
                <div className="flex-1 w-full flex items-end justify-center">
                  <div
                    className={cn(
                      'w-full max-w-[28px] rounded-md transition-all duration-200',
                      d.distance > 0 ? 'bg-[#4338ff]/70 group-hover:bg-[#4338ff]' : 'bg-slate-700/20',
                      isToday && d.distance > 0 && 'ring-2 ring-[#4338ff]/40'
                    )}
                    style={{ height: `${Math.max(barHeight, d.distance > 0 ? 10 : 3)}%` }}
                  />
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
  );
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [isCoach, setIsCoach] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);

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
  const filteredActivities = !isCoach && athleteId
    ? activities.filter(a => a.athlete_id === athleteId)
    : activities;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin h-10 w-10 border-[3px] border-[#4338ff]/20 border-t-[#4338ff] rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#4338ff]/10 flex items-center justify-center">
            <Activity className="h-5 w-5 text-[#4338ff]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Activities</h1>
            <p className="text-xs text-slate-400">
              {filteredActivities.length} activities · synced from Garmin
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCoach && activities.some(a => !a.avg_cadence && !a.vo2max) && (
            <button
              onClick={enrichActivities}
              disabled={enriching}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 transition-colors disabled:opacity-50"
            >
              <TrendingUp className={cn("h-3.5 w-3.5", enriching && "animate-pulse")} />
              {enriching ? 'Enriching...' : 'Enrich'}
            </button>
          )}
          <button
            onClick={syncAndFetch}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#4338ff] hover:bg-[#3730d4] transition-colors disabled:opacity-50 shadow-lg shadow-[#4338ff]/20"
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      {/* Weekly Overview */}
      <WeeklyOverview
        activities={filteredActivities}
        weekOffset={weekOffset}
        onChangeWeek={setWeekOffset}
      />

      {/* Activity Feed with Week Tabs */}
      <ActivityFeed
        activities={filteredActivities}
        syncing={syncing}
        lastSyncTime={lastSyncTime}
        onSync={syncAndFetch}
      />
    </div>
  );
}
