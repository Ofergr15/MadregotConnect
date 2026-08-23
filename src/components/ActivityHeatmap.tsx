'use client';

import { useEffect, useMemo, useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { useApi } from '@/lib/api';

interface HeatmapDay { date: string; km: number }

const HE_MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const CELL_COLORS = ['bg-slate-800/60', 'bg-primary-900/60', 'bg-primary-700/70', 'bg-primary-500/85', 'bg-primary-400'];
const WEEKS_BACK = 53;

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Activity/rest pattern for the last ~53 weeks (GitHub-contribution-graph
// style) — a rolling year, weeks starting Sunday to match the rest of the
// app's Sun→Sat training-week model. Grid always flows oldest (left) to
// newest (right) regardless of locale — a time axis, not RTL prose.
export function ActivityHeatmap({ athleteId }: { athleteId: string }) {
  const { data } = useApi<{ days: HeatmapDay[] }>(
    athleteId ? `/api/athletes/heatmap?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const { weeks, totalKm, activeDays } = useMemo(() => {
    const kmByDay = new Map((data?.days || []).map((d) => [d.date, d.km]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS_BACK * 7 - 1));
    start.setDate(start.getDate() - start.getDay()); // back up to the Sunday on/before start

    const maxKm = Math.max(1, ...Array.from(kmByDay.values()));
    const bucket = (km: number) => {
      if (km <= 0) return 0;
      const ratio = km / maxKm;
      if (ratio <= 0.25) return 1;
      if (ratio <= 0.5) return 2;
      if (ratio <= 0.75) return 3;
      return 4;
    };

    const cols: { iso: string; km: number | null; bucket: number; monthLabel: string | null }[][] = [];
    let cur = new Date(start);
    let lastMonth = -1;
    while (cur <= today) {
      const col: { iso: string; km: number | null; bucket: number; monthLabel: string | null }[] = [];
      for (let i = 0; i < 7; i++) {
        const iso = isoDay(cur);
        const isFuture = cur > today;
        const km = isFuture ? null : kmByDay.get(iso) || 0;
        const month = cur.getMonth();
        const monthLabel = !isFuture && i === 0 && month !== lastMonth ? HE_MONTHS_SHORT[month] : null;
        if (monthLabel) lastMonth = month;
        col.push({ iso, km, bucket: km == null ? -1 : bucket(km), monthLabel });
        cur.setDate(cur.getDate() + 1);
      }
      cols.push(col);
    }

    let totalKm = 0;
    let activeDays = 0;
    for (const d of data?.days || []) {
      totalKm += d.km;
      if (d.km > 0) activeDays++;
    }

    return { weeks: cols, totalKm: Math.round(totalKm), activeDays };
  }, [data]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [data]);

  if (!data) return null;

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4" dir="rtl">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">פעילות בשנה האחרונה</h2>
        </div>
        <span className="text-xs text-slate-400">{totalKm} ק״מ · {activeDays} ימי פעילות</span>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1" dir="ltr">
        <div className="inline-flex flex-col gap-1 min-w-full">
          <div className="flex gap-[3px] h-3">
            {weeks.map((col, i) => (
              <div key={i} className="w-[11px] shrink-0 text-[9px] text-slate-500 leading-none whitespace-nowrap">
                {col[0].monthLabel || ''}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((col, i) => (
              <div key={i} className="flex flex-col gap-[3px] shrink-0">
                {col.map((day, j) => (
                  <div
                    key={j}
                    className={`w-[11px] h-[11px] rounded-[3px] ${day.bucket === -1 ? 'bg-transparent' : CELL_COLORS[day.bucket]}`}
                    title={day.km != null ? `${day.iso}: ${day.km} ק״מ` : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 mt-3" dir="rtl">
        <span className="text-2xs text-slate-500">מעט</span>
        {CELL_COLORS.map((c, i) => (
          <span key={i} className={`w-[10px] h-[10px] rounded-[2px] ${c}`} />
        ))}
        <span className="text-2xs text-slate-500">הרבה</span>
      </div>
    </div>
  );
}
