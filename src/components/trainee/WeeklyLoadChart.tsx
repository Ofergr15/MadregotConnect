'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { CHART, nearestBar, weeklyLoadChart, weeklySentence, type WeeklyBarInput } from '@/lib/charts/weekly-load';
import { N } from '@/components/academy/book/ui';
import { CARD, dm } from './ui';

// ── ⚡ עומס לפי שבוע (trainee-experience-v2 screen 3) ───────────────────────────────────
//
// Eight Sunday weeks of done load, OLDEST ON THE LEFT and this week on the right (spec
// G1, lib/charts/timeline.ts), even in this RTL app — the header says so in words. This
// week is solid for what is done so far inside a dashed frame for what is planned, with
// the planned number flagged; an easy week is the light bar with "שבוע קל"; the dotted
// line is the average of the complete weeks. Every label is an HTML span over the LTR
// SVG, never <text>. One sentence under it compares the plan with the average. A tap on
// the chart picks the nearest bar and the line under the axis prints its value (spec M2).
//
// Drawn only when there is something to draw: the board shows KmCard instead while the
// load is still being learned (MonthBoard decides).

const FILL = { past: '#7C86FF', easy: '#C9CEFF', now: '#1525FF' } as const;

/** The card's inner width, measured, so the bars are laid out at real pixels (no stretched rx). */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function WeeklyLoadChart({ weekly }: { weekly: WeeklyBarInput[] }) {
  const t = useTranslations('trainee.month.load');
  const { ref, width } = useWidth(CHART.width);
  const chart = weeklyLoadChart(weekly, { width });
  const sentence = weeklySentence(weekly);
  const rich = {
    m: (c: ReactNode) => <N>{c}</N>,
    b: (c: ReactNode) => <b className="font-extrabold text-ink-900">{c}</b>,
  };
  const half = chart.barW / 2;
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked != null ? chart.bars[picked] ?? null : null;

  return (
    <div className={cn(CARD, 'px-4 py-3.5')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-extrabold text-ink-900">{t('title')}</span>
        <span className="text-[12.5px] font-bold text-ink-400">{t('axis')}</span>
      </div>
      <div ref={ref} dir="ltr" className="relative mt-2" style={{ height: chart.height }}>
        <svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} direction="ltr"
          className="block" role="img" aria-label={t('aria', { n: weekly.length })}>
          <line x1={0} x2={chart.width} y1={chart.baseY} y2={chart.baseY} stroke="#ECECF1" />
          {chart.bars.map(b => (
            <g key={b.weekStart}>
              {b.planned && (
                <rect x={b.x - half} y={b.planned.y} width={chart.barW} height={b.planned.h} rx={6}
                  fill={b.easy ? '#F7F8FF' : '#F3F4FF'} stroke={b.easy ? '#C9CEFF' : '#8F98FF'} strokeDasharray="4 3" strokeWidth={1.5} />
              )}
              {b.h > 0 && <rect x={b.x - half} y={b.y} width={chart.barW} height={b.h} rx={6} fill={FILL[b.tone]} />}
              {sel === b && (
                <rect x={b.x - half - 2.5} y={Math.min(b.y, b.planned?.y ?? b.y) - 2.5} width={chart.barW + 5}
                  height={chart.baseY - Math.min(b.y, b.planned?.y ?? b.y) + 2.5} rx={8} fill="none" stroke="#16171F" strokeWidth={1.5} />
              )}
            </g>
          ))}
          {chart.avgY != null && (
            <line x1={0} x2={chart.width} y1={chart.avgY} y2={chart.avgY} stroke="#16171F" strokeOpacity={0.35} strokeDasharray="2 4" strokeWidth={1.5} />
          )}
        </svg>
        {chart.bars.filter(b => b.easy && (b.tone === 'easy' || b.planned)).map(b => (
          <Flag key={`e${b.weekStart}`} x={b.x} y={b.planned ? b.planned.y - 17 : b.y - 3} className="text-ink-400">{t('easy')}</Flag>
        ))}
        {chart.bars.filter(b => b.planned).map(b => (
          <Flag key={`p${b.weekStart}`} x={b.x} y={b.planned!.y - 3} className="text-brand-600"><N>{b.planned!.value}</N></Flag>
        ))}
        {chart.avg != null && chart.avgY != null && (
          <span dir="rtl" className="absolute left-0.5 -translate-y-full whitespace-nowrap text-[11px] font-bold text-ink-400"
            style={{ top: chart.avgY - 2 }}>
            {t.rich('avg', { ...rich, avg: chart.avg })}
          </span>
        )}
        <button type="button" aria-label={t('pickAria')} className="absolute inset-0 cursor-pointer"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = nearestBar(chart, e.clientX - box.left);
            setPicked(i === picked ? null : i);
          }} />
      </div>
      <div dir="ltr" className="relative mt-[3px] h-4">
        {chart.bars.map(b => (
          <span key={b.weekStart}
            className={cn('absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px]', b.isNow ? 'font-extrabold text-ink-900' : 'text-ink-400')}
            style={{ left: b.x }}>
            {b.isNow ? t('thisWeek') : <N>{dm(b.weekStart)}</N>}
          </span>
        ))}
      </div>
      <p className="mt-1 min-h-[18px] text-[12.5px] text-ink-500" aria-live="polite">
        {sel ? (
          <>
            {sel.isNow
              ? t.rich('pickedNow', { ...rich, done: sel.done })
              : t.rich('pickedWeek', { ...rich, date: dm(sel.weekStart), done: sel.done })}
            {sel.plannedValue != null && t.rich('pickedPlanned', { ...rich, planned: sel.plannedValue })}
            {sel.easy && t('pickedEasy')}
          </>
        ) : <span className="text-ink-400">{t('tapHint')}</span>}
      </p>
      {sentence && (
        <p className="mt-1.5 text-13 leading-normal text-ink-500">
          {t.rich(sentence.key as 'noPlan', { ...rich, ...sentence.params } as never)}
          {sentence.afterHeavy && t('afterHeavy')}
          {t('end')}
          {sentence.easyShown && t('easyNote')}
          {sentence.easyNow && t('easyNowNote')}
        </p>
      )}
    </div>
  );
}

function Flag({ x, y, className, children }: { x: number; y: number; className?: string; children: ReactNode }) {
  return (
    <span dir="rtl" className={cn('absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-[11px] font-extrabold', className)}
      style={{ left: x, top: y }}>
      {children}
    </span>
  );
}
