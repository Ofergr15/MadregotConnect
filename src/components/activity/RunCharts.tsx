'use client';

/**
 * The run page's charts: pace, heart rate and elevation on ONE distance axis with
 * ONE cursor (Strava's grammar). Drag anywhere across the stack and the readout,
 * all three cursors and the dot on the route map follow.
 *
 * Drawn from the 1 Hz trace when the run has one (`/api/activities/stream`, every
 * Garmin run since migration 094), else from the per-km splits — the same chart,
 * coarser. It replaces six separately-scaled charts drawn from 8–30 dots joined by a
 * spline, whose peaks the spline invented.
 *
 * SVG geometry is stretched (`preserveAspectRatio="none"` + non-scaling strokes) so a
 * chart fills any phone width; every label is HTML on top, so text is never stretched.
 * The axis runs left→right like every chart in the app (see ExecutionRing's note on
 * `direction="ltr"`); the labels around it stay RTL.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { StreamView } from '@/lib/activities/stream-view';
import { HR_ZONE_FLOORS } from '@/lib/activities/stream-view';
import { formatDuration, formatPace } from './format';
import type { Split } from './types';

const W = 360;

type Metric = 'pace' | 'hr' | 'elev';

interface Series {
  x: number[];
  t: Array<number | null>;
  pace: Array<number | null>;
  hr: Array<number | null> | null;
  elev: Array<number | null> | null;
  /** True when built from per-km splits rather than the trace. */
  coarse: boolean;
}

function rolling(values: Array<number | null>, w: number): Array<number | null> {
  if (w <= 0) return values;
  return values.map((v, i) => {
    if (v == null) return null;
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(values.length - 1, i + w); k++) {
      const u = values[k];
      if (u != null) { s += u; n++; }
    }
    return n ? s / n : null;
  });
}

function fromView(view: StreamView): Series {
  // ~400 bins: on a 30 km run a bin is 75 m (already calm), on a 5 km run 12 m
  // (GPS-jittery), so the smoothing window scales with how short the bins are.
  const binM = (view.d[view.d.length - 1] * 1000) / view.d.length;
  const w = Math.max(1, Math.min(6, Math.round(60 / Math.max(binM, 1))));
  return {
    x: view.d,
    t: view.t,
    pace: rolling(view.pace, w),
    hr: view.hr ? rolling(view.hr, 1) : null,
    elev: view.elev ? rolling(view.elev, w) : null,
    coarse: false,
  };
}

function fromSplits(splits: Split[]): Series | null {
  if (splits.length < 2) return null;
  const x: number[] = [];
  const t: number[] = [];
  let d = 0;
  let sec = 0;
  for (const s of splits) { d += s.distance; sec += s.duration; x.push(d / 1000); t.push(sec); }
  const hasHr = splits.some((s) => s.averageHR);
  let el = 0;
  const elev = splits.map((s) => { el += (s.elevationGain ?? 0) - (s.elevationLoss ?? 0); return el; });
  const hasElev = splits.some((s) => s.elevationGain != null || s.elevationLoss != null);
  return {
    x,
    t,
    pace: splits.map((s) => s.averagePace || null),
    hr: hasHr ? splits.map((s) => s.averageHR) : null,
    elev: hasElev ? elev : null,
    coarse: true,
  };
}

function extent(values: Array<number | null>, lo = 0.02, hi = 0.98): [number, number] {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return [0, 1];
  return [v[Math.floor((v.length - 1) * lo)], v[Math.floor((v.length - 1) * hi)]];
}

interface Lane {
  metric: Metric;
  values: Array<number | null>;
  lo: number;
  hi: number;
  /** Pace: faster is UP, so the scale is inverted. */
  invert: boolean;
  height: number;
  stroke: string;
  fill: string;
  avg: number | null;
  format: (v: number) => string;
}

function laneY(l: Lane, v: number) {
  const f = (Math.min(Math.max(v, l.lo), l.hi) - l.lo) / (l.hi - l.lo || 1);
  return 4 + (l.invert ? f : 1 - f) * (l.height - 8);
}

function pathOf(l: Lane, x: number[], total: number) {
  let d = '';
  let pen = false;
  l.values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const px = (x[i] / total) * W;
    d += `${pen ? 'L' : 'M'}${px.toFixed(1)} ${laneY(l, v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

function areaOf(l: Lane, x: number[], total: number) {
  const pts = l.values.map((v, i) => (v == null ? null : [(x[i] / total) * W, laneY(l, v)] as const)).filter(Boolean) as Array<readonly [number, number]>;
  if (pts.length < 2) return '';
  const base = l.invert ? 0 : l.height;
  return `M${pts[0][0]} ${base}` + pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + `L${pts[pts.length - 1][0]} ${base}Z`;
}

export interface RunChartsProps {
  view: StreamView | null;
  splits: Split[];
  avgPace: number | null;
  avgHr: number | null;
  elevationGain: number | null;
  maxHr: number;
  /** 0..1 along the run, or null when the cursor leaves — for the map dot. */
  onCursor?: (fraction: number | null) => void;
  className?: string;
}

export function RunCharts({ view, splits, avgPace, avgHr, elevationGain, maxHr, onCursor, className }: RunChartsProps) {
  const t = useTranslations('runPage');
  const series = useMemo(() => (view ? fromView(view) : fromSplits(splits)), [view, splits]);
  const [cursor, setCursor] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const lanes = useMemo<Lane[]>(() => {
    if (!series) return [];
    const out: Lane[] = [];
    const [plo, phi] = extent(series.pace);
    out.push({
      metric: 'pace', values: series.pace, invert: true, height: 132,
      lo: Math.max(plo - 8, 120), hi: Math.min(phi + 12, 15 * 60),
      stroke: '#1525FF', fill: 'rgba(21,37,255,0.10)', avg: avgPace, format: (v) => formatPace(v),
    });
    if (series.hr) {
      const [hlo, hhi] = extent(series.hr, 0.01, 0.995);
      out.push({
        metric: 'hr', values: series.hr, invert: false, height: 96,
        lo: Math.max(60, hlo - 6), hi: hhi + 4,
        stroke: '#C2410C', fill: 'rgba(194,65,12,0.07)', avg: avgHr, format: (v) => String(Math.round(v)),
      });
    }
    if (series.elev) {
      let [elo, ehi] = extent(series.elev, 0, 1);
      if (ehi - elo < 20) { const mid = (ehi + elo) / 2; elo = mid - 10; ehi = mid + 10; }
      out.push({
        metric: 'elev', values: series.elev, invert: false, height: 60,
        lo: elo, hi: ehi, stroke: '#6B7280', fill: 'rgba(107,114,128,0.20)', avg: null, format: (v) => String(Math.round(v)),
      });
    }
    return out;
  }, [series, avgPace, avgHr]);

  if (!series || !lanes.length) return null;
  const total = series.x[series.x.length - 1] || 1;

  const move = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const f = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
    const xv = f * total;
    let i = series.x.findIndex((v) => v >= xv);
    if (i < 0) i = series.x.length - 1;
    setCursor(i);
    onCursor?.(series.x[i] / total);
  };

  const kmStep = total > 25 ? 5 : total > 10 ? 2 : 1;
  const kmTicks: number[] = [];
  for (let k = kmStep; k < total - kmStep * 0.3; k += kmStep) kmTicks.push(k);

  const at = cursor;
  const cx = at != null ? (series.x[at] / total) * W : null;

  const label = (m: Metric) => t(m === 'pace' ? 'pace' : m === 'hr' ? 'heartRate' : 'elevation');
  const sub = (l: Lane) => (l.metric === 'pace' && avgPace ? t('avgPace', { pace: formatPace(avgPace) })
    : l.metric === 'hr' && avgHr ? t('avgHr', { hr: Math.round(avgHr) })
      : l.metric === 'elev' && elevationGain ? t('climb', { m: Math.round(elevationGain) }) : '');

  return (
    <div className={className}>
      {/* The readout: averages at rest, the values under the finger while dragging. */}
      <div className="mb-2 flex min-h-[28px] flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
        {at == null ? (
          <span className="rounded-lg bg-page/60 px-2 py-1 text-ink-500">{t('dragHint')}</span>
        ) : (
          <>
            <Chip label={t('km')} value={series.x[at].toFixed(1)} />
            {series.t[at] != null && <Chip label="⏱" value={formatDuration(series.t[at] as number)} />}
            {series.pace[at] != null && <Chip label={t('pace')} value={formatPace(series.pace[at] as number)} />}
            {series.hr?.[at] != null && <Chip label="♥" value={String(Math.round(series.hr[at] as number))} />}
            {series.elev?.[at] != null && <Chip label="↑" value={`${Math.round(series.elev[at] as number)} ${t('m')}`} />}
          </>
        )}
      </div>

      <div
        ref={boxRef}
        dir="ltr"
        className="relative touch-pan-y select-none"
        onPointerDown={(e) => move(e.clientX)}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) move(e.clientX); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') { setCursor(null); onCursor?.(null); } }}
      >
        {lanes.map((l) => (
          <div key={l.metric} className="mt-3 first:mt-0">
            <div dir="rtl" className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-bold text-ink-700">{label(l.metric)}</span>
              <span className="text-ink-400">{sub(l)}</span>
            </div>
            <div className="relative" style={{ height: l.height }}>
              <svg viewBox={`0 0 ${W} ${l.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                {l.metric === 'hr' && HR_ZONE_FLOORS.map((f, z) => {
                  const top = laneY(l, maxHr * (HR_ZONE_FLOORS[z + 1] ?? 1.3));
                  const bottom = laneY(l, maxHr * f);
                  return bottom - top > 0.5 ? <rect key={z} x={0} y={top} width={W} height={bottom - top} fill={ZONE_WASH[z]} /> : null;
                })}
                <path d={areaOf(l, series.x, total)} fill={l.fill} />
                <path d={pathOf(l, series.x, total)} fill="none" stroke={l.stroke} strokeWidth={series.coarse ? 2.2 : 1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {l.avg != null && (
                  <line x1={0} x2={W} y1={laneY(l, l.avg)} y2={laneY(l, l.avg)} stroke={l.stroke} strokeDasharray="3 3" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
                )}
                {cx != null && <line x1={cx} x2={cx} y1={0} y2={l.height} stroke="#1D1E26" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              </svg>
              {/* Two y labels per lane, in HTML so they are never stretched. */}
              <span className="pointer-events-none absolute left-1 top-0.5 text-3xs tabular-nums text-ink-400">{l.format(l.invert ? l.lo : l.hi)}</span>
              <span className="pointer-events-none absolute bottom-0.5 left-1 text-3xs tabular-nums text-ink-400">{l.format(l.invert ? l.hi : l.lo)}</span>
              {cx != null && at != null && l.values[at] != null && (
                <span
                  className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                  style={{ left: `${(cx / W) * 100}%`, top: laneY(l, l.values[at] as number), background: l.stroke }}
                />
              )}
            </div>
          </div>
        ))}
        <div className="relative mt-1 h-4 text-3xs tabular-nums text-ink-400">
          {kmTicks.map((k) => (
            <span key={k} className="absolute -translate-x-1/2" style={{ left: `${(k / total) * 100}%` }}>{k}</span>
          ))}
          <span className="absolute right-0">{t('km')}</span>
        </div>
      </div>
      {series.coarse && <p className="mt-1 text-3xs text-ink-400">{t('perKmNote')}</p>}
    </div>
  );
}

/** Faint zone washes behind the HR line — fills only, never text. */
const ZONE_WASH = ['rgba(150,150,150,0.08)', 'rgba(96,165,250,0.10)', 'rgba(22,163,74,0.10)', 'rgba(251,146,60,0.12)', 'rgba(215,78,78,0.12)'];

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className={cn('rounded-lg bg-page/60 px-2 py-1 text-ink-500')}>
      {label} <bdi dir="ltr" className="font-bold tabular-nums text-ink-700">{value}</bdi>
    </span>
  );
}
