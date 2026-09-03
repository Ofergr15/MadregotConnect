'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Heart, Timer, Route, TrendingUp,
  MapPin, ChevronDown, ChevronUp, Zap, Footprints, Mountain,
  Flame, RefreshCw, Gauge, MessageCircle, Share2,
} from 'lucide-react';
import { cn, formatActivityTime, formatActivityDate, activityLocalHour, activityLocalDay, activityLocalDateStr } from '@/lib/utils';
import { fetchActivityDetails } from '@/lib/activities-client';
import { apiHeaders } from '@/lib/api';
import { projectBandsToBins, PlannedKmPoint } from '@/lib/academy/segments';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';

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
  gps_points?: Array<{ lat: number; lng: number }> | null;
  splits?: Split[] | null;
  athlete_name?: string;
}

interface Split {
  distance: number;
  duration: number;
  averagePace: number;
  averageHR: number | null;
  elevationGain: number | null;
  elevationLoss?: number | null;
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
  const hour = activityLocalHour(startTime);
  if (hour < 6) return 'Night Run';
  if (hour < 12) return 'Morning Run';
  if (hour < 17) return 'Afternoon Run';
  return 'Evening Run';
}

function inferRunTypeFromActivity(distanceKm: number, avgPaceSec: number | null): { type: string; label: string; color: string; bg: string } {
  const types: Record<string, { label: string; color: string; bg: string }> = {
    long_run: { label: 'Long Run', color: 'text-purple-600', bg: 'bg-purple-500/15' },
    tempo: { label: 'Tempo', color: 'text-band-3', bg: 'bg-band-3/15' },
    intervals: { label: 'Intervals', color: 'text-accent-red', bg: 'bg-accent-red/15' },
    easy: { label: 'Easy', color: 'text-accent-600', bg: 'bg-accent-600/15' },
    recovery: { label: 'Recovery', color: 'text-ink-400', bg: 'bg-ink-300/15' },
  };

  if (distanceKm >= 16) return { type: 'long_run', ...types.long_run };
  if (avgPaceSec && avgPaceSec < 270 && distanceKm >= 8) return { type: 'tempo', ...types.tempo };
  if (avgPaceSec && avgPaceSec < 290 && distanceKm >= 6 && distanceKm < 14) return { type: 'intervals', ...types.intervals };
  if (distanceKm < 7 && avgPaceSec && avgPaceSec > 330) return { type: 'recovery', ...types.recovery };
  return { type: 'easy', ...types.easy };
}

function getHRZone(hr: number, maxHR = 190): { zone: number; label: string; color: string; bgColor: string } {
  const pct = hr / maxHR;
  if (pct < 0.6) return { zone: 1, label: 'Easy', color: 'text-ink-400', bgColor: '#969696' };
  if (pct < 0.7) return { zone: 2, label: 'Aerobic', color: 'text-band-2', bgColor: '#60a5fa' };
  if (pct < 0.8) return { zone: 3, label: 'Tempo', color: 'text-accent-600', bgColor: '#16a34a' };
  if (pct < 0.9) return { zone: 4, label: 'Threshold', color: 'text-band-3', bgColor: '#fb923c' };
  return { zone: 5, label: 'VO2max', color: 'text-accent-red', bgColor: '#D74E4E' };
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
        // Don't hijack page scroll when the cursor is over the map.
        scrollWheelZoom: false,
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
        L.polyline(latlngs, { color: '#1525FF', weight: 4, opacity: 0.9 }).addTo(map);
        L.polyline(latlngs, { color: '#1525FF', weight: 8, opacity: 0.2 }).addTo(map);
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
    <div className="relative" style={{ zIndex: 0 }}>
      <div ref={mapRef} style={{ height: `${height}px`, position: 'relative', zIndex: 0 }} className="w-full rounded-xl" />
      {splits && splits.length > 1 && (
        <button
          onClick={() => setColorByPace(!colorByPace)}
          className={cn(
            'absolute top-3 end-3 z-[1000] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-lg',
            colorByPace ? 'bg-white text-ink-900' : 'bg-card/90 text-ink-500 hover:text-ink-900 border border-ink-300'
          )}
        >
          {colorByPace ? '● Pace Colors' : '○ Color by Pace'}
        </button>
      )}
      {colorByPace && (
        <div className="absolute bottom-3 start-3 z-[1000] bg-card/90 rounded-lg px-3 py-2 flex items-center gap-2 text-3xs font-medium shadow-lg">
          <span className="text-ink-400">Fast</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-2 rounded-sm bg-[#22c55e]" />
            <div className="w-4 h-2 rounded-sm bg-[#eab308]" />
            <div className="w-4 h-2 rounded-sm bg-[#f97316]" />
            <div className="w-4 h-2 rounded-sm bg-[#ef4444]" />
          </div>
          <span className="text-ink-400">Slow</span>
        </div>
      )}
    </div>
  );
}

// ─── Interactive Chart Tooltip Hook ────────────────────────────────────────────

function useChartHover(pointCount: number) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>, padLeft: number, chartW: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relX = (x / rect.width) * 1000;
    const idx = Math.round(((relX - padLeft) / chartW) * (pointCount - 1));
    if (idx >= 0 && idx < pointCount) setHoverIdx(idx);
    else setHoverIdx(null);
  };

  const handleMouseLeave = () => setHoverIdx(null);

  return { hoverIdx, svgRef, handleMouseMove, handleMouseLeave };
}

// ─── Full-Width Pace Chart ─────────────────────────────────────────────────────

function PaceChart({ splits, planned }: { splits: Split[]; planned?: (PlannedKmPoint | null)[] }) {
  const { hoverIdx, svgRef, handleMouseMove, handleMouseLeave } = useChartHover(splits.length);

  if (splits.length < 2) return null;

  const width = 1000;
  const height = 220;
  const pad = { top: 24, right: 40, bottom: 36, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const paces = splits.map(s => s.averagePace);
  // The planned band (aligned per-km with the splits) may sit outside the actual
  // pace range — include its values in the y-domain so the plan is never clipped.
  const hasPlan = Array.isArray(planned) && planned.some(p => p != null);
  const domainVals = [...paces];
  if (hasPlan) {
    planned!.forEach(p => { if (p) { domainVals.push(p.min, p.max); } });
  }
  const maxPace = Math.max(...domainVals);
  const minPace = Math.min(...domainVals);
  const dataRange = maxPace - minPace;
  const padding = Math.max(dataRange * 0.1, 15);
  const viewMin = minPace - padding;
  const viewMax = maxPace + padding;

  const toX = (km: number) => pad.left + ((km - 1) / (splits.length - 1)) * chartW;
  const toY = (pace: number) => pad.top + chartH - ((viewMax - pace) / (viewMax - viewMin)) * chartH;

  const points = paces.map((p, i) => ({ x: toX(i + 1), y: toY(p) }));
  const linePath = catmullRom(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${pad.top + chartH} L ${points[0].x.toFixed(1)} ${pad.top + chartH} Z`;

  const ySteps = 5;
  const yLabels = Array.from({ length: ySteps }, (_, i) => {
    const pace = viewMax - (viewMax - viewMin) * (i / (ySteps - 1));
    return { pace, y: toY(pace) };
  });

  const xInterval = splits.length > 20 ? 5 : splits.length > 10 ? 2 : 1;

  // Planned overlay: split into contiguous runs of paced kms (gaps = null), so
  // the dashed center line + shaded band break wherever the plan has no target.
  const plannedRuns: Array<Array<{ i: number; p: PlannedKmPoint }>> = [];
  if (hasPlan) {
    let cur: Array<{ i: number; p: PlannedKmPoint }> = [];
    planned!.slice(0, splits.length).forEach((p, i) => {
      if (p) cur.push({ i, p });
      else if (cur.length) { plannedRuns.push(cur); cur = []; }
    });
    if (cur.length) plannedRuns.push(cur);
  }
  const bandArea = (run: Array<{ i: number; p: PlannedKmPoint }>): string => {
    // Upper edge (fastest = smaller sec) left→right, lower edge (slowest) right→left.
    const top = run.map(({ i, p }) => ({ x: toX(i + 1), y: toY(p.min) }));
    const bot = run.map(({ i, p }) => ({ x: toX(i + 1), y: toY(p.max) })).reverse();
    const pts = [...top, ...bot];
    return 'M ' + pts.map(pt => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' L ') + ' Z';
  };

  return (
    <div>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> Pace per KM
        {hasPlan && <span className="text-3xs text-accent-600 ms-2">— dashed = planned</span>}
      </h4>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: '220px' }}
        onMouseMove={e => handleMouseMove(e, pad.left, chartW)}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="paceGradFW" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1525FF" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#1525FF" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {yLabels.map((l, i) => (
          <line key={i} x1={pad.left} x2={width - pad.right} y1={l.y} y2={l.y} stroke="#DFDFDF" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#paceGradFW)" />
        {/* Planned pace band + dashed center, per contiguous paced run. */}
        {plannedRuns.map((run, k) => (
          <g key={`plan-${k}`}>
            <path d={bandArea(run)} fill="#22c55e" opacity={0.1} />
            <path
              d={catmullRom(run.map(({ i, p }) => ({ x: toX(i + 1), y: toY(p.pace) })))}
              fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="8 4" opacity={0.75}
            />
          </g>
        ))}
        <path d={linePath} fill="none" stroke="#1525FF" strokeWidth="3" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hoverIdx === i ? 6 : 3.5} fill="#1525FF" stroke="#FFFFFF" strokeWidth="2" className="transition-all" />
        ))}
        {hoverIdx !== null && (
          <g>
            <line x1={points[hoverIdx].x} x2={points[hoverIdx].x} y1={pad.top} y2={pad.top + chartH} stroke="#1525FF" strokeWidth="1" opacity={0.4} strokeDasharray="3 3" />
            <rect x={points[hoverIdx].x - 40} y={points[hoverIdx].y - 28} width="80" height="22" rx="4" fill="#1D1E26" stroke="#1525FF" strokeWidth="1" />
            <text x={points[hoverIdx].x} y={points[hoverIdx].y - 14} textAnchor="middle" className="fill-white" fontSize="12" fontWeight="700">
              {formatPace(paces[hoverIdx])} /km
            </text>
            <text x={points[hoverIdx].x} y={pad.top + chartH + 14} textAnchor="middle" className="fill-ink-500" fontSize="10" fontWeight="600">
              KM {hoverIdx + 1}
            </text>
          </g>
        )}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#BBBBBB" strokeWidth="1" />
        {splits.map((_, i) => {
          const km = i + 1;
          if (km % xInterval !== 0 && km !== splits.length) return null;
          return <text key={i} x={toX(km)} y={height - 12} textAnchor="middle" className="fill-ink-400" fontSize="11" fontWeight="500">{km}</text>;
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + chartH} stroke="#BBBBBB" strokeWidth="1" />
        {yLabels.map((l, i) => (
          <text key={i} x={pad.left - 8} y={l.y + 4} textAnchor="end" className="fill-ink-400" fontSize="11">{formatPace(l.pace)}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── Full-Width Heart Rate Chart ───────────────────────────────────────────────

function HRChart({ splits, maxHR = 190 }: { splits: Split[]; maxHR?: number }) {
  const { hoverIdx, svgRef, handleMouseMove, handleMouseLeave } = useChartHover(splits.length);
  const valid = splits.filter(s => s.averageHR);
  if (valid.length < 2) return null;

  const width = 1000;
  const height = 200;
  const pad = { top: 24, right: 40, bottom: 36, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const hrs = splits.map(s => s.averageHR || 0);
  const validHrs = hrs.filter(h => h > 0);
  const maxVal = Math.max(...validHrs);
  const minVal = Math.min(...validHrs);
  const dataRange = maxVal - minVal;
  const padding = Math.max(dataRange * 0.15, 10);
  const viewMin = Math.max(0, minVal - padding);
  const viewMax = maxVal + padding;

  const toX = (km: number) => pad.left + ((km - 1) / (splits.length - 1)) * chartW;
  const toY = (hr: number) => pad.top + chartH - ((hr - viewMin) / (viewMax - viewMin)) * chartH;

  const points = hrs.map((h, i) => ({ x: toX(i + 1), y: toY(h), hr: h }));
  const linePath = catmullRom(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${pad.top + chartH} L ${points[0].x.toFixed(1)} ${pad.top + chartH} Z`;

  const zones = [
    { min: 0, max: maxHR * 0.6, color: '#969696' },
    { min: maxHR * 0.6, max: maxHR * 0.7, color: '#60a5fa' },
    { min: maxHR * 0.7, max: maxHR * 0.8, color: '#16a34a' },
    { min: maxHR * 0.8, max: maxHR * 0.9, color: '#fb923c' },
    { min: maxHR * 0.9, max: maxHR * 1.1, color: '#D74E4E' },
  ];

  const ySteps = 5;
  const yLabels = Array.from({ length: ySteps }, (_, i) => {
    const hr = viewMin + (viewMax - viewMin) * (i / (ySteps - 1));
    return { hr: Math.round(hr), y: toY(hr) };
  }).reverse();

  const xInterval = splits.length > 20 ? 5 : splits.length > 10 ? 2 : 1;

  return (
    <div>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex items-center gap-1.5">
        <Heart className="h-3 w-3" /> Heart Rate
      </h4>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: '200px' }}
        onMouseMove={e => handleMouseMove(e, pad.left, chartW)}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="hrGradFW" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D74E4E" stopOpacity={0.3} />
            <stop offset="50%" stopColor="#fb923c" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#fb923c" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {zones.map((z, i) => {
          const y1 = Math.max(toY(z.max), pad.top);
          const y2 = Math.min(toY(z.min), pad.top + chartH);
          if (y2 <= y1) return null;
          return <rect key={i} x={pad.left} y={y1} width={chartW} height={y2 - y1} fill={z.color} opacity={0.05} />;
        })}
        {yLabels.map((l, i) => (
          <line key={i} x1={pad.left} x2={width - pad.right} y1={l.y} y2={l.y} stroke="#DFDFDF" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <path d={areaPath} fill="url(#hrGradFW)" />
        <path d={linePath} fill="none" stroke="#D74E4E" strokeWidth="3" strokeLinecap="round" />
        {points.map((p, i) => {
          const zone = getHRZone(p.hr, maxHR);
          return <circle key={i} cx={p.x} cy={p.y} r={hoverIdx === i ? 6 : 3.5} fill={zone.bgColor} stroke="#FFFFFF" strokeWidth="2" className="transition-all" />;
        })}
        {hoverIdx !== null && hrs[hoverIdx] > 0 && (
          <g>
            <line x1={points[hoverIdx].x} x2={points[hoverIdx].x} y1={pad.top} y2={pad.top + chartH} stroke="#D74E4E" strokeWidth="1" opacity={0.4} strokeDasharray="3 3" />
            <rect x={points[hoverIdx].x - 42} y={points[hoverIdx].y - 28} width="84" height="22" rx="4" fill="#1D1E26" stroke="#D74E4E" strokeWidth="1" />
            <text x={points[hoverIdx].x} y={points[hoverIdx].y - 14} textAnchor="middle" className="fill-white" fontSize="12" fontWeight="700">
              {hrs[hoverIdx]} bpm
            </text>
            <text x={points[hoverIdx].x} y={pad.top + chartH + 14} textAnchor="middle" className="fill-ink-500" fontSize="10" fontWeight="600">
              KM {hoverIdx + 1}
            </text>
          </g>
        )}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#BBBBBB" strokeWidth="1" />
        {splits.map((_, i) => {
          const km = i + 1;
          if (km % xInterval !== 0 && km !== splits.length) return null;
          return <text key={i} x={toX(km)} y={height - 12} textAnchor="middle" className="fill-ink-400" fontSize="11" fontWeight="500">{km}</text>;
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + chartH} stroke="#BBBBBB" strokeWidth="1" />
        {yLabels.map((l, i) => (
          <text key={i} x={pad.left - 8} y={l.y + 4} textAnchor="end" className="fill-ink-400" fontSize="11">{l.hr}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── Full-Width Elevation Chart (Gain + Loss per KM) ──────────────────────────

function ElevationChart({ splits }: { splits: Split[] }) {
  const { hoverIdx, svgRef, handleMouseMove, handleMouseLeave } = useChartHover(splits.length);

  if (splits.length < 2) return null;

  const width = 1000;
  const height = 180;
  const pad = { top: 24, right: 40, bottom: 36, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const gains = splits.map(s => s.elevationGain || 0);
  const losses = splits.map(s => s.elevationLoss || 0);
  const maxGain = Math.max(...gains, 1);
  const maxLoss = Math.max(...losses, 0);
  const maxVal = Math.max(maxGain, maxLoss);

  const barW = Math.min(chartW / splits.length * 0.7, 24);
  const gap = chartW / splits.length;
  const midY = pad.top + chartH * 0.5;
  const halfH = chartH * 0.45;

  const toX = (i: number) => pad.left + (i + 0.5) * gap;

  const xInterval = splits.length > 20 ? 5 : splits.length > 10 ? 2 : 1;

  return (
    <div>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex items-center gap-1.5">
        <Mountain className="h-3 w-3" /> Elevation per KM
        <span className="ms-2 flex items-center gap-2 text-3xs">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-600/80" /> gain</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-red/80" /> loss</span>
        </span>
      </h4>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: '180px' }}
        onMouseMove={e => handleMouseMove(e, pad.left, chartW)}
        onMouseLeave={handleMouseLeave}
      >
        <line x1={pad.left} x2={width - pad.right} y1={midY} y2={midY} stroke="#BBBBBB" strokeWidth="1" />
        {[0.25, 0.5, 0.75, 1].map((frac, i) => {
          const val = Math.round(maxVal * frac);
          const yUp = midY - (frac * halfH);
          const yDown = midY + (frac * halfH);
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={yUp} y2={yUp} stroke="#DFDFDF" strokeWidth="0.5" strokeDasharray="4 4" />
              {frac === 0.5 || frac === 1 ? (
                <>
                  <text x={pad.left - 8} y={yUp + 4} textAnchor="end" className="fill-accent-600/70" fontSize="10">+{val}m</text>
                  <text x={pad.left - 8} y={yDown + 4} textAnchor="end" className="fill-accent-red/70" fontSize="10">-{val}m</text>
                </>
              ) : null}
              <line x1={pad.left} x2={width - pad.right} y1={yDown} y2={yDown} stroke="#DFDFDF" strokeWidth="0.5" strokeDasharray="4 4" />
            </g>
          );
        })}
        {splits.map((_, i) => {
          const x = toX(i);
          const gainH = maxVal > 0 ? (gains[i] / maxVal) * halfH : 0;
          const lossH = maxVal > 0 ? (losses[i] / maxVal) * halfH : 0;
          const isHover = hoverIdx === i;
          return (
            <g key={i}>
              {gainH > 0 && (
                <rect x={x - barW / 2} y={midY - gainH} width={barW} height={gainH} rx="2"
                  fill={isHover ? '#22c55e' : '#22c55e'} opacity={isHover ? 0.9 : 0.6} className="transition-opacity" />
              )}
              {lossH > 0 && (
                <rect x={x - barW / 2} y={midY} width={barW} height={lossH} rx="2"
                  fill={isHover ? '#D74E4E' : '#D74E4E'} opacity={isHover ? 0.9 : 0.5} className="transition-opacity" />
              )}
            </g>
          );
        })}
        {hoverIdx !== null && (
          <g>
            <rect x={toX(hoverIdx) - 50} y={pad.top} width="100" height="22" rx="4" fill="#1D1E26" stroke="#BBBBBB" strokeWidth="1" />
            <text x={toX(hoverIdx)} y={pad.top + 15} textAnchor="middle" className="fill-white" fontSize="11" fontWeight="700">
              +{Math.round(gains[hoverIdx])}m / -{Math.round(losses[hoverIdx])}m
            </text>
          </g>
        )}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#BBBBBB" strokeWidth="1" />
        {splits.map((_, i) => {
          const km = i + 1;
          if (km % xInterval !== 0 && km !== splits.length) return null;
          return <text key={i} x={toX(i)} y={height - 12} textAnchor="middle" className="fill-ink-400" fontSize="11" fontWeight="500">{km}</text>;
        })}
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
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> Splits
      </h4>
      <div className="space-y-1">
        <div className="grid grid-cols-12 gap-2 text-3xs font-semibold uppercase text-ink-400 px-3 pb-1">
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
              isFastest ? 'bg-accent-600/10 border border-accent-600/20' :
              isSlowest ? 'bg-accent-red/5 border border-accent-red/10' : 'bg-page/30'
            )}>
              <span className="col-span-1 text-xs font-bold text-ink-400">{i + 1}</span>
              <div className="col-span-4 flex items-center gap-2">
                <div className="w-16 h-1.5 bg-page rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', isFastest ? 'bg-accent-600' : isSlowest ? 'bg-accent-red' : 'bg-brand-600')}
                    style={{ width: `${Math.max(20, pacePos * 100)}%` }}
                  />
                </div>
                <span className={cn('font-bold tabular-nums', isFastest ? 'text-accent-600' : isSlowest ? 'text-accent-red' : 'text-ink-700')}>
                  {formatPace(split.averagePace)}
                </span>
              </div>
              <span className="col-span-3 text-ink-500 tabular-nums">{formatDuration(split.duration)}</span>
              <span className="col-span-2 text-ink-400 tabular-nums">{split.averageHR || '—'}</span>
              <span className="col-span-2 text-ink-400 tabular-nums">
                {split.elevationGain != null ? <><span className="text-accent-600">+{Math.round(split.elevationGain)}</span>{split.elevationLoss ? <span className="text-accent-red ms-1">-{Math.round(split.elevationLoss)}</span> : null}</> : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Activity Card ─────────────────────────────────────────────────────────────

function ActivityCard({
  activity,
  myAthleteId,
  isStaff,
}: {
  activity: ActivityEntry;
  myAthleteId: string | null;
  isStaff: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const isMyActivity = !!myAthleteId && activity.athlete_id === myAthleteId;
  const runChatLabel = isStaff && !isMyActivity ? 'שוחח עם הרץ' : 'שוחח עם המאמן';
  const [details, setDetails] = useState<ActivityDetailsData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [planned, setPlanned] = useState<(PlannedKmPoint | null)[] | null>(null);
  // Manual re-open of the same customize-before-posting sheet the background
  // sync shows automatically once — this lets an athlete share (or edit the
  // sharing of) any past run, not just the one that was just synced.
  const [showShare, setShowShare] = useState(false);

  const distKm = (activity.distance / 1000).toFixed(1);
  const distKmNum = activity.distance / 1000;
  const paceStr = activity.average_pace ? formatPace(activity.average_pace) : null;
  const durationStr = formatDuration(activity.duration);
  const movingStr = activity.moving_duration ? formatDuration(activity.moving_duration) : null;
  const dateStr = formatActivityDate(activity.start_time);
  const timeStr = formatActivityTime(activity.start_time);
  const hebrewDays = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
  const dayLabel = hebrewDays[activityLocalDay(activity.start_time)];
  const timeLabel = getTimeLabel(activity.start_time);
  const hrZone = activity.average_hr ? getHRZone(activity.average_hr) : null;
  const runType = inferRunTypeFromActivity(distKmNum, activity.average_pace);

  const loadDetails = async () => {
    if (details || loadingDetails) return;
    setLoadingDetails(true);
    try {
      const res = await fetchActivityDetails(activity.id, activity.athlete_id);
      let liveSplits: Split[] = [];
      if (res.ok) {
        const d = await res.json();
        setDetails(d);
        if (Array.isArray(d?.splits)) liveSplits = d.splits;
      }
      // Overlay the day's planned pace, aligned to the ACTUAL split distances
      // (splits aren't always 1km — intervals auto-lap per step). Fetch the plan
      // as meter bands, then project onto each split's distance. Best-effort:
      // no plan / no paced steps → no overlay.
      const useSplits = liveSplits.length ? liveSplits : (activity.splits || []);
      if (useSplits.length >= 2) {
        const date = activityLocalDateStr(activity.start_time);
        try {
          const pr = await fetch(
            `/api/academy/segments?athleteId=${encodeURIComponent(activity.athlete_id)}&date=${date}&bands=1`,
            { headers: await apiHeaders() },
          );
          if (pr.ok) {
            const pj = await pr.json();
            if (Array.isArray(pj?.bands) && pj.bands.length) {
              const binMeters = useSplits.map((s) => s.distance || 1000);
              setPlanned(projectBandsToBins(pj.bands, binMeters));
            }
          }
        } catch { /* plan overlay optional */ }
      }
    } catch { /* silent */ }
    finally { setLoadingDetails(false); }
  };

  const handleExpand = () => {
    if (!expanded) loadDetails();
    setExpanded(!expanded);
  };

  const splits = details?.splits || activity.splits || [];
  // Prefer the route stored at sync time (instant, reliable); fall back to the
  // live-fetched points for activities synced before GPS was persisted.
  const routePoints = (activity.gps_points && activity.gps_points.length > 0)
    ? activity.gps_points
    : (details?.gpsPoints || []);
  // A stored empty array means we confirmed there's no GPS (indoor/treadmill).
  const knownNoRoute = Array.isArray(activity.gps_points) && activity.gps_points.length === 0;

  return (
    <>
    <div className="bg-card/50 rounded-card border border-page/30 overflow-hidden">
      {/* Collapsed card */}
      <div className="p-4 sm:p-5 cursor-pointer hover:bg-page/70 transition-colors" onClick={handleExpand}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-600/15 flex items-center justify-center">
              <Route className="h-4 w-4 text-brand-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink-700">{activity.athlete_name || 'Unknown'}</span>
                <span className="text-xs text-ink-400">{dateStr} · {timeStr}</span>
              </div>
              <p className="text-xs text-ink-400">{timeLabel}{activity.location_name ? ` · ${activity.location_name}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isMyActivity && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setShowShare(true);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-ink-300/50 bg-page/30 px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors hover:bg-page/60 hover:text-ink-900"
                aria-label="שיתוף בפיד"
                title="שיתוף בפיד"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">שיתוף</span>
              </button>
            )}
            <button
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/dashboard/run-chat/${activity.id}`);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-brand-600/30 bg-brand-600/10 px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-600/20 hover:text-brand-700"
              aria-label={runChatLabel}
              title={runChatLabel}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{runChatLabel}</span>
            </button>
            <span className={cn('text-3xs font-bold px-2 py-0.5 rounded', runType.bg, runType.color)}>
              {runType.label}
            </span>
            {expanded ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
          </div>
        </div>

        <p className="text-base font-semibold text-ink-700 mb-3">{dayLabel}</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <p className="text-3xs text-ink-400 font-medium">Distance</p>
            <p className="text-lg font-black text-ink-700 tabular-nums">{distKm}<span className="text-xs text-ink-400 ms-0.5">km</span></p>
          </div>
          <div>
            <p className="text-3xs text-ink-400 font-medium">Pace</p>
            <p className="text-lg font-black text-ink-700 tabular-nums">{paceStr || '—'}<span className="text-xs text-ink-400 ms-0.5">/km</span></p>
          </div>
          <div>
            <p className="text-3xs text-ink-400 font-medium">Time</p>
            <p className="text-lg font-black text-ink-700 tabular-nums">{durationStr}</p>
          </div>
          {activity.average_hr && (
            <div className="hidden lg:block">
              <p className="text-3xs text-ink-400 font-medium">Avg HR</p>
              <p className={cn("text-lg font-black tabular-nums flex items-center gap-1", hrZone?.color)}>
                <Heart className="h-3.5 w-3.5" />{activity.average_hr}
              </p>
            </div>
          )}
          {activity.elevation_gain && activity.elevation_gain > 0 ? (
            <div className="hidden lg:block">
              <p className="text-3xs text-ink-400 font-medium">Elevation</p>
              <p className="text-lg font-black text-ink-700 tabular-nums flex items-center gap-1">
                <Mountain className="h-3.5 w-3.5 text-accent-600" />{Math.round(activity.elevation_gain)}<span className="text-xs text-ink-400">m</span>
              </p>
            </div>
          ) : null}
        </div>

      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-page/50 px-4 sm:px-5 py-5 space-y-5">
          {loadingDetails && !details && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 text-ink-400 animate-spin" />
              <span className="text-sm text-ink-400 ms-2">Loading activity details...</span>
            </div>
          )}

          {/* Map — stored route if available, else live-fetched */}
          {routePoints.length > 2 ? (
            <div className="rounded-xl overflow-hidden border border-page/30">
              <RouteMap points={routePoints} height={300} splits={splits} />
            </div>
          ) : (!loadingDetails && (knownNoRoute || details)) ? (
            <div className="rounded-card border border-page/30 bg-card/40 py-6 text-center">
              <MapPin className="h-5 w-5 text-ink-400 mx-auto mb-1" />
              <p className="text-xs text-ink-400">No route recorded (indoor/treadmill run)</p>
            </div>
          ) : null}

          {/* Key Stats Banner */}
          <div className="bg-gradient-to-br from-card/60 to-page/60 rounded-xl p-5 border border-page/30">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-ink-400 mb-1">Distance</p>
                <p className="text-3xl font-black text-ink-700 tabular-nums">{distKm}<span className="text-sm text-ink-400 ms-1">km</span></p>
              </div>
              <div>
                <p className="text-xs text-ink-400 mb-1">Pace</p>
                <p className="text-3xl font-black text-ink-700 tabular-nums">{paceStr || '—'}<span className="text-sm text-ink-400 ms-1">/km</span></p>
              </div>
              <div>
                <p className="text-xs text-ink-400 mb-1">Time</p>
                <p className="text-3xl font-black text-ink-700 tabular-nums">{durationStr}</p>
                {movingStr && movingStr !== durationStr && (
                  <p className="text-3xs text-ink-400 mt-0.5">{movingStr} moving</p>
                )}
              </div>
              {activity.average_hr && (
                <div className="hidden lg:block">
                  <p className="text-xs text-ink-400 mb-1">Avg HR</p>
                  <p className={cn("text-3xl font-black tabular-nums", hrZone?.color)}>{activity.average_hr}</p>
                  {hrZone && <p className="text-3xs text-ink-400 mt-0.5">Zone {hrZone.zone} · {hrZone.label}</p>}
                </div>
              )}
              {activity.elevation_gain ? (
                <div className="hidden lg:block">
                  <p className="text-xs text-ink-400 mb-1">Elevation</p>
                  <p className="text-3xl font-black text-ink-700 tabular-nums">{Math.round(activity.elevation_gain)}<span className="text-sm text-ink-400 ms-1">m</span></p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Performance Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {(activity.calories || details?.summary?.calories) && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Flame className="h-3.5 w-3.5 text-band-3" />
                  <p className="text-3xs font-bold uppercase text-ink-400">Calories</p>
                </div>
                <p className="text-2xl font-black text-ink-700 tabular-nums">{activity.calories || details?.summary?.calories}</p>
                <p className="text-3xs text-ink-400 mt-0.5">kcal</p>
              </div>
            )}
            {(activity.avg_cadence || details?.summary?.averageRunCadence) && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Footprints className="h-3.5 w-3.5 text-band-2" />
                  <p className="text-3xs font-bold uppercase text-ink-400">Cadence</p>
                </div>
                <p className="text-2xl font-black text-ink-700 tabular-nums">{Math.round(activity.avg_cadence || details?.summary?.averageRunCadence)}</p>
                <p className="text-3xs text-ink-400 mt-0.5">steps/min</p>
              </div>
            )}
            {(activity.avg_stride_length || details?.summary?.strideLength) && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="h-3.5 w-3.5 text-purple-600" />
                  <p className="text-3xs font-bold uppercase text-ink-400">Stride</p>
                </div>
                <p className="text-2xl font-black text-ink-700 tabular-nums">
                  {activity.avg_stride_length
                    ? (activity.avg_stride_length > 10 ? (activity.avg_stride_length / 100).toFixed(2) : activity.avg_stride_length.toFixed(2))
                    : details?.summary?.strideLength?.toFixed(2)}
                </p>
                <p className="text-3xs text-ink-400 mt-0.5">meters</p>
              </div>
            )}
            {(activity.vo2max || details?.summary?.vO2MaxValue) && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="h-3.5 w-3.5 text-band-3" />
                  <p className="text-3xs font-bold uppercase text-ink-400">VO2 Max</p>
                </div>
                <p className="text-2xl font-black text-ink-700 tabular-nums">{activity.vo2max || details?.summary?.vO2MaxValue}</p>
                <p className="text-3xs text-ink-400 mt-0.5">ml/kg/min</p>
              </div>
            )}
            {activity.max_hr && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Heart className="h-3.5 w-3.5 text-accent-red" />
                  <p className="text-3xs font-bold uppercase text-ink-400">Max HR</p>
                </div>
                <p className="text-2xl font-black text-ink-700 tabular-nums">{activity.max_hr}</p>
                <p className="text-3xs text-ink-400 mt-0.5">bpm</p>
              </div>
            )}
            {details?.summary?.trainingEffect && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className="h-3.5 w-3.5 text-band-2" />
                  <p className="text-3xs font-bold uppercase text-ink-400">Training Effect</p>
                </div>
                <div className="flex items-baseline gap-3">
                  <div>
                    <p className="text-xl font-black text-band-2 tabular-nums">{details.summary.trainingEffect.toFixed(1)}</p>
                    <p className="text-3xs text-ink-400">Aerobic</p>
                  </div>
                  {details.summary.anaerobicTrainingEffect && (
                    <div>
                      <p className="text-xl font-black text-band-3 tabular-nums">{details.summary.anaerobicTrainingEffect.toFixed(1)}</p>
                      <p className="text-3xs text-ink-400">Anaerobic</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {(details?.summary?.perceivedRpe != null || details?.summary?.perceivedFeel != null) && (
              <div className="bg-page/50 rounded-xl p-4 border border-page/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Gauge className="h-3.5 w-3.5 text-brand-600" />
                  <p className="text-3xs font-bold uppercase text-ink-400">Self Evaluation</p>
                </div>
                <div className="flex items-baseline gap-3">
                  {details.summary.perceivedRpe != null && (
                    <div>
                      <p className="text-xl font-black text-brand-600 tabular-nums">{details.summary.perceivedRpe.toFixed(0)}<span className="text-xs text-ink-400">/10</span></p>
                      <p className="text-3xs text-ink-400">Effort</p>
                    </div>
                  )}
                  {details.summary.perceivedFeel != null && (
                    <div>
                      <p className="text-xl leading-none">{['😣','😕','😐','🙂','😄'][Math.round(details.summary.perceivedFeel)] ?? '—'}</p>
                      <p className="text-3xs text-ink-400 mt-1">Feel</p>
                    </div>
                  )}
                </div>
              </div>
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
                  <HRChart splits={splits} maxHR={activity.max_hr || 190} />
                </div>
              )}
              <div className="bg-page/40 rounded-xl p-4 border border-page/20">
                <ElevationChart splits={splits} />
              </div>
            </div>
          )}

          {/* Splits Table */}
          {splits.length > 0 && <SplitsTable splits={splits} />}
        </div>
      )}
    </div>
    {showShare && (
      <ActivitySyncEditor activity={activity} onClose={() => setShowShare(false)} />
    )}
    </>
  );
}

// ─── Activity Feed (exported) ──────────────────────────────────────────────────

interface ActivityFeedProps {
  activities: ActivityEntry[];
  syncing: boolean;
  lastSyncTime: string | null;
  onSync: () => void;
  myAthleteId?: string | null;
  isStaff?: boolean;
}

export function ActivityFeed({
  activities,
  syncing,
  myAthleteId = null,
  isStaff = false,
}: ActivityFeedProps) {
  if (activities.length === 0 && !syncing) {
    return (
      <div className="bg-card/30 rounded-card border border-page/20 p-8 text-center">
        <Activity className="h-8 w-8 text-ink-400 mx-auto mb-3" />
        <p className="text-sm text-ink-400">No activities this week.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map(act => (
        <ActivityCard
          key={act.id}
          activity={act}
          myAthleteId={myAthleteId}
          isStaff={isStaff}
        />
      ))}
    </div>
  );
}
