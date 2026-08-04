'use client';

import { useApi } from '@/lib/api';

interface Summary { totalKm: number; thisMonthRuns: number; totalRuns: number; }

// Two headline stat tiles for the runner dashboard (design panel 4): all-time km
// and workouts this month. Reads /api/athletes/summary — SWR-cached and shared
// with MomentumCard, so both render from one request. Hidden until any runs.
export function StatTiles({ athleteId }: { athleteId: string }) {
  const { data: s } = useApi<Summary>(
    athleteId ? `/api/athletes/summary?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  if (!s || s.totalRuns === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3" dir="rtl">
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-4">
        <div className="text-3xl font-black text-primary-400 tabular-nums">{s.totalKm.toLocaleString('en-US')}</div>
        <div className="text-2xs text-slate-400 mt-1">ק״מ סה״כ</div>
      </div>
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-4">
        <div className="text-3xl font-black text-primary-400 tabular-nums">{s.thisMonthRuns}</div>
        <div className="text-2xs text-slate-400 mt-1">אימונים החודש</div>
      </div>
    </div>
  );
}
