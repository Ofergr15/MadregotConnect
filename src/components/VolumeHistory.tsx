'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

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

// Training-volume history — the athlete's weekly km over the last N weeks, from
// the durable weekly_km_snapshots table (nightly cron; complete incl. zero
// weeks). A hand-rolled SVG bar chart matching the app's chart style. Hidden
// until there's at least one week with a run, so it never shows an empty shell.
// Athlete-scoped via the same auth as /prs and /summary.
export function VolumeHistory({ athleteId, weeks = 12 }: { athleteId: string; weeks?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!athleteId) { setLoading(false); return; }
    const email = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    fetch(`/api/athletes/volume-history?athleteId=${encodeURIComponent(athleteId)}&weeks=${weeks}`, {
      headers: email ? { 'x-user-email': email } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [athleteId, weeks]);

  if (loading || !data) return null;
  const series = data.series || [];
  const ran = series.filter((w) => w.runs > 0);
  if (ran.length === 0) return null; // no volume yet → hide entirely

  // This-week vs prior-week trend (last two entries in chronological order).
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = prev ? Math.round((last.km - prev.km) * 10) / 10 : 0;
  const TrendIcon = delta > 0.05 ? TrendingUp : delta < -0.05 ? TrendingDown : Minus;
  const trendColor = delta > 0.05 ? 'text-emerald-400' : delta < -0.05 ? 'text-amber-400' : 'text-slate-400';

  // Chart geometry (viewBox; scales to container width).
  const W = 1000, H = 240;
  const pad = { top: 20, right: 16, bottom: 40, left: 40 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxKm = Math.max(data.peakKm, ...series.map((w) => w.km), 1);
  const n = series.length;
  const slot = chartW / n;
  const barW = Math.min(slot * 0.6, 46);
  const toY = (km: number) => pad.top + chartH - (km / maxKm) * chartH;

  // Y gridlines at 0 / half / peak.
  const gridVals = [0, Math.round(maxKm / 2), Math.round(maxKm)];
  const fmtWeek = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z');
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };
  // Label density: every week if ≤8, else every other.
  const labelEvery = n <= 8 ? 1 : 2;

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5" dir="rtl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">נפח שבועי</h2>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          {delta > 0 ? '+' : ''}{delta} ק״מ
        </span>
      </div>
      <div className="flex items-baseline gap-4 mb-3">
        <span className="text-xs text-slate-400">שיא: <b className="text-slate-200 tabular-nums">{data.peakKm}</b> ק״מ</span>
        <span className="text-xs text-slate-400">ממוצע: <b className="text-slate-200 tabular-nums">{data.avgKm}</b> ק״מ</span>
      </div>

      <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '220px' }}>
        <defs>
          <linearGradient id="volBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4338ff" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#4338ff" stopOpacity={0.5} />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="4 4" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" className="fill-slate-400" fontSize="11">{v}</text>
            </g>
          );
        })}
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
                  fill={isLast ? '#818cf8' : 'url(#volBar)'}
                />
              )}
              {w.km > 0 && (
                <text x={cx} y={y - 5} textAnchor="middle" className="fill-slate-300" fontSize="10" fontWeight="700">
                  {w.km}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 22} textAnchor="middle" className="fill-slate-500" fontSize="10">{fmtWeek(w.weekStart)}</text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + chartH} y2={pad.top + chartH} stroke="#475569" strokeWidth="1" />
      </svg>
      </div>

      <p className="mt-2 text-2xs text-slate-500">ק״מ לשבוע (שני–ראשון), {data.weeksReturned} שבועות אחרונים</p>
    </div>
  );
}
