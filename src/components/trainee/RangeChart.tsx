'use client';

import { useTranslations } from 'next-intl';
import { RANGE_CHART, rangeChart, type MetricPanel } from '@/lib/academy/body';
import { fmtSleep } from '@/lib/academy/normal-range';
import { xAt } from '@/lib/charts/timeline';
import { C, RICH, dm, useMeasuredWidth } from './ui';

// ── 30 mornings against the normal range (trainee-experience-v2 screen 8) ──────────────
//
// Resting HR or sleep, OLDEST LEFT and today on the right (G1). The green band is the
// trainee's own P25…P75 — half their mornings fall inside it. Grey dots are mornings; only
// the bad side is coloured (orange above the band for resting HR, below it for sleep — a
// low HR and a long night are good news). The newest morning is the big dot with its value
// flagged; every label, the gridlines' included, is an HTML span over the LTR SVG.

export function RangeChart({ panel, kind, today }: { panel: MetricPanel; kind: 'rhr' | 'sleep'; today: string }) {
  const t = useTranslations('trainee.body');
  const { ref, width } = useMeasuredWidth(RANGE_CHART.width);
  const g = rangeChart(panel.series, panel.range, kind, today, { width });
  if (!g) return null;
  const fmt = (v: number) => (kind === 'sleep' ? fmtSleep(v) : String(Math.round(v)));
  const latest = g.dots.find(d => d.latest);
  // The x labels sit under the first day, the middle and today — by day, like the dots.
  const at = (i: number) => xAt(i, 30, g.width, RANGE_CHART.padL, RANGE_CHART.padR);

  return (
    <div>
      <div ref={ref} dir="ltr" className="relative" style={{ height: g.height }}>
        <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} direction="ltr" className="block" role="img" aria-label={t(`aria.${kind}`)}>
          {g.grid.map(l => <line key={l.value} x1={20} x2={g.width} y1={l.y} y2={l.y} stroke="#ECECF1" />)}
          {g.band && <rect x={20} y={g.band.y} width={g.width - 20} height={g.band.h} fill={C.goodBg} rx={8} />}
          {g.dots.map(d => (
            <circle key={d.date} cx={d.x} cy={d.y} r={d.latest ? 6 : d.out ? 4 : 3.2}
              fill={d.out ? C.org : '#9A9BA6'} stroke="#fff" strokeWidth={d.latest ? 2 : 1.2} />
          ))}
        </svg>
        {g.grid.map(l => (
          <span key={`g${l.value}`} className="absolute left-0 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold text-ink-300" style={{ top: l.y }}>
            <bdi dir="ltr">{fmt(l.value)}</bdi>
          </span>
        ))}
        {latest && (
          <span dir="rtl" className="absolute -translate-x-full -translate-y-full whitespace-nowrap text-[11px] font-extrabold"
            style={{ left: latest.x + 4, top: latest.y - 9, color: latest.out ? C.warn : '#4A4B57' }}>
            {latest.date === today
              ? t.rich(`flag.${kind}`, { ...RICH, v: fmt(latest.value) })
              : t.rich('flag.date', { ...RICH, v: fmt(latest.value), date: dm(latest.date) })}
          </span>
        )}
      </div>
      <div dir="ltr" className="relative mt-[3px] h-4">
        <span className="absolute top-0 whitespace-nowrap text-[11px] text-ink-400" style={{ left: Math.max(0, at(0) - 6) }}>{t('x.month')}</span>
        <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] text-ink-400" style={{ left: at(15) }}>{t('x.twoWeeks')}</span>
        <span className="absolute top-0 -translate-x-full whitespace-nowrap text-[11px] font-extrabold text-ink-900" style={{ left: at(29) + 6 }}>{t('x.today')}</span>
      </div>
    </div>
  );
}
