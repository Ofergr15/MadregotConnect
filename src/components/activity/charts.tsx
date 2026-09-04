'use client';

import { useRef, useState } from 'react';
import { Heart, Mountain, Timer } from 'lucide-react';
import { PlannedKmPoint } from '@/lib/academy/segments';
import { catmullRom, formatPace, getHRZone } from './format';
import type { Split } from './types';

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

export function PaceChart({ splits, planned }: { splits: Split[]; planned?: (PlannedKmPoint | null)[] }) {
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

export function HRChart({ splits, maxHR = 190 }: { splits: Split[]; maxHR?: number }) {
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

export function ElevationChart({ splits }: { splits: Split[] }) {
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
                  fill="#22c55e" opacity={isHover ? 0.9 : 0.6} className="transition-opacity" />
              )}
              {lossH > 0 && (
                <rect x={x - barW / 2} y={midY} width={barW} height={lossH} rx="2"
                  fill="#D74E4E" opacity={isHover ? 0.9 : 0.5} className="transition-opacity" />
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
