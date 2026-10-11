'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { THRESHOLD_BOX, monthLabelAt, thresholdChart, type ThresholdPoint } from '@/lib/charts/threshold';
import { CARD, clock, monthName } from './ui';

// ── 7ג "כל הטסטים" (mockup trainee-experience-v2) ──────────────────────────────────────
//
// The threshold of every test: oldest on the LEFT, faster HIGHER (spec G1/G2), so a
// threshold that improves climbs toward today. A green line with a light fill, each test's
// pace over its dot and its month under it — HTML spans over an LTR SVG, never <text>,
// and month names only (never "מרץ 26", which reads as a day of the month).

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

const GREEN = '#1FA55B';

export function ThresholdChart({ points, className }: { points: ThresholdPoint[]; className?: string }) {
  const t = useTranslations('trainee.tests');
  const locale = useLocale();
  const { ref, width } = useWidth(THRESHOLD_BOX.width);
  const chart = thresholdChart(points, { width });
  if (!chart) return null;
  const n = chart.points.length;

  return (
    <section className={cn(CARD, 'px-4 py-3.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-ink-900">{t('chart')}</h2>
        <span className="text-[12px] font-bold text-ink-400">{t('axis')}</span>
      </div>
      <div ref={ref} dir="ltr" className="relative mt-2.5" style={{ height: chart.height }}>
        <svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} direction="ltr" className="block" role="img" aria-label={t('chartAria')}>
          {chart.grid.map(g => <line key={g} x1={0} x2={chart.width} y1={g} y2={g} stroke="#F1F1F5" />)}
          {chart.area && <path d={chart.area} fill={GREEN} opacity={0.08} />}
          {n > 1 && <path d={chart.line} fill="none" stroke={GREEN} strokeWidth={3.2} strokeLinecap="round" />}
          {chart.points.map(p => (
            <circle key={p.date} cx={p.x} cy={p.y} r={p.newest ? 6 : 4.5} fill="#fff" stroke={GREEN} strokeWidth={p.newest ? 3 : 2.5} />
          ))}
        </svg>
        {chart.points.map(p => (
          // Over the dot with a clear gap (the dot's radius and 4px), so a label never sits on it.
          <span key={`v${p.date}`}
            className={cn('absolute -translate-x-1/2 -translate-y-full whitespace-nowrap font-extrabold', p.newest ? 'text-[13px] text-[#0E7A3C]' : 'text-[11.5px] text-ink-500')}
            style={{ left: p.x, top: p.y - (p.newest ? 10 : 8) }}>
            <bdi dir="ltr">{clock(p.paceSec)}</bdi>
          </span>
        ))}
      </div>
      <div dir="ltr" className="relative mt-1 h-4">
        {chart.points.map((p, i) => monthLabelAt(i, n) && (
          <span key={`m${p.date}`}
            className={cn('absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px]', p.newest ? 'font-extrabold text-ink-900' : 'text-ink-400')}
            style={{ left: p.x }}>
            {monthName(p.date, locale)}
          </span>
        ))}
      </div>
    </section>
  );
}
