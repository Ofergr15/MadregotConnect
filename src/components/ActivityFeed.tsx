'use client';

import { useState, useEffect, useRef } from 'react';
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

function getPaceColor(pace: number, minPace: number, maxPace: number): string {
  const range = maxPace - minPace || 1;
  const ratio = (pace - minPace) / range;
  if (ratio < 0.25) return '#22c55e';
  if (ratio < 0.5) return '#eab308';
  if (ratio < 0.75) return '#f97316';
  return '#ef4444';
}

function catmullRom(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

// ─── Leaflet Map ───────────────────────────────────────────────────────────────

function RouteMap({ points, height = 300, splits }: {
  points: Array<{ lat: number; lng: number }>;
  height?: number;
  splits?: Split[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [colorByPace, setColorByPace] = useState(false);

  useEffect(() => {
    if (!mapRef.current || points.length < 2) return;

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const initMap = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;

      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      const latlngs = points.map(p => [p.lat, p.lng]);

      if (colorByPace && splits && splits.length > 1) {
        const paces = splits.map(s => s.averagePace);
        const minP = Math.min(...paces);
        const maxP = Math.max(...paces);
        const ptsPerSplit = Math.floor(points.length / splits.length);

        for (let i = 0; i < splits.length; i++) {
          const start = i * ptsPerSplit;
          const end = i === splits.length - 1 ? points.length : (i + 1) * ptsPerSplit + 1;
          const segment = latlngs.slice(start, end);
          if (segment.length < 2) continue;
          L.polyline(segment, { color: getPaceColor(splits[i].averagePace, minP, maxP), weight: 5, opacity: 0.9 }).addTo(map);
        }
      } else {
        L.polyline(latlngs, { color: '#4338ff', weight: 4, opacity: 0.9 }).addTo(map);
        L.polyline(latlngs, { color: '#4338ff', weight: 8, opacity: 0.2 }).addTo(map);
      }

      L.circleMarker(latlngs[0], { radius: 7, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
      mapInstance.current = map;
    };

    if ((window as any).L) { initMap(); }
    else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = initMap;
      document.head.appendChild(script);
    }

    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, [points, colorByPace, splits]);

  if (points.length < 2) return null;

  return (
    <div className="relative">
      <div ref={mapRef} style={{ height: `${height}px` }} className="w-full rounded-xl" />
      {splits && splits.length > 1 && (
        <button
          onClick={() => setColorByPace(!colorByPace)}
          className={cn(
            'absolute top-3 right-3 z-[1000] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-lg',
            colorByPace ? 'bg-white text-slate-900' : 'bg-slate-800/90 text-slate-300 hover:text-white border border-slate-600'
          )}
        >
          {colorByPace ? '● Pace Colors' : '○ Color by Pace'}
        </button>
      )}
      {colorByPace && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-slate-800/90 rounded-lg px-3 py-2 flex items-center gap-2 text-[10px] font-medium shadow-lg">
          <span className="text-slate-400">Fast</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-2 rounded-sm bg-[#22c55e]" />
            <div className="w-4 h-2 rounded-sm bg-[#eab308]" />
            <div className="w-4 h-2 rounded-sm bg-[#f97316]" />
            <div className="w-4 h-2 rounded-sm bg-[#ef4444]" />
          </div>
          <span className="text-slate-400">Slow</span>
        </div>
      )}
    </div>
  );
}

// ─── Full-Width Pace Chart ─────────────────────────────────────────────────────

function PaceChart({ splits }: { splits: Split[] }) {
  if (splits.length < 2) return null;

  const width = 1000;
  const height = 200;
  const pad = { top: 20, right: 40, bottom: 36, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const paces = splits.map(s => s.averagePace);
  const maxPace = Math.max(...paces);
  const minPace = Math.min(...paces);
  const range = maxPace - minPace || 30;
  const viewMin = minPace - range * 0.15;
  const viewMax = maxPace + range * 0.15;

  const toX = (km: number) => pad.left + ((km - 1) / (splits.length - 1)) * chartW;
  const toY = (pace: number) => pad.top + chartH - ((viewMax - pace) / (viewMax - viewMin)) * chartH;

  const points = paces.map((p, i) => ({ x: toX(i + 1), y: toY(p) }));
  const linePath = catmullRom(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${pad.top + chartH} L ${points[0].x.toFixed(1)} ${pad.top + chartH} Z`;

  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps }, (_, i) => {
    const pace = viewMax - (viewMax - viewMin) * (i / (ySteps - 1));
    return { pace, y: toY(pace) };
  });

  const xInterval = splits.length > 20 ? 5 : splits.length > 10 ? 2 : 1;

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> Pace per KM
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '200px' }}>
        <defs>
          <linearGradient id="paceGradFW" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4338ff" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#4338ff" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {yLabels.map((l, i) => (
          <line key={i} x1={pad.left} x2={width - pad.right} y1={l.y} y2={l.y} stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#paceGradFW)" />
        <path d={linePath} fill="none" stroke="#4338ff" strokeWidth="3" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#4338ff" stroke="#1e1b4b" strokeWidth="2" />
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
        {splits.map((_, i) => {
          const km = i + 1;
          if (km % xInterval !== 0 && km !== splits.length) return null;
          return <text key={i} x={toX(km)} y={height - 12} textAnchor="middle" className="fill-slate-400" fontSize="11" fontWeight="500">{km}</text>;
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
        {yLabels.map((l, i) => (
          <text key={i} x={pad.left - 8} y={l.y + 4} textAnchor="end" className="fill-slate-400" fontSize="11">{formatPace(l.pace)}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── Full-Width Heart Rate Chart ───────────────────────────────────────────────

function HRChart({ splits, maxHR = 190 }: { splits: Split[]; maxHR?: number }) {
  const valid = splits.filter(s => s.averageHR);
  if (valid.length < 2) return null;

  const width = 1000;
  const height = 180;
  const pad = { top: 20, right: 40, bottom: 36, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const hrs = splits.map(s => s.averageHR || 0);
  const maxVal = Math.max(...hrs, maxHR * 0.9);
  const minVal = Math.min(...hrs.filter(h => h > 0), maxHR * 0.5);
  const range = maxVal - minVal || 30;
  const viewMin = Math.max(0, minVal - range * 0.1);
  const viewMax = maxVal + range * 0.1;

  const toX = (km: number) => pad.left + ((km - 1) / (splits.length - 1)) * chartW;
  const toY = (hr: number) => pad.top + chartH - ((hr - viewMin) / (viewMax - viewMin)) * chartH;

  const points = hrs.map((h, i) => ({ x: toX(i + 1), y: toY(h), hr: h }));
  const linePath = catmullRom(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${pad.top + chartH} L ${points[0].x.toFixed(1)} ${pad.top + chartH} Z`;

  const zones = [
    { min: 0, max: maxHR * 0.6, color: '#94a3b8' },
    { min: maxHR * 0.6, max: maxHR * 0.7, color: '#60a5fa' },
    { min: maxHR * 0.7, max: maxHR * 0.8, color: '#4ade80' },
    { min: maxHR * 0.8, max: maxHR * 0.9, color: '#fb923c' },
    { min: maxHR * 0.9, max: maxHR * 1.1, color: '#f87171' },
  ];

  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps }, (_, i) => {
    const hr = viewMin + (viewMax - viewMin) * (i / (ySteps - 1));
    return { hr: Math.round(hr), y: toY(hr) };
  }).reverse();

  const xInterval = splits.length > 20 ? 5 : splits.length > 10 ? 2 : 1;

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Heart className="h-3 w-3" /> Heart Rate
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '180px' }}>
        <defs>
          <linearGradient id="hrGradFW" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity={0.35} />
            <stop offset="50%" stopColor="#fb923c" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#fb923c" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {zones.map((z, i) => {
          const y1 = Math.max(toY(z.max), pad.top);
          const y2 = Math.min(toY(z.min), pad.top + chartH);
          if (y2 <= y1) return null;
          return <rect key={i} x={pad.left} y={y1} width={chartW} height={y2 - y1} fill={z.color} opacity={0.06} />;
        })}
        {yLabels.map((l, i) => (
          <line key={i} x1={pad.left} x2={width - pad.right} y1={l.y} y2={l.y} stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#hrGradFW)" />
        <path d={linePath} fill="none" stroke="#f87171" strokeWidth="3" strokeLinecap="round" />
        {points.map((p, i) => {
          const zone = getHRZone(p.hr, maxHR);
          return <circle key={i} cx={p.x} cy={p.y} r="4" fill={zone.bgColor} stroke="#1e1b4b" strokeWidth="2" />;
        })}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
        {splits.map((_, i) => {
          const km = i + 1;
          if (km % xInterval !== 0 && km !== splits.length) return null;
          return <text key={i} x={toX(km)} y={height - 12} textAnchor="middle" className="fill-slate-400" fontSize="11" fontWeight="500">{km}</text>;
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
        {yLabels.map((l, i) => (
          <text key={i} x={pad.left - 8} y={l.y + 4} textAnchor="end" className="fill-slate-400" fontSize="11">{l.hr}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── Full-Width Elevation Chart ────────────────────────────────────────────────

function ElevationChart({ splits }: { splits: Split[] }) {
  if (splits.length < 2) return null;

  const width = 1000;
  const height = 160;
  const pad = { top: 20, right: 40, bottom: 36, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  let cum = 0;
  const elevs = [0, ...splits.map(s => { cum += s.elevationGain || 0; return cum; })];
  const maxE = Math.max(...elevs, 1);
  const minE = Math.min(...elevs, 0);
  const range = maxE - minE || 1;
  const viewMin = minE - range * 0.1;
  const viewMax = maxE + range * 0.1;

  const toX = (i: number) => pad.left + (i / splits.length) * chartW;
  const toY = (e: number) => pad.top + chartH - ((e - viewMin) / (viewMax - viewMin)) * chartH;

  const points = elevs.map((e, i) => ({ x: toX(i), y: toY(e) }));
  const linePath = catmullRom(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${pad.top + chartH} L ${points[0].x.toFixed(1)} ${pad.top + chartH} Z`;

  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps }, (_, i) => {
    const e = viewMin + (viewMax - viewMin) * (i / (ySteps - 1));
    return { elev: Math.round(e), y: toY(e) };
  }).reverse();

  const xInterval = splits.length > 20 ? 5 : splits.length > 10 ? 2 : 1;

  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase text-slate-500 mb-2 flex items-center gap-1.5">
        <Mountain className="h-3 w-3" /> Elevation Profile
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '160px' }}>
        <defs>
          <linearGradient id="elevGradFW" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {yLabels.map((l, i) => (
          <line key={i} x1={pad.left} x2={width - pad.right} y1={l.y} y2={l.y} stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#elevGradFW)" />
        <path d={linePath} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" />
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
        {splits.map((_, i) => {
          const km = i + 1;
          if (km % xInterval !== 0 && km !== splits.length) return null;
          return <text key={i} x={toX(km)} y={height - 12} textAnchor="middle" className="fill-slate-400" fontSize="11" fontWeight="500">{km}</text>;
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
        {yLabels.map((l, i) => (
          <text key={i} x={pad.left - 8} y={l.y + 4} textAnchor="end" className="fill-slate-400" fontSize="11">{l.elev}m</text>
        ))}
      </svg>
    </div>
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
              isSlowest ? 'bg-red-500/5 border border-red-500/10' : 'bg-slate-900/30'
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
              <span className="col-span-2 text-slate-400 tabular-nums">{split.elevationGain != null ? `+${Math.round(split.elevationGain)}` : '—'}</span>
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
      const res = await fetch(`/api/garmin/activity-details?activityId=${activity.garmin_activity_id}&athleteId=${activity.athlete_id}`);
      if (res.ok) setDetails(await res.json());
    } catch { /* silent */ }
    finally { setLoadingDetails(false); }
  };

  const handleExpand = () => {
    if (!expanded) loadDetails();
    setExpanded(!expanded);
  };

  const splits = details?.splits || activity.splits || [];

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden">
      {/* Collapsed card */}
      <div className="p-4 sm:p-5 cursor-pointer hover:bg-slate-800/70 transition-colors" onClick={handleExpand}>
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

        <p className="text-base font-semibold text-white mb-3">{activity.activity_name}</p>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-700/50 px-4 sm:px-5 py-5 space-y-5">
          {loadingDetails && !details && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 text-slate-400 animate-spin" />
              <span className="text-sm text-slate-400 ml-2">Loading activity details...</span>
            </div>
          )}

          {/* Map */}
          {details?.gpsPoints && details.gpsPoints.length > 2 && (
            <div className="rounded-xl overflow-hidden border border-slate-700/30">
              <RouteMap points={details.gpsPoints} height={300} splits={splits} />
            </div>
          )}

          {/* Key Stats Banner */}
          <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 rounded-xl p-5 border border-slate-700/30">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">Distance</p>
                <p className="text-3xl font-black text-white tabular-nums">{distKm}<span className="text-sm text-slate-400 ml-1">km</span></p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Pace</p>
                <p className="text-3xl font-black text-white tabular-nums">{paceStr || '—'}<span className="text-sm text-slate-400 ml-1">/km</span></p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Time</p>
                <p className="text-3xl font-black text-white tabular-nums">{durationStr}</p>
                {movingStr && movingStr !== durationStr && (
                  <p className="text-[10px] text-slate-500 mt-0.5">{movingStr} moving</p>
                )}
              </div>
              {activity.average_hr && (
                <div className="hidden sm:block">
                  <p className="text-xs text-slate-400 mb-1">Avg HR</p>
                  <p className={cn("text-3xl font-black tabular-nums", hrZone?.color)}>{activity.average_hr}</p>
                  {hrZone && <p className="text-[10px] text-slate-500 mt-0.5">Zone {hrZone.zone} · {hrZone.label}</p>}
                </div>
              )}
              {activity.elevation_gain ? (
                <div className="hidden sm:block">
                  <p className="text-xs text-slate-400 mb-1">Elevation</p>
                  <p className="text-3xl font-black text-white tabular-nums">{Math.round(activity.elevation_gain)}<span className="text-sm text-slate-400 ml-1">m</span></p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Performance Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {(activity.calories || details?.summary?.calories) && (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Flame className="h-3.5 w-3.5 text-orange-400" />
                  <p className="text-[10px] font-bold uppercase text-slate-400">Calories</p>
                </div>
                <p className="text-2xl font-black text-white tabular-nums">{activity.calories || details?.summary?.calories}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">kcal</p>
              </div>
            )}
            {(activity.avg_cadence || details?.summary?.averageRunCadence) && (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Footprints className="h-3.5 w-3.5 text-cyan-400" />
                  <p className="text-[10px] font-bold uppercase text-slate-400">Cadence</p>
                </div>
                <p className="text-2xl font-black text-white tabular-nums">{Math.round(activity.avg_cadence || details?.summary?.averageRunCadence)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">steps/min</p>
              </div>
            )}
            {(activity.avg_stride_length || details?.summary?.strideLength) && (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="h-3.5 w-3.5 text-purple-400" />
                  <p className="text-[10px] font-bold uppercase text-slate-400">Stride</p>
                </div>
                <p className="text-2xl font-black text-white tabular-nums">
                  {activity.avg_stride_length
                    ? (activity.avg_stride_length > 10 ? (activity.avg_stride_length / 100).toFixed(2) : activity.avg_stride_length.toFixed(2))
                    : details?.summary?.strideLength?.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">meters</p>
              </div>
            )}
            {(activity.vo2max || details?.summary?.vO2MaxValue) && (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="h-3.5 w-3.5 text-yellow-400" />
                  <p className="text-[10px] font-bold uppercase text-slate-400">VO2 Max</p>
                </div>
                <p className="text-2xl font-black text-white tabular-nums">{activity.vo2max || details?.summary?.vO2MaxValue}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">ml/kg/min</p>
              </div>
            )}
            {activity.max_hr && (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Heart className="h-3.5 w-3.5 text-red-400" />
                  <p className="text-[10px] font-bold uppercase text-slate-400">Max HR</p>
                </div>
                <p className="text-2xl font-black text-white tabular-nums">{activity.max_hr}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">bpm</p>
              </div>
            )}
            {details?.summary?.trainingEffect && (
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className="h-3.5 w-3.5 text-blue-400" />
                  <p className="text-[10px] font-bold uppercase text-slate-400">Training Effect</p>
                </div>
                <div className="flex items-baseline gap-3">
                  <div>
                    <p className="text-xl font-black text-blue-400 tabular-nums">{details.summary.trainingEffect.toFixed(1)}</p>
                    <p className="text-[9px] text-slate-500">Aerobic</p>
                  </div>
                  {details.summary.anaerobicTrainingEffect && (
                    <div>
                      <p className="text-xl font-black text-orange-400 tabular-nums">{details.summary.anaerobicTrainingEffect.toFixed(1)}</p>
                      <p className="text-[9px] text-slate-500">Anaerobic</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Charts - Full Width Stacked */}
          {splits.length >= 2 && (
            <div className="space-y-4">
              <div className="bg-slate-900/40 rounded-xl p-4 border border-slate-700/20">
                <PaceChart splits={splits} />
              </div>
              {splits.some(s => s.averageHR) && (
                <div className="bg-slate-900/40 rounded-xl p-4 border border-slate-700/20">
                  <HRChart splits={splits} maxHR={activity.max_hr || 190} />
                </div>
              )}
              <div className="bg-slate-900/40 rounded-xl p-4 border border-slate-700/20">
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
