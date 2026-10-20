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

type Metric = 'pace' | 'hr' | 'cad' | 'pw' | 'elev';

/** The y-axis gutter, px — labels live there, never over the line. */
const GUTTER = 34;

/** Four round ticks across [lo, hi]. */
function niceTicks(lo: number, hi: number, metric: Metric): number[] {
  const step = metric === 'pace' ? ([15, 30, 60, 120].find((st) => (hi - lo) / st <= 4) ?? 300)
    : metric === 'hr' ? ([10, 20, 30].find((st) => (hi - lo) / st <= 4) ?? 40)
      : metric === 'cad' ? 20 : metric === 'pw' ? ([50, 100].find((st) => (hi - lo) / st <= 4) ?? 200) : ([5, 10, 20, 50].find((st) => (hi - lo) / st <= 3) ?? 100);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** A stretch of the run (km), for the strip above the charts: "50′ רציף" · "15×200" · "שחרור". */
export interface RunPhase { from: number; to: number; label: string; kind: 'steady' | 'reps' | 'easy' }
const PHASE_TONE: Record<RunPhase['kind'], string> = {
  steady: 'bg-[#E3F6EA] text-[#12A150]', reps: 'bg-[#FFF1DC] text-[#8A4B00]', easy: 'bg-brand-600/10 text-brand-600',
};

interface Series {
  x: number[];
  /** km along the run, whatever the x axis is — the map's cursor reads this. */
  km: number[];
  t: Array<number | null>;
  pace: Array<number | null>;
  hr: Array<number | null> | null;
  elev: Array<number | null> | null;
  cad: Array<number | null> | null;
  pw: Array<number | null> | null;
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

function fromView(view: StreamView, byTime = false): Series {
  // ~400 bins: on a 30 km run a bin is 75 m (already calm), on a 5 km run 12 m
  // (GPS-jittery), so the smoothing window scales with how short the bins are.
  const binM = (view.d[view.d.length - 1] * 1000) / view.d.length;
  const w = Math.max(1, Math.min(6, Math.round(60 / Math.max(binM, 1))));
  return {
    x: byTime ? view.t.map((sec) => sec / 60) : view.d,
    km: view.d,
    t: view.t,
    pace: rolling(view.pace, w),
    hr: view.hr ? rolling(view.hr, 1) : null,
    elev: view.elev ? rolling(view.elev, w) : null,
    // A cadence under 120 is standing or walking — a gap, not a dive to the floor.
    cad: view.cad && view.cad.some((c) => c != null && c > 120) ? rolling(view.cad.map((c) => (c != null && c > 120 ? c : null)), w) : null,
    pw: view.pw && view.pw.some((v) => v != null && v > 50) ? rolling(view.pw.map((v) => (v != null && v > 50 ? v : null)), w) : null,
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
    km: x,
    t,
    pace: splits.map((s) => s.averagePace || null),
    hr: hasHr ? splits.map((s) => s.averageHR) : null,
    elev: hasElev ? elev : null,
    cad: null,
    pw: null,
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
  /** The plan's target band per km (sec/km), shaded behind the pace line. */
  planned?: Array<{ min: number; max: number } | null> | null;
  /** The workout's parts, drawn as a strip above the charts. */
  phases?: RunPhase[] | null;
  /** The reps, shaded behind every chart (km and seconds from the start). */
  bands?: Array<{ fromKm: number; toKm: number; fromSec: number; toSec: number }> | null;
  className?: string;
}

export function RunCharts({ view, splits, avgPace, avgHr, elevationGain, maxHr, onCursor, planned, phases, bands, className }: RunChartsProps) {
  const t = useTranslations('runPage');
  // Distance or time along the bottom (the coarse per-km fallback has no time axis).
  const [axis, setAxis] = useState<'d' | 't'>('d');
  const byTime = axis === 't' && !!view;
  const series = useMemo(() => (view ? fromView(view, byTime) : fromSplits(splits)), [view, splits, byTime]);
  const [cursor, setCursor] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const lanes = useMemo<Lane[]>(() => {
    if (!series) return [];
    const out: Lane[] = [];
    const [plo, phi] = extent(series.pace);
    out.push({
      // The slow end stops near the run's own pace: the walks between reps (10:00/km)
      // would otherwise flatten everything that was actually run.
      metric: 'pace', values: series.pace, invert: true, height: 132,
      lo: Math.max(plo - 8, 120), hi: Math.min(phi + 12, 15 * 60, (avgPace || phi) + 100),
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
    if (series.cad) {
      const [clo, chi] = extent(series.cad, 0.02, 0.98);
      out.push({
        metric: 'cad', values: series.cad, invert: false, height: 70,
        lo: Math.max(120, Math.floor((clo - 4) / 10) * 10), hi: Math.ceil((chi + 4) / 10) * 10,
        stroke: '#0F766E', fill: 'rgba(15,118,110,0.08)', avg: null, format: (v) => String(Math.round(v)),
      });
    }
    if (series.pw) {
      const [wlo, whi] = extent(series.pw, 0.02, 0.98);
      out.push({
        metric: 'pw', values: series.pw, invert: false, height: 70,
        lo: Math.max(0, Math.floor((wlo - 20) / 50) * 50), hi: Math.ceil((whi + 20) / 50) * 50,
        stroke: '#6D28D9', fill: 'rgba(109,40,217,0.08)', avg: null, format: (v) => String(Math.round(v)),
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
    // The gutter on the left holds the axis labels; the run starts after it.
    const f = Math.min(Math.max((clientX - box.left - GUTTER) / (box.width - GUTTER), 0), 1);
    const xv = f * total;
    let i = series.x.findIndex((v) => v >= xv);
    if (i < 0) i = series.x.length - 1;
    setCursor(i);
    onCursor?.(series.km[i] / (series.km[series.km.length - 1] || 1));
  };

  // The x axis, under every chart: km, or minutes when reading by time.
  const xStep = byTime ? (total > 90 ? 15 : total > 40 ? 10 : 5) : total > 25 ? 5 : total > 10 ? 2 : 1;
  const xTicks: number[] = [];
  for (let k = xStep; k < total - xStep * 0.3; k += xStep) xTicks.push(k);
  const xUnit = byTime ? '′' : '';
  const shade = (bands || []).map((b) => (byTime ? [b.fromSec / 60, b.toSec / 60] : [b.fromKm, b.toKm]) as [number, number]);

  const at = cursor;
  const cx = at != null ? (series.x[at] / total) * W : null;

  const label = (m: Metric) => (m === 'pw' ? t('power') : t(m === 'pace' ? 'pace' : m === 'hr' ? 'heartRate' : m === 'cad' ? 'cadence' : 'elevation'));
  const sub = (l: Lane) => (l.metric === 'pace' && avgPace ? t('avgPace', { pace: formatPace(avgPace) })
    : l.metric === 'hr' && avgHr ? t('avgHr', { hr: Math.round(avgHr) })
      : l.metric === 'elev' && elevationGain ? t('climb', { m: Math.round(elevationGain) }) : '');

  return (
    <div className={className}>
      {/* The readout: averages at rest, the values under the finger while dragging. */}
      {view && (
        <div className="mb-2 flex justify-end">
          <div className="flex rounded-[10px] bg-page p-0.5 text-xs font-bold">
            {(['d', 't'] as const).map((a) => (
              <button key={a} type="button" onClick={() => { setAxis(a); setCursor(null); }} className={cn('min-h-[32px] rounded-lg px-3', axis === a ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>
                {a === 'd' ? t('byDistance') : t('byTime')}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* The readout up here; each chart also shows its own value at the finger (header badge),
          so a chart far down the stack reads without looking back up. */}
      <div className="mb-2 flex min-h-[28px] flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
        {at == null ? (
          <span className="rounded-lg bg-page/60 px-2 py-1 text-ink-500">{t('dragHint')}</span>
        ) : (
          <>
            <Chip label={t('km')} value={series.km[at].toFixed(1)} />
            {series.t[at] != null && <Chip label="⏱" value={formatDuration(series.t[at] as number)} />}
            {series.pace[at] != null && <Chip label={t('pace')} value={formatPace(series.pace[at] as number)} />}
            {series.hr?.[at] != null && <Chip label="♥" value={String(Math.round(series.hr[at] as number))} />}
            {series.cad?.[at] != null && <Chip label="👣" value={String(Math.round(series.cad[at] as number))} />}
            {series.pw?.[at] != null && <Chip label="⚡" value={`${Math.round(series.pw[at] as number)}W`} />}
            {series.elev?.[at] != null && <Chip label="↑" value={`${Math.round(series.elev[at] as number)} ${t('m')}`} />}
          </>
        )}
      </div>

      <div
        ref={boxRef}
        dir="ltr"
        className="relative touch-pan-y select-none"
        style={{ paddingLeft: GUTTER }}
        onPointerDown={(e) => move(e.clientX)}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) move(e.clientX); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') { setCursor(null); onCursor?.(null); } }}
      >
        {phases && phases.length > 1 && (
          <div className="relative mb-2 h-5" aria-hidden>
            {phases.map((p, i) => (
              <span key={i} dir="rtl" className={cn('absolute top-0 flex h-5 items-center justify-center overflow-hidden whitespace-nowrap rounded-md text-[10.5px] font-extrabold', PHASE_TONE[p.kind])}
                style={{ left: `calc(${(p.from / total) * 100}% + 1px)`, width: `calc(${((p.to - p.from) / total) * 100}% - 2px)` }}>
                {p.label}
              </span>
            ))}
          </div>
        )}
        {lanes.map((l) => (
          <div key={l.metric} className="mt-3 first:mt-0">
            <div dir="rtl" className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-bold text-ink-700">
                {label(l.metric)}
                {/* The value under the finger, on the chart itself — no looking up to the readout. */}
                {at != null && l.values[at] != null && (
                  <bdi dir="ltr" className="ms-1.5 rounded-md px-1.5 py-px text-[11px] font-black tabular-nums text-white" style={{ background: l.stroke }}>
                    {l.metric === 'pw' ? `${l.format(l.values[at] as number)}W` : l.format(l.values[at] as number)}
                  </bdi>
                )}
              </span>
              <span className="text-ink-400">{sub(l)}</span>
            </div>
            <div className="relative" style={{ height: l.height }}>
              <svg viewBox={`0 0 ${W} ${l.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                {niceTicks(l.lo, l.hi, l.metric).map((tv) => (
                  <line key={`g${tv}`} x1={0} x2={W} y1={laneY(l, tv)} y2={laneY(l, tv)} stroke="#ECECF1" vectorEffect="non-scaling-stroke" />
                ))}
                {l.metric === 'pace' && planned && planned.map((b, k) => (b && total > 0 ? (
                  <rect key={`p${k}`} x={(k / total) * W} width={Math.max(0, (Math.min(k + 1, total) - k) / total * W)}
                    y={laneY(l, Math.min(b.min, b.max))} height={Math.max(1, laneY(l, Math.max(b.min, b.max)) - laneY(l, Math.min(b.min, b.max)))} fill="rgba(18,161,80,0.12)" />
                ) : null))}
                {shade.map(([a, b], k) => (
                  <rect key={`b${k}`} x={(a / total) * W} width={Math.max(0, ((b - a) / total) * W)} y={0} height={l.height} fill="rgba(21,37,255,0.05)" />
                ))}
                {l.metric !== 'hr' && <path d={areaOf(l, series.x, total)} fill={l.fill} />}
                {/* Heart rate as Garmin draws it: one line, coloured by the zone it is in. */}
                {l.metric === 'hr' ? zonePaths(l, series.x, total, maxHr).map((z, k) => (
                  <path key={k} d={z.d} fill="none" stroke={z.color} strokeWidth={series.coarse ? 2.4 : 1.9} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                )) : <path d={pathOf(l, series.x, total)} fill="none" stroke={l.stroke} strokeWidth={series.coarse ? 2.2 : 1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                {l.avg != null && (
                  <line x1={0} x2={W} y1={laneY(l, l.avg)} y2={laneY(l, l.avg)} stroke={l.stroke} strokeDasharray="3 3" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
                )}
                {cx != null && <line x1={cx} x2={cx} y1={0} y2={l.height} stroke="#1D1E26" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              </svg>
              {/* The axis, in HTML in the gutter so it is never stretched and never over the line. */}
              {niceTicks(l.lo, l.hi, l.metric).map((tv) => (
                <span key={tv} className="pointer-events-none absolute -translate-y-1/2 text-3xs tabular-nums text-ink-400"
                  style={{ top: laneY(l, tv), right: '100%', marginRight: 5 }}>{l.format(tv)}</span>
              ))}

              {cx != null && at != null && l.values[at] != null && (
                <span
                  className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                  style={{ left: `${(cx / W) * 100}%`, top: laneY(l, l.values[at] as number), background: l.stroke }}
                />
              )}
            </div>
            {/* Every chart carries its own axis — time or km — so none is read without one. */}
            <div className="relative mt-0.5 h-3.5 border-t border-page text-3xs tabular-nums text-ink-400">
              {xTicks.map((k) => (
                <span key={k} className="absolute top-0.5 -translate-x-1/2" style={{ left: `${(k / total) * 100}%` }}>{k}{xUnit}</span>
              ))}
              <span className="absolute -left-[30px] top-0.5">{byTime ? t('minutesShort') : t('km')}</span>
            </div>
          </div>
        ))}
      </div>
      {series.coarse && <p className="mt-1 text-3xs text-ink-400">{t('perKmNote')}</p>}
    </div>
  );
}

/** Garmin's zone colours: grey, blue, green, orange, red. */
const ZONE_COLOR = ['#9CA3AF', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444'];

/** The heart-rate line cut where it changes zone, each piece in its zone's colour. */
function zonePaths(l: Lane, x: number[], total: number, maxHr: number): Array<{ d: string; color: string }> {
  const zoneOf = (v: number) => { let z = 0; HR_ZONE_FLOORS.forEach((f, k) => { if (v >= maxHr * f) z = k; }); return z; };
  const out: Array<{ d: string; color: string }> = [];
  let cur: { d: string; z: number } | null = null;
  let prev: [number, number] | null = null;
  l.values.forEach((v, i) => {
    if (v == null) { if (cur) out.push({ d: cur.d, color: ZONE_COLOR[cur.z] }); cur = null; prev = null; return; }
    const p: [number, number] = [(x[i] / total) * W, laneY(l, v)];
    const z = zoneOf(v);
    if (!cur || cur.z !== z) {
      if (cur) out.push({ d: cur.d, color: ZONE_COLOR[cur.z] });
      cur = { d: prev ? `M${prev[0].toFixed(1)} ${prev[1].toFixed(1)}L${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`, z };
    } else cur.d += `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    prev = p;
  });
  if (cur) out.push({ d: (cur as { d: string }).d, color: ZONE_COLOR[(cur as { z: number }).z] });
  return out;
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className={cn('rounded-lg bg-page/60 px-2 py-1 text-ink-500')}>
      {label} <bdi dir="ltr" className="font-bold tabular-nums text-ink-700">{value}</bdi>
    </span>
  );
}
