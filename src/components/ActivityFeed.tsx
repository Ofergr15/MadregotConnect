'use client';

import { useState } from 'react';
import {
  Activity, Heart, Timer, Route, TrendingUp, TrendingDown,
  MapPin, ChevronDown, ChevronUp, Zap, Footprints, Mountain,
  Flame, Clock, RefreshCw,
} from 'lucide-react';
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
  splits?: Split[] | null;
  athlete_name?: string;
}

interface Split {
  distance: number;
  duration: number;
  averagePace: number;
  averageHR: number | null;
  elevationGain: number | null;
}

interface ActivityDetailsData {
  gpsPoints: Array<{ lat: number; lng: number }>;
  splits: Split[];
  summary: any;
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDurationFull(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getTimeOfDayLabel(startTime: string): string {
  const hour = new Date(startTime).getHours();
  if (hour < 6) return 'Night Run';
  if (hour < 12) return 'Morning Run';
  if (hour < 17) return 'Afternoon Run';
  return 'Evening Run';
}

function getHRZone(hr: number, maxHR: number = 190): { zone: number; label: string; color: string } {
  const pct = hr / maxHR;
  if (pct < 0.6) return { zone: 1, label: 'Easy', color: 'text-slate-400' };
  if (pct < 0.7) return { zone: 2, label: 'Aerobic', color: 'text-blue-400' };
  if (pct < 0.8) return { zone: 3, label: 'Tempo', color: 'text-green-400' };
  if (pct < 0.9) return { zone: 4, label: 'Threshold', color: 'text-orange-400' };
  return { zone: 5, label: 'VO2max', color: 'text-red-400' };
}

function ActivityCard({ activity }: { activity: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<ActivityDetailsData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const distKm = (activity.distance / 1000).toFixed(2);
  const paceStr = activity.average_pace ? formatPace(activity.average_pace) : null;
  const durationStr = formatDurationFull(activity.duration);
  const movingDurationStr = activity.moving_duration ? formatDurationFull(activity.moving_duration) : null;
  const dateStr = new Date(activity.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = new Date(activity.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const timeLabel = getTimeOfDayLabel(activity.start_time);
  const hrZone = activity.average_hr ? getHRZone(activity.average_hr) : null;

  const loadDetails = async () => {
    if (details || loadingDetails) return;
    setLoadingDetails(true);
    try {
      const res = await fetch(
        `/api/garmin/activity-details?activityId=${activity.garmin_activity_id}&athleteId=${activity.athlete_id}`
      );
      if (res.ok) {
        const data = await res.json();
        setDetails(data);
      }
    } catch { /* silent */ }
    finally { setLoadingDetails(false); }
  };

  const handleExpand = () => {
    if (!expanded) loadDetails();
    setExpanded(!expanded);
  };

  const splits = details?.splits || activity.splits || [];

  const fastestSplit = splits.length > 0
    ? splits.reduce((min, s) => s.averagePace < min.averagePace ? s : min, splits[0])
    : null;
  const slowestSplit = splits.length > 0
    ? splits.reduce((max, s) => s.averagePace > max.averagePace ? s : max, splits[0])
    : null;

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden transition-all">
      {/* Main card - always visible */}
      <div
        className="p-4 sm:p-5 cursor-pointer hover:bg-slate-800/70 transition-colors"
        onClick={handleExpand}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#4338ff]/15 flex items-center justify-center">
              <Route className="h-4 w-4 text-[#4338ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{activity.athlete_name || 'Unknown'}</span>
                <span className="text-xs text-slate-500">· {timeLabel}</span>
              </div>
              <p className="text-xs text-slate-500">{dateStr} at {timeStr}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activity.location_name && (
              <span className="text-xs text-slate-500 flex items-center gap-1 hidden sm:flex">
                <MapPin className="h-3 w-3" />{activity.location_name}
              </span>
            )}
            {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
        </div>

        {/* Activity title */}
        <p className="text-base font-semibold text-white mb-3">{activity.activity_name}</p>

        {/* Primary stats row */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Distance</p>
            <p className="text-lg font-black text-white tabular-nums">{distKm}<span className="text-xs text-slate-400 ml-1">km</span></p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Time</p>
            <p className="text-lg font-black text-white tabular-nums">{durationStr}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Pace</p>
            <p className="text-lg font-black text-white tabular-nums">{paceStr || '—'}<span className="text-xs text-slate-400 ml-1">/km</span></p>
          </div>
          {activity.average_hr && (
            <div className="hidden sm:block">
              <p className="text-xs text-slate-500 mb-0.5">Avg HR</p>
              <p className={cn("text-lg font-black tabular-nums flex items-center gap-1", hrZone?.color || 'text-white')}>
                <Heart className="h-3.5 w-3.5" />{activity.average_hr}
              </p>
            </div>
          )}
          {activity.elevation_gain && activity.elevation_gain > 0 ? (
            <div className="hidden sm:block">
              <p className="text-xs text-slate-500 mb-0.5">Elevation</p>
              <p className="text-lg font-black text-white tabular-nums flex items-center gap-1">
                <Mountain className="h-3.5 w-3.5 text-green-400" />{Math.round(activity.elevation_gain)}<span className="text-xs text-slate-400 ml-0.5">m</span>
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-700/50 px-4 sm:px-5 py-4 space-y-5">
          {/* Secondary stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {movingDurationStr && movingDurationStr !== durationStr && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Moving Time</p>
                <p className="text-sm font-bold text-white tabular-nums mt-1">{movingDurationStr}</p>
              </div>
            )}
            {activity.calories && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Calories</p>
                <p className="text-sm font-bold text-white tabular-nums mt-1 flex items-center gap-1">
                  <Flame className="h-3 w-3 text-orange-400" />{activity.calories}
                </p>
              </div>
            )}
            {activity.avg_cadence && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Cadence</p>
                <p className="text-sm font-bold text-white tabular-nums mt-1 flex items-center gap-1">
                  <Footprints className="h-3 w-3 text-cyan-400" />{Math.round(activity.avg_cadence)} <span className="text-xs text-slate-500">spm</span>
                </p>
              </div>
            )}
            {activity.avg_stride_length && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Stride</p>
                <p className="text-sm font-bold text-white tabular-nums mt-1">
                  {(activity.avg_stride_length / 100).toFixed(2)} <span className="text-xs text-slate-500">m</span>
                </p>
              </div>
            )}
            {activity.max_hr && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Max HR</p>
                <p className="text-sm font-bold text-red-400 tabular-nums mt-1 flex items-center gap-1">
                  <Heart className="h-3 w-3" />{activity.max_hr}
                </p>
              </div>
            )}
            {activity.vo2max && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">VO2 Max</p>
                <p className="text-sm font-bold text-green-400 tabular-nums mt-1 flex items-center gap-1">
                  <Zap className="h-3 w-3" />{activity.vo2max}
                </p>
              </div>
            )}
            {activity.elevation_gain && (
              <div className="bg-slate-900/50 rounded-xl p-3 sm:hidden">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Elevation</p>
                <p className="text-sm font-bold text-white tabular-nums mt-1">
                  ↑{Math.round(activity.elevation_gain)}m
                </p>
              </div>
            )}
            {activity.lap_count && activity.lap_count > 1 && (
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Laps</p>
                <p className="text-sm font-bold text-white tabular-nums mt-1">{activity.lap_count}</p>
              </div>
            )}
          </div>

          {/* Splits */}
          {loadingDetails && splits.length === 0 && (
            <div className="flex items-center justify-center py-6">
              <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" />
              <span className="text-sm text-slate-400 ml-2">Loading splits...</span>
            </div>
          )}

          {splits.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-400 mb-3 flex items-center gap-2">
                <Timer className="h-3.5 w-3.5" /> Splits
              </h4>
              <div className="space-y-1">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold uppercase text-slate-500 px-3 pb-1">
                  <span className="col-span-1">KM</span>
                  <span className="col-span-4">Pace</span>
                  <span className="col-span-3">Time</span>
                  <span className="col-span-2">HR</span>
                  <span className="col-span-2">Elev</span>
                </div>
                {splits.map((split, i) => {
                  const isFastest = fastestSplit && split.averagePace === fastestSplit.averagePace;
                  const isSlowest = slowestSplit && split.averagePace === slowestSplit.averagePace;
                  const paceRange = slowestSplit && fastestSplit
                    ? slowestSplit.averagePace - fastestSplit.averagePace
                    : 1;
                  const pacePosition = fastestSplit
                    ? 1 - ((split.averagePace - fastestSplit.averagePace) / (paceRange || 1))
                    : 0.5;

                  return (
                    <div
                      key={i}
                      className={cn(
                        'grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-lg text-sm',
                        isFastest ? 'bg-green-500/10 border border-green-500/20' :
                        isSlowest ? 'bg-red-500/5 border border-red-500/10' :
                        'bg-slate-900/30'
                      )}
                    >
                      <span className="col-span-1 text-xs font-bold text-slate-400">{i + 1}</span>
                      <div className="col-span-4 flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', isFastest ? 'bg-green-400' : isSlowest ? 'bg-red-400' : 'bg-[#4338ff]')}
                            style={{ width: `${Math.max(20, pacePosition * 100)}%` }}
                          />
                        </div>
                        <span className={cn(
                          'font-bold tabular-nums',
                          isFastest ? 'text-green-400' : isSlowest ? 'text-red-400' : 'text-white'
                        )}>
                          {formatPace(split.averagePace)}
                        </span>
                      </div>
                      <span className="col-span-3 text-slate-300 tabular-nums">{formatDurationFull(split.duration)}</span>
                      <span className="col-span-2 text-slate-400 tabular-nums">{split.averageHR || '—'}</span>
                      <span className="col-span-2 text-slate-400 tabular-nums">
                        {split.elevationGain != null ? `↑${Math.round(split.elevationGain)}` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Map placeholder */}
          {details?.gpsPoints && details.gpsPoints.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-400 mb-3 flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" /> Route
              </h4>
              <div className="h-64 rounded-xl overflow-hidden border border-slate-700/30">
                <RouteMap points={details.gpsPoints} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RouteMap({ points }: { points: Array<{ lat: number; lng: number }> }) {
  if (points.length === 0) return null;

  const minLat = Math.min(...points.map(p => p.lat));
  const maxLat = Math.max(...points.map(p => p.lat));
  const minLng = Math.min(...points.map(p => p.lng));
  const maxLng = Math.max(...points.map(p => p.lng));

  const padLat = (maxLat - minLat) * 0.1;
  const padLng = (maxLng - minLng) * 0.1;

  const viewMinLat = minLat - padLat;
  const viewMaxLat = maxLat + padLat;
  const viewMinLng = minLng - padLng;
  const viewMaxLng = maxLng + padLng;

  const width = 800;
  const height = 256;

  const toX = (lng: number) => ((lng - viewMinLng) / (viewMaxLng - viewMinLng)) * width;
  const toY = (lat: number) => height - ((lat - viewMinLat) / (viewMaxLat - viewMinLat)) * height;

  const pathData = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.lng).toFixed(1)} ${toY(p.lat).toFixed(1)}`)
    .join(' ');

  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  return (
    <div className="w-full h-full bg-slate-900 relative">
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <path d={pathData} fill="none" stroke="#4338ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        <path d={pathData} fill="none" stroke="#4338ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
        {/* Start marker */}
        <circle cx={toX(startPoint.lng)} cy={toY(startPoint.lat)} r="6" fill="#22c55e" stroke="#fff" strokeWidth="2" />
        {/* End marker */}
        <circle cx={toX(endPoint.lng)} cy={toY(endPoint.lat)} r="6" fill="#ef4444" stroke="#fff" strokeWidth="2" />
      </svg>
    </div>
  );
}

interface ActivityFeedProps {
  activities: ActivityEntry[];
  syncing: boolean;
  lastSyncTime: string | null;
  onSync: () => void;
}

export function ActivityFeed({ activities, syncing, lastSyncTime, onSync }: ActivityFeedProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#4338ff]" />
          <h2 className="text-sm sm:text-base font-bold text-white">Recent Activities</h2>
          {lastSyncTime && <span className="text-xs text-slate-500 ml-2">Synced {lastSyncTime}</span>}
        </div>
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>

      {activities.length === 0 && !syncing && (
        <div className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-8 text-center">
          <Activity className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No activities yet. Connect athletes to Garmin to see their runs here.</p>
        </div>
      )}

      {activities.length > 0 && (
        <div className="space-y-3">
          {activities.map((act) => (
            <ActivityCard key={act.id} activity={act} />
          ))}
        </div>
      )}
    </section>
  );
}
