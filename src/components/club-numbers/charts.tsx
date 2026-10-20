'use client';

import { cn } from '@/lib/utils';

/**
 * The charts of "מדרגות במספרים" (mockup ~/.cache/madregot/club-numbers-v3.html): plain SVG
 * with real axes — weeks along the bottom with the month marked where it starts, ticks on
 * the right with round numbers. Time runs left to right, as on every chart in the app.
 */

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export const monthShort = (m: number) => MONTHS[(m - 1 + 12) % 12];
export const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

/** A round step for about `n` gridlines up to `max`. */
export function niceStep(max: number, n = 4): number {
  const raw = max / n;
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function Grid({ top, step, y, x0, x1, W }: { top: number; step: number; y: (v: number) => number; x0: number; x1: number; W: number }) {
  const lines = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    lines.push(
      <g key={v}>
        <line x1={x0} x2={x1} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#E3E5EC' : '#F0F1F4'} />
        <text x={W - 2} y={y(v) + 3.5} textAnchor="end" className="fill-ink-400 text-[10px]">{fmt(v)}</text>
      </g>,
    );
  }
  return <>{lines}</>;
}

function MonthAxis({ weeks, x, y0, H }: { weeks: string[]; x: (i: number) => number; y0: number; H: number }) {
  return (
    <>
      {weeks.map((w, i) => {
        const starts = i > 0 ? weeks[i - 1].slice(5, 7) !== w.slice(5, 7) : weeks.length > 1 && weeks[1].slice(5, 7) === w.slice(5, 7);
        return (
          <g key={w}>
            <line x1={x(i)} x2={x(i)} y1={y0} y2={y0 + (starts ? 7 : 3)} stroke={starts ? '#8A8C97' : '#C9CCD6'} />
            {starts && <text x={x(i)} y={H - 6} className="fill-ink-500 text-[10px] font-bold">{monthShort(Number(w.slice(5, 7)))}</text>}
          </g>
        );
      })}
    </>
  );
}

export interface Series { label: string; color: string; values: Array<number | null> }

/** Lines over weeks, with an optional soft area under the first one and the last value marked. */
export function WeekLines({ weeks, series, height = 150, area = false, endLabels = true }: { weeks: string[]; series: Series[]; height?: number; area?: boolean; endLabels?: boolean }) {
  const W = 320, PL = 8, PR = 34, PT = 12, PB = 24, iw = W - PL - PR, ih = height - PT - PB;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const max = Math.max(1, ...vals) * 1.05;
  const step = niceStep(max); const top = step * Math.ceil(max / step);
  const n = weeks.length;
  const x = (i: number) => PL + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
  const y = (v: number) => PT + ih - (v / top) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" style={{ height, direction: 'ltr' }} role="img">
      <Grid top={top} step={step} y={y} x0={PL} x1={PL + iw} W={W} />
      <MonthAxis weeks={weeks} x={x} y0={PT + ih} H={height} />
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter(Boolean) as Array<readonly [number, number]>;
        if (!pts.length) return null;
        const last = pts[pts.length - 1];
        const lastV = [...s.values].reverse().find((v) => v != null) as number;
        return (
          <g key={s.label}>
            {area && si === 0 && <polygon points={`${pts[0][0]},${PT + ih} ${pts.map((p) => p.join(',')).join(' ')} ${last[0]},${PT + ih}`} fill={s.color} fillOpacity={0.09} />}
            <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={last[0]} cy={last[1]} r={3.6} fill="#fff" stroke={s.color} strokeWidth={2.2} />
            {endLabels && <text x={last[0] - 6} y={last[1] - 8} textAnchor="end" className="text-[11px] font-black" fill={s.color}>{fmt(lastV)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Week against week: a column for every full week, and this week as what is run so far, the
 * projection for the rest of it (dashed), and a line where last week stood on the same day.
 */
export function WeekColumns({ weeks, km, soFar, lastSame, projected, height = 180, nowLabel }: {
  weeks: string[]; km: number[]; soFar: number; lastSame: number; projected: number | null; height?: number; nowLabel: string;
}) {
  const W = 330, PL = 4, PR = 34, PT = 22, PB = 22, iw = W - PL - PR, ih = height - PT - PB;
  const all = [...km, projected ?? soFar];
  const max = Math.max(1, ...all) * 1.05; const step = niceStep(max); const top = step * Math.ceil(max / step);
  const n = all.length; const slot = iw / n; const bw = slot * 0.68;
  const x = (i: number) => PL + i * slot + (slot - bw) / 2;
  const y = (v: number) => PT + ih - (v / top) * ih;
  const peak = km.indexOf(Math.max(...km));
  const i = n - 1;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" style={{ height, direction: 'ltr' }} role="img">
      <Grid top={top} step={step} y={y} x0={PL} x1={PL + iw} W={W} />
      {km.map((v, k) => (
        <g key={weeks[k]}>
          <rect x={x(k)} y={y(v)} width={bw} height={y(0) - y(v)} rx={3} fill={k === peak ? '#AEB8FF' : '#D4D9FF'} />
          {k === peak && <text x={x(k) + bw / 2} y={y(v) - 5} textAnchor="middle" className="text-[11px] font-black" fill="#5F6BFF">{fmt(v)}</text>}
          {k % 3 === 0 && k < km.length - 2 && <text x={x(k) + bw / 2} y={height - 6} textAnchor="middle" className="fill-ink-400 text-[10px]">{dm(weeks[k])}</text>}
        </g>
      ))}
      {projected != null && <rect x={x(i)} y={y(projected)} width={bw} height={y(0) - y(projected)} rx={3} fill="#1525FF" fillOpacity={0.06} stroke="#1525FF" strokeDasharray="3 2" strokeWidth={1.2} />}
      <rect x={x(i)} y={y(soFar)} width={bw} height={y(0) - y(soFar)} rx={3} fill="#1525FF" />
      <line x1={x(i - 1) - 1} x2={x(i) + bw + 1} y1={y(lastSame)} y2={y(lastSame)} stroke="#16171F" strokeWidth={2} />
      <text x={x(i) + bw / 2} y={y(projected ?? soFar) - 5} textAnchor="middle" className="text-[11px] font-black" fill="#1525FF">{fmt(soFar)}</text>
      <text x={x(i) + bw / 2} y={height - 6} textAnchor="middle" className="text-[10px] font-bold" fill="#1525FF">{nowLabel}</text>
    </svg>
  );
}

/**
 * A count per week as columns on the same axes as WeekColumns: this week in the strong colour,
 * the rest soft, and the weeks that grew marked with their +n.
 */
export function CountColumns({ weeks, values, color, soft, nowLabel, height = 170 }: { weeks: string[]; values: number[]; color: string; soft: string; nowLabel: string; height?: number }) {
  const W = 330, PL = 4, PR = 30, PT = 22, PB = 22, iw = W - PL - PR, ih = height - PT - PB;
  const max = Math.max(1, ...values); const step = Math.max(1, niceStep(max, Math.min(4, max))); const top = Math.max(step, step * Math.ceil(max / step));
  const n = values.length; const slot = iw / n; const bw = slot * 0.66;
  const x = (i: number) => PL + i * slot + (slot - bw) / 2;
  const y = (v: number) => PT + ih - (v / top) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" style={{ height, direction: 'ltr' }} role="img">
      <Grid top={top} step={step} y={y} x0={PL} x1={PL + iw} W={W} />
      {values.map((v, k) => {
        const grew = k > 0 && v > values[k - 1];
        const now = k === n - 1;
        return (
          <g key={weeks[k]}>
            {v > 0 && <rect x={x(k)} y={y(v)} width={bw} height={y(0) - y(v)} rx={3} fill={now ? color : soft} />}
            {grew && <text x={x(k) + bw / 2} y={y(v) - 5} textAnchor="middle" className="text-[10px] font-black" fill="#15803d">+{v - values[k - 1]}</text>}
            {now && <text x={x(k) + bw / 2} y={y(v) - (grew ? 17 : 5)} textAnchor="middle" className="text-[11px] font-black" fill={color}>{v}</text>}
            {now ? <text x={x(k) + bw / 2} y={height - 6} textAnchor="middle" className="text-[10px] font-bold" fill={color}>{nowLabel}</text>
              : k % 3 === 0 && k < n - 2 && <text x={x(k) + bw / 2} y={height - 6} textAnchor="middle" className="fill-ink-400 text-[10px]">{dm(weeks[k])}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** Plain columns with a label under each; `hi` are drawn in the strong colour. */
export function Columns({ values, labels, height = 110, hi, color = '#1525FF', soft = '#E3E5EC', showValues, format = fmt }: {
  values: number[]; labels: string[]; height?: number; hi?: number[]; color?: string; soft?: string; showValues?: number[]; format?: (v: number) => string;
}) {
  const max = Math.max(1, ...values) * 1.08;
  return (
    <div className="flex items-end gap-[5px]" style={{ height }} dir="ltr">
      {values.map((v, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[3px]">
          <span className="h-3 whitespace-nowrap text-[9.5px] font-extrabold text-ink-900">{(showValues ?? []).includes(i) ? format(v) : ''}</span>
          <i className="block w-full rounded-t-[5px] rounded-b-[2px]" style={{ height: `${(v / max) * 100}%`, background: !hi || hi.includes(i) ? color : soft }} />
          <em className="h-3 whitespace-nowrap text-[9.5px] not-italic text-ink-400">{labels[i]}</em>
        </div>
      ))}
    </div>
  );
}

export function Spark({ values, color = '#1525FF', className }: { values: number[]; color?: string; className?: string }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i * 100) / Math.max(1, values.length - 1)},${30 - (v / max) * 26}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn('block h-[30px] w-full', className)} style={{ direction: 'ltr' }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean; line?: boolean }> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-[5px]">
          <i className={cn('block', it.line ? 'h-[2px] w-[10px]' : 'h-[9px] w-[9px] rounded-[3px]')}
            style={it.dashed ? { border: `1.5px dashed ${it.color}` } : { background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
