'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonList, SegmentedControl, EmptyState } from '@/components/ui';

interface Row {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  squad: string | null;
  squadColor: string | null;
  series: number[];
  thisWeekKm: number;
  thisWeekRuns: number;
  deltaKm: number;
  avgKm: number;
  peakKm: number;
}

// Coach team-volume overview: every active athlete's recent weekly km, from the
// durable weekly_km_snapshots table, with a per-athlete sparkline + this-week vs
// last-week trend so a coach can spot who's ramping up or dropping off.
// Staff-only (server-enforced); this page assumes the coach nav gate.
export default function TeamVolumePage() {
  const t = useTranslations('teamVolume');
  const [range, setRange] = useState(8);
  const { data } = useApi<{ athletes?: Row[]; weeks?: string[] }>(`/api/coach/volume?weeks=${range}`);
  const rows = data?.athletes || [];
  const loading = !data;

  // Shared max across all athletes so sparklines are comparable.
  const globalMax = useMemo(() => Math.max(1, ...rows.flatMap((r) => r.series)), [rows]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-700 flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-brand-600" /> {t('title')}
        </h1>
        <p className="text-sm text-ink-400 mt-1">{t('subtitle')}</p>
      </div>

      <SegmentedControl
        value={String(range)}
        onChange={(v) => setRange(Number(v))}
        options={[8, 12, 16].map((w) => ({ value: String(w), label: t('weeksOption', { w }) }))}
        className="mb-4 w-fit"
      />

      {loading ? (
        <SkeletonList count={6} />
      ) : rows.length === 0 ? (
        <EmptyState icon={BarChart3} title={t('noData')} />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => <VolumeRow key={r.athleteId} r={r} globalMax={globalMax} />)}
        </div>
      )}
    </div>
  );
}

function VolumeRow({ r, globalMax }: { r: Row; globalMax: number }) {
  const t = useTranslations('teamVolume');
  const TrendIcon = r.deltaKm > 0.05 ? TrendingUp : r.deltaKm < -0.05 ? TrendingDown : Minus;
  // The -ink companions, not the fill colours: this is 11px text on a
  // card/60 tile, where accent-600 measures 2.95:1 and band-3 2.89:1.
  const trendColor = r.deltaKm > 0.05 ? 'text-accent-900' : r.deltaKm < -0.05 ? 'text-band-3-ink' : 'text-ink-400';
  const initials = (r.name.split(' ').map((x) => x[0]).join('').toUpperCase().slice(0, 2)) || '?';

  // Sparkline geometry — bars, shared globalMax so rows are comparable.
  const W = 240, H = 44, n = r.series.length;
  const slot = n > 0 ? W / n : W;
  const barW = Math.min(slot * 0.62, 14);
  const toH = (km: number) => Math.max((km / globalMax) * (H - 6), km > 0 ? 2 : 0);

  return (
    <div className="rounded-xl border border-page bg-card/60 p-3 flex items-center gap-3">
      {/* Athlete */}
      <div className="flex items-center gap-2.5 w-[42%] min-w-0">
        {r.avatarUrl
          ? <img src={r.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
          : <span className="w-9 h-9 rounded-full bg-page flex items-center justify-center text-2xs font-bold text-ink-700 shrink-0">{initials}</span>}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-ink-700 truncate" dir="auto">{r.name}</span>
            {r.squad && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.squadColor || '#159AFF' }} />}
          </div>
          <div className="text-2xs text-ink-400">{t('avgPeak', { avg: r.avgKm, peak: r.peakKm })}</div>
        </div>
      </div>

      {/* Sparkline */}
      <div className="flex-1 min-w-0" dir="ltr">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '40px' }} preserveAspectRatio="none">
          {r.series.map((km, i) => {
            const h = toH(km);
            const x = slot * i + (slot - barW) / 2;
            const isLast = i === n - 1;
            return <rect key={i} x={x} y={H - h} width={barW} height={h} rx="1.5" fill={isLast ? '#159AFF' : '#1525FF'} opacity={isLast ? 1 : 0.55} />;
          })}
        </svg>
      </div>

      {/* This week + trend */}
      <div className="w-[86px] text-end shrink-0">
        <div className="text-base font-black text-ink-700 tabular-nums">{r.thisWeekKm}<span className="text-2xs font-normal text-ink-400"> {t('km')}</span></div>
        <div className={`inline-flex items-center gap-0.5 text-2xs font-semibold ${trendColor}`}>
          <TrendIcon className="h-3 w-3" />{r.deltaKm > 0 ? '+' : ''}{r.deltaKm}
        </div>
      </div>
    </div>
  );
}
