'use client';

import { useMemo, useState } from 'react';
import { useApi } from '@/lib/api';
import { useIsSuperUser, STAFF_ROLES } from '@/lib/impersonation';
import { cn } from '@/lib/utils';
import type { PaceAtHr, RunKind } from '@/lib/fitness/pace-at-hr';

// "כושר · קצב באותו דופק" (#105, mockup ~/.cache/madregot/fitness-105/mockup.html):
// for easy and progressive runs, the pace per km at each 5-bpm heart-rate band, over
// time. Faster is UP. The owner and staff only — the route says so too.

const PERIODS = [
  { key: '3m', label: '3 חודשים' },
  { key: '2m', label: 'חודשיים' },
  { key: '1y', label: 'שנה' },
] as const;
const COLORS = ['#9AA3FF', '#1525FF', '#E5673A', '#16794A'];
const KIND: Record<Exclude<RunKind, 'skip'>, { label: string; cls: string }> = {
  easy: { label: 'קל', cls: 'bg-[#E6E8FF] text-brand-600' },
  progressive: { label: 'פרוגרסיב', cls: 'bg-[#FFE4D6] text-[#A14A12]' },
  interval: { label: 'אינטרוולים', cls: 'bg-page text-ink-400 line-through' },
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dayName = (iso: string) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

export function PaceAtHrCard({ athleteId, owner }: { athleteId: string | null; owner: boolean }) {
  const superUser = useIsSuperUser();
  const { data: me } = useApi<{ role?: string }>(owner ? null : '/api/auth/me');
  const allowed = owner || superUser || (!!me?.role && (STAFF_ROLES as readonly string[]).includes(me.role));
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('2m');
  const { data } = useApi<PaceAtHr>(allowed && athleteId ? `/api/athletes/${athleteId}/pace-at-hr?period=${period}` : null);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [allRuns, setAllRuns] = useState(false);

  const bandKeys = useMemo(
    // A band offered as a chip needs two points at least: one dot is not a trend.
    () => Object.keys(data?.bands || {}).map(Number).filter(b => data!.bands[b].filter(p => p.paceSecPerKm != null).length >= 2),
    [data],
  );
  // Default: the headline's band and its two neighbours that have data.
  const shown = picked ?? (data?.headline
    ? bandKeys.filter(b => Math.abs(b - data.headline!.band) <= 5).slice(0, 3)
    : bandKeys.slice(0, 3));

  if (!allowed || !data || bandKeys.length === 0) return null;

  const series = shown.map(b => data.bands[b]);
  const all = series.flat().map(p => p.paceSecPerKm).filter((v): v is number => v != null);
  const lo = Math.floor((Math.min(...all) - 5) / 15) * 15;
  const hi = Math.ceil((Math.max(...all) + 5) / 15) * 15;
  const n = series[0]?.length || 1;
  const L = 36, R = 320, T = 16, B = 140, H = 170;
  const x = (i: number) => L + ((R - L) * i) / Math.max(1, n - 1);
  const y = (s: number) => T + ((B - T) * (s - lo)) / Math.max(1, hi - lo); // faster (smaller) is up
  const ticks = [lo, Math.round((lo + hi) / 2 / 5) * 5, hi];
  const h = data.headline;
  const delta = h ? h.from - h.to : 0;
  const runs = allRuns ? data.runs : data.runs.slice(0, 6);

  return (
    <section className="rounded-card bg-card p-4" dir="rtl">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-ink-700">כושר · קצב באותו דופק</h2>
        <span className="shrink-0 text-2xs text-ink-400">4 שבועות לכל נקודה</span>
      </div>

      <div className="mt-2.5 flex rounded-xl bg-page p-[3px]" role="radiogroup">
        {PERIODS.map(p => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={period === p.key}
            onClick={() => setPeriod(p.key)}
            className={cn('min-h-[36px] flex-1 rounded-[10px] text-xs font-bold', period === p.key ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-500')}
          >
            {p.label}
          </button>
        ))}
      </div>

      {h && (
        <div className={cn('mt-2.5 rounded-2xl px-3 py-2.5', delta > 0 ? 'bg-accent-600/10' : 'bg-page')}>
          <p className={cn('text-xs', delta > 0 ? 'text-accent-900' : 'text-ink-500')}>
            בדופק <bdi dir="ltr">{h.band}–{h.band + 5}</bdi> הקצב היום
          </p>
          <p className={cn('text-[22px] font-black', delta > 0 ? 'text-accent-900' : 'text-ink-700')}>
            <bdi dir="ltr">{fmt(h.to)}</bdi> לק״מ
            {delta !== 0 && (
              <span className="ms-1.5 text-sm font-bold">
                ({delta > 0 ? '▲' : '▼'} <bdi dir="ltr">{Math.abs(delta)}</bdi> שנ׳ {delta > 0 ? 'מהר יותר' : 'לאט יותר'})
              </span>
            )}
          </p>
          <p className={cn('text-xs', delta > 0 ? 'text-accent-900' : 'text-ink-500')}>
            לעומת <bdi dir="ltr">{fmt(h.from)}</bdi> לק״מ בתחילת התקופה — אותו דופק
          </p>
        </div>
      )}

      <svg viewBox={`0 0 330 ${H}`} style={{ direction: 'ltr' }} className="mt-2 block w-full" role="img" aria-label="קצב לפי טווח דופק">
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke="rgba(60,60,67,.1)" />
            <text x={L - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#7C7D87">{fmt(v)}</text>
          </g>
        ))}
        <text x={R} y={9} textAnchor="end" fontSize={9} fill="#16794A">↑ מהר יותר</text>
        {series[0]?.map((p, i) => (i % Math.max(1, Math.ceil(n / 5)) === 0 || i === n - 1) && (
          <text key={p.date} x={x(i)} y={B + 16} textAnchor="middle" fontSize={9} fill="#7C7D87">{dm(p.date)}</text>
        ))}
        {series.map((pts, k) => {
          const xy = pts.map((p, i) => (p.paceSecPerKm != null ? [x(i), y(p.paceSecPerKm)] as const : null));
          const segs: string[] = [];
          let cur = '';
          xy.forEach(pt => { if (pt) cur += `${cur ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`; else if (cur) { segs.push(cur); cur = ''; } });
          if (cur) segs.push(cur);
          const c = COLORS[k % COLORS.length];
          return (
            <g key={shown[k]}>
              {segs.map(d => <path key={d} d={d} fill="none" stroke={c} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />)}
              {xy.map((pt, i) => pt && <circle key={i} cx={pt[0]} cy={pt[1]} r={3} fill="#fff" stroke={c} strokeWidth={2} />)}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11.5px] font-bold">
        {shown.map((b, k) => (
          <span key={b} className="inline-flex items-center gap-1">
            <i className="inline-block h-[3px] w-3.5 rounded" style={{ background: COLORS[k % COLORS.length] }} />
            <bdi dir="ltr">{b}–{b + 5}</bdi>
          </span>
        ))}
      </div>
      <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {bandKeys.map(b => {
          const on = shown.includes(b);
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(on ? shown.filter(x => x !== b) : [...shown, b].sort((a, c) => a - c).slice(-4))}
              className={cn('min-h-[36px] min-w-[44px] shrink-0 rounded-pill px-2.5 text-xs font-bold', on ? 'bg-ink-900 text-white' : 'bg-page text-ink-500')}
            >
              <bdi dir="ltr">{b}</bdi>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-sm font-bold text-ink-700">אילו ריצות נספרו</p>
        <p className="text-2xs text-ink-400">
          {data.runs.filter(r => r.kind !== 'interval').length} נספרו · {data.runs.filter(r => r.kind === 'interval').length} אינטרוולים בחוץ
        </p>
      </div>
      <ul className="mt-1 divide-y divide-page">
        {runs.map(r => (
          <li key={r.id} className="flex items-center justify-between py-2 text-[13px] text-ink-700">
            <span>{dayName(r.date)} <bdi dir="ltr">{dm(r.date)}</bdi> · <bdi dir="ltr">{r.km}</bdi> ק״מ</span>
            {r.kind !== 'skip' && <span className={cn('rounded-md px-1.5 py-px text-2xs font-extrabold', KIND[r.kind].cls)}>{KIND[r.kind].label}</span>}
          </li>
        ))}
      </ul>
      {data.runs.length > 6 && (
        <button type="button" onClick={() => setAllRuns(v => !v)} className="mt-1 min-h-[36px] w-full text-xs font-bold text-brand-600">
          {allRuns ? 'פחות' : `כל ${data.runs.length} הריצות`}
        </button>
      )}
    </section>
  );
}
