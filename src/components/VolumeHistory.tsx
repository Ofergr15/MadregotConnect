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
  /**
   * That week's OWN target band, from the plan published for it. Absent on a
   * week with no parsed plan, and absent entirely at month/year granularity —
   * a month has no target of its own.
   */
  target?: { min: number; max: number };
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
  // The ceilings count towards the scale too: a week whose target sat above
  // anything the athlete ran would otherwise have its band clipped off the top
  // of the chart, i.e. hidden in exactly the weeks that fell short.
  const maxKm = Math.max(data?.peakKm || 0, ...series.map((w) => Math.max(w.km, w.target?.max || 0)), 1);
  const hasTargets = series.some((w) => w.target);
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
        <defs>
          <linearGradient id="volBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1525FF" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#1525FF" stopOpacity={0.5} />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="#DFDFDF" strokeWidth="0.5" strokeDasharray="4 4" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" className="fill-ink-400" fontSize="11">{v}</text>
            </g>
          );
        })}
        {/* THE TARGET BAND, per week, behind the bars. One rect per slot rather
            than one across the chart: every week has its own plan, so a single
            band would judge a 78 km week against today's numbers when the plan
            it actually had asked for 70–85. Full slot width, so consecutive
            weeks with the same target merge into one ribbon and a week whose
            target changed reads as a step. The floor gets a line of its own —
            "did the bar reach the green" is the whole question. */}
        {series.map((w, i) =>
          w.target ? (
            <g key={`t-${w.weekStart}`}>
              <rect
                x={pad.left + slot * i}
                y={toY(w.target.max)}
                width={slot}
                height={Math.max(toY(w.target.min) - toY(w.target.max), 1)}
                fill="#22c55e"
                fillOpacity={0.18}
              />
              <line
                x1={pad.left + slot * i}
                x2={pad.left + slot * (i + 1)}
                y1={toY(w.target.min)}
                y2={toY(w.target.min)}
                stroke="#14532d"
                strokeOpacity={0.45}
                strokeWidth="1"
              />
            </g>
          ) : null,
        )}
        {series.map((w, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const y = toY(w.km);
          const h = pad.top + chartH - y;
          const isLast = i === n - 1;
          return (
            <g key={w.weekStart}>
              {w.km > 0 && (
                <rect
                  x={cx - barW / 2} y={y} width={barW} height={Math.max(h, 1)} rx="3"
                  fill={isLast ? '#159AFF' : 'url(#volBar)'}
                />
              )}
              {w.km > 0 && (
                <text x={cx} y={y - 5} textAnchor="middle" className="fill-ink-500" fontSize="10" fontWeight="700">
                  {w.km}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 22} textAnchor="middle" className="fill-ink-400" fontSize="10">{fmtPeriod(w.weekStart)}</text>
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
      {/* Only when something is actually painted green — on a stretch of weeks
          with no parsed plan the sentence would point at nothing. */}
      {hasTargets && (
        <p className="mt-1 flex items-center gap-1.5 text-2xs text-ink-400">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-tile bg-accent-500/25 ring-1 ring-accent-900/25" />
          <span>הירוק = טווח היעד של אותו שבוע, מהתכנית שפורסמה לו. שבוע בלי תכנית מפורסמת נשאר בלי יעד.</span>
        </p>
      )}
        </>
      )}
    </div>
  );
}
