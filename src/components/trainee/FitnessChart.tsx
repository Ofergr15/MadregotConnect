'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { LoadPayload } from '@/lib/academy/load-payload';
import { FITNESS_CHART, fitnessChart } from '@/lib/academy/progress';
import { monthName, useMeasuredWidth } from './ui';

// ── כושר ועייפות (trainee-experience-v2 screen 7, TP's PMC) ─────────────────────────────
//
// Two lines and nothing else: fitness thick in the brand blue with a light fill under it,
// fatigue thin in #C2559B. Time runs OLDEST LEFT → today on the right (spec G1,
// lib/charts/timeline.ts), so fitness that is being built climbs toward "היום". The
// geometry is lib/academy/progress.ts `fitnessChart`; the SVG is `direction="ltr"`, and
// every label — the month names, "היום", the two end values — is an HTML span over it.

export const FIT = '#1525FF';
export const FAT = '#C2559B';

export function FitnessChart({ series, height = FITNESS_CHART.height }: { series: LoadPayload['series']; height?: number }) {
  const t = useTranslations('trainee.progress');
  const locale = useLocale();
  const { ref, width } = useMeasuredWidth(FITNESS_CHART.width);
  const g = fitnessChart(series, { width, height });
  if (!g) return null;
  // The fitness value sits on the side away from the fatigue line, so the two never overlap.
  const fitAbove = g.end.fitnessY <= g.end.fatigueY;

  return (
    <div>
      <div ref={ref} dir="ltr" className="relative" style={{ height: g.height }}>
        <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} direction="ltr" className="block"
          role="img" aria-label={t('aria', { days: series.length > 1 ? Math.round((Date.parse(series[series.length - 1].date) - Date.parse(series[0].date)) / 86_400_000) + 1 : 1 })}>
          {g.grid.map(y => <line key={y} x1={0} x2={g.width} y1={y} y2={y} stroke="#F1F1F5" />)}
          <path d={g.fitnessArea} fill={FIT} opacity={0.07} />
          <path d={g.fatiguePath} fill="none" stroke={FAT} strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
          <path d={g.fitnessPath} fill="none" stroke={FIT} strokeWidth={3.8} strokeLinecap="round" />
          <circle cx={g.end.x} cy={g.end.fatigueY} r={4.5} fill="#fff" stroke={FAT} strokeWidth={2.5} />
          <circle cx={g.end.x} cy={g.end.fitnessY} r={5.5} fill="#fff" stroke={FIT} strokeWidth={3} />
        </svg>
        <span className="absolute whitespace-nowrap text-[13px] font-extrabold" dir="ltr"
          style={{ left: g.end.x - 8, top: g.end.fitnessY + (fitAbove ? -8 : 8), color: FIT, transform: `translate(-100%, ${fitAbove ? '-100%' : '0'})` }}>
          <bdi dir="ltr">{g.end.fitness}</bdi>
        </span>
        <span className="absolute whitespace-nowrap text-[11px] font-extrabold" dir="ltr"
          style={{ left: g.end.x - 8, top: g.end.fatigueY + (fitAbove ? 6 : -6), color: FAT, transform: `translate(-100%, ${fitAbove ? '0' : '-100%'})` }}>
          <bdi dir="ltr">{g.end.fatigue}</bdi>
        </span>
      </div>
      <div dir="ltr" className="relative mt-[3px] h-4">
        {g.labels.map(l => (
          <span key={`${l.kind}${l.date}`}
            className={cn('absolute top-0 whitespace-nowrap text-[11px]',
              l.kind === 'today' ? 'font-extrabold text-ink-900' : 'text-ink-400',
              l.align === 'center' && '-translate-x-1/2', l.align === 'end' && '-translate-x-full')}
            style={{ left: l.kind === 'today' ? l.x + 6 : l.align === 'start' ? Math.max(0, l.x - 6) : l.x }}>
            {l.kind === 'today' ? t('today') : monthName(l.date, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}
