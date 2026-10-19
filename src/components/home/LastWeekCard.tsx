'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { addDaysToDateStr, cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { nameQualifier, roundKm } from '@/lib/plans/week-summary';
import { lastWeekSummary, runClock, weeksSummary } from '@/lib/home/today';
import type { DailyDistance, WeekSession } from '@/lib/plans/workout-parsing';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';

// ── "השבוע שעבר" on the runner's home (mockup ~/.cache/madregot/today-mockup.html) ──────
//
// Two charts in the app's chart language (components/trainee/WeeklyLoadChart.tsx): time
// runs LEFT → RIGHT even in this RTL app (lib/charts/timeline.ts, spec G1), the dashed
// frame is what was planned and the solid bar what was run, the dotted line an average,
// every label an HTML span over an LTR SVG. A tap picks a day and the line under the axis
// prints it; the long run is picked to start with.

const BLUE = '#1525FF';
const MISS = '#E5484D';

function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setWidth(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

const pace = (seconds: number, km: number) => {
  if (km <= 0) return '';
  const s = Math.round(seconds / km);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const dm = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`; };
/** "11–17.10", or "27.9–3.10" across a month. */
const weekSpan = (iso: string) => {
  const a = new Date(`${iso}T12:00:00Z`); const b = new Date(a.getTime() + 6 * 86_400_000);
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()}.${b.getUTCMonth() + 1}` : `${dm(iso)}–${b.getUTCDate()}.${b.getUTCMonth() + 1}`;
};

function Label({ x, y, className, children }: { x: number; y: number; className?: string; children: ReactNode }) {
  return (
    <span dir="rtl" className={cn('absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-[11.5px] font-extrabold', className)} style={{ left: x, top: y }}>
      {children}
    </span>
  );
}

export function LastWeekCard({ pw, plan }: {
  pw: PlanWeekStats;
  /** Last week's plan in the runner's lane (/api/plans/week?lane=mine), null when there was none. */
  plan: { hasPlan?: boolean; dailyDistances?: DailyDistance[]; sessions?: WeekSession[] } | null;
}) {
  const t = useTranslations('todayHome');
  const tc = useTranslations('common');
  const dayNames = tc.raw('dayNames') as string[];
  const dayShort = tc.raw('dayNamesShort') as string[];
  const { ref, width } = useWidth(326);
  const { ref: ref2, width: width2 } = useWidth(326);

  const hasPlan = !!plan?.hasPlan && !!plan.dailyDistances?.length;
  const s = lastWeekSummary(hasPlan ? plan!.dailyDistances : null, pw.lastDays ?? [], pw.lastDayRuns ?? []);
  const w = weeksSummary(pw.weeks);
  const [picked, setPicked] = useState<number | null>(null);
  if (s.km <= 0 && !hasPlan) return null;
  const sel = picked ?? s.longest?.dayOfWeek ?? null;

  // ── day by day
  const H = 156; const TOP = 22;
  const max = Math.max(10, ...s.days.map((d) => Math.max(d.km, d.planned)));
  const k = (H - TOP) / (Math.ceil(max / 10) * 10);
  const slot = width / 7; const bw = Math.min(30, slot - 12);
  const grid = [0.5, 1].map((f) => Math.round((Math.ceil(max / 10) * 10 * f)));

  const selDay = sel != null ? s.days[sel] : null;
  const selRuns = sel != null ? (pw.lastDayRuns?.[sel] ?? []) : [];
  const selNames = sel != null ? (plan?.sessions ?? []).filter((x) => x.dayOfWeek === sel && !x.optional).map((x) => nameQualifier(x.name, dayNames) || '').filter(Boolean) : [];
  const selName = selNames.length === 1 ? selNames[0] : '';
  const misses = s.days.filter((d) => d.missed);

  // ── eight weeks
  const H2 = 112; const T2 = 18;
  const wMax = w ? Math.max(...w.weeks.map((x) => x.km), w.avg, 10) : 10;
  const k2 = (H2 - T2) / wMax;
  const slot2 = w ? width2 / w.weeks.length : 0; const bw2 = Math.min(26, slot2 - 10);

  return (
    <section className="rounded-[22px] bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <b className="text-[15.5px] font-extrabold text-ink-900">{t('lastWeek')}</b>
        <span className="text-[12.5px] text-ink-400"><bdi dir="ltr">{weekSpan(pw.weeks[pw.weeks.length - 2]?.weekStart ?? pw.weekStart)}</bdi></span>
      </div>

      <div className="mt-2 flex items-center gap-3.5">
        <b className="text-[44px] font-black leading-none tracking-tight text-ink-900"><bdi dir="ltr">{roundKm(s.km)}</bdi><small className="ms-1 text-base font-bold text-ink-500">{tc('km')}</small></b>
        <div className="flex flex-col gap-1">
          {w?.delta != null && w.delta !== 0 && (
            <span className={cn('self-start rounded-full px-2.5 py-0.5 text-[13px] font-extrabold', w.delta > 0 ? 'bg-accent-600/10 text-accent-900' : 'bg-page text-ink-500')}>
              {w.delta > 0 ? '▲' : '▼'} <bdi dir="ltr">{Math.abs(w.delta)}</bdi> {t('vsWeekBefore')}
            </span>
          )}
          {s.pct != null && (
            <span className="text-[12.5px] text-ink-400">
              {t('ofPlan', { pct: s.pct })}{s.sessionsPlanned > 0 && <> · <bdi dir="ltr">{s.sessionsDone}/{s.sessionsPlanned}</bdi> {t('sessions')}</>}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-[13px] font-extrabold text-ink-700">
        <span>{t('dayByDay')}</span>
        {hasPlan && (
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-400">
            <i className="h-[11px] w-[11px] rounded-[3px] border-[1.5px] border-dashed border-[#8F98FF] bg-[#F3F4FF]" />{t('planned')}
            <i className="ms-1.5 h-[11px] w-[11px] rounded-[3px] bg-brand-600" />{t('ran')}
          </span>
        )}
      </div>
      <div ref={ref} dir="ltr" className="relative mt-1.5" style={{ height: H + 2 }}>
        <svg width={width} height={H + 2} viewBox={`0 0 ${width} ${H + 2}`} className="block" role="img" aria-label={t('dayByDayAria')}>
          {grid.map((v) => <line key={v} x1={0} x2={width} y1={H - v * k} y2={H - v * k} stroke="#F0F1F5" />)}
          <line x1={0} x2={width} y1={H} y2={H} stroke="#E4E5EB" />
          {s.days.map((d, i) => {
            const cx = slot * i + slot / 2; const x = cx - bw / 2;
            const py = H - d.planned * k; const dy = H - d.km * k;
            return (
              <g key={i}>
                {hasPlan && d.planned > 0 && <rect x={x} y={py} width={bw} height={d.planned * k} rx={7} fill="#F3F4FF" stroke="#8F98FF" strokeDasharray="4 3" strokeWidth={1.5} />}
                {d.km > 0 && <rect x={x + 3} y={dy} width={bw - 6} height={Math.max(d.km * k, 3)} rx={5} fill={d.missed ? MISS : BLUE} />}
                {sel === i && <rect x={x - 3} y={Math.min(py, dy) - 3} width={bw + 6} height={H - Math.min(py, dy) + 3} rx={9} fill="none" stroke="#16171F" strokeWidth={1.6} />}
              </g>
            );
          })}
        </svg>
        {s.days.map((d, i) => (d.km > 0 || d.planned > 0) && (
          <Label key={i} x={slot * i + slot / 2} y={Math.min(H - d.planned * k, H - d.km * k) - 4} className={d.missed ? 'text-[#C93C40]' : 'text-ink-900'}>
            <bdi dir="ltr">{roundKm(d.km)}</bdi>
          </Label>
        ))}
        <button type="button" aria-label={t('pickDay')} className="absolute inset-0"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.min(6, Math.max(0, Math.floor((e.clientX - box.left) / slot)));
            setPicked(i);
          }} />
      </div>
      <div dir="ltr" className="relative mt-1 h-4">
        {s.days.map((_, i) => (
          <span key={i} className={cn('absolute -translate-x-1/2 text-[11.5px]', sel === i ? 'font-extrabold text-ink-900' : 'font-semibold text-ink-400')} style={{ left: slot * i + slot / 2 }}>
            {dayShort[i]}
          </span>
        ))}
      </div>
      {selDay && (
        <p className="mt-1.5 rounded-[10px] bg-page/70 px-2.5 py-1.5 text-[12.5px] text-ink-500" aria-live="polite">
          <b className="text-ink-900">{dayNames[sel!]}{selName && <> · <bdi dir="auto">{selName}</bdi></>}</b>
          {' — '}<bdi dir="ltr">{roundKm(selDay.km)}</bdi>
          {selDay.planned > 0 ? <> {t('outOf')} <bdi dir="ltr">{roundKm(selDay.planned)}</bdi></> : null} {tc('km')}
          {selRuns.length === 1 && selDay.km > 0 && <>, <bdi dir="ltr">{pace(selRuns[0].seconds, selRuns[0].km)}</bdi> {t('perKm')}</>}
        </p>
      )}
      {hasPlan && (
        <p className="mt-2 text-13 leading-normal text-ink-500">
          {misses.length === 0 ? t('allOnPlan') : t('missedDays', {
            days: misses.map((d) => `${dayNames[d.dayOfWeek]} (${roundKm(d.km)}/${roundKm(d.planned)})`).join(', '),
          })}
          {s.longest && s.longest.km >= 20 && <> {t('longRun', { km: roundKm(s.longest.km), time: runClock(s.longest.seconds) })}</>}
        </p>
      )}

      {w && (
        <>
          <div className="mt-4 flex items-center justify-between text-[13px] font-extrabold text-ink-700">
            <span>{t('eightWeeks')}</span>
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-400">
              <i className="w-4 border-t-2 border-dotted border-ink-900/45" />{t('average', { km: w.avg })}
            </span>
          </div>
          <div ref={ref2} dir="ltr" className="relative mt-1.5" style={{ height: H2 + 2 }}>
            <svg width={width2} height={H2 + 2} viewBox={`0 0 ${width2} ${H2 + 2}`} className="block" role="img" aria-label={t('eightWeeksAria')}>
              <line x1={0} x2={width2} y1={H2} y2={H2} stroke="#E4E5EB" />
              {w.weeks.map((x, i) => {
                const cx = slot2 * i + slot2 / 2; const last = i === w.weeks.length - 1;
                return <rect key={x.weekStart} x={cx - bw2 / 2} y={H2 - x.km * k2} width={bw2} height={Math.max(x.km * k2, 2)} rx={6} fill={last ? BLUE : '#C9CEFF'} />;
              })}
              <line x1={0} x2={width2} y1={H2 - w.avg * k2} y2={H2 - w.avg * k2} stroke="#16171F" strokeOpacity={0.38} strokeDasharray="2 4" strokeWidth={1.5} />
            </svg>
            {w.weeks.map((x, i) => {
              const last = i === w.weeks.length - 1;
              return (
                <Label key={x.weekStart} x={slot2 * i + slot2 / 2} y={H2 - x.km * k2 - 4} className={last ? 'text-brand-600' : 'text-[11px] font-bold text-ink-400'}>
                  <bdi dir="ltr">{Math.round(x.km)}</bdi>
                </Label>
              );
            })}
          </div>
          <div dir="ltr" className="relative mt-1 h-4">
            {w.weeks.map((x, i) => (
              <span key={x.weekStart} className={cn('absolute -translate-x-1/2 whitespace-nowrap text-[11px]', i === w.weeks.length - 1 ? 'font-extrabold text-ink-900' : 'font-semibold text-ink-400')} style={{ left: slot2 * i + slot2 / 2 }}>
                {dm(x.weekStart)}
              </span>
            ))}
          </div>
          {w.ratio != null && (
            <p className="mt-2 text-13 leading-normal text-ink-500">
              {w.biggest ? t.rich('biggest', { b: (c) => <b className="text-ink-900">{c}</b>, ratio: w.ratio }) : w.ratio >= 1 ? t('vsAverage', { ratio: w.ratio }) : t('belowAverage', { avg: w.avg })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Last week on the home, reading what it needs: the stats' plan week and last week's plan in my lane. */
export function LastWeek({ athleteId }: { athleteId: string }) {
  const { data: stats } = useApi<{ planWeek?: PlanWeekStats }>(`/api/athletes/${athleteId}/stats`);
  const pw = stats?.planWeek;
  const { data: plan } = useApi<{ hasPlan?: boolean; dailyDistances?: DailyDistance[]; sessions?: WeekSession[] }>(
    pw ? `/api/plans/week?weekStart=${addDaysToDateStr(pw.weekStart, -7)}&lane=mine` : null,
  );
  if (!pw?.lastDays || plan === undefined) return null;
  return <LastWeekCard pw={pw} plan={plan ?? null} />;
}
