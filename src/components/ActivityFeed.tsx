'use client';

import { useState, useMemo } from 'react';
import {
  Activity, Heart, Timer, Route, TrendingUp,
  MapPin, ChevronDown, ChevronUp, Zap, Footprints, Mountain,
  Flame, RefreshCw, Clock,
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

// ─── Utilities ─────────────────────────────────────────────────────────────────

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

function getTimeLabel(startTime: string): string {
  const hour = new Date(startTime).getHours();
  if (hour < 6) return 'Night Run';
  if (hour < 12) return 'Morning Run';
  if (hour < 17) return 'Afternoon Run';
  return 'Evening Run';
}

function getHRZone(hr: number, maxHR = 190): { zone: number; label: string; color: string; bgColor: string } {
  const pct = hr / maxHR;
  if (pct < 0.6) return { zone: 1, label: 'Easy', color: 'text-slate-400', bgColor: '#94a3b8' };
  if (pct < 0.7) return { zone: 2, label: 'Aerobic', color: 'text-blue-400', bgColor: '#60a5fa' };
  if (pct < 0.8) return { zone: 3, label: 'Tempo', color: 'text-green-400', bgColor: '#4ade80' };
  if (pct < 0.9) return { zone: 4, label: 'Threshold', color: 'text-orange-400', bgColor: '#fb923c' };
  return { zone: 5, label: 'VO2max', color: 'text-red-400', bgColor: '#f87171' };
}

// ─── SVG Route Map ─────────────────────────────────────────────────────────────

function RouteMap({ points, height = 200, mini = false }: { points: Array<{ lat: number; lng: number }>; height?: number; mini?: boolean }) {
  if (points.length < 2) return null;

  const sampled = mini && points.length > 100
    ? points.filter((_, i) => i % Math.ceil(points.length / 80) === 0)
    : points;

  const minLat = Math.min(...sampled.map(p => p.lat));
  const maxLat = Math.max(...sampled.map(p => p.lat));
  const minLng = Math.min(...sampled.map(p => p.lng));
  const maxLng = Math.max(...sampled.map(p => p.lng));

  const padLat = (maxLat - minLat) * 0.12 || 0.001;
  const padLng = (maxLng - minLng) * 0.12 || 0.001;

  const vMinLat = minLat - padLat;
  const vMaxLat = maxLat + padLat;
  const vMinLng = minLng - padLng;
  const vMaxLng = maxLng + padLng;

  const width = mini ? 300 : 800;
  const h = mini ? 80 : height;

  const toX = (lng: number) => ((lng - vMinLng) / (vMaxLng - vMinLng)) * width;
  const toY = (lat: number) => h - ((lat - vMinLat) / (vMaxLat - vMinLat)) * h;

  const pathData = sampled
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.lng).toFixed(1)} ${toY(p.lat).toFixed(1)}`)
    .join(' ');

  const start = sampled[0];
  const end = sampled[sampled.length - 1];

  return (
    <div className={cn('w-full bg-slate-900/80 rounded-xl overflow-hidden', mini ? 'h-20' : '')}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="xMidYMid meet">
        <path d={pathData} fill="none" stroke="#4338ff" strokeWidth={mini ? 2 : 3} strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        <path d={pathData} fill="none" stroke="#4338ff" strokeWidth={mini ? 4 : 6} strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
        <circle cx={toX(start.lng)} cy={toY(start.lat)} r={mini ? 4 : 6} fill="#22c55e" stroke="#fff" strokeWidth={mini ? 1 : 2} />
        <circle cx={toX(end.lng)} cy={toY(end.lat)} r={mini ? 4 : 6} fill="#ef4444" stroke="#fff" strokeWidth={mini ? 1 : 2} />
      </svg>
    </div>
  );
}

// ─── Elevation Profile Chart ───────────────────────────────────────────────────

function ElevationChart({ splits }: { splits: Split[] }) {
  if (splits.length < 2) return null;

  const width = 600;
  const height = 140;
  const padding = { top: 10, right: 10, bottom: 24, left: 36 };

  const elevations = splits.map((s, i) => ({
    km: i + 1,
    elevation: s.elevationGain || 0,
  }));

  let cumulative = 0;
  const cumulativeElev = elevations.map(e => {
    cumulative += e.elevation;
    return cumulative;
  });
  cumulativeElev.unshift(0);

  const maxElev = Math.max(...cumulativeElev, 1);
  const minElev = Math.min(...cumulativeElev, 0);
  const range = maxElev - minElev || 1;

  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const toX = (km: number) => padding.left + (km / splits.length) * chartW;
  const toY = (elev: number) => padding.top + chartH - ((elev - minElev) / range) * chartH;

  const pathPoints = cumulativeElev.map((e, i) => ({ x: toX(i), y: toY(e) }));
  const linePath = pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L ${pathPoints[pathPoints.length - 1].x.toFixed(1)} ${padding.top + chartH} L ${pathPoints[0].x.toFixed(1)} ${padding.top + chartH} Z`;

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Mountain className="h-3 w-3" /> Elevation Profile
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '140px' }}>
        <defs>
          <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(pct => (
          <line key={pct} x1={padding.left} x2={width - padding.right}
            y1={padding.top + chartH * (1 - pct)} y2={padding.top + chartH * (1 - pct)}
            stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#elevGrad)" />
        <path d={linePath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
        {/* X axis labels */}
        {splits.map((_, i) => {
          if (splits.length > 10 && i % 2 !== 0) return null;
          return (
            <text key={i} x={toX(i + 1)} y={height - 4} textAnchor="middle" className="fill-slate-500" fontSize="9">
              {i + 1}
            </text>
          );
        })}
        {/* Y axis */}
        <text x={padding.left - 4} y={padding.top + 4} textAnchor="end" className="fill-slate-500" fontSize="9">
          {Math.round(maxElev)}m
        </text>
        <text x={padding.left - 4} y={padding.top + chartH} textAnchor="end" className="fill-slate-500" fontSize="9">
          {Math.round(minElev)}m
        </text>
      </svg>
    </div>
  );
}

// ─── Pace Chart ────────────────────────────────────────────────────────────────

function PaceChart({ splits }: { splits: Split[] }) {
  if (splits.length < 2) return null;

  const width = 600;
  const height = 140;
  const padding = { top: 10, right: 10, bottom: 24, left: 42 };

  const paces = splits.map(s => s.averagePace);
  const maxPace = Math.max(...paces);
  const minPace = Math.min(...paces);
  const range = maxPace - minPace || 30;
  const viewMin = minPace - range * 0.1;
  const viewMax = maxPace + range * 0.1;

  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const toX = (km: number) => padding.left + ((km - 1) / (splits.length - 1)) * chartW;
  // Invert Y: lower pace (faster) = higher on chart
  const toY = (pace: number) => padding.top + ((pace - viewMin) / (viewMax - viewMin)) * chartH;

  const points = paces.map((p, i) => ({ x: toX(i + 1), y: toY(p) }));

  // Smooth path with quadratic bezier
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    path += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)}, ${midX.toFixed(1)} ${curr.y.toFixed(1)}`;
  }

  const areaPath = path + ` L ${points[points.length - 1].x.toFixed(1)} ${padding.top + chartH} L ${points[0].x.toFixed(1)} ${padding.top + chartH} Z`;

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> Pace per KM
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '140px' }}>
        <defs>
          <linearGradient id="paceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4338ff" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#4338ff" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(pct => (
          <line key={pct} x1={padding.left} x2={width - padding.right}
            y1={padding.top + chartH * pct} y2={padding.top + chartH * pct}
            stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#paceGrad)" />
        <path d={path} fill="none" stroke="#4338ff" strokeWidth="2.5" strokeLinecap="round" />
        {/* Data points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="#4338ff" stroke="#1e1b4b" strokeWidth="1.5" />
        ))}
        {/* X axis */}
        {splits.map((_, i) => {
          if (splits.length > 10 && i % 2 !== 0) return null;
          return (
            <text key={i} x={toX(i + 1)} y={height - 4} textAnchor="middle" className="fill-slate-500" fontSize="9">
              {i + 1}
            </text>
          );
        })}
        {/* Y axis - pace labels (note: top = slower, bottom = faster for this chart) */}
        <text x={padding.left - 4} y={padding.top + 6} textAnchor="end" className="fill-slate-500" fontSize="9">
          {formatPace(viewMin)}
        </text>
        <text x={padding.left - 4} y={padding.top + chartH} textAnchor="end" className="fill-slate-500" fontSize="9">
          {formatPace(viewMax)}
        </text>
      </svg>
    </div>
  );
}

// ─── Heart Rate Zone Chart ─────────────────────────────────────────────────────

function HRChart({ splits, maxHR = 190 }: { splits: Split[]; maxHR?: number }) {
  const hrSplits = splits.filter(s => s.averageHR);
  if (hrSplits.length < 2) return null;

  const width = 600;
  const height = 140;
  const padding = { top: 10, right: 10, bottom: 24, left: 36 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const hrs = splits.map(s => s.averageHR || 0);
  const maxVal = Math.max(...hrs, maxHR * 0.95);
  const minVal = Math.min(...hrs.filter(h => h > 0), maxHR * 0.5);
  const range = maxVal - minVal || 30;
  const viewMin = minVal - range * 0.1;
  const viewMax = maxVal + range * 0.1;

  const toX = (km: number) => padding.left + ((km - 1) / (splits.length - 1)) * chartW;
  const toY = (hr: number) => padding.top + chartH - ((hr - viewMin) / (viewMax - viewMin)) * chartH;

  const points = hrs.map((h, i) => ({ x: toX(i + 1), y: toY(h), hr: h }));

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    path += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)}, ${midX.toFixed(1)} ${curr.y.toFixed(1)}`;
  }

  // Zone bands
  const zones = [
    { min: 0, max: maxHR * 0.6, color: '#94a3b8', label: 'Z1' },
    { min: maxHR * 0.6, max: maxHR * 0.7, color: '#60a5fa', label: 'Z2' },
    { min: maxHR * 0.7, max: maxHR * 0.8, color: '#4ade80', label: 'Z3' },
    { min: maxHR * 0.8, max: maxHR * 0.9, color: '#fb923c', label: 'Z4' },
    { min: maxHR * 0.9, max: maxHR, color: '#f87171', label: 'Z5' },
  ];

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Heart className="h-3 w-3" /> Heart Rate
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '140px' }}>
        {/* Zone background bands */}
        {zones.map(zone => {
          const y1 = Math.max(toY(zone.max), padding.top);
          const y2 = Math.min(toY(zone.min), padding.top + chartH);
          if (y2 <= y1) return null;
          return (
            <rect key={zone.label} x={padding.left} y={y1} width={chartW} height={y2 - y1}
              fill={zone.color} opacity={0.06} />
          );
        })}
        {/* Line */}
        <path d={path} fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
        {/* Points with zone colors */}
        {points.map((p, i) => {
          const zone = getHRZone(p.hr, maxHR);
          return (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill={zone.bgColor} stroke="#1e1b4b" strokeWidth="1.5" />
          );
        })}
        {/* X axis */}
        {splits.map((_, i) => {
          if (splits.length > 10 && i % 2 !== 0) return null;
          return (
            <text key={i} x={toX(i + 1)} y={height - 4} textAnchor="middle" className="fill-slate-500" fontSize="9">
              {i + 1}
            </text>
          );
        })}
        {/* Y axis */}
        <text x={padding.left - 4} y={padding.top + 6} textAnchor="end" className="fill-slate-500" fontSize="9">
          {Math.round(viewMax)}
        </text>
        <text x={padding.left - 4} y={padding.top + chartH} textAnchor="end" className="fill-slate-500" fontSize="9">
          {Math.round(viewMin)}
        </text>
      </svg>
    </div>
  );
}

// ─── Elevation Sparkline (for card preview) ────────────────────────────────────

function ElevationSparkline({ splits }: { splits: Split[] }) {
  if (splits.length < 2) return null;

  let cumulative = 0;
  const points = splits.map((s, i) => {
    cumulative += s.elevationGain || 0;
    return cumulative;
  });
  points.unshift(0);

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const width = 120;
  const height = 20;

  const pathData = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 2);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = pathData + ` L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-5 mt-1">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={pathData} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Splits Table ──────────────────────────────────────────────────────────────

function SplitsTable({ splits }: { splits: Split[] }) {
  if (splits.length === 0) return null;

  const fastest = splits.reduce((min, s) => s.averagePace < min.averagePace ? s : min, splits[0]);
  const slowest = splits.reduce((max, s) => s.averagePace > max.averagePace ? s : max, splits[0]);
  const paceRange = slowest.averagePace - fastest.averagePace || 1;

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> Splits
      </h4>
      <div className="space-y-1">
        <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold uppercase text-slate-500 px-3 pb-1">
          <span className="col-span-1">KM</span>
          <span className="col-span-4">Pace</span>
          <span className="col-span-3">Time</span>
          <span className="col-span-2">HR</span>
          <span className="col-span-2">Elev</span>
        </div>
        {splits.map((split, i) => {
          const isFastest = split.averagePace === fastest.averagePace;
          const isSlowest = split.averagePace === slowest.averagePace;
          const pacePos = 1 - ((split.averagePace - fastest.averagePace) / paceRange);

          return (
            <div key={i} className={cn(
              'grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-lg text-sm',
              isFastest ? 'bg-green-500/10 border border-green-500/20' :
              isSlowest ? 'bg-red-500/5 border border-red-500/10' :
              'bg-slate-900/30'
            )}>
              <span className="col-span-1 text-xs font-bold text-slate-400">{i + 1}</span>
              <div className="col-span-4 flex items-center gap-2">
                <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', isFastest ? 'bg-green-400' : isSlowest ? 'bg-red-400' : 'bg-[#4338ff]')}
                    style={{ width: `${Math.max(20, pacePos * 100)}%` }}
                  />
                </div>
                <span className={cn('font-bold tabular-nums', isFastest ? 'text-green-400' : isSlowest ? 'text-red-400' : 'text-white')}>
                  {formatPace(split.averagePace)}
                </span>
              </div>
              <span className="col-span-3 text-slate-300 tabular-nums">{formatDuration(split.duration)}</span>
              <span className="col-span-2 text-slate-400 tabular-nums">{split.averageHR || '—'}</span>
              <span className="col-span-2 text-slate-400 tabular-nums">
                {split.elevationGain != null ? `+${Math.round(split.elevationGain)}` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Activity Card ─────────────────────────────────────────────────────────────

function ActivityCard({ activity }: { activity: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<ActivityDetailsData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const distKm = (activity.distance / 1000).toFixed(1);
  const paceStr = activity.average_pace ? formatPace(activity.average_pace) : null;
  const durationStr = formatDuration(activity.duration);
  const movingStr = activity.moving_duration ? formatDuration(activity.moving_duration) : null;
  const dateStr = new Date(activity.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = new Date(activity.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const timeLabel = getTimeLabel(activity.start_time);
  const hrZone = activity.average_hr ? getHRZone(activity.average_hr) : null;

  const loadDetails = async () => {
    if (details || loadingDetails) return;
    setLoadingDetails(true);
    try {
      const res = await fetch(
        `/api/garmin/activity-details?activityId=${activity.garmin_activity_id}&athleteId=${activity.athlete_id}`
      );
      if (res.ok) {
        setDetails(await res.json());
      }
    } catch { /* silent */ }
    finally { setLoadingDetails(false); }
  };

  const handleExpand = () => {
    if (!expanded) loadDetails();
    setExpanded(!expanded);
  };

  const splits = details?.splits || activity.splits || [];

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden transition-all">
      {/* Collapsed card */}
      <div className="p-4 sm:p-5 cursor-pointer hover:bg-slate-800/70 transition-colors" onClick={handleExpand}>
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#4338ff]/15 flex items-center justify-center">
              <Route className="h-4 w-4 text-[#4338ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{activity.athlete_name || 'Unknown'}</span>
                <span className="text-xs text-slate-500">{dateStr} · {timeStr}</span>
              </div>
              <p className="text-xs text-slate-500">{timeLabel}{activity.location_name ? ` · ${activity.location_name}` : ''}</p>
            </div>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>

        {/* Activity name */}
        <p className="text-base font-semibold text-white mb-3">{activity.activity_name}</p>

        {/* Stats + optional mini map */}
        <div className="flex items-end gap-4">
          <div className="flex-1 grid grid-cols-3 sm:grid-cols-5 gap-3">
            <div>
              <p className="text-[10px] text-slate-500 font-medium">Distance</p>
              <p className="text-lg font-black text-white tabular-nums">{distKm}<span className="text-xs text-slate-400 ml-0.5">km</span></p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-medium">Pace</p>
              <p className="text-lg font-black text-white tabular-nums">{paceStr || '—'}<span className="text-xs text-slate-400 ml-0.5">/km</span></p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-medium">Time</p>
              <p className="text-lg font-black text-white tabular-nums">{durationStr}</p>
            </div>
            {activity.average_hr && (
              <div className="hidden sm:block">
                <p className="text-[10px] text-slate-500 font-medium">Avg HR</p>
                <p className={cn("text-lg font-black tabular-nums flex items-center gap-1", hrZone?.color)}>
                  <Heart className="h-3.5 w-3.5" />{activity.average_hr}
                </p>
              </div>
            )}
            {activity.elevation_gain && activity.elevation_gain > 0 ? (
              <div className="hidden sm:block">
                <p className="text-[10px] text-slate-500 font-medium">Elevation</p>
                <p className="text-lg font-black text-white tabular-nums flex items-center gap-1">
                  <Mountain className="h-3.5 w-3.5 text-green-400" />{Math.round(activity.elevation_gain)}<span className="text-xs text-slate-400">m</span>
                </p>
              </div>
            ) : null}
          </div>

          {/* Mini sparkline for elevation if splits available */}
          {(activity.splits && activity.splits.length > 0) && (
            <div className="hidden sm:block w-28 flex-shrink-0">
              <ElevationSparkline splits={activity.splits} />
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail view */}
      {expanded && (
        <div className="border-t border-slate-700/50 px-4 sm:px-5 py-5 space-y-5">
          {/* Loading state */}
          {loadingDetails && !details && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 text-slate-400 animate-spin" />
              <span className="text-sm text-slate-400 ml-2">Loading activity details...</span>
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {movingStr && movingStr !== durationStr && (
              <StatCard label="Moving Time" value={movingStr} icon={<Clock className="h-3 w-3 text-blue-400" />} />
            )}
            {activity.calories && (
              <StatCard label="Calories" value={`${activity.calories}`} icon={<Flame className="h-3 w-3 text-orange-400" />} />
            )}
            {activity.avg_cadence && (
              <StatCard label="Cadence" value={`${Math.round(activity.avg_cadence)} spm`} icon={<Footprints className="h-3 w-3 text-cyan-400" />} />
            )}
            {activity.avg_stride_length && (
              <StatCard label="Stride" value={`${(activity.avg_stride_length / 100).toFixed(2)} m`} icon={<TrendingUp className="h-3 w-3 text-purple-400" />} />
            )}
            {activity.max_hr && (
              <StatCard label="Max HR" value={`${activity.max_hr} bpm`} icon={<Heart className="h-3 w-3 text-red-400" />} />
            )}
            {activity.vo2max && (
              <StatCard label="VO2 Max" value={`${activity.vo2max}`} icon={<Zap className="h-3 w-3 text-green-400" />} />
            )}
            {activity.elevation_gain && (
              <StatCard label="Elev Gain" value={`${Math.round(activity.elevation_gain)} m`} icon={<Mountain className="h-3 w-3 text-green-400" />} />
            )}
            {activity.lap_count && activity.lap_count > 1 && (
              <StatCard label="Laps" value={`${activity.lap_count}`} icon={<Route className="h-3 w-3 text-[#4338ff]" />} />
            )}
          </div>

          {/* Route Map */}
          {details?.gpsPoints && details.gpsPoints.length > 2 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Route
              </h4>
              <div className="rounded-xl overflow-hidden border border-slate-700/30" style={{ height: '220px' }}>
                <RouteMap points={details.gpsPoints} height={220} />
              </div>
            </div>
          )}

          {/* Charts */}
          {splits.length >= 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-slate-900/40 rounded-xl p-3 border border-slate-700/20">
                <PaceChart splits={splits} />
              </div>
              <div className="bg-slate-900/40 rounded-xl p-3 border border-slate-700/20">
                <HRChart splits={splits} maxHR={activity.max_hr || 190} />
              </div>
              <div className="bg-slate-900/40 rounded-xl p-3 border border-slate-700/20">
                <ElevationChart splits={splits} />
              </div>
            </div>
          )}

          {/* Splits Table */}
          {splits.length > 0 && <SplitsTable splits={splits} />}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card Helper ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-slate-900/50 rounded-xl p-3">
      <p className="text-[10px] font-semibold uppercase text-slate-500 flex items-center gap-1">{icon}{label}</p>
      <p className="text-sm font-bold text-white tabular-nums mt-1">{value}</p>
    </div>
  );
}

// ─── Activity Feed (exported) ──────────────────────────────────────────────────

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
          {activities.map(act => (
            <ActivityCard key={act.id} activity={act} />
          ))}
        </div>
      )}
    </section>
  );
}
