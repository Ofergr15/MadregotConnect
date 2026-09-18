'use client';

import Link from 'next/link';
import { ChevronLeft, Flag } from 'lucide-react';
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
    <div className="rounded-card bg-card/80 border border-page/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">מרוצים</h2>
        </div>
        <span className="text-lg font-black text-ink-700 tabular-nums">{total}</span>
      </div>
      <div className="space-y-2">
        {/* Each race IS one activity — `activityId` is how the row was matched to
            a calendar event in the first place — so the row opens it. Reported as
            "I want to open the run from day x from the data screen and it doesn't
            open": the rows named runs and none of them was a link. */}
        {races.slice(0, 8).map((r) => (
          <Link
            key={r.id}
            href={`/dashboard/activities/${r.activityId}`}
            className="flex items-center gap-3 bg-page/50 rounded-xl p-3 active:opacity-60 transition-opacity"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-700 truncate" dir="auto">
                {r.eventName || r.activityName || 'מרוץ'}
              </div>
              <div className="text-xs text-ink-400 truncate" dir="auto">
                {fmtDate(r.date)}
                {r.location ? ` · ${r.location}` : ''}
              </div>
            </div>
            {r.distance ? (
              <div className="text-sm font-bold text-ink-500 tabular-nums shrink-0">
                {Math.round((r.distance / 1000) * 10) / 10} ק״מ
              </div>
            ) : null}
            <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
          </Link>
        ))}
      </div>
      <p className="mt-3 text-2xs text-ink-400">מחושב אוטומטית מהריצות שלך שמתאימות ליום מרוץ בלוח השנה</p>
    </div>
  );
}
