'use client';

import { Flag } from 'lucide-react';
import { useApi } from '@/lib/api';

interface RaceRow {
  id: string;
  activityId: string;
  eventId: string | null;
  matchMethod: 'auto' | 'manual';
  activityName: string | null;
  date: string | null;
  distance: number | null;
  duration: number | null;
  eventName: string | null;
  location: string | null;
  raceClass: string | null;
}

interface RaceData {
  races?: RaceRow[];
  totalRaces?: number;
}

// Race-count analytic (roadmap #20) — auto-detected from the athlete's
// activities matched against the calendar's race events by same-day date
// proximity (src/lib/races/match-athlete-races.ts), with room for manual
// tagging/correction on top. Sibling card to PersonalRecords; hidden entirely
// if the athlete hasn't completed a race yet, so it never shows an empty shell.
export function RaceHistory({ athleteId }: { athleteId: string }) {
  const { data } = useApi<RaceData>(
    athleteId ? `/api/athletes/races?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const races = data?.races || [];
  const total = data?.totalRaces ?? races.length;

  if (total === 0) return null;

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' }) : '';

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-primary-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">מרוצים</h2>
        </div>
        <span className="text-lg font-black text-white tabular-nums">{total}</span>
      </div>
      <div className="space-y-2">
        {races.slice(0, 8).map((r) => (
          <div key={r.id} className="flex items-center gap-3 bg-slate-900/50 rounded-xl p-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate" dir="auto">
                {r.eventName || r.activityName || 'מרוץ'}
              </div>
              <div className="text-xs text-slate-400 truncate" dir="auto">
                {fmtDate(r.date)}
                {r.location ? ` · ${r.location}` : ''}
              </div>
            </div>
            {r.distance ? (
              <div className="text-sm font-bold text-slate-300 tabular-nums shrink-0">
                {Math.round((r.distance / 1000) * 10) / 10} ק״מ
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-2xs text-slate-500">מחושב אוטומטית מהריצות שלך שמתאימות ליום מרוץ בלוח השנה</p>
    </div>
  );
}
