'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Heart, Mountain, Timer } from 'lucide-react';
import { PlannedKmPoint } from '@/lib/academy/segments';
import { catmullRom, formatPace, getHRZone } from './format';
import type { Split } from './types';

// ─── Chart geometry ───────────────────────────────────────────────────────────
// Padding is in CSS pixels, because the viewBox is measured (see useChartWidth)
// rather than fixed. `left` holds a "5:39"-width pace label at 11px; `right` only
// has to keep the last x-axis label from being clipped.
const PAD = { top: 20, right: 14, bottom: 26, left: 42 };

/**
 * The chart's rendered width in CSS pixels, used as the SVG's own coordinate width.
 *
 * These charts declared a fixed 1000-unit viewBox against a fixed pixel height,
 * so preserveAspectRatio scaled all 1000 units down to fit — on a 358px phone the
 * plot rendered at 36%, which left ~140px of dead space above it and drew the
 * 11px axis labels at about 4px. Measuring makes one SVG unit one pixel, so a
 * stated font size means what it says at every container width.
 */
function useChartWidth() {
  const boxRef = useRef<HTMLDivElement>(null);
  // Narrower than any real container, so the first paint is never wider than the
  // box it lands in — it grows to fit on measure, rather than overflowing first.
  const [width, setWidth] = useState(320);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { boxRef, width };
}

// ─── Interactive Chart Tooltip Hook ────────────────────────────────────────────

function useChartHover(pointCount: number) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>, chartW: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // The pointer is always measured from the SVG's own left edge: the viewBox is
    // LTR even when the page is RTL, so this must not use `dir`-aware offsets.
    const x = e.clientX - rect.left;
    const idx = Math.round(((x - PAD.left) / chartW) * (pointCount - 1));
    if (idx >= 0 && idx < pointCount) setHoverIdx(idx);
    else setHoverIdx(null);
  };

  const handleMouseLeave = () => setHoverIdx(null);

  return { hoverIdx, svgRef, handleMouseMove, handleMouseLeave };
}

/** Legend swatch + label, e.g. a dashed green rule meaning "planned". */
function LegendItem({ label, swatch }: { label: string; swatch: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 font-semibold normal-case">
      {swatch}
      {label}
    </span>
  );
}

// ─── Full-Width Pace Chart ─────────────────────────────────────────────────────

export function PaceChart({ splits, planned }: { splits: Split[]; planned?: (PlannedKmPoint | null)[] }) {
  const t = useTranslations('activities');
  const { hoverIdx, svgRef, handleMouseMove, handleMouseLeave } = useChartHover(splits.length);
  const { boxRef, width } = useChartWidth();

  const height = 220;
  const pad = PAD;
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  // After the hooks: an early return above them changes the hook count between
  // renders when a split arrives, which React rejects.
  if (splits.length < 2) return null;

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
    <div ref={boxRef}>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5"><Timer className="h-3 w-3" /> {t('chartPacePerKm')}</span>
        {/* Named, not "dashed = planned": the band is the more legible of the two
            marks and the dash was the only thing the old label pointed at. */}
        {hasPlan && (
          <LegendItem
            label={t('legendPlanned')}
            swatch={<span className="inline-block w-4 border-t-2 border-dashed border-accent-600" />}
          />
        )}
        <LegendItem
          label={t('legendActual')}
          swatch={<span className="inline-block w-4 border-t-2 border-brand-600" />}
        />
      </h4>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        // The page is RTL and an SVG inherits that: without this, textAnchor="end"
        // resolves to the LEFT edge and every y-axis label draws into the plot.
        direction="ltr"
        className="max-w-full"
        onMouseMove={e => handleMouseMove(e, chartW)}
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
            {/* Drawn over the blue area fill, and at an opacity that survives it:
                at 0.1 the band was invisible exactly where it matters most, under
                the stretch of the run the plan actually put a target on. */}
            <path d={bandArea(run)} fill="#16a34a" opacity={0.2} stroke="#16a34a" strokeOpacity={0.35} strokeWidth="1" />
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
              {formatPace(paces[hoverIdx])} {t('perKm')}
            </text>
            <text x={points[hoverIdx].x} y={pad.top + chartH + 14} textAnchor="middle" className="fill-ink-500" fontSize="10" fontWeight="600">
              {t('kmNumber', { n: hoverIdx + 1 })}
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
  const t = useTranslations('activities');
  const { hoverIdx, svgRef, handleMouseMove, handleMouseLeave } = useChartHover(splits.length);
  const { boxRef, width } = useChartWidth();

  const height = 200;
  const pad = PAD;
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const valid = splits.filter(s => s.averageHR);
  if (valid.length < 2) return null;

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
    <div ref={boxRef}>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex items-center gap-1.5">
        <Heart className="h-3 w-3" /> {t('chartHrPerKm')}
      </h4>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        direction="ltr"
        className="max-w-full"
        onMouseMove={e => handleMouseMove(e, chartW)}
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
              {hrs[hoverIdx]} {t('bpm')}
            </text>
            <text x={points[hoverIdx].x} y={pad.top + chartH + 14} textAnchor="middle" className="fill-ink-500" fontSize="10" fontWeight="600">
              {t('kmNumber', { n: hoverIdx + 1 })}
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
  const t = useTranslations('activities');
  const { hoverIdx, svgRef, handleMouseMove, handleMouseLeave } = useChartHover(splits.length);
  const { boxRef, width } = useChartWidth();

  const height = 180;
  const pad = PAD;
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  if (splits.length < 2) return null;

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
    <div ref={boxRef}>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5"><Mountain className="h-3 w-3" /> {t('chartElevationPerKm')}</span>
        <LegendItem
          label={t('legendGain')}
          swatch={<span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-600/80" />}
        />
        <LegendItem
          label={t('legendLoss')}
          swatch={<span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-red/80" />}
        />
      </h4>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        direction="ltr"
        className="max-w-full"
        onMouseMove={e => handleMouseMove(e, chartW)}
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
