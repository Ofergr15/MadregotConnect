'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonCard, SegmentedControl } from '@/components/ui';

type Granularity = 'week' | 'month' | 'year';

interface Week {
  weekStart: string;
  km: number;
  runs: number;
  durationSec: number;
}
interface Data {
  series: Week[];
  weeksReturned: number;
  peakKm: number;
  avgKm: number;
}

const HE_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const UNIT_LABEL: Record<Granularity, string> = { week: 'שבועי', month: 'חודשי', year: 'שנתי' };
const PER_PERIOD_LABEL: Record<Granularity, string> = { week: 'לשבוע', month: 'לחודש', year: 'לשנה' };
const RECENT_PERIODS_LABEL: Record<Granularity, string> = { week: 'שבועות אחרונים', month: 'חודשים אחרונים', year: 'שנים אחרונות' };

// Training-volume history — the athlete's km over the last N periods, from the
// durable weekly_km_snapshots table (nightly cron; complete incl. zero weeks),
// aggregated server-side by week/month/year. A hand-rolled SVG bar chart
// matching the app's chart style. Hidden until there's at least one period with
// a run, so it never shows an empty shell. Athlete-scoped via the same auth as
// /prs and /summary.
export function VolumeHistory({ athleteId }: { athleteId: string }) {
  const [granularity, setGranularity] = useState<Granularity>('week');
  const periods = granularity === 'week' ? 12 : granularity === 'month' ? 12 : 6;
  const query = granularity === 'week'
    ? `weeks=${periods}`
    : `granularity=${granularity}&periods=${periods}`;
  const { data } = useApi<Data>(
    athleteId ? `/api/athletes/volume-history?athleteId=${encodeURIComponent(athleteId)}&${query}` : null,
  );

  const series = data?.series || [];
  const ran = series.filter((w) => w.runs > 0);

  // This-period vs prior-period trend (last two entries in chronological order).
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = prev ? Math.round((last.km - prev.km) * 10) / 10 : 0;
  const TrendIcon = delta > 0.05 ? TrendingUp : delta < -0.05 ? TrendingDown : Minus;
  const trendColor = delta > 0.05 ? 'text-accent-600' : delta < -0.05 ? 'text-band-3' : 'text-ink-400';

  // Chart geometry (viewBox; scales to container width).
  const W = 1000, H = 240;
  const pad = { top: 20, right: 16, bottom: 40, left: 40 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxKm = Math.max(data?.peakKm || 0, ...series.map((w) => w.km), 1);
  const n = series.length;
  const slot = n ? chartW / n : chartW;
  const barW = Math.min(slot * 0.6, 46);
  const toY = (km: number) => pad.top + chartH - (km / maxKm) * chartH;

  // Y gridlines at 0 / half / peak.
  const gridVals = [0, Math.round(maxKm / 2), Math.round(maxKm)];
  const fmtPeriod = (key: string) => {
    if (granularity === 'year') return key;
    if (granularity === 'month') {
      const [, m] = key.split('-').map(Number);
      return HE_MONTHS[m - 1];
    }
    const d = new Date(key + 'T12:00:00Z');
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };
  // Label density: every period if ≤8, else every other.
  const labelEvery = n <= 8 ? 1 : 2;
  // A value on EVERY bar goes unread and turns twelve periods into a wall of
  // digits. Label the two that carry the story instead — the peak and the period
  // we're in — and let the peak/average line above and the axis carry the rest.
  const peakIdx = series.reduce((best, w, i) => (w.km > series[best].km ? i : best), 0);

  return (
    <div className="rounded-card bg-card/80 border border-page/50 p-5" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">נפח {UNIT_LABEL[granularity]}</h2>
        </div>
        {series.length > 0 && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            {delta > 0 ? '+' : ''}{delta} ק״מ
          </span>
        )}
      </div>

      <SegmentedControl
        value={granularity}
        onChange={setGranularity}
        options={[
          { value: 'week', label: 'שבועות' },
          { value: 'month', label: 'חודשים' },
          { value: 'year', label: 'שנים' },
        ]}
        className="mb-3"
      />

      {!data ? (
        <SkeletonCard className="h-40" />
      ) : ran.length === 0 ? (
        <p className="text-sm text-ink-400 text-center py-8">אין עדיין נתוני נפח לתקופה הזו</p>
      ) : (
        <>
      <div className="flex items-baseline gap-4 mb-3">
        <span className="text-xs text-ink-400">שיא: <b className="text-ink-700 tabular-nums">{data.peakKm}</b> ק״מ</span>
        <span className="text-xs text-ink-400">ממוצע: <b className="text-ink-700 tabular-nums">{data.avgKm}</b> ק״מ</span>
      </div>

      <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '220px' }}>
        {/* Solid hairlines. Dashing a gridline reads as "threshold" or "projected"
            when it is only a grid, and at 0.5px the dashes are mostly noise. */}
        {gridVals.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="#DFDFDF" strokeWidth="0.5" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" className="fill-ink-400" fontSize="11">{v}</text>
            </g>
          );
        })}
        {series.map((w, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const y = toY(w.km);
          const h = pad.top + chartH - y;
          const isLast = i === n - 1;
          // A rest period is a NOUGHT, not a gap. Skipping the rect entirely made a
          // zero week look like a week we have no data for, which is a different and
          // much worse claim — so every period draws, with a 2px floor so the zero
          // still reads as a mark sitting on the baseline.
          const isZero = w.km <= 0;
          return (
            <g key={w.weekStart}>
              <rect
                x={cx - barW / 2} y={isZero ? pad.top + chartH - 2 : y} width={barW}
                height={isZero ? 2 : Math.max(h, 2)} rx="3"
                // The emphasised bar is the DARKEST one. It used to be #159AFF, which
                // is lighter than the bars it was meant to stand out from (2.88:1 on
                // this card, under the 3:1 mark floor) and is also band-2's identity
                // colour, so the current period read as a דבוקה marker. Now: brand at
                // /55 for the series (3.04:1) and full brand for the current period
                // (7.28:1). The bold axis label below carries the same emphasis, so
                // it is never colour-alone.
                fill={isLast ? '#1525FF' : 'rgba(21, 37, 255, 0.55)'}
              />
              {(isLast || i === peakIdx) && w.km > 0 && (
                <text x={cx} y={y - 5} textAnchor="middle" className="fill-ink-500" fontSize="10" fontWeight="700">
                  {w.km}
                </text>
              )}
              {/* `|| isLast` because with 12 periods labelEvery is 2 and the last
                  index is odd, so the current period — the one the emphasis is
                  about — was the one label that never rendered. */}
              {(i % labelEvery === 0 || isLast) && (
                <text
                  x={cx} y={H - 22} textAnchor="middle" fontSize="10"
                  className={isLast ? 'fill-ink-700' : 'fill-ink-400'}
                  fontWeight={isLast ? 700 : undefined}
                >
                  {fmtPeriod(w.weekStart)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#BBBBBB" strokeWidth="1" />
      </svg>
      </div>

      <p className="mt-2 text-2xs text-ink-400">
        ק״מ {PER_PERIOD_LABEL[granularity]}{granularity === 'week' ? ' (ראשון–שבת)' : ''}, {data.weeksReturned} {RECENT_PERIODS_LABEL[granularity]}
      </p>
        </>
      )}
    </div>
  );
}
