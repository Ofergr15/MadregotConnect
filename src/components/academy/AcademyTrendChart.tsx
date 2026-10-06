'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { TrendWeek } from '@/lib/academy/trends';

/**
 * The academy home's one chart, three ways: trainees per week (who was there,
 * and who joined that week), plan completion, and kilometres. One card with a
 * switch instead of three cards, so the home fits one screen.
 *
 * Time runs left to right, like every chart in the app. Bars are one hue (the
 * brand blue); the stacked "joined that week" segment is its light step, named in
 * the legend. Completion is a 2px line, never a second axis on the bar chart.
 * Tap or hover a week for its numbers; the latest week is labelled outright.
 */

type Metric = 'trainees' | 'completion' | 'km';
const TABS: Array<{ key: Metric; label: string; title: string }> = [
  { key: 'trainees', label: 'מתאמנים', title: 'מתאמנים בכל שבוע' },
  { key: 'completion', label: 'ביצוע', title: 'ביצוע התוכנית' },
  { key: 'km', label: 'ק״מ', title: 'ק״מ בשבוע' },
];

const W = 334;
const H = 84;
const TOP = 13;
const BASE = H - 16;
const BRAND = '#1525FF';
const BRAND_LIGHT = '#9FA8FF';

const dayMonth = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;

export function AcademyTrendChart({ coachScope }: { coachScope: boolean }) {
  const [metric, setMetric] = useState<Metric>('trainees');
  const [hover, setHover] = useState<number | null>(null);
  const { data, error } = useApi<{ weeks: TrendWeek[] }>(`/api/academy/trends?weeks=12${coachScope ? '&scope=coach' : ''}`);
  const weeks = data?.weeks ?? [];
  const tab = TABS.find((x) => x.key === metric)!;
  const n = weeks.length;
  const slot = n ? W / n : W;

  const value = (w: TrendWeek) => (metric === 'trainees' ? w.trainees : metric === 'km' ? w.km : w.completionRate);
  const fmt = (w: TrendWeek) => {
    if (metric === 'trainees') return `${w.trainees} מתאמנים${w.joined ? ` · ${w.joined} חדשים` : ''}`;
    if (metric === 'km') return `${w.km} ק״מ · ${w.runs} ריצות`;
    return w.completionRate === null ? 'לא תוכנן' : `${Math.round(w.completionRate * 100)}% מהתוכנית`;
  };
  const shown = hover !== null ? weeks[hover] : weeks[n - 1];

  return (
    <div className="rounded-card bg-card px-3 pb-1.5 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink-700">{tab.title}</h2>
        <div role="tablist" className="flex rounded-lg bg-page p-0.5">
          {TABS.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={metric === x.key}
              onClick={() => { setMetric(x.key); setHover(null); }}
              className={cn(
                'min-h-[32px] rounded-md px-2.5 text-xs font-semibold',
                metric === x.key ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-0.5 flex min-h-[16px] items-center justify-between gap-2 text-3xs text-ink-400">
        {metric === 'trainees' ? (
          <span className="flex gap-3">
            <span><i className="me-1 inline-block h-2 w-2 rounded-sm align-[-1px]" style={{ background: BRAND }} />היו כבר</span>
            <span><i className="me-1 inline-block h-2 w-2 rounded-sm align-[-1px]" style={{ background: BRAND_LIGHT }} />הצטרפו באותו שבוע</span>
          </span>
        ) : <span />}
        {shown && (
          <span className="font-semibold text-ink-700">
            <bdi dir="ltr">{dayMonth(shown.weekStart)}</bdi> · {fmt(shown)}
          </span>
        )}
      </div>

      {error ? (
        <p className="py-8 text-center text-xs text-ink-400">לא הצלחתי לטעון את הגרף</p>
      ) : !data ? (
        <div className="my-1 h-[84px] animate-pulse rounded-lg bg-page/70" />
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`${tab.title}: ${weeks.map((w) => `${dayMonth(w.weekStart)} ${fmt(w)}`).join(', ')}`}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((g) => (
            <line key={g} x1={0} x2={W} y1={BASE - (BASE - TOP) * g} y2={BASE - (BASE - TOP) * g} stroke="#EEEEF2" />
          ))}
          {metric === 'completion' ? <Line weeks={weeks} slot={slot} hover={hover} /> : <Bars weeks={weeks} slot={slot} metric={metric} hover={hover} value={value} />}
          {weeks.map((w, i) => (
            <rect
              key={w.weekStart}
              x={i * slot}
              y={0}
              width={slot}
              height={BASE}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(hover === i ? null : i)}
            />
          ))}
          {n > 0 && [0, Math.floor(n / 2), n - 1].map((i) => (
            <text key={i} x={i * slot + slot / 2} y={H - 3} textAnchor="middle" className="fill-ink-400" fontSize={9.5}>
              {dayMonth(weeks[i].weekStart)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

function Bars({ weeks, slot, metric, hover, value }: {
  weeks: TrendWeek[]; slot: number; metric: Metric; hover: number | null; value: (w: TrendWeek) => number | null;
}) {
  const max = Math.max(1, ...weeks.map((w) => Number(value(w)) || 0)) * 1.15;
  const bw = Math.max(4, slot - 6);
  const r = 4;
  const rounded = (x: number, yTop: number, h: number) =>
    h <= r ? `M${x},${BASE} v${-h} h${bw} v${h} z`
      : `M${x},${BASE} v${-(h - r)} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
  return (
    <>
      {weeks.map((w, i) => {
        const v = Number(value(w)) || 0;
        const x = i * slot + (slot - bw) / 2;
        const h = ((BASE - TOP) * v) / max;
        const top = metric === 'trainees' ? w.joined : 0;
        const ht = ((BASE - TOP) * top) / max;
        const dim = hover !== null && hover !== i ? 0.45 : 1;
        const lower = top ? Math.max(0, h - ht - 2) : h;
        return (
          <g key={w.weekStart} opacity={dim}>
            {lower > 0 && (top
              ? <path d={`M${x},${BASE} v${-lower} h${bw} v${lower} z`} fill={BRAND} />
              : <path d={rounded(x, BASE - h, h)} fill={BRAND} />)}
            {top > 0 && ht > 0 && (
              <path
                d={ht <= r
                  ? `M${x},${BASE - h + ht} v${-ht} h${bw} v${ht} z`
                  : `M${x},${BASE - h + ht} v${-(ht - r)} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${ht - r} z`}
                fill={BRAND_LIGHT}
              />
            )}
            {i === weeks.length - 1 && (
              <text x={x + bw / 2} y={BASE - h - 4} textAnchor="middle" fontSize={11} fontWeight={800} className="fill-ink-700">{v}</text>
            )}
          </g>
        );
      })}
    </>
  );
}

function Line({ weeks, slot, hover }: { weeks: TrendWeek[]; slot: number; hover: number | null }) {
  const pts = weeks.map((w, i) => ({ i, v: w.completionRate })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (!pts.length) return <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={11} className="fill-ink-400">עוד אין שבועות עם תוכנית</text>;
  const lo = Math.min(0.5, ...pts.map((p) => p.v));
  const X = (i: number) => i * slot + slot / 2;
  const Y = (v: number) => BASE - ((BASE - TOP) * (v - lo)) / (1 - lo || 1);
  const last = pts[pts.length - 1];
  const at = hover !== null ? pts.find((p) => p.i === hover) : undefined;
  return (
    <>
      <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" stroke={BRAND} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(last.i)} cy={Y(last.v)} r={4.5} fill={BRAND} stroke="#fff" strokeWidth={2} />
      <text x={X(last.i)} y={Y(last.v) - 8} textAnchor="middle" fontSize={11} fontWeight={800} className="fill-ink-700">{Math.round(last.v * 100)}%</text>
      {at && at !== last && <circle cx={X(at.i)} cy={Y(at.v)} r={4.5} fill={BRAND} stroke="#fff" strokeWidth={2} />}
    </>
  );
}
